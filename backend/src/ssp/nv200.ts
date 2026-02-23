import { EventEmitter } from 'events';
import { SSPBus } from './ssp-bus';
import { SSPResponse, SSP_GENERIC } from './ssp-packet';

// Dirección SSP del NV200 en el bus RS485
const NV200_ADDRESS = 0x00;

// Comandos SSP (PDF GA02204 sección 4)
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
  GET_ALL_LEVELS:        0x22,
} as const;

// Eventos de poll del NV200 (PDF sección 4.3.2)
const EVT = {
  SLAVE_RESET:       0xf1,
  READ_NOTE:         0xef,
  CREDIT_NOTE:       0xee,
  NOTE_REJECTING:    0xed,
  NOTE_REJECTED:     0xec,
  NOTE_STACKING:     0xcc,
  NOTE_STACKED:      0xeb,
  SAFE_NOTE_JAM:     0xea,
  UNSAFE_NOTE_JAM:   0xe9,
  DISABLED:          0xe8,
  STACKER_FULL:      0xe7,
  NOTE_CLEARED_BEZEL: 0xe1,
  NOTE_CLEARED_INTO_CASHBOX: 0xe2,
  CASHBOX_REMOVED:   0xe3,
  CASHBOX_REPLACED:  0xe4,
  FRAUD_ATTEMPT:     0xe6,
} as const;

export interface NV200Info {
  firmwareVersion: string;
  countryCode:     string;
  numChannels:     number;
  channelValues:   number[]; // valor en centavos por canal
  protocolVersion: number;
}

export class NV200 extends EventEmitter {
  private bus:   SSPBus;
  private info:  NV200Info | null = null;
  private ready: boolean = false;

  constructor(bus: SSPBus) {
    super();
    this.bus = bus;
    this.bus.registerAddress(NV200_ADDRESS);

    // Escuchar eventos de poll del bus
    this.bus.on('poll', (address: number, res: SSPResponse) => {
      if (address === NV200_ADDRESS) this.handlePollResponse(res);
    });
  }

  get isReady() { return this.ready; }
  get deviceInfo() { return this.info; }

  // ── Secuencia de inicialización (PDF sección 4.2) ────────────────────────
  async init(): Promise<void> {
    console.log('[NV200] Iniciando secuencia de setup...');

    // 1. SYNC — sincronizar SEQ bit
    await this.send(Buffer.from([CMD.SYNC]));
    console.log('[NV200] SYNC OK');

    // 2. HOST_PROTOCOL_VERSION — versión 8
    await this.send(Buffer.from([CMD.HOST_PROTOCOL_VERSION, 0x08]));
    console.log('[NV200] Protocol version 8 OK');

    // 3. SETUP_REQUEST — obtener info del dispositivo
    const setupRes = await this.send(Buffer.from([CMD.SETUP_REQUEST]));
    this.info = this.parseSetupResponse(setupRes.data);
    console.log(`[NV200] Setup: ${this.info.numChannels} canales, firmware ${this.info.firmwareVersion}`);

    // 4. SET_INHIBITS — habilitar todos los canales disponibles
    // 2 bytes: cada bit = un canal. 0xFF 0xFF = todos habilitados
    await this.send(Buffer.from([CMD.SET_INHIBITS, 0xff, 0xff]));
    console.log('[NV200] Inhibits OK (todos los canales habilitados)');

    // 5. ENABLE — encender el dispositivo
    await this.enable();

    this.ready = true;
    console.log('[NV200] ✅ Listo para aceptar billetes');
    this.emit('ready', this.info);
  }

  async enable(): Promise<void> {
    await this.send(Buffer.from([CMD.ENABLE]));
    console.log('[NV200] ENABLE OK — LED frontal debería encenderse');
    this.emit('enabled');
  }

  async disable(): Promise<void> {
    await this.send(Buffer.from([CMD.DISABLE]));
    console.log('[NV200] DISABLE OK');
    this.emit('disabled');
  }

  async reset(): Promise<void> {
    await this.send(Buffer.from([CMD.RESET]));
    this.ready = false;
    console.log('[NV200] RESET enviado');
  }

