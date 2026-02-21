import { EventEmitter } from 'events';
import { SSPBus } from './ssp-bus';
import { SSPResponse, SSP_GENERIC } from './ssp-packet';

// Dirección SSP del SCS en el bus RS485 (PDF GA02205 sección 4.1.1)
const SCS_ADDRESS = 0x10;

// Comandos SSP (PDF GA02205 sección 4)
const CMD = {
  SYNC:                  0x11,
  HOST_PROTOCOL_VERSION: 0x06,
  SETUP_REQUEST:         0x05,
  SET_COIN_INHIBIT:      0x40, // por denominación, no por byte de canal
  SET_DENOMINATION_ROUTE: 0x3b,
  SET_OPTIONS:           0x4a,
  ENABLE:                0x0a,
  DISABLE:               0x09,
  POLL:                  0x07,
  POLL_WITH_ACK:         0x56,
  EVENT_ACK:             0x57,
  RESET:                 0x01,
  GET_ALL_LEVELS:        0x22,
  PAYOUT_AMOUNT:         0x33,
  PAYOUT_BY_DENOMINATION: 0x46,
  EMPTY:                 0x3f,
  SMART_EMPTY:           0x52,
} as const;

// Eventos de poll del SCS (PDF GA02205 sección 4.3.1)
const EVT = {
  SLAVE_RESET:        0xf1,
  COIN_CREDIT:        0xda, // value added — moneda aceptada y creditada
  VALUE_ADDED:        0xbf, // valor acumulado agregado desde último poll
  PAY_IN_ACTIVE:      0xc1, // metal detector activado
  COIN_REJECTED:      0xba,
  DISPENSING:         0xda,
  DISPENSED:          0xd2,
  COINS_LOW:          0xd3,
  DEVICE_FULL:        0xd4,
  JAMMED:             0xd5,
  HALTED:             0xd6,
  FLOATING:           0xd7,
  FLOATED:            0xd8,
  TIMEOUT:            0xd9,
  INCOMPLETE_PAYOUT:  0xdc,
  INCOMPLETE_FLOAT:   0xdd,
  CASHBOX_PAID:       0xde,
  COIN_CREDIT_EVT:    0xdf,
  DISABLED:           0xe8,
  CALIBRATION_FAIL:   0x83,
  FRAUD_ATTEMPT:      0xe6,
} as const;

export interface CoinDenomination {
  level:    number;   // cantidad actual en hopper
  value:    number;   // valor en centavos
  country:  string;   // código ASCII ej: 'USD'
}

export interface SCSInfo {
  firmwareVersion: string;
  countryCode:     string;
  numChannels:     number;
  denominations:   CoinDenomination[];
  protocolVersion: number;
}

export class SCS extends EventEmitter {
  private bus:    SSPBus;
  private info:   SCSInfo | null = null;
  private ready:  boolean = false;
  private currencyCode: string;

  constructor(bus: SSPBus, currencyCode = 'USD') {
    super();
    this.bus          = bus;
    this.currencyCode = currencyCode;
    this.bus.registerAddress(SCS_ADDRESS);

    // Escuchar eventos de poll del bus
    this.bus.on('poll', (address: number, res: SSPResponse) => {
      if (address === SCS_ADDRESS) this.handlePollResponse(res);
    });
  }

  get isReady()    { return this.ready; }
  get deviceInfo() { return this.info; }

  // ── Secuencia de inicialización (PDF GA02205 sección 4.2) ────────────────
  async init(): Promise<void> {
    console.log('[SCS] Iniciando secuencia de setup...');

    // 1. SYNC
    await this.send(Buffer.from([CMD.SYNC]));
    console.log('[SCS] SYNC OK');

    // 2. HOST_PROTOCOL_VERSION 8
    await this.send(Buffer.from([CMD.HOST_PROTOCOL_VERSION, 0x08]));
    console.log('[SCS] Protocol version 8 OK');

    // 3. SETUP_REQUEST — obtener denominaciones disponibles
    const setupRes = await this.send(Buffer.from([CMD.SETUP_REQUEST]));
    this.info = this.parseSetupResponse(setupRes.data);
    console.log(`[SCS] Setup: ${this.info.numChannels} denominaciones, firmware ${this.info.firmwareVersion}`);

    // 4. SET_DENOMINATION_ROUTE — todas las monedas al hopper (payout)
    // route=0 → payout (reciclar), route=1 → cashbox
    for (const denom of this.info.denominations) {
      await this.setDenominationRoute(denom.value, 0); // 0 = payout/hopper
    }
    console.log('[SCS] Rutas configuradas → hopper');

    // 5. SET_COIN_INHIBIT — habilitar todas las denominaciones
    for (const denom of this.info.denominations) {
      await this.setCoinInhibit(denom.value, true);
    }
    console.log('[SCS] Inhibits OK (todas las denominaciones habilitadas)');

    // 6. SET_OPTIONS — velocidad alta, level check ON (PDF sección 4.2.7)
    // REG0: bit1=LevelCheck(1), bit2=HighSpeed(1) → 0x06
    // REG1: bit0=RejectEvents(1), bit4=ValueCoin(1) → 0x11
    await this.send(Buffer.from([CMD.SET_OPTIONS, 0x06, 0x11]));
    console.log('[SCS] Opciones configuradas');

    // 7. ENABLE
    await this.enable();

    this.ready = true;
    console.log('[SCS] ✅ Listo para aceptar monedas');
    this.emit('ready', this.info);
  }

