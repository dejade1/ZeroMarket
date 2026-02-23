// backend/src/ssp/scs.ts
// SMART Coin System (SCS) — Driver SSP completo
// Dirección RS485: 0x10 | Protocolo: SSP v6 máximo
// Referencia: SCS-SSP-Implementation-Test-Script-v1.1

import { EventEmitter } from 'events';
import { SSPBus }       from './ssp-bus';
import { SSPResponse, SSP_GENERIC } from './ssp-packet';

const SCS_ADDRESS = 0x10;

const CMD = {
  SYNC:                   0x11,
  HOST_PROTOCOL_VERSION:  0x06,
  SETUP_REQUEST:          0x05,
  SET_COIN_INHIBIT:       0x40,
  SET_DENOMINATION_ROUTE: 0x3b,
  SET_OPTIONS:            0x50,
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

const EVT = {
  SLAVE_RESET:       0xf1,
  COIN_CREDIT:       0xda,
  DISPENSING:        0xd1,
  DISPENSED:         0xd2,
  VALUE_ADDED:       0xbf,
  PAY_IN_ACTIVE:     0xc1,
  COIN_REJECTED:     0xba,
  COINS_LOW:         0xd3,
  DEVICE_FULL:       0xd4,
  JAMMED:            0xd5,
  HALTED:            0xd6,
  FLOATING:          0xd7,
  FLOATED:           0xd8,
  TIMEOUT_EVT:       0xd9,
  INCOMPLETE_PAYOUT: 0xdc,
  INCOMPLETE_FLOAT:  0xdd,
  CASHBOX_PAID:      0xde,
  DISABLED:          0xe8,
  CALIBRATION_FAIL:  0x83,
  FRAUD_ATTEMPT:     0xe6,
} as const;

export interface CoinDenomination {
  channel: number;
  value:   number;
  country: string;
}

export interface SCSInfo {
  firmwareVersion: string;
  countryCode:     string;
  numChannels:     number;
  denominations:   CoinDenomination[];
  protocolVersion: number;
}

export class SCS extends EventEmitter {
  private bus:          SSPBus;
  private currencyCode: string;
  private info:         SCSInfo | null = null;
  private ready:        boolean        = false;

  constructor(bus: SSPBus, currencyCode = 'USD') {
    super();
    this.bus          = bus;
    this.currencyCode = currencyCode;
    this.bus.registerAddress(SCS_ADDRESS);
  }

  get isReady():    boolean        { return this.ready; }
  get deviceInfo(): SCSInfo | null { return this.info;  }

  async init(): Promise<void> {
    console.log('[SCS] Iniciando secuencia de setup...');

    const syncRes = await this.send(Buffer.from([CMD.SYNC]));
    if (syncRes.generic !== SSP_GENERIC.OK) {
      throw new Error(`[SCS] SYNC failed: 0x${syncRes.generic.toString(16)}`);
    }
    console.log('[SCS] SYNC OK');

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

          // Activar mecanismo de aceptación (pay-in mode)
      const optRes = await this.send(Buffer.from([
        CMD.SET_OPTIONS,
        0x01  // bit 0 = pay-in enabled
      ]));
      if (optRes.generic !== SSP_GENERIC.OK) {
        console.warn(`[SCS] SET_OPTIONS warning: 0x${optRes.generic.toString(16)}`);
      }
      console.log('[SCS] SET_OPTIONS OK — mecanismo activado');


    const enRes = await this.send(Buffer.from([CMD.ENABLE]));
    if (enRes.generic !== SSP_GENERIC.OK) {
      throw new Error(`[SCS] ENABLE failed: 0x${enRes.generic.toString(16)}`);
    }
    console.log('[SCS] ENABLE OK — aceptando monedas');

    this.ready = true;
  }

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
  // 1. Drenar eventos pendientes sin importar si ready=false
  //    El SCS puede estar con PAY_IN_ACTIVE en cola (0xC1) y rechaza DISABLE con 0xF4
  for (let drain = 0; drain < 5; drain++) {
    try {
      const res = await this.send(Buffer.from([CMD.POLL]));
      if (res.generic === SSP_GENERIC.OK) {
        const hasPayInActive = res.data.includes(EVT.PAY_IN_ACTIVE);
        const hasValueAdded  = res.data.includes(EVT.VALUE_ADDED);

        if (res.data.length > 0) {
          // ACK para limpiar la cola
          await this.send(Buffer.from([CMD.EVENT_ACK])).catch(() => {});
        }

        // Si no hay eventos activos de pay-in, podemos proceder
        if (!hasPayInActive && !hasValueAdded) break;
      }
    } catch {
      // Ignorar errores en el drain
    }
    await new Promise(r => setTimeout(r, 200));
  }

  // 2. Enviar DISABLE con reintentos
  let attempts = 0;
  while (attempts < 3) {
    const res = await this.send(Buffer.from([CMD.DISABLE]));

    if (res.generic === SSP_GENERIC.OK) {
      this.ready = false;
      console.log('[SCS] DISABLE OK');
      this.emit('disabled');
      return;
    }

    attempts++;
    console.warn(
      `[SCS] DISABLE no confirmado (0x${res.generic.toString(16)}) — retry ${attempts}/3`
    );
    await new Promise(r => setTimeout(r, 200)); // aumentado de 150 a 200ms
  }

  this.ready = false;
  console.error('[SCS] DISABLE no confirmado tras 3 intentos — forzando estado');
  this.emit('disabled');
}


  async reset(): Promise<void> {
    await this.send(Buffer.from([CMD.RESET]));
    this.ready = false;
    console.log('[SCS] RESET enviado');
  }

  async poll(): Promise<void> {
  if (!this.ready) return;  // guard para el poll loop externo
  await this.pollInternal();
}

private async pollInternal(): Promise<void> {
  const res = await this.send(Buffer.from([CMD.POLL]));
  if (res.generic === SSP_GENERIC.OK) {
    await this.handlePollResponse(res.data);
  }
}

  async payoutAmount(amountCents: number): Promise<void> {
    const valueBuf = Buffer.alloc(4);
    valueBuf.writeUInt32LE(amountCents, 0);
    const countryBuf = Buffer.from(
      this.currencyCode.padEnd(3, ' ').slice(0, 3), 'ascii'
    );
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

  async setCoinInhibit(valueCents: number, inhibit: boolean): Promise<void> {
    const valueBuf = Buffer.alloc(2);
    valueBuf.writeUInt16LE(valueCents, 0);
    const countryBuf = Buffer.from(
      this.currencyCode.padEnd(3, ' ').slice(0, 3), 'ascii'
    );
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

  async setDenominationRoute(valueCents: number, toHopper: boolean): Promise<void> {
    const valueBuf = Buffer.alloc(4);
    valueBuf.writeUInt32LE(valueCents, 0);
    const countryBuf = Buffer.from(
      this.currencyCode.padEnd(3, ' ').slice(0, 3), 'ascii'
    );
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

  private async handlePollResponse(data: Buffer): Promise<void> {
    if (data.length === 0) return;

    let i = 0;
    let hasEvents = false;

    while (i < data.length) {
      const evt = data[i];

      switch (evt) {

        case EVT.SLAVE_RESET: {
          console.warn('[SCS] SLAVE_RESET — re-inicializando...');
          this.ready = false;
          this.emit('reset');
          setImmediate(() =>
            this.init().catch(e => console.error('[SCS] Re-init error:', e.message))
          );
          i++;
          hasEvents = true;
          break;
        }

        case EVT.COIN_CREDIT: {
          // [0xDA][valor 4B LE][país 3B ASCII]
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
          // [0xBF][numCountries 1B]([valor 4B LE][país 3B ASCII]) x N
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
          if (i + 7 >= data.length) { i++; break; }
          const amount  = data.readUInt32LE(i + 1);
          const country = data.slice(i + 5, i + 8).toString('ascii').trim();
          this.emit('floating', { amount, country });
          i += 8;
          hasEvents = true;
          break;
        }

        case EVT.FLOATED: {
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
          if (i + 11 >= data.length) { i++; break; }
          const paid    = data.readUInt32LE(i + 1);
          const request = data.readUInt32LE(i + 5);
          const country = data.slice(i + 9, i + 12).toString('ascii').trim();
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
          if (i + 11 >= data.length) { i++; break; }
          const paid    = data.readUInt32LE(i + 1);
          const request = data.readUInt32LE(i + 5);
          const country = data.slice(i + 9, i + 12).toString('ascii').trim();
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

    
  }

  // ── parseSetupResponse CORREGIDO ──────────────────────────────────────────
  // Estructura REAL verificada con firmware SCS 0140 (payload sin byte 0xF0):
  //
  // Offset  Bytes  Campo
  // [0]       1    unit_type
  // [1..4]    4    firmware version (ASCII)
  // [5..7]    3    country code dispositivo (ASCII)
  // [8]       1    protocol_version   ← NO hay multiplier antes de aquí
  // [9]       1    num_channels (N)
  //
  // Si protocol_version >= 6 (valores expandidos):
  //   [10 + ch*2]         2B LE  valor canal en centavos  (ch = 0..N-1)
  //   [10 + N*2 + ch*3]   3B     country canal (ASCII)
  //
  // Si protocol_version < 6 (valores base 1B):
  //   [10 + ch]           1B     valor canal en centavos
  //   [10 + N + ch*3]     3B     country canal (ASCII)
  //
  // Verificado con raw: 09 30 31 34 30 55 53 44 06 05 ...
  //   unit_type=0x09, fw="0140", country="USD", proto=6, N=5

  private parseSetupResponse(data: Buffer): SCSInfo {
    const unitType        = data[0];
    const firmwareVersion = data.slice(1, 5).toString('ascii').trim();
    const countryCode     = data.slice(5, 8).toString('ascii').trim();
    const protocolVersion = data[8];
    const numChannels     = data[9] ?? 0;

    const denominations: CoinDenomination[] = [];

    if (protocolVersion >= 6) {
      // valores expandidos: 2B LE por canal, luego 3B país por canal
      for (let ch = 0; ch < numChannels; ch++) {
        const valueOffset   = 10 + ch * 2;
        const countryOffset = 10 + numChannels * 2 + ch * 3;
        if (valueOffset + 2 > data.length) break;
        const value   = data.readUInt16LE(valueOffset);
        const country = (countryOffset + 3 <= data.length)
          ? data.slice(countryOffset, countryOffset + 3).toString('ascii').trim()
          : countryCode;
        denominations.push({ channel: ch + 1, value, country });
      }
    } else {
      // valores base: 1B por canal, luego 3B país por canal
      for (let ch = 0; ch < numChannels; ch++) {
        const rawVal        = data[10 + ch] ?? 0;
        const countryOffset = 10 + numChannels + ch * 3;
        const country = (countryOffset + 3 <= data.length)
          ? data.slice(countryOffset, countryOffset + 3).toString('ascii').trim()
          : countryCode;
        denominations.push({ channel: ch + 1, value: rawVal, country });
      }
    }

    console.log(`[SCS] unitType=0x${unitType.toString(16)} protocolVersion=v${protocolVersion}`);
    return { firmwareVersion, countryCode, numChannels, denominations, protocolVersion };
  }

  private async send(data: Buffer): Promise<SSPResponse> {
    const res = await this.bus.send(SCS_ADDRESS, data);
    if (res.generic === SSP_GENERIC.UNKNOWN_CMD) {
      throw new Error(`[SCS] Comando desconocido: 0x${data[0].toString(16)}`);
    }
    if (res.generic === SSP_GENERIC.FAIL) {
      throw new Error(`[SCS] Comando fallido (FAIL): 0x${data[0].toString(16)}`);
    }
    return res;
  }
}
