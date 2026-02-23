// backend/src/ssp/scs.ts
// SMART Coin System (SCS) — Driver SSP completo
// Dirección RS485: 0x10 | Protocolo: SSP v6 máximo
// Referencia: SCS-SSP-Implementation-Test-Script-v1.1

import { EventEmitter } from 'events';
import { SSPBus }       from './ssp-bus';
import { SSPResponse, SSP_GENERIC } from './ssp-packet';

// ── Constantes ───────────────────────────────────────────────────────────────

const SCS_ADDRESS = 0x10;

const CMD = {
  SYNC:                   0x11,
  HOST_PROTOCOL_VERSION:  0x06,
  SETUP_REQUEST:          0x05,
  SET_COIN_INHIBIT:       0x40,
  SET_DENOMINATION_ROUTE: 0x3b,
  SET_OPTIONS:            0x4a,
  ENABLE:                 0x0a,
  DISABLE:                0x09,
  POLL:                   0x07,
  POLL_WITH_ACK:          0x56,
  EVENT_ACK:              0x57,
  RESET:                  0x01,
  GET_ALL_LEVELS:         0x22,
  PAYOUT_AMOUNT:          0x33,
  PAYOUT_BY_DENOMINATION: 0x46,
  EMPTY:                  0x3f,
  SMART_EMPTY:            0x52,
} as const;

// Eventos de poll — PDF GA02205 sección 4.3
// 0xDA = COIN_CREDIT (moneda aceptada y acreditada al host)
// 0xD1 = DISPENSING  (en proceso de dispensar)
// 0xD2 = DISPENSED   (moneda dispensada como cambio)
const EVT = {
  SLAVE_RESET:       0xf1,
  COIN_CREDIT:       0xda, // [valor 4B LE][país 3B ASCII]
  DISPENSING:        0xd1, // [valor 4B LE][país 3B ASCII]
  DISPENSED:         0xd2, // [valor 4B LE][país 3B ASCII]
  VALUE_ADDED:       0xbf, // [numCountries 1B][valor 4B LE][país 3B ASCII] x N
  PAY_IN_ACTIVE:     0xc1,
  COIN_REJECTED:     0xba,
  COINS_LOW:         0xd3,
  DEVICE_FULL:       0xd4,
  JAMMED:            0xd5,
  HALTED:            0xd6,
  FLOATING:          0xd7,
  FLOATED:           0xd8,
  TIMEOUT_EVT:       0xd9,
  INCOMPLETE_PAYOUT: 0xdc, // [pagado 4B LE][solicitado 4B LE][país 3B ASCII]
  INCOMPLETE_FLOAT:  0xdd,
  CASHBOX_PAID:      0xde,
  DISABLED:          0xe8,
  CALIBRATION_FAIL:  0x83,
  FRAUD_ATTEMPT:     0xe6,
} as const;

// ── Interfaces públicas ───────────────────────────────────────────────────────

export interface CoinDenomination {
  channel: number; // canal 1-based
  value:   number; // valor en centavos (ej: 25 = $0.25)
  country: string; // código ASCII 3 chars (ej: 'USD')
}

export interface SCSInfo {
  firmwareVersion: string;
  countryCode:     string;
  numChannels:     number;
  denominations:   CoinDenomination[];
  protocolVersion: number;
}

// ── Clase principal ───────────────────────────────────────────────────────────

export class SCS extends EventEmitter {
  private bus:          SSPBus;
  private currencyCode: string;
  private info:         SCSInfo | null = null;
  private ready:        boolean        = false;

