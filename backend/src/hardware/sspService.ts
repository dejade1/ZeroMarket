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
      const pkt = buildPacket(this.address, this.seq, encPayload);
      this.port.write(pkt);
      this.port.drain();
      const raw = await this.readResponse();
      this.seq ^= 1;

      const { code, data } = parseResponse(raw);
      if (!data.length) return { code, data };

      // Respuesta cifrada — parseResponse pone 0x7E como code
      if (code === 0x7e) {
        const encryptedPayload = Buffer.concat([Buffer.from([0x7e]), data]);
        const decrypted = this.crypto.decryptResponse(encryptedPayload);
        if (!decrypted) return { code: 0xfe, data: Buffer.alloc(0) };
        return { code: decrypted[0], data: decrypted.slice(1) };
      }

      // Respuesta plana (no debería ocurrir en comandos cifrados)
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

    const { code: c1 } = await this.send(0x4a, bigIntTo8ByteLE(generator));
    if (c1 !== 0xf0) return false;
    await delay(50);

    const { code: c2 } = await this.send(0x4b, bigIntTo8ByteLE(modulus));
    if (c2 !== 0xf0) return false;
    await delay(50);

    // 0x4C se envía sin cifrar — el dispositivo responde cifrado con eCOUNT=0
    const { code: c3, data } = await this.send(0x4c, bigIntTo8ByteLE(hostInterKey));
    if (c3 !== 0xf0 || data.length < 8) return false;

    const slaveInterKey = bufferTo8ByteBigIntLE(data.slice(0, 8));
    this.crypto.finalizeKey(slaveInterKey, hostRnd, modulus);
    return true;
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

  async reactivateCoinMech(): Promise<boolean> {
    await this.send(0x49, Buffer.from([0x01]));
    await delay(50);
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
  private scsCountry       = 'ECD';
  private isPollingActive = false;
  public onPaymentComplete?: (orderId: string, changeCents: number) => void;

  private dispensingState: 'idle' | 'waiting' | 'done' = 'idle';
  private dispensingOrderId = '';
  private dispensingChangeCents = 0;
  private paymentTriggered = false;

  private currentSession: {
    orderId:    string;
    totalCents: number;
    inserted:   number;
    active:     boolean;
  } | null = null;

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

  private splitChange(changeCents: number): { notesCents: number; coinsCents: number } {
    // Solo $10 y $5 pueden darse como vuelto (están ruteados al reciclador)
    const noteDenoms = [1000, 500];
    let notesCents = 0;
    let remaining = changeCents;

    for (const denom of noteDenoms) {
      const count = Math.floor(remaining / denom);
      notesCents += count * denom;
      remaining  -= count * denom;
    }

    // Lo restante va al SCS en monedas
    return { notesCents, coinsCents: remaining };
  }

  async initDevices(country = 'usd'): Promise<void> {
    this.country = country;
    if (!this.scs || !this.nv200) throw new Error('No conectado');

    // ── NV200 ──────────────────────────────────────────────────────────────
   console.log('[NV200] Iniciando...');
await this.nv200.setProtocol(8);
await this.nv200.setupRequest();
const nv200KeyOk = await this.nv200.negotiateKeys();
if (nv200KeyOk) {
  // ── Rutas de denominaciones ──────────────────────────────────────────
  // route=0 → payout/reciclador | route=1 → cashbox directo

  const r1  = await this.nv200.setDenominationRoute(100,  country, 1); // $1  → cashbox
  const r2  = await this.nv200.setDenominationRoute(200,  country, 1); // $2  → cashbox
  const r5  = await this.nv200.setDenominationRoute(500,  country, 0); // $5  → payout ♻️
  const r10 = await this.nv200.setDenominationRoute(1000, country, 0); // $10 → payout ♻️
  const r20 = await this.nv200.setDenominationRoute(2000, country, 1); // $20 → cashbox

  const r4 = await this.nv200.enablePayoutDevice();

  console.log(`[NV200] Rutas: $1=${r1} $2=${r2} $5=${r5} $10=${r10} $20=${r20} payoutDevice=${r4}`);

  // ── Inhibir $50 y $100 — no aceptar ─────────────────────────────────
  // Canales 6 y 7 típicamente corresponden a $50 y $100 en dataset USD
  // Los inhibits se aplican por canal en setInhibits — canales 1-5 habilitados, 6-7 inhibidos
  // 0b00011111 = 0x1F → canales 1-5 ON, 6-8 OFF
  await this.nv200.setInhibits(0x1f, 0x00);
}
await this.nv200.disable();
console.log('[NV200] Listo');

    // ── SCS ────────────────────────────────────────────────────────────────
    console.log('[SCS] Iniciando...');
    await this.scs.setProtocol(6);
    await this.scs.setupRequest();
    await this.scs.negotiateKeys();
    const SCS_DENOMS = [1, 5, 10, 25, 100];
    await this.scs.configureCoinMech(SCS_DENOMS, 'ECD');
    await this.scs.setInhibits(0xff, 0xff);
    await this.scs.setInhibits(0x00, 0x00);
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

    await this.scs?.setInhibits(0xff, 0xff);
    await this.scs?.enable();

    this.startPolling(500);
    console.log(`[SSP] Sesión iniciada: ${orderId} — Total: $${(totalCents / 100).toFixed(2)}`);
  }

  async cancelPaymentSession(): Promise<void> {
    if (!this.currentSession) return;
    console.log(`[SSP] Sesión cancelada: ${this.currentSession.orderId}`);
    this.currentSession = null;
    this.stopPolling();
    await this.nv200?.disable();
    await this.scs?.setInhibits(0x00, 0x00);
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
      } else if ([0xda, 0xd2, 0xd7, 0xd8, 0xb3, 0xb4, 0xdc, 0xdd, 0xb1].includes(evCode)) {
        if (i < data.length) {
          const n = data[i];
          const sz = 1 + n * 7;
          evData = data.slice(i, i + sz);
          i += sz;
        }
      }

      this.onEvent?.(device, evName, evData);
      this.handlePaymentEvent(device, evName, evData);

      // Detectar DISPENSED y errores de payout
      if (device === 'SCS' && this.dispensingState === 'waiting') {
        if (evCode === 0xd2) {
          console.log(`[SCS] ✅ DISPENSED — Vuelto $${(this.dispensingChangeCents / 100).toFixed(2)} entregado`);
          this.dispensingState = 'done';
          await this.finishPayoutSession();
        } else if ([0xdc, 0xb1, 0xd9, 0xd6].includes(evCode)) {
          console.error(`[SCS] ❌ Error en payout: ${evName} (0x${evCode.toString(16)})`);
          this.dispensingState = 'done';
          await this.finishPayoutSession();
        }
      }
    }
  }

  private handlePaymentEvent(device: 'SCS' | 'NV200', event: string, data: Buffer): void {
    if (!this.currentSession?.active) return;

    let amountCents = 0;

    if (event === 'NOTE_CREDIT' && device === 'NV200') {
      amountCents = this.getNV200ChannelValue(data[0]);
    }
    if (event === 'VALUE_ADDED' && device === 'SCS') {
      amountCents = data.length >= 5 ? data.readUInt32LE(1) : 0;
      if (data.length >= 8) {
      this.scsCountry = data.slice(5, 8).toString('ascii'); // "ECD"
      }
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
        this.paymentTriggered = true;
        this.currentSession.active = false;
        console.log(`[SSP] ✅ Pago completo: ${orderId}`);

        const changeCents = inserted - totalCents;
        this.nv200?.disable().catch(() => {});

        if (changeCents <= 0) {
          this.scs?.disable().catch(() => {});
          console.log(`[SSP] 💰 PAYMENT_COMPLETE enviado — Cambio: $0.00`);
          this.onPaymentComplete?.(orderId, 0);
        } else {
          console.log(`[SSP] 💰 PAYMENT_COMPLETE enviado — Cambio: $${(changeCents / 100).toFixed(2)}`);
          this.onPaymentComplete?.(orderId, changeCents);
          this.startPayout(orderId, changeCents).catch((err) => {
            console.error('[SSP] Error iniciando payout:', err);
            this.scs?.disable().catch(() => {});
          });
        }
      }
    }
  }

 private async startPayout(orderId: string, changeCents: number): Promise<void> {
  this.stopPolling();
  await delay(300); // ✅ Aumentar de 200 a 500ms — dar tiempo al SCS de terminar

  console.log(`[SSP] 💸 Iniciando payout de $${(changeCents / 100).toFixed(2)}...`);

  await this.waitForPayinComplete();

  const { notesCents, coinsCents } = this.splitChange(changeCents);
  console.log(`[SSP] NV200: $${(notesCents / 100).toFixed(2)} | SCS: $${(coinsCents / 100).toFixed(2)}`);

 
    // ── 1. Payout de billetes con NV200 ──────────────────────────────────
  if (notesCents > 0) {
    await this.nv200!.disable();
    await delay(300);

    const nv200KeyOk = await this.nv200!.negotiateKeys();
    if (!nv200KeyOk) {
      console.error('[NV200] ❌ Key negotiation falló');
    } else {
      await this.nv200!.enable();
      await delay(400);

      const { code: nCode, data: nData } = await this.nv200!.payoutAmount(notesCents, this.country);
      console.log(`[NV200] payoutAmount → code: 0x${nCode.toString(16)}`);

      if (nCode === 0xf0) {
        // Esperar DISPENSED del NV200
        await this.waitForDispensed('NV200', this.nv200!, 15_000);
      } else {
        const errCode = nData?.[0] ?? 0;
        console.error(`[NV200] ❌ Payout rechazado: errCode=${errCode}`);
      }
    }
  }

  // ── 2. Payout de monedas con SCS ─────────────────────────────────────
  if (coinsCents > 0) {
      await this.scs!.disable();
      await delay(500); // ✅ más tiempo para que el SCS termine de procesar monedas

      // ✅ Limpiar cola de eventos pendientes antes de negociar
      await this.scs!.poll();
      await delay(100);
      await this.scs!.poll();
      await delay(100);

      const scsKeyOk = await this.scs!.negotiateKeys();
      if (!scsKeyOk) {
        console.error('[SCS] ❌ Key negotiation falló');
        this.dispensingState = 'idle';
        this.startPolling(500);
        return;
      }

      await this.scs!.enable();
      await delay(400);

      const PAYOUT_ERRORS: Record<number, string> = {
        1: 'Sin suficiente valor', 2: 'No puede pagar exacto',
        3: 'Dispositivo ocupado',  4: 'Dispositivo deshabilitado',
      };

      // ✅ Retry automático si el dispositivo está ocupado (errCode=3)
   let result: { code: number; data: Buffer } = { code: 0, data: Buffer.alloc(0) as Buffer };
    let attempts = 0;

    do {
      if (attempts > 0) {
        console.log(`[SCS] ⏳ Reintentando payout (intento ${attempts + 1}/4)...`);
        await delay(600);
      }
      result = await this.scs!.payoutAmount(coinsCents, this.scsCountry ?? this.country);
      console.log(`[SCS] payoutAmount → code: 0x${result.code.toString(16)} errCode=${result.data?.[0] ?? 0}`);
      attempts++;
    } while (result.code === 0xf5 && (result.data?.[0] ?? 0) === 3 && attempts < 4);

    if (result.code !== 0xf0) {
      const errCode = result.data?.[0] ?? 0;
      console.error(`[SCS] ❌ Payout rechazado: ${PAYOUT_ERRORS[errCode] ?? `0x${result.code.toString(16)}`}`);
      await this.scs?.disable();
      this.dispensingState = 'idle';
      this.startPolling(500);
      return;
    }
  }

    // ── 3. Esperar DISPENSED del SCS (o finalizar si solo había billetes) ─
    if (coinsCents > 0) {
      console.log(`[SCS] ⏳ Payout aceptado, esperando DISPENSED...`);
      this.dispensingState       = 'waiting';
      this.dispensingOrderId     = orderId;
      this.dispensingChangeCents = changeCents;
      this.startPolling(200);

      setTimeout(async () => {
        if (this.dispensingState === 'waiting') {
          console.warn(`[SCS] ⚠️ Timeout esperando DISPENSED`);
          this.dispensingState = 'done';
          await this.finishPayoutSession();
        }
      }, 12_000);
    } else {
      // Solo había billetes — NV200 ya dispensó
      await this.finishPayoutSession();
    }
}

 
private async waitForPayinComplete(): Promise<void> {
  const MAX_WAIT_MS = 8_000;
  const POLL_INTERVAL = 300;
  const start = Date.now();

  console.log('[SCS] ⏳ Esperando fin de PAYIN_ACTIVE...');

  while (Date.now() - start < MAX_WAIT_MS) {
    const { code, data } = await this.scs!.poll();

    if (code !== 0xf0 || !data.length) {
      break; // sin eventos — dispositivo libre
    }

    const hasPayinActive = data.includes(0xc1);

    if (!hasPayinActive) {
      console.log('[SCS] ✅ PAYIN_ACTIVE finalizado — listo para payout');
      break;
    }

    console.log('[SCS] 🔄 PAYIN_ACTIVE todavía activo...');
    await delay(POLL_INTERVAL);
  }

  await delay(200); // margen extra antes de negociar
}


