// backend/src/ssp/nv200.ts
// NV200 Spectral — Driver SSP completo
// Dirección RS485: 0x00 | Protocolo: SSP v8
// Referencia: NV200-Spectral-Range-SSP-Implementation-Script-1.1

import { EventEmitter } from 'events';
import { SSPBus }       from './ssp-bus';
import { SSPResponse, SSP_GENERIC } from './ssp-packet';

// ── Constantes ────────────────────────────────────────────────────────────────

const NV200_ADDRESS = 0x00;

const CMD = {
  SYNC:                  0x11,
  HOST_PROTOCOL_VERSION: 0x06,
  SETUP_REQUEST:         0x05,
  SET_INHIBITS:          0x02,
  ENABLE:                0x0a,
  DISABLE:               0x09,
  POLL:                  0x07,
  POLL_WITH_ACK:         0x56,
  EVENT_ACK:             0x57,
  RESET:                 0x01,
} as const;

// Eventos de poll del NV200 — PDF GA02204 sección 4.3.2
// Flujo correcto de un billete aceptado:
//   READ_NOTE (0xEF) → NOTE_STACKING (0xCC) → NOTE_STACKED (0xEB) = CRÉDITO REAL
//
// IMPORTANTE — códigos corregidos vs archivo anterior:
//   0xEF = READ_NOTE      (billete leído, incluye byte de canal)
//   0xCC = NOTE_STACKING  (billete en camino al stacker)
//   0xEB = NOTE_STACKED   (billete en stacker = CRÉDITO)
//   0xEE = CREDIT_NOTE    (evento alternativo de crédito en algunos firmwares)
//   0xED = NOTE_REJECTING (en proceso de rechazo)
//   0xEC = NOTE_REJECTED  (rechazado completamente)
const EVT = {
  SLAVE_RESET:               0xf1,
  READ_NOTE:                 0xef, // [canal 1B]
  CREDIT_NOTE:               0xee, // crédito alternativo — [canal 1B]
  NOTE_REJECTING:            0xed,
  NOTE_REJECTED:             0xec,
  NOTE_STACKING:             0xcc,
  NOTE_STACKED:              0xeb, // ← CRÉDITO REAL
  SAFE_NOTE_JAM:             0xea,
  UNSAFE_NOTE_JAM:           0xe9,
  DISABLED:                  0xe8,
  STACKER_FULL:              0xe7,
  NOTE_CLEARED_BEZEL:        0xe1,
  NOTE_CLEARED_INTO_CASHBOX: 0xe2,
  CASHBOX_REMOVED:           0xe3,
  CASHBOX_REPLACED:          0xe4,
  FRAUD_ATTEMPT:             0xe6,
} as const;

// ── Interfaces públicas ───────────────────────────────────────────────────────

export interface NV200Info {
  firmwareVersion: string;
  countryCode:     string;
  numChannels:     number;
  channelValues:   number[]; // valor en centavos por canal (index 0 = canal 1)
  protocolVersion: number;
}

// ── Clase principal ───────────────────────────────────────────────────────────

export class NV200 extends EventEmitter {
  private bus:             SSPBus;
  private info:            NV200Info | null = null;
  private ready:           boolean          = false;
  private lastReadChannel: number           = 0; // canal del último READ_NOTE