  constructor(bus: SSPBus, currencyCode = 'USD') {
    super();
    this.bus          = bus;
    this.currencyCode = currencyCode;
    // Registrar dirección para que el bus gestione el seqBit de forma independiente
    this.bus.registerAddress(SCS_ADDRESS);
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  get isReady():    boolean        { return this.ready; }
  get deviceInfo(): SCSInfo | null { return this.info;  }

  // ── Init — secuencia según PDF GA02205 sección 4.2 ───────────────────────

  async init(): Promise<void> {
    console.log('[SCS] Iniciando secuencia de setup...');

    // 1. SYNC
    const syncRes = await this.send(Buffer.from([CMD.SYNC]));
    if (syncRes.generic !== SSP_GENERIC.OK) {
      throw new Error(`[SCS] SYNC failed: 0x${syncRes.generic.toString(16)}`);
    }
    console.log('[SCS] SYNC OK');

    // 2. HOST_PROTOCOL_VERSION
    // SCS soporta máximo v6 — v8 devuelve 0xF8 (FAIL)
    // Negociar desde 6 hacia abajo por compatibilidad con firmware antiguo
    let negotiatedVersion = 0;
    for (const ver of [6, 5, 4]) {
      const res = await this.send(Buffer.from([CMD.HOST_PROTOCOL_VERSION, ver]));
      if (res.generic === SSP_GENERIC.OK) {
        negotiatedVersion = ver;
        break;
      }
      console.warn(`[SCS] Protocol v${ver} rechazado (0x${res.generic.toString(16)})`);
    }
    if (negotiatedVersion === 0) {
      throw new Error('[SCS] No se pudo negociar protocol version (v4/v5/v6 fallaron)');
    }
    console.log(`[SCS] Protocol version ${negotiatedVersion} OK`);

    // 3. SETUP_REQUEST
    const setupRes = await this.send(Buffer.from([CMD.SETUP_REQUEST]));
    if (setupRes.generic !== SSP_GENERIC.OK) {
      throw new Error(`[SCS] SETUP_REQUEST failed: 0x${setupRes.generic.toString(16)}`);
    }
    this.info = this.parseSetupResponse(setupRes.data);
    console.log(
      `[SCS] Setup: ${this.info.numChannels} canales | ` +
      `firmware: ${this.info.firmwareVersion} | ` +
      `protocolo: v${this.info.protocolVersion}`
    );
    console.log(
      '[SCS] Denominaciones:',
      this.info.denominations
        .map(d => `ch${d.channel}=$${(d.value / 100).toFixed(2)}`)
        .join(', ')
    );

    // 4. ENABLE
    // El SCS no usa SET_INHIBITS por máscara de canal.
    // Para inhibir denominaciones específicas usar setCoinInhibit() después.
    const enRes = await this.send(Buffer.from([CMD.ENABLE]));
    if (enRes.generic !== SSP_GENERIC.OK) {
      throw new Error(`[SCS] ENABLE failed: 0x${enRes.generic.toString(16)}`);
    }
    console.log('[SCS] ENABLE OK — aceptando monedas');

    this.ready = true;
  }

  // ── Comandos de control ───────────────────────────────────────────────────

  async enable(): Promise<void> {
    const res = await this.send(Buffer.from([CMD.ENABLE]));
    if (res.generic !== SSP_GENERIC.OK) {
      throw new Error(`[SCS] ENABLE failed: 0x${res.generic.toString(16)}`);
    }
    this.ready = true;
    console.log('[SCS] ENABLE OK');
    this.emit('enabled');
  }

  async disable(): Promise<void> {
    const res = await this.send(Buffer.from([CMD.DISABLE]));
    if (res.generic !== SSP_GENERIC.OK) {
      throw new Error(`[SCS] DISABLE failed: 0x${res.generic.toString(16)}`);
    }
    this.ready = false;
    console.log('[SCS] DISABLE OK');
    this.emit('disabled');
  }

  async reset(): Promise<void> {
    await this.send(Buffer.from([CMD.RESET]));
    this.ready = false;
    console.log('[SCS] RESET enviado');
  }

  // ── Poll manual — llamado desde sspService en el loop interleaved ─────────

  async poll(): Promise<void> {
    if (!this.ready) return;
    // POLL_WITH_ACK (0x56): el dispositivo retiene el evento hasta recibir EVENT_ACK (0x57)
    // Esto evita que el mismo evento se repita en el siguiente poll
    const res = await this.send(Buffer.from([CMD.POLL_WITH_ACK]));
    if (res.generic === SSP_GENERIC.OK) {
      await this.handlePollResponse(res.data);
    }
  }

  // ── Payout de cambio ──────────────────────────────────────────────────────

  async payoutAmount(amountCents: number): Promise<void> {
    const valueBuf = Buffer.alloc(4);
    valueBuf.writeUInt32LE(amountCents, 0);
    const countryBuf = Buffer.from(
      this.currencyCode.padEnd(3, ' ').slice(0, 3), 'ascii'
    );
    // 0x58 = ejecutar payout real | 0x19 = solo verificar disponibilidad
    const data = Buffer.concat([
      Buffer.from([CMD.PAYOUT_AMOUNT]),
      valueBuf,
      countryBuf,
      Buffer.from([0x58]),
    ]);
    console.log(`[SCS] Dispensando cambio: $${(amountCents / 100).toFixed(2)}`);
    const res = await this.send(data);
    if (res.generic === SSP_GENERIC.CANNOT_PROCESS) {
      const errCode = res.data[0];
      const errMap: Record<number, string> = {
        1: 'Valor insuficiente en hopper',
        2: 'No puede dar cambio exacto',
        3: 'Dispositivo ocupado',
        4: 'Dispositivo deshabilitado',
      };
      throw new Error(
        `[SCS] Payout fallido: ${errMap[errCode] ?? `código ${errCode}`}`
      );
    }
    if (res.generic !== SSP_GENERIC.OK) {
      throw new Error(`[SCS] Payout error: 0x${res.generic.toString(16)}`);
    }
  }

  // ── Inhibir/desinhibir denominación específica ────────────────────────────

  async setCoinInhibit(valueCents: number, inhibit: boolean): Promise<void> {
    const valueBuf = Buffer.alloc(2);
    valueBuf.writeUInt16LE(valueCents, 0);
    const countryBuf = Buffer.from(
      this.currencyCode.padEnd(3, ' ').slice(0, 3), 'ascii'
    );
    // CMD 0x40: [0=allow / 0=inhibit][value 2B LE][country 3B ASCII]
    // NOTA: 0x01 = allow, 0x00 = inhibit
    const data = Buffer.concat([
      Buffer.from([CMD.SET_COIN_INHIBIT, inhibit ? 0x00 : 0x01]),
      valueBuf,
      countryBuf,
    ]);
    const res = await this.send(data);
    if (res.generic !== SSP_GENERIC.OK) {
      throw new Error(`[SCS] SET_COIN_INHIBIT failed: 0x${res.generic.toString(16)}`);
    }
  }

  // ── Configurar ruta de denominación (cashbox vs hopper/recycler) ──────────

  async setDenominationRoute(valueCents: number, toHopper: boolean): Promise<void> {
    const valueBuf = Buffer.alloc(4);
    valueBuf.writeUInt32LE(valueCents, 0);
    const countryBuf = Buffer.from(
      this.currencyCode.padEnd(3, ' ').slice(0, 3), 'ascii'
    );
    // route: 0 = cashbox | 1 = hopper/recycler
    const data = Buffer.concat([
      Buffer.from([CMD.SET_DENOMINATION_ROUTE, toHopper ? 1 : 0]),
      valueBuf,
      countryBuf,
    ]);
    const res = await this.send(data);
    if (res.generic !== SSP_GENERIC.OK) {
      throw new Error(`[SCS] SET_DENOMINATION_ROUTE failed: 0x${res.generic.toString(16)}`);
    }
  }

  // ── Manejo de eventos de poll ─────────────────────────────────────────────

  private async handlePollResponse(data: Buffer): Promise<void> {
    if (data.length === 0) return; // idle — sin eventos

    let i = 0;
    let hasEvents = false;

    while (i < data.length) {
      const evt = data[i];

      switch (evt) {

        case EVT.SLAVE_RESET: {
          console.warn('[SCS] SLAVE_RESET — re-inicializando...');
          this.ready = false;
          this.emit('reset');
          // Re-init asíncrono sin bloquear el loop de poll
          setImmediate(() =>
            this.init().catch(e => console.error('[SCS] Re-init error:', e.message))
          );
          i++;
          hasEvents = true;
          break;
        }

        case EVT.COIN_CREDIT: {
          // Estructura: [0xDA][valor 4B LE][país 3B ASCII]
          if (i + 7 >= data.length) { i++; break; }
          const amount  = data.readUInt32LE(i + 1);
          const country = data.slice(i + 5, i + 8).toString('ascii').trim();
          console.log(`[SCS] COIN_CREDIT: $${(amount / 100).toFixed(2)} (${country})`);
          this.emit('COIN_CREDIT', { amount, country });
          i += 8;
          hasEvents = true;
          break;
        }

                case EVT.VALUE_ADDED: {
          // Estructura: [0xBF][numCountries 1B] ([valor 4B LE][país 3B ASCII]) x N
          const numCountries = data[i + 1] ?? 1;
          for (let c = 0; c < numCountries; c++) {
            const offset  = i + 2 + (c * 7);
            if (offset + 7 > data.length) break;
            const amount  = data.readUInt32LE(offset);
            const country = data.slice(offset + 4, offset + 7).toString('ascii').trim();
            console.log(`[SCS] VALUE_ADDED: $${(amount / 100).toFixed(2)} (${country})`);
            this.emit('VALUE_ADDED', { amount, country });
          }
          i += 2 + (numCountries * 7);
          hasEvents = true;
          break;
        }

        case EVT.PAY_IN_ACTIVE: {
          this.emit('payInActive');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.COIN_REJECTED: {
          console.log('[SCS] COIN_REJECTED — moneda rechazada');
          this.emit('COIN_REJECTED');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.DISPENSING: {
          // Estructura: [0xD1][valor 4B LE][país 3B ASCII]
          if (i + 7 >= data.length) { i++; break; }
          const amount  = data.readUInt32LE(i + 1);
          const country = data.slice(i + 5, i + 8).toString('ascii').trim();
          console.log(`[SCS] DISPENSING: $${(amount / 100).toFixed(2)} (${country})`);
          this.emit('dispensing', { amount, country });
          i += 8;
          hasEvents = true;
          break;
        }

        case EVT.DISPENSED: {
          // Estructura: [0xD2][valor 4B LE][país 3B ASCII]
          if (i + 7 >= data.length) { i++; break; }
          const amount  = data.readUInt32LE(i + 1);
          const country = data.slice(i + 5, i + 8).toString('ascii').trim();
          console.log(`[SCS] DISPENSED: $${(amount / 100).toFixed(2)} (${country})`);
          this.emit('dispensed', { amount, country });
          i += 8;
          hasEvents = true;
          break;
        }

        case EVT.COINS_LOW: {
          console.warn('[SCS] COINS_LOW — monedas bajas en hopper');
          this.emit('coinsLow');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.DEVICE_FULL: {
          console.warn('[SCS] DEVICE_FULL — hopper lleno');
          this.emit('deviceFull');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.JAMMED: {
          console.warn('[SCS] JAMMED — moneda atascada');
          this.emit('jammed');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.HALTED: {
          console.warn('[SCS] HALTED');
          this.emit('halted');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.FLOATING: {
          // Estructura: [0xD7][valor 4B LE][país 3B ASCII]
          if (i + 7 >= data.length) { i++; break; }
          const amount  = data.readUInt32LE(i + 1);
          const country = data.slice(i + 5, i + 8).toString('ascii').trim();
          this.emit('floating', { amount, country });
          i += 8;
          hasEvents = true;
          break;
        }

        case EVT.FLOATED: {
          // Estructura: [0xD8][valor 4B LE][país 3B ASCII]
          if (i + 7 >= data.length) { i++; break; }
          const amount  = data.readUInt32LE(i + 1);
          const country = data.slice(i + 5, i + 8).toString('ascii').trim();
          console.log(`[SCS] FLOATED: $${(amount / 100).toFixed(2)} (${country})`);
          this.emit('floated', { amount, country });
          i += 8;
          hasEvents = true;
          break;
        }

        case EVT.TIMEOUT_EVT: {
          console.warn('[SCS] TIMEOUT interno del dispositivo');
          this.emit('deviceTimeout');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.INCOMPLETE_PAYOUT: {
          // Estructura: [0xDC][pagado 4B LE][solicitado 4B LE][país 3B ASCII]
          if (i + 11 >= data.length) { i++; break; }
          const paid     = data.readUInt32LE(i + 1);
          const request  = data.readUInt32LE(i + 5);
          const country  = data.slice(i + 9, i + 12).toString('ascii').trim();
          console.warn(
            `[SCS] INCOMPLETE_PAYOUT: pagado $${(paid / 100).toFixed(2)} ` +
            `de $${(request / 100).toFixed(2)} (${country})`
          );
          this.emit('incompletePayout', { paid, request, country });
          i += 12;
          hasEvents = true;
          break;
        }

        case EVT.INCOMPLETE_FLOAT: {
          // Estructura: [0xDD][pagado 4B LE][solicitado 4B LE][país 3B ASCII]
          if (i + 11 >= data.length) { i++; break; }
          const paid     = data.readUInt32LE(i + 1);
          const request  = data.readUInt32LE(i + 5);
          const country  = data.slice(i + 9, i + 12).toString('ascii').trim();
          console.warn(
            `[SCS] INCOMPLETE_FLOAT: pagado $${(paid / 100).toFixed(2)} ` +
            `de $${(request / 100).toFixed(2)} (${country})`
          );
          this.emit('incompleteFloat', { paid, request, country });
          i += 12;
          hasEvents = true;
          break;
        }

        case EVT.CASHBOX_PAID: {
          // Estructura: [0xDE][valor 4B LE][país 3B ASCII]
          if (i + 7 >= data.length) { i++; break; }
          const amount  = data.readUInt32LE(i + 1);
          const country = data.slice(i + 5, i + 8).toString('ascii').trim();
          console.log(`[SCS] CASHBOX_PAID: $${(amount / 100).toFixed(2)} (${country})`);
          this.emit('cashboxPaid', { amount, country });
          i += 8;
          hasEvents = true;
          break;
        }

        case EVT.DISABLED: {
          console.warn('[SCS] DISABLED — dispositivo deshabilitado');
          this.ready = false;
          this.emit('disabled');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.CALIBRATION_FAIL: {
          console.error('[SCS] CALIBRATION_FAIL');
          this.emit('calibrationFail');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.FRAUD_ATTEMPT: {
          console.warn('[SCS] FRAUD_ATTEMPT — intento de fraude detectado');
          this.emit('fraud');
          i++;
          hasEvents = true;
          break;
        }

        default: {
          console.warn(`[SCS] Evento desconocido: 0x${evt.toString(16)} — saltando`);
          i++;
          break;
        }
      }
    }

    // EVENT_ACK (0x57): confirmar al dispositivo que procesamos los eventos
    // Solo si hubo eventos reales — evita ACKs innecesarios en idle
    if (hasEvents) {
      try {
        await this.send(Buffer.from([CMD.EVENT_ACK]));
      } catch (e) {
        // No lanzar — el ACK fallido solo causa que el evento se repita en el siguiente poll
        console.warn('[SCS] EVENT_ACK warning:', (e as Error).message);
      }
    }
  }

  // ── Parsear respuesta de SETUP_REQUEST ────────────────────────────────────
  // Estructura del payload (data sin byte genérico 0xF0):
  // [0]      = unit_type
  // [1..4]   = firmware version (ASCII)
  // [5..7]   = country code (ASCII)
  // [8..11]  = value multiplier (4B LE) — para convertir valor de canal a centavos
  // [12]     = num_channels
  // [13..12+N] = channel_security (1B por canal)
  // [13+N..12+2N] = channel_values base (1B por canal, pre-v6)
  // [13+2N]  = protocol_version
  // — Si protocol_version >= 6: —
  // [14+2N .. 13+2N+7*N] = expanded values ([valor 4B LE][país 3B ASCII]) por canal

  private parseSetupResponse(data: Buffer): SCSInfo {
    const unitType       = data[0];
    const firmwareVersion = data.slice(1, 5).toString('ascii').trim();
    const countryCode    = data.slice(5, 8).toString('ascii').trim();
    const multiplier     = data.readUInt32LE(8);   // value multiplier
    const numChannels    = data[12] ?? 0;

    // protocol_version está en offset 13 + 2*numChannels
    const protocolVersion = data[13 + 2 * numChannels] ?? 0;

    const denominations: CoinDenomination[] = [];

    if (protocolVersion >= 6) {
      // Valores expandidos: offset 14 + 2*N, estructura [valor 4B LE][país 3B ASCII]
      const baseOffset = 14 + 2 * numChannels;
      for (let ch = 0; ch < numChannels; ch++) {
        const offset  = baseOffset + ch * 7;
        if (offset + 7 > data.length) break;
        const value   = data.readUInt32LE(offset);
        const country = data.slice(offset + 4, offset + 7).toString('ascii').trim();
        denominations.push({ channel: ch + 1, value, country });
      }
    } else {
      // Valores base (1B por canal) × multiplier
      for (let ch = 0; ch < numChannels; ch++) {
        const rawVal = data[13 + numChannels + ch] ?? 0;
        denominations.push({
          channel: ch + 1,
          value:   rawVal * multiplier,
          country: countryCode,
        });
      }
    }

    console.log(`[SCS] unitType=0x${unitType.toString(16)} multiplier=${multiplier}`);
    return { firmwareVersion, countryCode, numChannels, denominations, protocolVersion };
  }

  // ── Envío de comando al bus ───────────────────────────────────────────────

  private async send(data: Buffer): Promise<SSPResponse> {
    const res = await this.bus.send(SCS_ADDRESS, data);

    if (res.generic === SSP_GENERIC.UNKNOWN_CMD) {
      throw new Error(`[SCS] Comando desconocido: 0x${data[0].toString(16)}`);
    }
    if (res.generic === SSP_GENERIC.FAIL) {
      throw new Error(`[SCS] Comando fallido (FAIL): 0x${data[0].toString(16)}`);
    }
    // CANNOT_PROCESS y otros se retornan al llamador para que decida
    return res;
  }
}
