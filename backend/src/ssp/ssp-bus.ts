// backend/src/ssp/ssp-bus.ts
// Bus SSP compartido RS485 — NV200 (addr 0x00) + SCS (addr 0x10)
// Gestiona: apertura de puerto, cola FIFO, SEQ bit por dispositivo, parseo de frames

import { SerialPort }  from 'serialport';
import { EventEmitter } from 'events';
import { buildPacket, parseResponse, SSPResponse } from './ssp-packet';

// ── Constantes ────────────────────────────────────────────────────────────────

const CMD_TIMEOUT_MS = 5000; // tiempo máximo esperando respuesta por comando
const MAX_RETRIES    = 1;    // reintentos antes de rechazar — 1 es suficiente en RS485 estable

const CMD_SYNC = 0x11;       // necesario para resetear seqBit post-SYNC

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface BusCommand {
  address: number;
  data:    Buffer;
  resolve: (res: SSPResponse) => void;
  reject:  (err: Error) => void;
  retries: number;
}

// ── Clase principal ───────────────────────────────────────────────────────────

export class SSPBus extends EventEmitter {
  private port:      SerialPort | null = null;
  private portName:  string;
  private rxBuffer:  Buffer = Buffer.alloc(0);

  // SEQ bit independiente por dirección — nunca compartir entre NV200 y SCS
  // Valor inicial true (seqBit=1) para el primer SYNC de cada dispositivo
  private seqBits = new Map<number, boolean>();

  // Cola FIFO de comandos — garantiza un solo comando en el bus en cada momento
  private cmdQueue:   BusCommand[] = [];
  private processing: boolean      = false;

  // Estado del comando actualmente en vuelo
  private pendingResolve: ((res: SSPResponse) => void) | null = null;
  private pendingReject:  ((err: Error) => void)        | null = null;
  private pendingAddress: number                               = 0;
  private pendingCmd:     number                               = 0;
  private timeoutHandle:  NodeJS.Timeout | null                = null;

  constructor(portName: string) {
    super();
    this.portName = portName;
  }

  // ── Apertura del puerto ───────────────────────────────────────────────────

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

      sp.on('data',  (chunk: Buffer) => this.onData(chunk));
      sp.on('error', (err: Error) => {
        console.error('[SSPBus] Error serial:', err.message);
        this.emit('error', err);
      });

