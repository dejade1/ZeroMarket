import { SerialPort } from 'serialport';
import { Mutex } from 'async-mutex';
import { eSSPCrypto } from './esspCrypto';


// ─── CRC + PACKET ─────────────────────────────────────────────────────────────
function crc16(data: Buffer): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function buildPacket(address: number, seqBit: number, data: Buffer): Buffer {
  const seqId = ((seqBit & 1) << 7) | (address & 0x7f);
  const payload = Buffer.from([seqId, data.length, ...data]);
  const crcVal = crc16(payload);
  const raw = Buffer.from([0x7f, ...payload, crcVal & 0xff, (crcVal >> 8) & 0xff]);
  const stuffed: number[] = [0x7f];
  for (let i = 1; i < raw.length; i++) {
    stuffed.push(raw[i]);
    if (raw[i] === 0x7f) stuffed.push(0x7f);
  }
  return Buffer.from(stuffed);
}

function parseResponse(raw: Buffer): { code: number; data: Buffer } {
  if (!raw || raw.length < 6 || raw[0] !== 0x7f) return { code: 0, data: Buffer.alloc(0) };
  const destuffed: number[] = [];
  let i = 1;
  while (i < raw.length) {
    destuffed.push(raw[i]);
    if (raw[i] === 0x7f && i + 1 < raw.length && raw[i + 1] === 0x7f) i += 2;
    else i++;
  }
  if (destuffed.length < 3) return { code: 0, data: Buffer.alloc(0) };
  const length = destuffed[1];
  const data = Buffer.from(destuffed.slice(2, 2 + length));
  return { code: data[0] ?? 0, data: data.slice(1) };
}


// ─── DRIVER ───────────────────────────────────────────────────────────────────
export class SSPDriver {
  private seq = 1;
  public crypto = new eSSPCrypto();

  constructor(
    private port: SerialPort,
    public address: number,
    private mutex: Mutex,
  ) {}

  private readResponse(): Promise<Buffer> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let idleTimer: ReturnType<typeof setTimeout>;
      let hardTimer: ReturnType<typeof setTimeout>;
      let resolved = false;

