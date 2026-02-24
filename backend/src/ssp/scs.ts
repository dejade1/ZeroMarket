// backend/src/ssp/scs.ts
import { EventEmitter } from 'events';
import { SSPBus }       from './ssp-bus';
import { SSPResponse, SSP_GENERIC } from './ssp-packet';
import * as crypto from 'crypto';

const SCS_ADDRESS = 0x10;

const CMD = {
  RESET:                  0x01,
  SETUP_REQUEST:          0x05,
  HOST_PROTOCOL_VERSION:  0x06,
  POLL:                   0x07,
  DISABLE:                0x09,
  ENABLE:                 0x0a,
  GET_SERIAL_NUMBER:      0x0c,
  SYNC:                   0x11,
  GET_ALL_LEVELS:         0x22,
  PAYOUT_AMOUNT:          0x33,
  SET_DENOMINATION_ROUTE: 0x3b,
  GET_DENOMINATION_ROUTE: 0x3c,
  SET_COIN_INHIBIT:       0x40,
  PAYOUT_BY_DENOMINATION: 0x46,
  ENABLE_COIN_MECH:       0x49,
  SET_GENERATOR:          0x4a,
  SET_MODULUS:            0x4b,
  REQUEST_KEY_EXCHANGE:   0x4c,
  SET_OPTIONS:            0x50,
  GET_OPTIONS:            0x51,
  SMART_EMPTY:            0x52,
  POLL_WITH_ACK:          0x56,
  EVENT_ACK:              0x57,
} as const;

export interface CoinDenomination {
  channel: number;
  value:   number;   // en centavos (e.g. 25 = $0.25)
  country: string;
}

export interface SCSInfo {
  firmwareVersion: string;
  countryCode:     string;
  numChannels:     number;
  denominations:   CoinDenomination[];
  protocolVersion: number;
}

interface EncryptionState {
  fixedKey:   Buffer;
  negotiated: Buffer;
  fullKey:    Buffer;
  encCount:   number;
  active:     boolean;
}

export class SCS extends EventEmitter {
  private bus:          SSPBus;
  private currencyCode: string;
  private info:         SCSInfo | null = null;
  private ready:        boolean        = false;
  private pollRunning = false;
  private pollTimer:   NodeJS.Timeout | null = null;

  // Fixed key = default ITL: 0123456701234567
  // Confirmado con ITL Validator Manager — no fue modificada
  private enc: EncryptionState = {
    fixedKey:   Buffer.from('0123456701234567', 'hex'),
    negotiated: Buffer.alloc(8),
    fullKey:    Buffer.alloc(16),
    encCount:   0,
    active:     false,
  };

  constructor(bus: SSPBus, currencyCode = 'USD') {
    super();
    this.bus          = bus;
    this.currencyCode = currencyCode;
    this.bus.registerAddress(SCS_ADDRESS);
  }

  get isReady():    boolean        { return this.ready; }
  get deviceInfo(): SCSInfo | null { return this.info;  }

startPolling(intervalMs = 200): void {
  if (this.pollRunning) return;
  this.pollRunning = true;
  console.log('[SCS] Poll iniciado');
  const loop = async () => {
    if (!this.pollRunning) return;
    try {
      await this.poll();   // ← sin handlePollResponse, el resultado ya lo emite el EventEmitter
    } catch (_) { /* timeout esperado */ }
    if (this.pollRunning) {
      this.pollTimer = setTimeout(loop, intervalMs);
    }
  };
  this.pollTimer = setTimeout(loop, intervalMs);
}

stopPolling(): void {
  this.pollRunning = false;
  if (this.pollTimer) {
    clearTimeout(this.pollTimer);
    this.pollTimer = null;
    console.log('[SCS] Poll detenido');
  }
}


  // ═══════════════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════════════