// ── Helper: esperar DISPENSED de un dispositivo con timeout ────────────────
private waitForDispensed(device: 'NV200' | 'SCS', driver: SSPDriver, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      const { code, data } = await driver.poll();
      if (code !== 0xf0 || !data.length) return;
      for (let i = 0; i < data.length; i++) {
        if (data[i] === 0xd2) {
          console.log(`[${device}] ✅ DISPENSED`);
          clearInterval(interval);
          clearTimeout(timeout);
          resolve();
          return;
        }
        // Error — igual resolvemos para no bloquear
        if ([0xdc, 0xb1, 0xd9, 0xd6].includes(data[i])) {
          console.error(`[${device}] ❌ Error durante payout: 0x${data[i].toString(16)}`);
          clearInterval(interval);
          clearTimeout(timeout);
          resolve();
          return;
        }
      }
    }, 300);

    const timeout = setTimeout(() => {
      console.warn(`[${device}] ⚠️ Timeout esperando DISPENSED`);
      clearInterval(interval);
      resolve();
    }, timeoutMs);
  });
}

  private async finishPayoutSession(): Promise<void> {
    this.dispensingState       = 'idle';
    this.dispensingOrderId     = '';
    this.dispensingChangeCents = 0;

    await this.scs?.disable().catch(() => {});

    console.log(`[SSP] Payout finalizado: ${this.currentSession?.orderId ?? ''}`);
    this.currentSession = null;
    this.stopPolling();
    this.startPolling(500);
  }

  private getNV200ChannelValue(channel: number): number {
    const channelMap: Record<number, number> = {
      1: 100, 2: 200, 3: 500, 4: 1000,
      5: 2000, 6: 5000, 7: 10000,
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
    this.hardwareReady   = false;
    this.currentSession  = null;
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