      const done = (buf: Buffer) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(idleTimer);
        clearTimeout(hardTimer);
        this.port.removeListener('data', onData);
        resolve(buf);
      };

      const onData = (chunk: Buffer) => {
        chunks.push(chunk);
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => done(Buffer.concat(chunks)), 80);
      };

      this.port.on('data', onData);
      hardTimer = setTimeout(() => done(Buffer.alloc(0)), 800);
    });
  }

  async send(cmd: number, params: Buffer = Buffer.alloc(0)): Promise<{ code: number; data: Buffer }> {
    return this.mutex.runExclusive(async () => {
      const pkt = buildPacket(this.address, this.seq, Buffer.from([cmd, ...params]));
      this.port.write(pkt);
      this.port.drain();
      const raw = await this.readResponse();
      this.seq ^= 1;
      return parseResponse(raw);
    });
  }

  async sendEncrypted(cmd: number, params: Buffer = Buffer.alloc(0)): Promise<{ code: number; data: Buffer }> {
    if (!this.crypto.isNegotiated) throw new Error('eSSP: clave no negociada');
    return this.mutex.runExclusive(async () => {
      const encPayload = this.crypto.encryptPacket(cmd, params);

        
            console.log(`[eSSP-DBG] cmd=0x${cmd.toString(16)} encPayload[0]=0x${encPayload[0]?.toString(16)} len=${
              encPayload.length} hex=${encPayload.slice(0,12).toString('hex')}`);

      
      const pkt = buildPacket(this.address, this.seq, encPayload);
      this.port.write(pkt);
      this.port.drain();
      const raw = await this.readResponse();
      this.seq ^= 1;

      const { code, data } = parseResponse(raw);
      if (!data.length) return { code, data };

      if (data[0] === 0x7e) {
        const decrypted = this.crypto.decryptResponse(data);
        if (!decrypted) return { code: 0xfe, data: Buffer.alloc(0) };
        return { code: decrypted[0], data: decrypted.slice(1) };
      }
      return { code: data[0], data: data.slice(1) };
    });
  }

  async forceSync(): Promise<boolean> {
    for (let i = 0; i < 3; i++) {
      this.seq = 1;
      const { code } = await this.send(0x11);
      this.seq = 0;
      if (code === 0xf0) return true;
      await delay(200);
    }
    return false;
  }

  async negotiateKeys(): Promise<boolean> {
    this.crypto.reset();
    this.seq = 0;

    const syncOk = await this.forceSync();
    if (!syncOk) return false;

    const { generator, modulus, hostInterKey, hostRnd } = this.crypto.prepareKeyExchange();

    const genBuf = bigIntTo8ByteLE(generator);
    const { code: c1 } = await this.send(0x4a, genBuf);
    if (c1 !== 0xf0) return false;
    await delay(50);

    const modBuf = bigIntTo8ByteLE(modulus);
    const { code: c2 } = await this.send(0x4b, modBuf);
    if (c2 !== 0xf0) return false;
    await delay(50);

    const hiBuf = bigIntTo8ByteLE(hostInterKey);
    const { code: c3, data } = await this.send(0x4c, hiBuf);
    if (c3 !== 0xf0 || data.length < 8) return false;

    const slaveInterKey = bufferTo8ByteBigIntLE(data.slice(0, 8));
    this.crypto.finalizeKey(slaveInterKey, hostRnd, modulus);
    return true;
  }

  async configureCoinMech(denomsCents: number[], country: string): Promise<boolean> {
    for (const cents of denomsCents) {
      const p = Buffer.alloc(6);
      p[0] = 0x01;
      p.writeUInt16LE(cents, 1);
      p.write(country.slice(0, 3).padEnd(3), 3, 'ascii');
      await this.sendEncrypted(0x40, p);
      await delay(20);
    }
    await this.sendEncrypted(0x49, Buffer.from([0x01]));
    await delay(20);
    return true;
  }

  async reactivateCoinMech(): Promise<boolean> {
    await this.send(0x49, Buffer.from([0x01]));
    await delay(50);
    return this.enable();
  }

  async setProtocol(v = 8)    { return (await this.send(0x06, Buffer.from([v]))).code === 0xf0; }
  async setupRequest()        { const r = await this.send(0x05); return r.code === 0xf0 ? r.data : Buffer.alloc(0); }
  async enable()              { return (await this.send(0x0a)).code === 0xf0; }
  async disable()             { return (await this.send(0x09)).code === 0xf0; }
  async reset()               { return (await this.send(0x01)).code === 0xf0; }
  async poll()                { return this.send(0x07); }
  async setInhibits(b1 = 0xff, b2 = 0xff) { return (await this.send(0x02, Buffer.from([b1, b2]))).code === 0xf0; }
  async rejectNote()          { return (await this.send(0x08)).code === 0xf0; }
  async holdNote()            { return (await this.send(0x18)).code === 0xf0; }

  async getSerial(): Promise<number> {
    const { code, data } = await this.send(0x0c);
    return code === 0xf0 && data.length >= 4 ? data.readUInt32BE(0) : 0;
  }

  async getAllLevels() {
    const { code, data } = await this.send(0x22);
    if (code !== 0xf0 || !data.length) return [];
    const num = data[0];
    const result = [];
    for (let i = 0; i < num; i++) {
      const base = 1 + i * 9;
      if (base + 9 > data.length) break;
      result.push({
        level:   data.readUInt16LE(base),
        value:   data.readUInt32LE(base + 2),
        country: data.slice(base + 6, base + 9).toString('ascii'),
      });
    }
    return result;
  }

  async setDenominationRoute(cents: number, country: string, route: 0 | 1 = 0): Promise<boolean> {
    const p = Buffer.alloc(8);
    p[0] = route;
    p.writeUInt32LE(cents, 1);
    p.write(country.slice(0, 3).padEnd(3), 5, 'ascii');
    const { code } = await this.sendEncrypted(0x3b, p);
    return code === 0xf0;
  }

  async enablePayoutDevice(): Promise<boolean> {
    const { code } = await this.sendEncrypted(0x5c, Buffer.from([0x00]));
    return code === 0xf0;
  }

  async payoutAmount(cents: number, country: string, test = false): Promise<{ code: number; data: Buffer }> {
    const p = Buffer.alloc(8);
    p.writeUInt32LE(cents, 0);
    p.write(country.slice(0, 3).padEnd(3), 4, 'ascii');
    p[7] = test ? 0x19 : 0x58;
    return this.sendEncrypted(0x33, p);
  }

  async smartEmpty(): Promise<boolean> {
    const { code } = await this.sendEncrypted(0x52);
    return code === 0xf0;
  }

  async enableCoinMech(denomsCents: number[], country: string): Promise<boolean> {
    for (const cents of denomsCents) {
      const p = Buffer.alloc(6);
      p[0] = 0x01;
      p.writeUInt16LE(cents, 1);
      p.write(country.slice(0, 3).padEnd(3), 3, 'ascii');
      await this.sendEncrypted(0x40, p);
      await delay(20);
    }
    await this.sendEncrypted(0x49, Buffer.from([0x01]));
    await delay(20);
    return this.enable();
  }
}