  async enable(): Promise<void> {
    await this.send(Buffer.from([CMD.ENABLE]));
    console.log('[SCS] ENABLE OK — LED frontal debería parpadear verde');
    this.emit('enabled');
  }

  async disable(): Promise<void> {
    await this.send(Buffer.from([CMD.DISABLE]));
    console.log('[SCS] DISABLE OK');
    this.emit('disabled');
  }

  async reset(): Promise<void> {
    await this.send(Buffer.from([CMD.RESET]));
    this.ready = false;
    console.log('[SCS] RESET enviado');
  }

  // ── Payout de cambio (PDF sección 4.3.3) ────────────────────────────────
  // ENCRYPTION MANDATORY para este comando
  async payoutAmount(amountCents: number): Promise<void> {
    const countryBuf = Buffer.from(this.currencyCode.padEnd(3, ' ').slice(0, 3), 'ascii');
    const valueBuf   = Buffer.alloc(4);
    valueBuf.writeUInt32LE(amountCents, 0);

    // Opción 0x58 = ejecutar payout real (0x19 = test solamente)
    const data = Buffer.concat([
      Buffer.from([CMD.PAYOUT_AMOUNT]),
      valueBuf,
      countryBuf,
      Buffer.from([0x58]),
    ]);

    console.log(`[SCS] Dispensando cambio: ${amountCents} centavos`);
    const res = await this.send(data);

    if (res.generic === SSP_GENERIC.CANNOT_PROCESS) {
      const errCode = res.data[0];
      const errMap: Record<number, string> = {
        1: 'No hay suficiente valor en el hopper',
        2: 'No puede dar cambio exacto',
        3: 'Ocupado',
        4: 'Dispositivo deshabilitado',
      };
      throw new Error(`[SCS] Payout fallido: ${errMap[errCode] ?? `código ${errCode}`}`);
    }
  }

  // ── Configurar ruta de denominación ─────────────────────────────────────
  private async setDenominationRoute(valueCents: number, route: 0 | 1): Promise<void> {
    const countryBuf = Buffer.from(this.currencyCode.padEnd(3, ' ').slice(0, 3), 'ascii');
    const valueBuf   = Buffer.alloc(4);
    valueBuf.writeUInt32LE(valueCents, 0);

    const data = Buffer.concat([
      Buffer.from([CMD.SET_DENOMINATION_ROUTE, route]),
      valueBuf,
      countryBuf,
    ]);
    await this.send(data);
  }

  // ── Habilitar/deshabilitar una denominación ──────────────────────────────
  private async setCoinInhibit(valueCents: number, enable: boolean): Promise<void> {
    const countryBuf = Buffer.from(this.currencyCode.padEnd(3, ' ').slice(0, 3), 'ascii');
    const valueBuf   = Buffer.alloc(2);
    valueBuf.writeUInt16LE(valueCents, 0);

    // CMD 0x40: [enable(0/1), value(2 bytes LE), countryCode(3 bytes ASCII)]
    const data = Buffer.concat([
      Buffer.from([CMD.SET_COIN_INHIBIT, enable ? 0x01 : 0x00]),
      valueBuf,
      countryBuf,
    ]);
    await this.send(data);
  }