  // ── Manejo de eventos de poll ────────────────────────────────────────────
  // nv200.ts — método poll() / handlePollEvents()

private lastReadChannel = 0;

handlePollEvents(events: number[]): void {
  let i = 0;
  while (i < events.length) {
    const evt = events[i];

    switch (evt) {
      case 0xEF: // NOTE_READ — billete leído, contiene canal en siguiente byte
        this.lastReadChannel = events[++i] ?? 0;
        const readValue = this.channelValues[this.lastReadChannel - 1] ?? 0;
        logger.info(`[NV200] NOTE_READ canal=${this.lastReadChannel} valor=$${readValue/100}`);
        this.emit('NOTE_READ', { channel: this.lastReadChannel, amount: readValue });
        break;

      case 0xED: // NOTE_STACKING — camino al stacker
        logger.info(`[NV200] NOTE_STACKING canal=${this.lastReadChannel}`);
        break;

      case 0xCC: // NOTE_STACKED — *** CRÉDITO REAL ***
        const creditChannel = this.lastReadChannel;
        const creditAmount  = this.channelValues[creditChannel - 1] ?? 0;
        logger.info(`[NV200] ✅ NOTE_STACKED — CRÉDITO $${creditAmount/100} canal=${creditChannel}`);
        this.emit('NOTE_CREDIT', { channel: creditChannel, amount: creditAmount, currency: this.currency });
        this.lastReadChannel = 0;
        break;

      case 0xEE: // NOTE_REJECTED
        logger.warn('[NV200] NOTE_REJECTED');
        this.emit('NOTE_REJECTED', {});
        break;

      case 0xF1: // SLAVE_RESET — el dispositivo se reinició
        logger.warn('[NV200] SLAVE_RESET detectado — re-init necesario');
        this.emit('RESET', {});
        break;

      default:
        logger.debug(`[NV200] Evento desconocido: 0x${evt.toString(16)}`);
    }
    i++;
  }
}


        case EVT.NOTE_REJECTING:
          this.emit('rejecting');
          i++;
          break;

        case EVT.NOTE_REJECTED:
          console.log('[NV200] ❌ Billete rechazado');
          this.emit('rejected');
          i++;
          break;

        case EVT.NOTE_STACKING:
          this.emit('stacking');
          i++;
          break;

        case EVT.NOTE_STACKED:
          console.log('[NV200] Billete apilado en cashbox');
          this.emit('stacked');
          i++;
          break;

        case EVT.UNSAFE_NOTE_JAM:
          console.warn('[NV200] ⚠️  Atasco de billete INSEGURO');
          this.emit('jam', 'unsafe');
          i++;
          break;

        case EVT.SAFE_NOTE_JAM:
          console.warn('[NV200] ⚠️  Atasco de billete seguro');
          this.emit('jam', 'safe');
          i++;
          break;

        case EVT.STACKER_FULL:
          console.warn('[NV200] ⚠️  Stackerfull — cashbox lleno');
          this.emit('stackerFull');
          i++;
          break;

        case EVT.DISABLED:
          this.emit('disabled');
          i++;
          break;

        case EVT.FRAUD_ATTEMPT:
          console.warn('[NV200] 🚨 Intento de fraude detectado');
          this.emit('fraud');
          i++;
          break;

        case EVT.CASHBOX_REMOVED:
          console.warn('[NV200] ⚠️  Cashbox removido');
          this.emit('cashboxRemoved');
          i++;
          break;

        case EVT.CASHBOX_REPLACED:
          console.log('[NV200] Cashbox reemplazado');
          this.emit('cashboxReplaced');
          i++;
          break;

        default:
          i++; // evento desconocido — avanzar
      }
    }
  }

  // ── Parsear respuesta de SETUP_REQUEST ───────────────────────────────────
  private parseSetupResponse(data: Buffer): NV200Info {
    // PDF sección 4.2.3 — offset de campos
    const firmwareVersion = data.slice(1, 5).toString('ascii');
    const countryCode     = data.slice(5, 8).toString('ascii');
    const numChannels     = data[11] ?? 0;
    const channelValues: number[] = [];

    // Valores expandidos (protocol v6+): offset 16+n+5, 4 bytes por canal
    // Primero intentamos leer los valores simples (offset 12, 1 byte por canal)
    for (let i = 0; i < numChannels; i++) {
      channelValues.push(data[12 + i] ?? 0);
    }

    const protocolVersion = data[15 + numChannels] ?? 0;

    return { firmwareVersion, countryCode, numChannels, channelValues, protocolVersion };
  }

  // Valor en centavos de un canal
  private channelValue(channel: number): number {
    if (!this.info) return 0;
    return this.info.channelValues[channel - 1] ?? 0;
  }

  // ── Envío de comando al bus con validación de respuesta ──────────────────
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