// ─── SERVICIO PRINCIPAL ───────────────────────────────────────────────────────
export class SSPService {
  private port: SerialPort | null = null;
  private mutex = new Mutex();
  public scs:   SSPDriver | null = null;
  public nv200: SSPDriver | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  public onEvent?: (device: 'SCS' | 'NV200', event: string, data: Buffer) => void;
  private hardwareReady = false;
  private country       = 'USD';
  private isPollingActive = false;
  public onPaymentComplete?: (orderId: string, changeCents: number) => void;

  // ── Estado del payout de vuelto ──────────────────────────────────────────
  // Mientras dispensingState !== 'idle', el polling detecta DISPENSED/errores
  private dispensingState: 'idle' | 'waiting' | 'done' = 'idle';
  private dispensingOrderId = '';
  private dispensingChangeCents = 0;

  private paymentTriggered = false;


  async connect(portPath: string): Promise<{ scsOk: boolean; nv200Ok: boolean }> {
    if (this.port?.isOpen) await this.disconnect();

    this.port = new SerialPort({ path: portPath, baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 2, autoOpen: false });
    await new Promise<void>((res, rej) => this.port!.open(e => e ? rej(e) : res()));

    this.scs   = new SSPDriver(this.port, 0x10, this.mutex);
    this.nv200 = new SSPDriver(this.port, 0x00, this.mutex);

    const scsOk   = await this.scs.forceSync();
    const nv200Ok = await this.nv200.forceSync();
    return { scsOk, nv200Ok };
  }

  async initDevices(country = 'USD'): Promise<void> {
    this.country = country;
    if (!this.scs || !this.nv200) throw new Error('No conectado');

    // ── NV200 ──────────────────────────────────────────────────────────────
    console.log('[NV200] Iniciando...');
    await this.nv200.setProtocol(8);
    await this.nv200.setupRequest();
    const nv200KeyOk = await this.nv200.negotiateKeys();
    if (nv200KeyOk) {
      await this.nv200.setDenominationRoute(500,  country, 0);
      await this.nv200.setDenominationRoute(1000, country, 0);
      await this.nv200.enablePayoutDevice();
    }
    await this.nv200.setInhibits(0xff, 0xff);
    await this.nv200.disable();
    console.log('[NV200] Listo');

    // ── SCS ────────────────────────────────────────────────────────────────
    console.log('[SCS] Iniciando...');
    await this.scs.setProtocol(6);
    await this.scs.setupRequest();
    await this.scs.negotiateKeys();
    const SCS_DENOMS = [1, 5, 10, 25, 100];
    await this.scs.configureCoinMech(SCS_DENOMS, country);
    await this.scs.setInhibits(0xff, 0xff);
    await this.scs.disable();
    console.log('[SCS] Listo');

    this.hardwareReady = true;
    console.log('✅ SSP Hardware listo — dispositivos en STANDBY (polling activo)');
  }

  startPolling(intervalMs = 200): void {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(() => this.pollBoth(), intervalMs);
  }

  stopPolling(): void {
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
  }


  // ─── SESIÓN DE PAGO ───────────────────────────────────────────────────────

  private currentSession: {
    orderId:    string;
    totalCents: number;
    inserted:   number;
    active:     boolean;
  } | null = null;