  // ── Manejo de eventos de poll ────────────────────────────────────────────
  private handlePollResponse(res: SSPResponse) {
    if (res.generic === SSP_GENERIC.OK && res.data.length === 0) return; // idle

    let i = 0;
    while (i < res.data.length) {
      const evt = res.data[i];

      switch (evt) {
        case EVT.SLAVE_RESET:
          console.log('[SCS] ⚠️  Dispositivo reseteado');
          this.ready = false;
          this.emit('reset');
          this.init().catch(e => console.error('[SCS] Re-init error:', e.message));
          i++;
          break;

        case EVT.VALUE_ADDED: {
          // PDF sección 4.3.2: VALUE_ADDED 0xBF
          // [numCountries(1)] [value(4 bytes LE)] [country(3 bytes ASCII)] ...
          const numCountries = res.data[i + 1] ?? 1;
          for (let c = 0; c < numCountries; c++) {
            const offset  = i + 2 + (c * 7);
            const value   = res.data.readUInt32LE(offset);
            const country = res.data.slice(offset + 4, offset + 7).toString('ascii').trim();
            console.log(`[SCS] 🪙 Valor agregado: ${value} centavos (${country})`);
            this.emit('valueAdded', value, country);
          }
          i += 2 + (numCountries * 7);
          break;
        }

        case EVT.PAY_IN_ACTIVE:
          this.emit('payInActive');
          i++;
          break;

        case EVT.COIN_REJECTED:
          console.log('[SCS] ❌ Moneda rechazada');
          this.emit('rejected');
          i++;
          break;

        case EVT.DISPENSING: {
          const value   = res.data.readUInt32LE(i + 1);
          const country = res.data.slice(i + 5, i + 8).toString('ascii').trim();
          this.emit('dispensing', value, country);
          i += 8;
          break;
        }

        case EVT.DISPENSED: {
          const value   = res.data.readUInt32LE(i + 1);
          const country = res.data.slice(i + 5, i + 8).toString('ascii').trim();
          console.log(`[SCS] ✅ Dispensado: ${value} centavos (${country})`);
          this.emit('dispensed', value, country);
          i += 8;
          break;
        }

        case EVT.COINS_LOW:
          console.warn('[SCS] ⚠️  Monedas bajas');
          this.emit('coinsLow');
          i++;
          break;

        case EVT.DEVICE_FULL:
          console.warn('[SCS] ⚠️  Hopper lleno');
          this.emit('deviceFull');
          i++;
          break;

        case EVT.JAMMED:
          console.warn('[SCS] ⚠️  Moneda atascada');
          this.emit('jammed');
          i++;
          break;

        case EVT.TIMEOUT:
          console.warn('[SCS] ⚠️  Timeout interno');
          this.emit('timeout');
          i++;
          break;

        case EVT.INCOMPLETE_PAYOUT: {
          const paid    = res.data.readUInt32LE(i + 1);
          const request = res.data.readUInt32LE(i + 5);
          const country = res.data.slice(i + 9, i + 12).toString('ascii').trim();
          console.warn(`[SCS] ⚠️  Payout incompleto: pagado ${paid} de ${request} (${country})`);
          this.emit('incompletePayout', paid, request, country);
          i += 12;
          break;
        }

        case EVT.DISABLED:
          this.emit('disabled');
          i++;
          break;

        case EVT.FRAUD_ATTEMPT:
          console.warn('[SCS] 🚨 Intento de fraude');
          this.emit('fraud');
          i++;
          break;

        default:
          i++;
      }
    }
  }

  // ── Parsear respuesta de SETUP_REQUEST ───────────────────────────────────
  private parseSetupResponse(data: Buffer): SCSInfo {
    const firmwareVersion = data.slice(1, 5).toString('ascii');
    const countryCode     = data.slice(5, 8).toString('ascii');
    const numChannels     = data[11] ?? 0;
    const protocolVersion = data[15 + numChannels] ?? 0;
    const denominations: CoinDenomination[] = [];

    // Valores expandidos protocol v6+: offset 16+n+5, 4 bytes por canal
    for (let i = 0; i < numChannels; i++) {
      const valueOffset = 16 + numChannels + numChannels + (i * 7);
      const value       = data.readUInt32LE(valueOffset);
      const country     = data.slice(valueOffset + 4, valueOffset + 7).toString('ascii').trim();
      denominations.push({ level: 0, value, country });
    }

    return { firmwareVersion, countryCode, numChannels, denominations, protocolVersion };
  }

  // ── Envío de comando al bus con validación ───────────────────────────────
  private async send(data: Buffer): Promise<SSPResponse> {
    const res = await this.bus.send(SCS_ADDRESS, data);

    if (res.generic === SSP_GENERIC.UNKNOWN_CMD) {
      throw new Error(`[SCS] Comando desconocido: 0x${data[0].toString(16)}`);
    }
    if (res.generic === SSP_GENERIC.CANNOT_PROCESS) {
      // No lanzar — el llamador decide qué hacer con esto
      return res;
    }
    if (res.generic === SSP_GENERIC.FAIL) {
      throw new Error(`[SCS] Comando fallido: 0x${data[0].toString(16)}`);
    }

    return res;
  }
}