  constructor(bus: SSPBus) {
    super();
    this.bus = bus;
    this.bus.registerAddress(NV200_ADDRESS);
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  get isReady():    boolean          { return this.ready; }
  get deviceInfo(): NV200Info | null { return this.info;  }

  // ── Init — secuencia según PDF GA02204 sección 4.2 ───────────────────────

  async init(): Promise<void> {
    console.log('[NV200] Iniciando secuencia de setup...');

    // 1. SYNC — sincronizar SEQ bit con el dispositivo
    const syncRes = await this.send(Buffer.from([CMD.SYNC]));
    if (syncRes.generic !== SSP_GENERIC.OK) {
      throw new Error(`[NV200] SYNC failed: 0x${syncRes.generic.toString(16)}`);
    }
    console.log('[NV200] SYNC OK');

    // 2. HOST_PROTOCOL_VERSION — NV200 Spectral soporta v8
    const pvRes = await this.send(Buffer.from([CMD.HOST_PROTOCOL_VERSION, 0x08]));
    if (pvRes.generic !== SSP_GENERIC.OK) {
      throw new Error(`[NV200] HOST_PROTOCOL_VERSION failed: 0x${pvRes.generic.toString(16)}`);
    }
    console.log('[NV200] Protocol version 8 OK');

    // 3. SETUP_REQUEST — obtener configuración del dispositivo
    const setupRes = await this.send(Buffer.from([CMD.SETUP_REQUEST]));
    if (setupRes.generic !== SSP_GENERIC.OK) {
      throw new Error(`[NV200] SETUP_REQUEST failed: 0x${setupRes.generic.toString(16)}`);
    }
    this.info = this.parseSetupResponse(setupRes.data);
    console.log(
      `[NV200] Setup: ${this.info.numChannels} canales | ` +
      `firmware: ${this.info.firmwareVersion} | ` +
      `protocolo: v${this.info.protocolVersion}`
    );
    console.log(
      '[NV200] Canales:',
      this.info.channelValues
        .map((v, i) => `ch${i + 1}=$${(v / 100).toFixed(2)}`)
        .join(', ')
    );

    // 4. SET_INHIBITS — habilitar todos los canales
    // 2 bytes: cada bit representa un canal. 0xFF 0xFF = todos habilitados (16 canales)
    const inhRes = await this.send(Buffer.from([CMD.SET_INHIBITS, 0xff, 0xff]));
    if (inhRes.generic !== SSP_GENERIC.OK) {
      throw new Error(`[NV200] SET_INHIBITS failed: 0x${inhRes.generic.toString(16)}`);
    }
    console.log('[NV200] Inhibits OK (todos los canales habilitados)');

    // 5. ENABLE — encender aceptación de billetes
    const enRes = await this.send(Buffer.from([CMD.ENABLE]));
    if (enRes.generic !== SSP_GENERIC.OK) {
      throw new Error(`[NV200] ENABLE failed: 0x${enRes.generic.toString(16)}`);
    }
    console.log('[NV200] ENABLE OK — LED frontal debería encenderse');

    this.ready = true;
    console.log('[NV200] Listo para aceptar billetes');
    this.emit('ready', this.info);
  }

  // ── Comandos de control ───────────────────────────────────────────────────

  async enable(): Promise<void> {
    const res = await this.send(Buffer.from([CMD.ENABLE]));
    if (res.generic !== SSP_GENERIC.OK) {
      throw new Error(`[NV200] ENABLE failed: 0x${res.generic.toString(16)}`);
    }
    this.ready = true;
    console.log('[NV200] ENABLE OK');
    this.emit('enabled');
  }

  async disable(): Promise<void> {
    const res = await this.send(Buffer.from([CMD.DISABLE]));
    if (res.generic !== SSP_GENERIC.OK) {
      throw new Error(`[NV200] DISABLE failed: 0x${res.generic.toString(16)}`);
    }
    this.ready = false;
    console.log('[NV200] DISABLE OK');
    this.emit('disabled');
  }

  async reset(): Promise<void> {
    await this.send(Buffer.from([CMD.RESET]));
    this.ready = false;
    console.log('[NV200] RESET enviado');
  }

  // ── Poll manual — llamado desde sspService en el loop interleaved ─────────

  async poll(): Promise<void> {
    if (!this.ready) return;
    // POLL_WITH_ACK (0x56): el dispositivo retiene el evento hasta EVENT_ACK (0x57)
    const res = await this.send(Buffer.from([CMD.POLL_WITH_ACK]));
    if (res.generic === SSP_GENERIC.OK) {
      await this.handlePollResponse(res.data);
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
          console.warn('[NV200] SLAVE_RESET — re-inicializando...');
          this.ready = false;
          this.emit('reset');
          setImmediate(() =>
            this.init().catch(e => console.error('[NV200] Re-init error:', e.message))
          );
          i++;
          hasEvents = true;
          break;
        }

        case EVT.READ_NOTE: {
          // Estructura: [0xEF][canal 1B]
          const channel = data[i + 1] ?? 0;
          this.lastReadChannel = channel;
          const amount = this.channelValue(channel);
          console.log(
            `[NV200] READ_NOTE: canal=${channel} ` +
            `$${(amount / 100).toFixed(2)}`
          );
          this.emit('NOTE_READ', { channel, amount });
          i += 2;
          hasEvents = true;
          break;
        }

        case EVT.NOTE_STACKING: {
          // Billete en camino al stacker — aún no es crédito
          console.log(`[NV200] NOTE_STACKING: canal=${this.lastReadChannel}`);
          this.emit('stacking', { channel: this.lastReadChannel });
          i++;
          hasEvents = true;
          break;
        }

        case EVT.NOTE_STACKED: {
          // *** CRÉDITO REAL — billete físicamente en el stacker ***
          const channel = this.lastReadChannel;
          const amount  = this.channelValue(channel);
          const currency = this.info?.countryCode ?? 'USD';
          console.log(
            `[NV200] NOTE_STACKED — CREDITO: ` +
            `$${(amount / 100).toFixed(2)} canal=${channel}`
          );
          this.emit('NOTE_CREDIT', { channel, amount, currency });
          this.lastReadChannel = 0;
          i++;
          hasEvents = true;
          break;
        }

        case EVT.CREDIT_NOTE: {
          // Evento alternativo de crédito en algunos firmwares
          // Estructura: [0xEE][canal 1B]
          const channel  = data[i + 1] ?? this.lastReadChannel;
          const amount   = this.channelValue(channel);
          const currency = this.info?.countryCode ?? 'USD';
          console.log(
            `[NV200] CREDIT_NOTE: ` +
            `$${(amount / 100).toFixed(2)} canal=${channel}`
          );
          this.emit('NOTE_CREDIT', { channel, amount, currency });
          this.lastReadChannel = 0;
          i += 2;
          hasEvents = true;
          break;
        }

        case EVT.NOTE_REJECTING: {
          console.log('[NV200] NOTE_REJECTING — billete en proceso de rechazo');
          this.emit('rejecting');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.NOTE_REJECTED: {
          console.log('[NV200] NOTE_REJECTED — billete rechazado');
          this.emit('NOTE_REJECTED');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.SAFE_NOTE_JAM: {
          console.warn('[NV200] SAFE_NOTE_JAM');
          this.emit('jam', 'safe');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.UNSAFE_NOTE_JAM: {
          console.warn('[NV200] UNSAFE_NOTE_JAM');
          this.emit('jam', 'unsafe');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.STACKER_FULL: {
          console.warn('[NV200] STACKER_FULL — cashbox lleno');
          this.emit('stackerFull');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.DISABLED: {
          console.warn('[NV200] DISABLED');
          this.ready = false;
          this.emit('disabled');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.FRAUD_ATTEMPT: {
          console.warn('[NV200] FRAUD_ATTEMPT — intento de fraude detectado');
          this.emit('fraud');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.CASHBOX_REMOVED: {
          console.warn('[NV200] CASHBOX_REMOVED');
          this.emit('cashboxRemoved');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.CASHBOX_REPLACED: {
          console.log('[NV200] CASHBOX_REPLACED');
          this.emit('cashboxReplaced');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.NOTE_CLEARED_BEZEL: {
          console.log('[NV200] NOTE_CLEARED_BEZEL');
          this.emit('noteClearedBezel');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.NOTE_CLEARED_INTO_CASHBOX: {
          console.log('[NV200] NOTE_CLEARED_INTO_CASHBOX');
          this.emit('noteClearedIntoCashbox');
          i++;
          hasEvents = true;
          break;
        }

                default: {
          console.warn(`[NV200] Evento desconocido: 0x${evt.toString(16)} — saltando`);
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
        console.warn('[NV200] EVENT_ACK warning:', (e as Error).message);
      }
    }
  }

  // ── Parsear respuesta de SETUP_REQUEST ────────────────────────────────────
  // Estructura del payload (data sin byte genérico 0xF0):
  // [0]      = unit_type
  // [1..4]   = firmware version (ASCII)
  // [5..7]   = country code (ASCII)
  // [8..10]  = value multiplier (3B LE)
  // [11]     = num_channels
  // [12..11+N]        = channel_values base (1B por canal)
  // [12+N..11+2N]     = channel_security (1B por canal)
  // [12+2N]           = real_value_multiplier (1B)
  // [13+2N]           = protocol_version
  // — Si protocol_version >= 6: —
  // [14+2N .. 13+2N+5*N] = expanded values (5B por canal: valor 4B LE + security 1B)

  private parseSetupResponse(data: Buffer): NV200Info {
    const firmwareVersion = data.slice(1, 5).toString('ascii').trim();
    const countryCode     = data.slice(5, 8).toString('ascii').trim();
    const numChannels     = data[11] ?? 0;
    const protocolVersion = data[13 + 2 * numChannels] ?? 0;

    const channelValues: number[] = [];

    if (protocolVersion >= 6) {
      // Valores expandidos: offset 14 + 2*N, 4 bytes LE por canal
      const baseOffset = 14 + 2 * numChannels;
      for (let ch = 0; ch < numChannels; ch++) {
        const offset = baseOffset + ch * 5;
        if (offset + 4 > data.length) break;
        channelValues.push(data.readUInt32LE(offset));
      }
    } else {
      // Valores base (1B por canal) — centavos directos
      for (let ch = 0; ch < numChannels; ch++) {
        channelValues.push(data[12 + ch] ?? 0);
      }
    }

    return { firmwareVersion, countryCode, numChannels, channelValues, protocolVersion };
  }

  // ── Valor en centavos de un canal (1-based) ───────────────────────────────

  private channelValue(channel: number): number {
    if (!this.info) return 0;
    return this.info.channelValues[channel - 1] ?? 0;
  }

  // ── Envío de comando al bus con validación de respuesta ───────────────────

  private async send(data: Buffer): Promise<SSPResponse> {
    const res = await this.bus.send(NV200_ADDRESS, data);

    if (res.generic === SSP_GENERIC.UNKNOWN_CMD) {
      throw new Error(`[NV200] Comando desconocido: 0x${data[0].toString(16)}`);
    }
    if (res.generic === SSP_GENERIC.CANNOT_PROCESS) {
      throw new Error(`[NV200] Comando no puede procesarse ahora`);
    }
    if (res.generic === SSP_GENERIC.FAIL) {
      throw new Error(`[NV200] Comando fallido: 0x${data[0].toString(16)}`);
    }

    return res;
  }
}