  async startPaymentSession(orderId: string, totalCents: number): Promise<void> {
    if (!this.hardwareReady) throw new Error('Hardware SSP no inicializado todavía');

    this.paymentTriggered = false;
    
    if (this.currentSession?.active) {        

      console.log(`[SSP] Cancelando sesión previa: ${this.currentSession.orderId}`);
      this.stopPolling();
      await this.nv200?.disable().catch(() => {});
      await this.scs?.disable().catch(() => {});
      await delay(200);
      this.currentSession = null;
    }

    this.currentSession = { orderId, totalCents, inserted: 0, active: true };
    this.stopPolling();

    await this.nv200?.setInhibits(0xff, 0xff);
    await this.nv200?.enable();
    await delay(50);

    await this.scs?.reactivateCoinMech();
    console.log('[SCS] Coin mech activo');

    this.startPolling(500);
    console.log(`[SSP] Sesión iniciada: ${orderId} — Total: $${(totalCents / 100).toFixed(2)}`);
  }

  async cancelPaymentSession(): Promise<void> {
    if (!this.currentSession) return;

    console.log(`[SSP] Sesión cancelada: ${this.currentSession.orderId}`);
    this.currentSession = null;
    this.stopPolling();
    await this.nv200?.disable();
    await this.scs?.disable();
    this.startPolling(500);
  }

  getSessionStatus() {
    if (!this.currentSession) return { active: false };
    const { orderId, totalCents, inserted } = this.currentSession;
    return {
      active:    true,
      orderId,
      totalCents,
      inserted,
      remaining: Math.max(0, totalCents - inserted),
    };
  }


  // ─── POLLING ──────────────────────────────────────────────────────────────

  private async pollBoth(): Promise<void> {
    if (this.isPollingActive) return;
    this.isPollingActive = true;
    try {
      if (this.scs)   await this.handlePoll('SCS',   this.scs);
      if (this.nv200) await this.handlePoll('NV200', this.nv200);
    } finally {
      this.isPollingActive = false;
    }
  }

  private async handlePoll(device: 'SCS' | 'NV200', driver: SSPDriver): Promise<void> {
    const { code, data } = await driver.poll();
    if (code !== 0xf0 || !data.length) return;

    if (data[0] !== 0xe8) {
      console.log(`[${device}-POLL] raw: ${data.toString('hex')}`);
    }

    let i = 0;
    while (i < data.length) {
      const evCode = data[i++];
      const evName = SSP_EVENTS[evCode] ?? `0x${evCode.toString(16).toUpperCase()}`;

      let evData = Buffer.alloc(0);
      if (evCode === 0xee) {
        evData = data.slice(i, i + 1); i += 1;
      } else if (evCode === 0xdf) {
        evData = data.slice(i, i + 7); i += 7;
      } else if (evCode === 0xef) {
        evData = data.slice(i, i + 1); i += 1;
      } else if (evCode === 0xbf) {
        if (i < data.length) {
          const n = data[i];
          const sz = 1 + n * 7;
          evData = data.slice(i, i + sz);
          i += sz;
        }
      } else if (
        evCode === 0xda || evCode === 0xd2 ||
        evCode === 0xd7 || evCode === 0xd8 ||
        evCode === 0xb3 || evCode === 0xb4 ||
        evCode === 0xdc || evCode === 0xdd ||  // INCOMPLETE_PAYOUT / INCOMPLETE_FLOAT
        evCode === 0xb1                         // ERROR_DURING_PAYOUT
      ) {
        if (i < data.length) {
          const n = data[i];
          const sz = 1 + n * 7;
          evData = data.slice(i, i + sz);
          i += sz;
        }
      }

      this.onEvent?.(device, evName, evData);
      this.handlePaymentEvent(device, evName, evData);

      // ── Detectar confirmación de DISPENSED desde el polling normal ────────
      if (device === 'SCS' && this.dispensingState === 'waiting') {
        if (evCode === 0xd2) {
          // DISPENSED — vuelto entregado exitosamente
          console.log(`[SCS] ✅ DISPENSED — Vuelto $${(this.dispensingChangeCents / 100).toFixed(2)} entregado`);
          this.dispensingState = 'done';
          await this.finishPayoutSession();
        } else if (evCode === 0xdc || evCode === 0xb1 || evCode === 0xd9) {
          // INCOMPLETE_PAYOUT / ERROR_DURING_PAYOUT / TIMEOUT
          console.error(`[SCS] ❌ Error en payout: ${evName} (0x${evCode.toString(16)})`);
          this.dispensingState = 'done';
          await this.finishPayoutSession();
        }
      }
    }
  }