  async init(): Promise<void> {
    console.log('[SCS] ═══════════════════════════════════════════════');
    console.log('[SCS] Iniciando secuencia de setup...');

    // 1. SYNC
    const syncRes = await this.send(Buffer.from([CMD.SYNC]));
    if (syncRes.generic !== SSP_GENERIC.OK)
      throw new Error(`[SCS] SYNC failed: 0x${syncRes.generic.toString(16)}`);
    console.log('[SCS] ✓ SYNC OK');

    // 2. HOST_PROTOCOL_VERSION
    let protoVer = 0;
    for (const ver of [6, 5, 4]) {
      const r = await this.send(Buffer.from([CMD.HOST_PROTOCOL_VERSION, ver]));
      if (r.generic === SSP_GENERIC.OK) { protoVer = ver; break; }
    }
    if (!protoVer) throw new Error('[SCS] No se pudo negociar protocol version');
    console.log(`[SCS] ✓ Protocol version ${protoVer} OK`);

    // 3. SETUP_REQUEST
    const setupRes = await this.send(Buffer.from([CMD.SETUP_REQUEST]));
    if (setupRes.generic !== SSP_GENERIC.OK)
      throw new Error(`[SCS] SETUP_REQUEST failed: 0x${setupRes.generic.toString(16)}`);
    this.info = this.parseSetupResponse(setupRes.data);
    console.log(`[SCS] ✓ Setup: ${this.info.numChannels} canales | fw: ${this.info.firmwareVersion} | proto: v${this.info.protocolVersion}`);
    console.log('[SCS]   Denom:', this.info.denominations.map(d =>
      `ch${d.channel}=$${(d.value/100).toFixed(2)} ${d.country}`).join(', '));

    // 4. eSSP Key Exchange
    try {
      await this.initEncryption();
      console.log('[SCS] ✓ eSSP encryption active');
    } catch (e: any) {
      console.error('[SCS] ✗ Encryption failed:', e.message);
    }

    // 5. SET_DENOMINATION_ROUTE (MANDATORY — solo si enc activa)
    if (this.enc.active && this.info.denominations.length > 0) {
      for (const d of this.info.denominations) {
        try {
          const route = d.value <= 25 ? 0x00 : 0x01; // 0=payout, 1=cashbox
          await this.setDenominationRoute(d.value, route);
          console.log(`[SCS]   Route ch${d.channel} ($${(d.value/100).toFixed(2)}): ${route === 0 ? 'PAYOUT' : 'CASHBOX'}`);
        } catch (e: any) {
          console.warn(`[SCS]   Route ch${d.channel}: ${e.message}`);
        }
      }
      console.log('[SCS] ✓ Routes configured');
    }

    // 6. SET_COIN_INHIBIT — habilitar todas las denominaciones
    for (const d of this.info.denominations) {
      try {
        await this.setCoinInhibit(d.value, true);
      } catch (e: any) {
        console.warn(`[SCS]   Inhibit ch${d.channel}: ${e.message}`);
      }
    }
    console.log('[SCS] ✓ Coin inhibits set');

    // 7. SET_OPTIONS
    const optData = Buffer.from([CMD.SET_OPTIONS, 0x26, 0x01]);
    const optRes  = this.enc.active
      ? await this.sendEncrypted(optData)
      : await this.send(optData);
    if (optRes.generic !== SSP_GENERIC.OK)
      console.warn(`[SCS]   SET_OPTIONS: 0x${optRes.generic.toString(16)}`);
    else
      console.log('[SCS] ✓ SET_OPTIONS OK');

    // 8. ENABLE
    const enRes = await this.send(Buffer.from([CMD.ENABLE]));
    if (enRes.generic !== SSP_GENERIC.OK)
      throw new Error(`[SCS] ENABLE failed: 0x${enRes.generic.toString(16)}`);
    console.log('[SCS] ✓ ENABLE OK');

    // 9. ENABLE_COIN_MECH (MANDATORY encryption)
    if (this.enc.active) {
      try {
        const r = await this.sendEncrypted(Buffer.from([CMD.ENABLE_COIN_MECH, 0x01]));
        console.log(`[SCS] ${r.generic === SSP_GENERIC.OK ? '✓' : '⚠'} ENABLE_COIN_MECH: 0x${r.generic.toString(16)}`);
      } catch (e: any) {
        console.warn(`[SCS]   ENABLE_COIN_MECH: ${e.message}`);
      }
    }

    this.ready = true;
    console.log('[SCS] ═══════════════════════════════════════════════');
    console.log('[SCS] ✅ LISTO');
    this.emit('ready', this.info);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  /// ═══════════════════════════════════════════════════════════════════════════
// parseSetupResponse — SMART Coin System GA138 v6
//
// SCS tiene estructura DIFERENTE al NV200. No hay valueMultiplier(3) en [8-10].
//
// Offsets desde data[0] (data = payload sin 0xF0):
//  [0]        unitType
//  [1-4]      firmware (4 ASCII)
//  [5-7]      countryCode (3 ASCII)
//  [8]        numChannels
//  [9..8+n]   channelValues (1 byte cada uno, en centavos × multiplier)
//  [9+n..8+2n] channelSecurity (1 byte × n, ignorar)
//  [9+2n..11+2n] realValueMultiplier (3 bytes LE)
//  [12+2n]    protocolVersion
//  — Si proto ≥ 6:
//  [13+2n .. 13+2n+3n-1]      country codes (3 bytes × n)
//  [13+2n+3n .. 13+2n+7n-1]   values (4 bytes LE × n)
// ═══════════════════════════════════════════════════════════════════════════
private parseSetupResponse(data: Buffer): SCSInfo {
  console.log(`[SCS] Setup raw (${data.length}B): ${data.toString('hex')}`);

  if (data.length < 9) {
    return { firmwareVersion: '????', countryCode: '???', numChannels: 0,
             denominations: [], protocolVersion: 0 };
  }

  const fw    = data.slice(1, 5).toString('ascii').replace(/\0/g, '').trim();
  const cc    = data.slice(5, 8).toString('ascii').replace(/\0/g, '').trim();
  const numCh = data[8];

  console.log(`[SCS] fw=${fw} cc=${cc} numCh=${numCh}`);

  // SCS NO tiene channelSecurity — estructura simplificada vs NV200
  // [9..8+n]    channelValues (1 byte × n)
  // [9+n..11+n] realValueMultiplier (3 bytes LE)
  // [12+n]      protocolVersion
  // [13+n..]    expanded section (proto ≥ 6): countryCode(3)×n + value(4LE)×n
  const chValOff  = 9;
  const realVmOff = chValOff + numCh;          // sin channelSecurity
  const protoOff  = realVmOff + 3;

  if (data.length <= protoOff) {
    console.warn(`[SCS] Buffer muy corto: ${data.length}B`);
    return { firmwareVersion: fw, countryCode: cc, numChannels: numCh,
             denominations: [], protocolVersion: 0 };
  }

  const protoVer = data[protoOff];
  const realVm = (
    (data[realVmOff]     || 0)        |
    ((data[realVmOff+1]  || 0) << 8)  |
    ((data[realVmOff+2]  || 0) << 16)
  ) || 1;

  console.log(`[SCS] protoVer=${protoVer} realVm=${realVm}`);

  const denominations: CoinDenomination[] = [];

  if (protoVer >= 6) {
    const expCcOff  = protoOff + 1;
    const expValOff = expCcOff + 3 * numCh;
    const needed    = expValOff + 4 * numCh;

    if (data.length >= needed) {
      for (let i = 0; i < numCh; i++) {
        const ccOff  = expCcOff + i * 3;
        const vOff   = expValOff + i * 4;
        const country = data.slice(ccOff, ccOff + 3).toString('ascii').replace(/\0/g, '');
        const value   = data.readUInt32LE(vOff);
        denominations.push({ channel: i + 1, value, country });
      }
      console.log(`[SCS] Formato expandido proto v${protoVer}: ${numCh} canales`);
    } else {
      // fallback legacy
      for (let i = 0; i < numCh; i++) {
        denominations.push({ channel: i+1, value: (data[chValOff+i] || 0) * realVm, country: cc });
      }
      console.warn(`[SCS] Fallback legacy proto v${protoVer}: buffer tiene ${data.length}, necesita ${needed}`);
    }
  } else {
    for (let i = 0; i < numCh; i++) {
      denominations.push({ channel: i+1, value: (data[chValOff+i] || 0) * realVm, country: cc });
    }
    console.log(`[SCS] Formato legacy proto v${protoVer} vm=${realVm}`);
  }

  return { firmwareVersion: fw, countryCode: cc, numChannels: numCh,
           denominations, protocolVersion: protoVer };
}



  // ═══════════════════════════════════════════════════════════════════════════
  // initEncryption — Diffie-Hellman
  // generator=982451653, modulus=1287821 (spec ITL GA138)
  // ═══════════════════════════════════════════════════════════════════════════

  private async initEncryption(): Promise<void> {
    const generator  = BigInt('982451653');
    const modulus    = BigInt('1287821');

    // hostRandom en [2, modulus-2] — siempre < modulus
    const rawRand    = crypto.randomBytes(3).readUIntBE(0, 3);
    const hostRandom = BigInt(2) + (BigInt(rawRand) % (modulus - BigInt(4)));

    // SET_GENERATOR
    const genBuf = Buffer.alloc(9);
    genBuf[0] = CMD.SET_GENERATOR;
    this.writeBigInt64LE(genBuf, generator, 1);
    const genRes = await this.send(genBuf);
    if (genRes.generic !== SSP_GENERIC.OK)
      throw new Error(`SET_GENERATOR: 0x${genRes.generic.toString(16)}`);

    // SET_MODULUS
    const modBuf = Buffer.alloc(9);
    modBuf[0] = CMD.SET_MODULUS;
    this.writeBigInt64LE(modBuf, modulus, 1);
    const modRes = await this.send(modBuf);
    if (modRes.generic !== SSP_GENERIC.OK)
      throw new Error(`SET_MODULUS: 0x${modRes.generic.toString(16)}`);

    // REQUEST_KEY_EXCHANGE: enviar hostInter = generator^hostRandom mod modulus
    const hostInter = this.modPow(generator, hostRandom, modulus);
    const keBuf     = Buffer.alloc(9);
    keBuf[0] = CMD.REQUEST_KEY_EXCHANGE;
    this.writeBigInt64LE(keBuf, hostInter, 1);
    const keRes = await this.send(keBuf);
    if (keRes.generic !== SSP_GENERIC.OK)
      throw new Error(`REQUEST_KEY_EXCHANGE: 0x${keRes.generic.toString(16)}`);

    // keRes.data = payload SIN el byte 0xF0
    // data[0..7] = slaveInter (8 bytes LE)
    if (keRes.data.length < 8)
      throw new Error(`KEY_EXCHANGE response corta: ${keRes.data.length} bytes`);

    const slaveInter   = this.readBigInt64LE(keRes.data, 0);
    const sharedSecret = this.modPow(slaveInter, hostRandom, modulus);

    if (sharedSecret === BigInt(0) || sharedSecret === BigInt(1))
      throw new Error(`sharedSecret inválido: ${sharedSecret}`);

    const negBuf = Buffer.alloc(8);
    this.writeBigInt64LE(negBuf, sharedSecret, 0);

    this.enc.negotiated = negBuf;
    // fullKey = fixedKey(8 bytes) + negotiatedKey(8 bytes) = 128 bits AES
    this.enc.fullKey    = Buffer.concat([this.enc.fixedKey, negBuf]);
    this.enc.encCount   = 0;
    this.enc.active     = true;

    console.log(`[SCS]   sharedSecret: ${sharedSecret}`);
    console.log(`[SCS]   fullKey: ${this.enc.fullKey.toString('hex')}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // encryptData — AES-128-ECB
  //
  // Estructura del bloque cifrado (spec GA138 Encryption Layer):
  //   [0x7E]  STEX — NO cifrado, parte del DATA del frame SSP externo
  //   [AES block...]
  //     eLENGTH  (1 byte)  — longitud de eDATA solamente
  //     eCOUNT   (4 bytes LE)
  //     eDATA    (n bytes)
  //     ePACKING (random, relleno hasta múltiplo de 16 incluyendo eCRC)
  //     eCRCL    (1 byte)
  //     eCRCH    (1 byte)
  //
  // CRC calculado sobre [eLENGTH][eCOUNT][eDATA][ePACKING]
  // Mismo polynomial 0x8005 (spec usa mismo CRC en ambas capas)
  // ═══════════════════════════════════════════════════════════════════════════

  private encryptData(plainData: Buffer): Buffer {
    const eLength  = plainData.length;
    const countBuf = Buffer.alloc(4);
    countBuf.writeUInt32LE(this.enc.encCount, 0);

    // [eLENGTH][eCOUNT][eDATA]
    const header = Buffer.concat([Buffer.from([eLength]), countBuf, plainData]);

    // Padding para que (header + padding + CRC[2]) sea múltiplo de 16
    const baseLen   = header.length + 2;
    const padNeeded = (16 - (baseLen % 16)) % 16;
    const packing   = crypto.randomBytes(padNeeded);

    // CRC sobre [eLENGTH][eCOUNT][eDATA][ePACKING]
    const preCrc = Buffer.concat([header, packing]);
    const crcVal = crc16eSsp(preCrc);
    const crcBuf = Buffer.from([crcVal & 0xff, (crcVal >> 8) & 0xff]);

    // Bloque a cifrar
    const toEncrypt = Buffer.concat([preCrc, crcBuf]);

    const cipher = crypto.createCipheriv('aes-128-ecb', this.enc.fullKey, null);
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(toEncrypt), cipher.final()]);

    // STEX (0x7E) + bloque AES
    return Buffer.concat([Buffer.from([0x7e]), encrypted]);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // sendEncrypted — encCount sube SOLO si la respuesta es 0xF0
  // ═══════════════════════════════════════════════════════════════════════════

  async sendEncrypted(data: Buffer): Promise<SSPResponse> {
    if (!this.enc.active) throw new Error('[SCS] Encryption not active');
    const payload = this.encryptData(data);
    const res     = await this.bus.send(SCS_ADDRESS, payload);
    if (res.generic === SSP_GENERIC.OK) {
      this.enc.encCount++;
      console.log(`[SCS] ✓ encCount → ${this.enc.encCount}`);
    } else {
      console.warn(`[SCS] encCount NO inc — 0x${res.generic.toString(16)} (actual: ${this.enc.encCount})`);
    }
    return res;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // setDenominationRoute — proto v6+
  // [0x3B][route(1)][value(4LE)][country(3ASCII)]
  // ═══════════════════════════════════════════════════════════════════════════

  private async setDenominationRoute(valueCents: number, route: number): Promise<void> {
    const buf = Buffer.alloc(9);
    buf[0] = CMD.SET_DENOMINATION_ROUTE;
    buf[1] = route;
    buf.writeUInt32LE(valueCents, 2);
    buf.write(this.currencyCode.substring(0, 3).padEnd(3, ' '), 6, 'ascii');
    const res = await this.sendEncrypted(buf);
    if (res.generic !== SSP_GENERIC.OK) {
      throw new Error(`SET_DENOMINATION_ROUTE(${valueCents}¢): 0x${res.generic.toString(16)}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // setCoinInhibit — proto v6+
  // [0x40][enable(1)][value(2LE)][country(3ASCII)]
  // ═══════════════════════════════════════════════════════════════════════════

  private async setCoinInhibit(valueCents: number, enable: boolean): Promise<void> {
    const buf = Buffer.alloc(7);
    buf[0] = CMD.SET_COIN_INHIBIT;
    buf[1] = enable ? 0x01 : 0x00;
    buf.writeUInt16LE(valueCents, 2);
    buf.write(this.currencyCode.substring(0, 3).padEnd(3, ' '), 4, 'ascii');
    const res = await this.send(buf);
    if (res.generic !== SSP_GENERIC.OK)
      throw new Error(`SET_COIN_INHIBIT(${valueCents}¢): 0x${res.generic.toString(16)}`);
  }

  // ── API pública ──────────────────────────────────────────────────────────

  async poll(): Promise<SSPResponse> {
    if (this.enc.active)
      return this.sendEncrypted(Buffer.from([CMD.POLL_WITH_ACK]));
    return this.send(Buffer.from([CMD.POLL]));
  }

  async eventAck(): Promise<SSPResponse> {
    if (this.enc.active)
      return this.sendEncrypted(Buffer.from([CMD.EVENT_ACK]));
    return this.send(Buffer.from([CMD.EVENT_ACK]));
  }

  async enable(): Promise<SSPResponse> {
    return this.send(Buffer.from([CMD.ENABLE]));
  }

  async disable(): Promise<SSPResponse> {
    return this.send(Buffer.from([CMD.DISABLE]));
  }

  async payoutAmount(amountCents: number): Promise<SSPResponse> {
    if (!this.enc.active) throw new Error('[SCS] Payout requiere cifrado');
    // [0x33][value(4LE)][country(3ASCII)][option=0x58]
    const buf = Buffer.alloc(9);
    buf[0] = CMD.PAYOUT_AMOUNT;
    buf.writeUInt32LE(amountCents, 1);
    buf.write(this.currencyCode.substring(0, 3).padEnd(3, ' '), 5, 'ascii');
    buf[8] = 0x58; // commit
    return this.sendEncrypted(buf);
  }

  async getAllLevels(): Promise<SSPResponse> {
    return this.send(Buffer.from([CMD.GET_ALL_LEVELS]));
  }

  async smartEmpty(): Promise<SSPResponse> {
    if (!this.enc.active) throw new Error('[SCS] SmartEmpty requiere cifrado');
    return this.sendEncrypted(Buffer.from([CMD.SMART_EMPTY]));
  }

  // ── Helpers BigInt ───────────────────────────────────────────────────────

  private modPow(base: bigint, exp: bigint, mod: bigint): bigint {
    if (mod === BigInt(1)) return BigInt(0);
    let result = BigInt(1);
    base = base % mod;
    while (exp > BigInt(0)) {
      if (exp % BigInt(2) === BigInt(1)) result = (result * base) % mod;
      exp  = exp / BigInt(2);
      base = (base * base) % mod;
    }
    return result;
  }

  private writeBigInt64LE(buf: Buffer, val: bigint, off: number): void {
    buf.writeUInt32LE(Number(val & BigInt(0xffffffff)), off);
    buf.writeUInt32LE(Number((val >> BigInt(32)) & BigInt(0xffffffff)), off + 4);
  }

  private readBigInt64LE(buf: Buffer, off: number): bigint {
    const lo = BigInt(buf.readUInt32LE(off));
    const hi = BigInt(buf.readUInt32LE(off + 4));
    return lo + (hi << BigInt(32));
  }

  private async send(data: Buffer): Promise<SSPResponse> {
    return this.bus.send(SCS_ADDRESS, data);
  }
}

// CRC-16 interno del bloque cifrado — mismo polynomial 0x8005
function crc16eSsp(data: Buffer): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= (byte << 8);
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? ((crc << 1) & 0xffff) ^ 0x8005 : (crc << 1) & 0xffff;
    }
  }
  return crc;
}
