import { SerialPort } from 'serialport';
import { Mutex } from 'async-mutex';
import { eSSPCrypto } from './esspCrypto';

// ─── CRC + PACKET (igual que antes) ───────────────────────────────────────────
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

    // Timeout duro — si no hay ninguna respuesta en 800ms
    hardTimer = setTimeout(() => done(Buffer.alloc(0)), 800);
  });
}

  // ── Envío sin cifrado ──────────────────────────────────────────────────────
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

  // ── Envío CON cifrado (obligatorio para payout/rutas) ─────────────────────
  async sendEncrypted(cmd: number, params: Buffer = Buffer.alloc(0)): Promise<{ code: number; data: Buffer }> {
    if (!this.crypto.isNegotiated) throw new Error('eSSP: clave no negociada');
    return this.mutex.runExclusive(async () => {
      const encPayload = this.crypto.encryptPacket(cmd, params);
      const pkt = buildPacket(this.address, this.seq, encPayload);
      this.port.write(pkt);
      this.port.drain();
      const raw = await this.readResponse();
      this.seq ^= 1;

      const { code, data } = parseResponse(raw);
      if (!data.length) return { code, data };

      // Si la respuesta viene cifrada (comienza con 0x7E)
      if (data[0] === 0x7e) {
        const decrypted = this.crypto.decryptResponse(data);
        if (!decrypted) return { code: 0xfe, data: Buffer.alloc(0) };
        return { code: decrypted[0], data: decrypted.slice(1) };
      }
      return { code: data[0], data: data.slice(1) };
    });
  }

  // ── SYNC ──────────────────────────────────────────────────────────────────
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

  // ── NEGOCIACIÓN DE CLAVES DH ──────────────────────────────────────────────
  // Spec: Set Generator (0x4A) → Set Modulus (0x4B) → Request Key Exchange (0x4C)
  async negotiateKeys(): Promise<boolean> {
    this.crypto.reset();
    this.seq = 0;

    // SYNC previo obligatorio
    const syncOk = await this.forceSync();
    if (!syncOk) return false;

    const { generator, modulus, hostInterKey, hostRnd } = this.crypto.prepareKeyExchange();

    // Set Generator
    const genBuf = bigIntTo8ByteLE(generator);
    const { code: c1 } = await this.send(0x4a, genBuf);
    if (c1 !== 0xf0) return false;
    await delay(50);

    // Set Modulus
    const modBuf = bigIntTo8ByteLE(modulus);
    const { code: c2 } = await this.send(0x4b, modBuf);
    if (c2 !== 0xf0) return false;
    await delay(50);

    // Request Key Exchange — enviamos hostInterKey, recibimos slaveInterKey
    const hiBuf = bigIntTo8ByteLE(hostInterKey);
    const { code: c3, data } = await this.send(0x4c, hiBuf);
    if (c3 !== 0xf0 || data.length < 8) return false;

    const slaveInterKey = bufferTo8ByteBigIntLE(data.slice(0, 8));
    this.crypto.finalizeKey(slaveInterKey, hostRnd, modulus);
    return true;
  }