  // ─── PAGO Y VUELTO ────────────────────────────────────────────────────────

  private handlePaymentEvent(device: 'SCS' | 'NV200', event: string, data: Buffer): void {
    if (!this.currentSession?.active) return;

    let amountCents = 0;

    if (event === 'NOTE_CREDIT' && device === 'NV200') {
      const channel = data[0];
      amountCents = this.getNV200ChannelValue(channel);
    }

    if (event === 'VALUE_ADDED' && device === 'SCS') {
      amountCents = data.length >= 5 ? data.readUInt32LE(1) : 0;
    }

    if (event === 'COIN_CREDIT' && device === 'SCS') {
      amountCents = data.length >= 4 ? data.readUInt32LE(0) : 0;
    }

    if (amountCents > 0) {
        if (!this.currentSession?.active) return;

      this.currentSession.inserted += amountCents;
      const { orderId, totalCents, inserted } = this.currentSession;
      const remaining = totalCents - inserted;

      console.log(`[SSP] +$${(amountCents / 100).toFixed(2)} | Total insertado: $${(
                      inserted / 100).toFixed(2)} | Restante: $${(Math.max(0, remaining) / 100).toFixed(2)}`);

      if (inserted >= totalCents && !this.paymentTriggered) {
          this.paymentTriggered = true;           // ← bloquear inmediatamente
          this.currentSession.active = false;

          console.log(`[SSP] ✅ Pago completo: ${orderId}`);


        const changeCents = inserted - totalCents;

        // ── Deshabilitar NV200 siempre — ya no aceptamos más billetes ────────
        this.nv200?.disable().catch(() => {});

        if (changeCents <= 0) {
          // Pago exacto → deshabilitar SCS y terminar directo
          this.scs?.disable().catch(() => {});
          console.log(`[SSP] 💰 PAYMENT_COMPLETE enviado — Cambio: $0.00`);
          this.onPaymentComplete?.(orderId, 0);
        } else {
          // Hay vuelto → iniciar payout, SCS permanece habilitado
          console.log(`[SSP] 💰 PAYMENT_COMPLETE enviado — Cambio: $${(changeCents / 100).toFixed(2)}`);
          this.onPaymentComplete?.(orderId, changeCents);
          // Lanzar payout de forma asíncrona — no bloquear el handler
          this.startPayout(orderId, changeCents).catch((err) => {
            console.error('[SSP] Error iniciando payout:', err);
            this.scs?.disable().catch(() => {});
          });
        }
      }
    }
  }

  private async startPayout(orderId: string, changeCents: number): Promise<void> {
    // Detener polling momentáneamente para enviar el comando sin interferencia
    this.stopPolling();
    await delay(100);

    console.log(`[SCS] 💸 Iniciando payout de $${(changeCents / 100).toFixed(2)}...`);

    console.log(`[SCS] 🔑 Re-negociando claves para payout...`);
        const keysOk = await this.scs!.negotiateKeys();
        if (!keysOk) {
          console.error(`[SCS] ❌ No se pudieron negociar claves para payout`);
          await this.scs?.disable().catch(() => {});
          this.dispensingState = 'idle';
          this.startPolling(500);
          return;
        }
        console.log(`[SCS] ✅ Claves re-negociadas`);
        await this.scs!.enable();
        await delay(300); 
    
      
    
    const PAYOUT_ERRORS: Record<number, string> = {
      1: 'Sin suficiente valor',
      2: 'No puede pagar exacto',
      3: 'Dispositivo ocupado',
      4: 'Dispositivo deshabilitado',
    };

    console.log(`[SCS] isNegotiated: ${this.scs!.crypto.isNegotiated}`);

    const { code, data } = await this.scs!.payoutAmount(changeCents, this.country);

    console.log(`[SCS] payoutAmount raw → code: 0x${code.toString(16)}, data: ${data.toString('hex')}`);

    if (code !== 0xf0) {
      const errCode = data?.[0] ?? 0;
      const errMsg = PAYOUT_ERRORS[errCode] ?? `código 0x${code.toString(16)}`;
      console.error(`[SCS] ❌ Payout rechazado: ${errMsg} (errCode=${errCode})`);
      // Deshabilitar SCS y cerrar — no hay vuelto que dar
      await this.scs?.disable().catch(() => {});
      this.dispensingState = 'idle';
      this.startPolling(500);
      return;
    }

    // Comando aceptado → armar estado para que handlePoll detecte DISPENSED
    console.log(`[SCS] ⏳ Payout aceptado, esperando DISPENSED...`);
    this.dispensingState   = 'waiting';
    this.dispensingOrderId  = orderId;
    this.dispensingChangeCents = changeCents;

    // Reanudar polling para detectar 0xD2 DISPENSED
    this.startPolling(200);

    // Timeout de seguridad: si en 12s no llega DISPENSED, cerrar igual
    setTimeout(async () => {
      if (this.dispensingState === 'waiting') {
        console.warn(`[SCS] ⚠️ Timeout esperando DISPENSED — cerrando sesión`);
        this.dispensingState = 'done';
        await this.finishPayoutSession();
      }
    }, 12_000);
  }

