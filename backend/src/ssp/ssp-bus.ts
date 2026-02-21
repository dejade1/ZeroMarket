import { SerialPort } from 'serialport';
import { EventEmitter } from 'events';
import { buildPacket, parseResponse, SSPResponse } from './ssp-packet';

const POLL_INTERVAL_MS = 200;   // PDF: máx 1000ms, recomendado ~200ms
const CMD_TIMEOUT_MS   = 5000;  // tiempo máximo esperando respuesta
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
    const sp = new SerialPort({
      path:     this.portName,
      baudRate: parseInt(process.env.SSP_BAUD_RATE || '9600'),
      dataBits: 8,
      stopBits: 2,
      parity:   'none',
      autoOpen: false,
    });

    sp.on('data', (chunk: Buffer) => this.onData(chunk));
    sp.on('error', (err: Error) => {
      console.error('[SSPBus] Error serial:', err.message);
      this.emit('error', err);
    });

    sp.open((err) => {
      if (err) return reject(err);
      this.port = sp; // asignar DESPUÉS de que open confirma éxito
      console.log(`[SSPBus] Puerto ${this.portName} abierto — baud: ${process.env.SSP_BAUD_RATE || '9600'}`);
      setTimeout(() => resolve(), 1500);
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
      this.seqBits.set(address, true);
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
        console.log(`[SSPBus] TX → addr=0x${address.toString(16)} seqBit=${seqBit} packet: ${packet.toString('hex')}`);
     
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
  console.log(`[SSPBus] RAW RX (${chunk.length} bytes): ${chunk.toString('hex')}`);
  this.rxBuffer = Buffer.concat([this.rxBuffer, chunk]);
  this.tryParseResponse();
}

private tryParseResponse() {
  // Buscar STX 0x7F
  const stxIdx = this.rxBuffer.indexOf(0x7f);
  if (stxIdx < 0) { this.rxBuffer = Buffer.alloc(0); return; }
  if (stxIdx > 0)  this.rxBuffer = this.rxBuffer.slice(stxIdx);

  if (this.rxBuffer.length < 3) return;

  // SEQID puede tener 0x7F si el address es 0x7F — poco probable pero manejarlo
  // rxBuffer[0]=STX(0x7F), rxBuffer[1]=SEQID, rxBuffer[2]=LENGTH
  const seqId    = this.rxBuffer[1];
  const length   = this.rxBuffer[2];
  const minExpected = 1 + 1 + 1 + length + 2;

  console.log(`[SSPBus] Frame: seqId=0x${seqId.toString(16)} len=${length} bufLen=${this.rxBuffer.length} need=${minExpected}`);

  if (this.rxBuffer.length < minExpected) return;

  const frame = this.rxBuffer.slice(0, minExpected);
  this.rxBuffer = this.rxBuffer.slice(minExpected);

  console.log(`[SSPBus] Frame completo: ${frame.toString('hex')}`);

  const response = parseResponse(frame);
  if (!response) {
    console.warn('[SSPBus] parseResponse retornó null');
    this.tryParseResponse();
    return;
  }

  console.log(`[SSPBus] Parsed: addr=0x${response.address.toString(16)} generic=0x${response.generic.toString(16)} valid=${response.valid}`);

  if (!response.valid) {
    console.warn(`[SSPBus] CRC inválido de 0x${response.address.toString(16)}`);
    this.tryParseResponse();
    return;
  }

  if (this.pendingResolve && response.address === this.pendingAddress) {
    clearTimeout(this.timeoutHandle!);
    const currentSeq = this.seqBits.get(response.address) ?? false;
    this.seqBits.set(response.address, !currentSeq);
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    this.pendingReject  = null;
    resolve(response);
  } else {
    console.log(`[SSPBus] Respuesta sin comando pendiente — addr=0x${response.address.toString(16)} pendingAddr=0x${this.pendingAddress.toString(16)}`);
    this.emit('response', response.address, response);
  }

  this.tryParseResponse();
 }
}