// En SSPDriver — configurar monedas SIN habilitar
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
  return true;  // ← sin enable()
}



  // ── COMANDOS SIN CIFRADO ──────────────────────────────────────────────────
  async setProtocol(v = 8)    { return (await this.send(0x06, Buffer.from([v]))).code === 0xf0; }
  async setupRequest()        { const r = await this.send(0x05); return r.code === 0xf0 ? r.data : Buffer.alloc(0); }
  async enable()              { return (await this.send(0x0a)).code === 0xf0; }
  async disable()             { return (await this.send(0x09)).code === 0xf0; }
  async reset()               { return (await this.send(0x01)).code === 0xf0; }
  async poll()                { return this.send(0x07); }
  async setInhibits(b1=0xff, b2=0xff) { return (await this.send(0x02, Buffer.from([b1, b2]))).code === 0xf0; }
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

  // ── COMANDOS CON CIFRADO OBLIGATORIO ─────────────────────────────────────
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

  // SCS: Set Coin Mech Inhibits (0x40) + Enable (0x49) — cifrado obligatorio
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
  public scs:   SSPDriver | null = null;  // address 0x10
  public nv200: SSPDriver | null = null;  // address 0x00
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  public onEvent?: (device: 'SCS' | 'NV200', event: string, data: Buffer) => void;
  private hardwareReady = false;   // ← AGREGAR
  private country       = 'USD';  // ← AGREGAR
  private isPollingActive = false;  // ← agregar propiedad
  public onPaymentComplete?: (orderId: string, changeCents: number) => void;

  async connect(portPath: string): Promise<{ scsOk: boolean; nv200Ok: boolean }> {
    if (this.port?.isOpen) await this.disconnect();

    this.port = new SerialPort({ path: portPath, baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 2, autoOpen: false });
    await new Promise<void>((res, rej) => this.port!.open(e => e ? rej(e) : res()));

    // Drivers creados ANTES de cualquier operación
    this.scs   = new SSPDriver(this.port, 0x10, this.mutex);
    this.nv200 = new SSPDriver(this.port, 0x00, this.mutex);

    const scsOk   = await this.scs.forceSync();
    const nv200Ok = await this.nv200.forceSync();
    return { scsOk, nv200Ok };
  }

  // Init completo: SYNC → protocol → setup → negociar claves → rutas → enable
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
  await this.nv200.disable();   // ← enable para que el polling funcione
  console.log('[NV200] Listo');

    
     // ── SCS ────────────────────────────────────────────────────────────────
  console.log('[SCS] Iniciando...');
  await this.scs.setProtocol(6);
  await this.scs.setupRequest();
  const scsKeyOk = await this.scs.negotiateKeys();
  if (scsKeyOk) {
     await this.scs.configureCoinMech([1, 5, 10, 25, 100], country);
  } else {
    await this.scs.setInhibits(0xff, 0xff);
    
  }

    await this.scs.disable();

  console.log('[SCS] Listo');


  

   this.hardwareReady = true;   // ← marcar como listo
  console.log('✅ SSP Hardware listo — dispositivos en STANDBY (polling activo)');

}

  startPolling(intervalMs = 200): void {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(() => this.pollBoth(), intervalMs);
  }

  stopPolling(): void {
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
  }


  // ─── SESIÓN DE PAGO ───────────────────────────────────────────────────────────

private currentSession: {
  orderId:     string;
  totalCents:  number;
  inserted:    number;
  active:      boolean;
} | null = null;

async startPaymentSession(orderId: string, totalCents: number): Promise<void> {
  if (!this.hardwareReady) throw new Error('Hardware SSP no inicializado todavía');
  
  if (this.currentSession?.active) {
    console.log(`[SSP] Cancelando sesión previa: ${this.currentSession.orderId}`);
    this.stopPolling();
    await this.nv200?.disable().catch(() => {});
    await this.scs?.disable().catch(() => {});
    await delay(100);
    this.currentSession = null;
  }

  this.currentSession = { orderId, totalCents, inserted: 0, active: true };
  this.stopPolling();


  // ✅ AGREGAR: habilitar dispositivos al iniciar la sesión
  await this.nv200?.setInhibits(0xff, 0xff);
  await this.nv200?.enable();
  await delay(50);

  await this.scs?.setInhibits(0xff, 0xff);
  await this.scs?.enable();

  
  this.startPolling(500);  // 500ms en vez de 200ms

  console.log(`[SSP] Sesión iniciada: ${orderId} — Total: $${(totalCents / 100).toFixed(2)}`);
}

async cancelPaymentSession(): Promise<void> {
  if (!this.currentSession) return;

  console.log(`[SSP] Sesión cancelada: ${this.currentSession.orderId}`);
  this.currentSession = null;
  this.stopPolling();
  // Deshabilitar aceptación de dinero
  await this.nv200?.disable();
  await this.scs?.disable();
  this.startPolling(500); 
}

getSessionStatus(): {
  active:      boolean;
  orderId?:    string;
  totalCents?: number;
  inserted?:   number;
  remaining?:  number;
} {
  if (!this.currentSession) return { active: false };
  const { orderId, totalCents, inserted } = this.currentSession;
  return {
    active:     true,
    orderId,
    totalCents,
    inserted,
    remaining:  Math.max(0, totalCents - inserted),
  };
}

private async pollBoth(): Promise<void> {
  if (this.isPollingActive) return;  // ← evitar overlap
  this.isPollingActive = true;
  try {
    if (this.scs)   await this.handlePoll('SCS',   this.scs);
    if (this.nv200) await this.handlePoll('NV200', this.nv200);
  } finally {
    this.isPollingActive = false;
  }
}