  private async finishPayoutSession(): Promise<void> {
    this.dispensingState       = 'idle';
    this.dispensingOrderId      = '';
    this.dispensingChangeCents  = 0;
    await this.scs?.disable().catch(() => {});
    console.log(`[SSP] Sesión cancelada: ${this.currentSession?.orderId ?? ''}`);
    this.currentSession = null;
    this.stopPolling();
    this.startPolling(500);
  }


  // ─── HELPERS ─────────────────────────────────────────────────────────────

  private getNV200ChannelValue(channel: number): number {
    const channelMap: Record<number, number> = {
      1: 100,
      2: 200,
      3: 500,
      4: 1000,
      5: 2000,
      6: 5000,
      7: 10000,
    };
    return channelMap[channel] ?? 0;
  }

  async disconnect(): Promise<void> {
    this.stopPolling();
    await this.scs?.disable().catch(() => {});
    await this.nv200?.disable().catch(() => {});
    if (this.port?.isOpen) await new Promise<void>(r => this.port!.close(() => r()));
    this.port  = null;
    this.scs   = null;
    this.nv200 = null;
    this.hardwareReady  = false;
    this.currentSession = null;
    this.dispensingState = 'idle';
  }
}


// ─── HELPERS BigInt LE 8 bytes ────────────────────────────────────────────────
function bigIntTo8ByteLE(n: bigint): Buffer {
  const buf = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) { buf[i] = Number(n & 0xffn); n >>= 8n; }
  return buf;
}
function bufferTo8ByteBigIntLE(buf: Buffer): bigint {
  let n = 0n;
  for (let i = 7; i >= 0; i--) n = (n << 8n) | BigInt(buf[i]);
  return n;
}
function delay(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }


// ─── EVENTOS ──────────────────────────────────────────────────────────────────
export const SSP_EVENTS: Record<number, string> = {
  0xef: 'READ',            0xee: 'NOTE_CREDIT',      0xed: 'REJECTING',
  0xec: 'REJECTED',        0xcc: 'STACKING',          0xeb: 'STACKED',
  0xf1: 'SLAVE_RESET',     0xe8: 'DISABLED',          0xe6: 'FRAUD_ATTEMPT',
  0xda: 'DISPENSING',      0xd2: 'DISPENSED',         0xd7: 'FLOATING',
  0xd8: 'FLOATED',         0xd5: 'JAMMED',            0xb3: 'SMART_EMPTYING',
  0xb4: 'SMART_EMPTIED',   0xdc: 'INCOMPLETE_PAYOUT', 0xdd: 'INCOMPLETE_FLOAT',
  0xcf: 'DEVICE_FULL',     0xbf: 'VALUE_ADDED',       0xc1: 'PAYIN_ACTIVE',
  0xd9: 'TIMEOUT',         0xd6: 'PAYOUT_HALTED',     0xdf: 'COIN_CREDIT',
  0xde: 'CASHBOX_PAID',    0xb6: 'INITIALISING',      0xdb: 'NOTE_STORED_IN_PAYOUT',
  0xb1: 'ERROR_DURING_PAYOUT',
};