      sp.open((err) => {
        if (err) return reject(err);
        this.port = sp;
        console.log(
          `[SSPBus] Puerto ${this.portName} abierto — ` +
          `baud: ${process.env.SSP_BAUD_RATE || '9600'}`
        );
        // 200ms suficiente para estabilización del transceiver RS485
        setTimeout(() => resolve(), 200);
      });
    });
  }

  // ── Cierre del puerto ─────────────────────────────────────────────────────

  async close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.port?.isOpen) return resolve();
      this.port.close(() => resolve());
    });
  }

  // ── Registro de dirección ─────────────────────────────────────────────────
  // Llamado por NV200 y SCS en su constructor
  // Inicializa el seqBit en true — el primer comando siempre es SYNC con seqBit=1

  registerAddress(address: number): void {
    if (!this.seqBits.has(address)) {
      this.seqBits.set(address, true);
      console.log(`[SSPBus] Dirección registrada: 0x${address.toString(16)}`);
    }
  }

  // ── SEQ bit — gestión por dispositivo ────────────────────────────────────

  private getSeqBit(addr: number): boolean {
    // Si no está registrado, inicializar en true
    if (!this.seqBits.has(addr)) this.seqBits.set(addr, true);
    return this.seqBits.get(addr)!;
  }

  private flipSeqBit(addr: number): void {
    this.seqBits.set(addr, !this.getSeqBit(addr));
  }

  // Post-SYNC: el siguiente comando debe ir con seqBit=false
  private resetSeqAfterSync(addr: number): void {
    this.seqBits.set(addr, false);
  }

  // ── Envío de comando público — entrada a la cola FIFO ────────────────────

  send(address: number, data: Buffer): Promise<SSPResponse> {
    return new Promise((resolve, reject) => {
      this.cmdQueue.push({ address, data, resolve, reject, retries: 0 });
      this.processQueue();
    });
  }

  // ── Procesamiento de la cola ──────────────────────────────────────────────

  private async processQueue(): Promise<void> {
    if (this.processing || this.cmdQueue.length === 0) return;
    this.processing = true;

    const cmd = this.cmdQueue.shift()!;
    try {
      const res = await this.sendRaw(cmd.address, cmd.data);
      cmd.resolve(res);
    } catch (err: any) {
      if (cmd.retries < MAX_RETRIES) {
        cmd.retries++;
        this.cmdQueue.unshift(cmd); // reencolar al frente para reintento inmediato
      } else {
        cmd.reject(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      this.processing = false;
      if (this.cmdQueue.length > 0) setImmediate(() => this.processQueue());
    }
  }

  // ── Envío raw — construye packet, envía, espera respuesta ────────────────

  private sendRaw(address: number, data: Buffer): Promise<SSPResponse> {
    return new Promise((resolve, reject) => {
      if (!this.port?.isOpen) {
        return reject(new Error('Puerto no abierto'));
      }

      const seqBit = this.getSeqBit(address);
      const packet = buildPacket({ address, seqBit, data });

      console.log(
        `[SSPBus] TX → addr=0x${address.toString(16)} ` +
        `seqBit=${seqBit} packet: ${packet.toString('hex')}`
      );

      this.pendingResolve = resolve;
      this.pendingReject  = reject;
      this.pendingAddress = address;
      this.pendingCmd     = data[0];

      this.timeoutHandle = setTimeout(() => {
        this.pendingResolve = null;
        this.pendingReject  = null;
        reject(new Error(
          `TIMEOUT address=0x${address.toString(16).padStart(2, '0')} ` +
          `cmd=0x${data[0].toString(16)}`
        ));
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

  // ── Recepción de datos ────────────────────────────────────────────────────

  private onData(chunk: Buffer): void {
    console.log(`[SSPBus] RAW RX (${chunk.length} bytes): ${chunk.toString('hex')}`);
    this.rxBuffer = Buffer.concat([this.rxBuffer, chunk]);
    this.tryParseResponse();
  }

  // ── Parser de frames SSP ──────────────────────────────────────────────────
  // Estructura: STX(0x7F) | SEQID | LENGTH | DATA... | CRC_L | CRC_H

  private tryParseResponse(): void {
    // Buscar STX 0x7F
    const stxIdx = this.rxBuffer.indexOf(0x7f);
    if (stxIdx < 0) { this.rxBuffer = Buffer.alloc(0); return; }
    if (stxIdx > 0)  this.rxBuffer = this.rxBuffer.slice(stxIdx);

    // Necesitamos mínimo: STX + SEQID + LENGTH = 3 bytes para saber el tamaño
    if (this.rxBuffer.length < 3) return;

    const seqId       = this.rxBuffer[1];
    const length      = this.rxBuffer[2];
    // Frame completo = STX(1) + SEQID(1) + LENGTH(1) + DATA(length) + CRC(2)
    const minExpected = 1 + 1 + 1 + length + 2;

    console.log(
      `[SSPBus] Frame: seqId=0x${seqId.toString(16)} ` +
      `len=${length} bufLen=${this.rxBuffer.length} need=${minExpected}`
    );

    if (this.rxBuffer.length < minExpected) return;

    const frame   = this.rxBuffer.slice(0, minExpected);
    this.rxBuffer = this.rxBuffer.slice(minExpected);

    console.log(`[SSPBus] Frame completo: ${frame.toString('hex')}`);

    const response = parseResponse(frame);
    if (!response) {
      console.warn('[SSPBus] parseResponse retornó null — descartando frame');
      this.tryParseResponse();
      return;
    }

    console.log(
      `[SSPBus] Parsed: addr=0x${response.address.toString(16)} ` +
      `generic=0x${response.generic.toString(16)} valid=${response.valid}`
    );

    if (!response.valid) {
      console.warn(`[SSPBus] CRC inválido de 0x${response.address.toString(16)}`);
      this.tryParseResponse();
      return;
    }

    // Entregar respuesta al comando pendiente si la dirección coincide
    if (this.pendingResolve && response.address === this.pendingAddress) {
      clearTimeout(this.timeoutHandle!);
      this.timeoutHandle = null;

      // Actualizar SEQ bit:
      // - Si el comando que acaba de completarse fue SYNC → resetear a false
      // - Cualquier otro comando → flip normal
      if (this.pendingCmd === CMD_SYNC) {
        this.resetSeqAfterSync(response.address);
      } else {
        this.flipSeqBit(response.address);
      }

      const resolve       = this.pendingResolve;
      this.pendingResolve = null;
      this.pendingReject  = null;
      this.pendingCmd     = 0;
      resolve(response);
    } else {
      // Respuesta inesperada — no hay comando pendiente para esa dirección
      console.warn(
        `[SSPBus] Respuesta inesperada — ` +
        `addr=0x${response.address.toString(16)} ` +
        `pendingAddr=0x${this.pendingAddress.toString(16)}`
      );
      this.emit('unexpectedResponse', response.address, response);
    }

    // Continuar parseando si quedaron bytes en el buffer
    this.tryParseResponse();
  }
}
