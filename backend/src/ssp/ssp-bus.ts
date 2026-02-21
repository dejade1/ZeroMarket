import { SerialPort } from 'serialport';
import { EventEmitter } from 'events';
import { buildPacket, parseResponse, SSPResponse } from './ssp-packet';

const POLL_INTERVAL_MS = 200;   // PDF: máx 1000ms, recomendado ~200ms
const CMD_TIMEOUT_MS   = 2000;  // tiempo máximo esperando respuesta
const MAX_RETRIES      = 3;

export interface BusCommand {
  address: number;
  data:    Buffer;
  resolve: (res: SSPResponse) => void;
  reject:  (err: Error) => void;
  retries: number;
}

export class SSPBus extends EventEmitter {
  private port:       SerialPort | null = null;
  private portName:   string;
  private rxBuffer:   Buffer = Buffer.alloc(0);

  // SEQ bit independiente por dirección de dispositivo
  private seqBits: Map<number, boolean> = new Map();

  // Cola FIFO de comandos pendientes
  private cmdQueue:    BusCommand[] = [];
  private processing:  boolean = false;
  private pollTimer:   NodeJS.Timeout | null = null;

  // Direcciones registradas para polling
  private pollAddresses: number[] = [];

  constructor(portName: string) {
    super();
    this.portName = portName;
  }

  // ── Apertura del puerto ──────────────────────────────────────────────────
  async open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.port = new SerialPort({
        path:     this.portName,
        baudRate: 9600,
        dataBits: 8,
        stopBits: 2,
        parity:   'none',
        autoOpen: false,
      });

      this.port.on('data', (chunk: Buffer) => this.onData(chunk));
      this.port.on('error', (err: Error) => {
        console.error('[SSPBus] Error serial:', err.message);
        this.emit('error', err);
      });

      this.port.open((err) => {
        if (err) return reject(err);
        console.log(`[SSPBus] Puerto ${this.portName} abierto`);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    this.stopPolling();
    return new Promise((resolve) => {
      if (!this.port?.isOpen) return resolve();
      this.port.close(() => resolve());
    });
  }

  // ── Registro de dispositivos para polling ────────────────────────────────
  registerAddress(address: number) {
    if (!this.pollAddresses.includes(address)) {
      this.pollAddresses.push(address);
      this.seqBits.set(address, false);
    }
  }

  // ── Polling automático ───────────────────────────────────────────────────
  startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.doPoll(), POLL_INTERVAL_MS);
    console.log(`[SSPBus] Polling iniciado (${POLL_INTERVAL_MS}ms)`);
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async doPoll() {
    // No hacer poll si hay un comando procesándose
    if (this.processing || this.cmdQueue.length > 0) return;

    for (const address of this.pollAddresses) {
      try {
        // POLL WITH ACK 0x56 (recomendado por PDF sobre 0x07)
        const res = await this.sendRaw(address, Buffer.from([0x56]));
        if (res) this.emit('poll', address, res);
      } catch (_) {
        // silencioso — el dispositivo puede no estar listo
      }
    }
  }

  // ── Envío de comando público ─────────────────────────────────────────────
  send(address: number, data: Buffer): Promise<SSPResponse> {
    return new Promise((resolve, reject) => {
      this.cmdQueue.push({ address, data, resolve, reject, retries: 0 });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing || this.cmdQueue.length === 0) return;
    this.processing = true;

    const cmd = this.cmdQueue.shift()!;
    try {
      const res = await this.sendRaw(cmd.address, cmd.data, cmd.retries);
      cmd.resolve(res);
    } catch (err: any) {
      if (cmd.retries < MAX_RETRIES) {
        cmd.retries++;
        this.cmdQueue.unshift(cmd); // reencolar al frente
      } else {
        cmd.reject(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      this.processing = false;
      if (this.cmdQueue.length > 0) setImmediate(() => this.processQueue());
    }
  }

  // ── Envío raw con SEQ bit y espera de respuesta ──────────────────────────
  private pendingResolve: ((res: SSPResponse) => void) | null = null;
  private pendingReject:  ((err: Error) => void) | null = null;
  private pendingAddress: number = 0;
  private timeoutHandle: NodeJS.Timeout | null = null;

  private sendRaw(address: number, data: Buffer, _retry = 0): Promise<SSPResponse> {
    return new Promise((resolve, reject) => {
      if (!this.port?.isOpen) return reject(new Error('Puerto no abierto'));

      const seqBit = this.seqBits.get(address) ?? false;
      const packet = buildPacket({ address, seqBit, data });

      this.pendingResolve = resolve;
      this.pendingReject  = reject;
      this.pendingAddress = address;

      this.timeoutHandle = setTimeout(() => {
        this.pendingResolve = null;
        this.pendingReject  = null;
        reject(new Error(`TIMEOUT address=0x${address.toString(16).padStart(2,'0')} cmd=0x${data[0].toString(16)}`));
      }, CMD_TIMEOUT_MS);

      this.port.write(packet, (err) => {
        if (err) {
          clearTimeout(this.timeoutHandle!);
          this.pendingResolve = null;
          this.pendingReject  = null;
          reject(new Error(`Write error: ${err.message}`));
        }
      });
    });
  }

  // ── Recepción de datos ───────────────────────────────────────────────────
  private onData(chunk: Buffer) {
    this.rxBuffer = Buffer.concat([this.rxBuffer, chunk]);
    this.tryParseResponse();
  }

  private tryParseResponse() {
    // Buscar STX 0x7F
    const stxIdx = this.rxBuffer.indexOf(0x7f);
    if (stxIdx < 0) { this.rxBuffer = Buffer.alloc(0); return; }
    if (stxIdx > 0)  this.rxBuffer = this.rxBuffer.slice(stxIdx);

    // Necesitamos al menos STX + SEQID + LENGTH = 3 bytes para saber tamaño
    if (this.rxBuffer.length < 3) return;

    // LENGTH está en byte 2 (índice 2), pero hay que considerar byte-stuffing
    // Estimamos el tamaño mínimo: STX(1) + SEQID(1) + LEN(1) + DATA(len) + CRC(2)
    const rawLength = this.rxBuffer[2];
    const minExpected = 1 + 1 + 1 + rawLength + 2; // STX+SEQID+LEN+DATA+CRC

    if (this.rxBuffer.length < minExpected) return; // esperar más datos

    const frame = this.rxBuffer.slice(0, minExpected);
    this.rxBuffer = this.rxBuffer.slice(minExpected);

    const response = parseResponse(frame);
    if (!response) { this.tryParseResponse(); return; }

    if (!response.valid) {
      console.warn(`[SSPBus] CRC inválido de 0x${response.address.toString(16)}`);
      this.tryParseResponse();
      return;
    }

    // Si hay un comando pendiente para esta dirección, resolverlo
    if (this.pendingResolve && response.address === this.pendingAddress) {
      clearTimeout(this.timeoutHandle!);

      // Alternar SEQ bit solo en respuesta exitosa
      const currentSeq = this.seqBits.get(response.address) ?? false;
      this.seqBits.set(response.address, !currentSeq);

      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      this.pendingReject  = null;
      resolve(response);
    } else {
      // Respuesta de poll espontánea — emitir como evento
      this.emit('response', response.address, response);
    }

    this.tryParseResponse();
  }
}
