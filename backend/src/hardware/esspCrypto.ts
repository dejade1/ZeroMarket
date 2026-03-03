import * as crypto from 'crypto';

// ─── MATH ─────────────────────────────────────────────────────────────────────
function modpow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) result = (result * base) % mod;
    exp = exp >> 1n;
    base = (base * base) % mod;
  }
  return result;
}

// ─── CRC-16 SSP ───────────────────────────────────────────────────────────────
export function crc16(data: Buffer): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

// ─── BigInt helpers (Little-Endian 8 bytes, como exige SSP) ──────────────────
export function bigIntTo8ByteLE(n: bigint): Buffer {
  const buf = Buffer.alloc(8);
  let tmp = n;
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(tmp & 0xffn);
    tmp >>= 8n;
  }
  return buf;
}

export function bufferLE8ToBigInt(buf: Buffer): bigint {
  let n = 0n;
  for (let i = 7; i >= 0; i--) n = (n << 8n) | BigInt(buf[i]);
  return n;
}

// ─── eSSP Crypto ─────────────────────────────────────────────────────────────
export class eSSPCrypto {
  private key: Buffer | null = null;
  private encryptCount = 0;
  private decryptCount = 0;

  // Lower 64-bit fija del fabricante (ITL default: 0x0123456701234567)
  // DEBE coincidir con lo que el dispositivo espera
  private readonly fixedKeyLow = Buffer.from([
    0x01, 0x23, 0x45, 0x67, 0x01, 0x23, 0x45, 0x67,
  ]);

  get isNegotiated(): boolean { return this.key !== null; }

  reset(): void {
    this.key = null;
    this.encryptCount = 0;
    this.decryptCount = 0;
  }

  // ── Paso 1: preparar valores para Set Generator / Set Modulus / Key Exchange
  prepareKeyExchange(): {
    generator:    bigint;
    modulus:      bigint;
    hostInterKey: bigint;
    hostRnd:      bigint;
  } {
    const generator = 13n;
    const modulus   = 2147483647n; // Primo de Mersenne M31

    // hostRnd debe ser < modulus
    const rndBytes  = crypto.randomBytes(4);
    const hostRnd   = BigInt(rndBytes.readUInt32BE(0)) % (modulus - 2n) + 1n;
    const hostInterKey = modpow(generator, hostRnd, modulus);

    return { generator, modulus, hostInterKey, hostRnd };
  }

  // ── Paso 2: recibir slaveInterKey y calcular clave final AES-128
  finalizeKey(slaveInterKey: bigint, hostRnd: bigint, modulus: bigint): void {
    const sharedSecret = modpow(slaveInterKey, hostRnd, modulus);

    // Upper 64-bit: sharedSecret en Little-Endian (como manda el spec ITL)
    const keyHigh = bigIntTo8ByteLE(sharedSecret);

    // AES-128 key = fixedLow(8 bytes) + negotiatedHigh(8 bytes)
    this.key = Buffer.concat([this.fixedKeyLow, keyHigh]);
    this.encryptCount = 0;
    this.decryptCount = 0;

    console.log(`[eSSP] Clave negociada: ${this.key.toString('hex')}`);
    console.log(`[eSSP] sharedSecret: ${sharedSecret}`);
  }

  // ── Encriptar: cmd + params → 0x7E + AES(eLEN|eCOUNT|eDATA|ePACKING|eCRC)
  encryptPacket(cmd: number, params: Buffer = Buffer.alloc(0)): Buffer {
    if (!this.key) throw new Error('[eSSP] Clave no negociada');

    const eData = Buffer.concat([Buffer.from([cmd]), params]);
    const eLen  = eData.length;

    // Calcular tamaño con padding a múltiplo de 16
    // Estructura: eLENGTH(1) + eCOUNT(4) + eDATA(n) + ePACKING(?) + eCRC(2)
    const baseLen = 1 + 4 + eLen + 2;
    const padded  = Math.ceil(baseLen / 16) * 16;
    const packLen = padded - baseLen;

    const inner = Buffer.alloc(padded);
    let off = 0;

    inner[off++] = eLen;                                       // eLENGTH
    inner.writeUInt32LE(this.encryptCount, off); off += 4;     // eCOUNT (LE)
    eData.copy(inner, off);                      off += eLen;  // eDATA
    if (packLen > 0) {
      crypto.randomFillSync(inner, off, packLen);              // ePACKING
      off += packLen;
    }
    const crcVal = crc16(inner.slice(0, off));
    inner.writeUInt16LE(crcVal, off);                          // eCRC (LE)

    // AES-128-ECB sin padding automático
    const cipher = crypto.createCipheriv('aes-128-ecb', this.key, null);
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(inner), cipher.final()]);

    this.encryptCount++;

    return Buffer.concat([Buffer.from([0x7e]), encrypted]);
  }

  // ── Revertir encryptCount si el slave responde 0xFA (KEY NOT SET)
  // Necesario para mantener sincronía con el contador del slave
  revertEncryptCount(): void {
    if (this.encryptCount > 0) this.encryptCount--;
  }

  // ── Desencriptar respuesta del slave
  decryptResponse(data: Buffer): Buffer | null {
    if (!this.key)         return null;
    if (data[0] !== 0x7e)  return null;

    const encrypted = data.slice(1);
    if (encrypted.length % 16 !== 0) return null;

    const decipher = crypto.createDecipheriv('aes-128-ecb', this.key, null);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    const eLen   = decrypted[0];
    const eCount = decrypted.readUInt32LE(1);
    const eData  = decrypted.slice(5, 5 + eLen);

    // Verificar contador anti-replay
    if (eCount !== this.decryptCount) {
      console.warn(`[eSSP] eCOUNT mismatch: esperado ${this.decryptCount}, recibido ${eCount}`);
      return null;
    }

    // Verificar CRC interno
    const payloadForCrc = decrypted.slice(0, decrypted.length - 2);
    const crcExpected   = decrypted.readUInt16LE(decrypted.length - 2);
    if (crc16(payloadForCrc) !== crcExpected) {
      console.warn('[eSSP] CRC interno inválido en respuesta');
      return null;
    }

    this.decryptCount++;
    return eData;
  }
}