private handlePaymentEvent(device: 'SCS' | 'NV200', event: string, data: Buffer): void {
  if (!this.currentSession?.active) return;

  let amountCents = 0;

  if (event === 'NOTE_CREDIT' && device === 'NV200') {
    // data[0] = canal, el valor está en el channelMap del driver
    const channel = data[0];
    amountCents = this.getNV200ChannelValue(channel);
  }

  if (event === 'COIN_CREDIT' && device === 'SCS') {
    // data[0..3] = value LE, data[4..6] = country
    amountCents = data.length >= 4 ? data.readUInt32LE(0) : 0;
  }

  if (amountCents > 0) {
    this.currentSession.inserted += amountCents;
    const { orderId, totalCents, inserted } = this.currentSession;
    const remaining = totalCents - inserted;

    console.log(`[SSP] +$${(amountCents / 100).toFixed(2)} | Total insertado: $${(inserted / 100).toFixed(2)} | Restante: $${(Math.max(0, remaining) / 100).toFixed(2)}`);

    if (inserted >= totalCents) {
      console.log(`[SSP] ✅ Pago completo: ${orderId}`);
      this.currentSession.active = false;
      const changeCents = inserted - totalCents;   // ← agregar esto
      this.nv200?.disable().catch(() => {});
      this.scs?.disable().catch(() => {});
      this.onPaymentComplete?.(orderId, changeCents); // ← agregar esto
    }
  }
}

private getNV200ChannelValue(channel: number): number {
  const channelMap: Record<number, number> = {
    1: 100,   // $1.00
    2: 200,   // $2.00
    3: 500,   // $5.00
    4: 1000,  // $10.00  ← tu prueba confirmó esto
    5: 2000,  // $20.00
    6: 5000,  // $50.00
    7: 10000, // $100.00
  };
  return channelMap[channel] ?? 0;
}

  private async handlePoll(device: 'SCS' | 'NV200', driver: SSPDriver): Promise<void> {
  const { code, data } = await driver.poll();
  if (code !== 0xf0 || !data.length) return;
  let i = 0;
  while (i < data.length) {
    const evCode = data[i++];
    const evName = SSP_EVENTS[evCode] ?? `0x${evCode.toString(16).toUpperCase()}`;

    // Extraer bytes de datos según el evento
    let evData = Buffer.alloc(0);
    if (evCode === 0xee) {             // NOTE_CREDIT: 1 byte (canal)
      evData = data.slice(i, i + 1); i += 1;
    } else if (evCode === 0xdf) {      // COIN_CREDIT: 4 bytes valor LE + 3 bytes country
      evData = data.slice(i, i + 7); i += 7;
    } else if (evCode === 0xef) {      // READ: 1 byte canal
      evData = data.slice(i, i + 1); i += 1;
    }
    // Otros eventos sin datos extra: no avanzar i

    this.onEvent?.(device, evName, evData);
    this.handlePaymentEvent(device, evName, evData);  // ← AGREGAR ESTA LÍNEA
  }
 }
async disconnect(): Promise<void> {
    this.stopPolling();
    await this.scs?.disable().catch(() => {});
    await this.nv200?.disable().catch(() => {});
    if (this.port?.isOpen) await new Promise<void>(r => this.port!.close(() => r()));
    this.port  = null;
    this.scs   = null;
    this.nv200 = null;
    this.hardwareReady = false;
    this.currentSession = null;
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
  0xef: 'READ',           0xee: 'NOTE_CREDIT',      0xed: 'REJECTING',
  0xec: 'REJECTED',       0xcc: 'STACKING',          0xeb: 'STACKED',
  0xf1: 'SLAVE_RESET',    0xe8: 'DISABLED',          0xe6: 'FRAUD_ATTEMPT',
  0xda: 'DISPENSING',     0xd2: 'DISPENSED',         0xd7: 'FLOATING',
  0xd8: 'FLOATED',        0xd5: 'JAMMED',            0xb3: 'SMART_EMPTYING',
  0xb4: 'SMART_EMPTIED',  0xdc: 'INCOMPLETE_PAYOUT', 0xdd: 'INCOMPLETE_FLOAT',
  0xcf: 'DEVICE_FULL',    0xbf: 'VALUE_ADDED',       0xc1: 'PAYIN_ACTIVE',
  0xd9: 'TIMEOUT',        0xd6: 'PAYOUT_HALTED',     0xdf: 'COIN_CREDIT',
  0xde: 'CASHBOX_PAID',   0xb6: 'INITIALISING',      0xdb: 'NOTE_STORED_IN_PAYOUT',
};
