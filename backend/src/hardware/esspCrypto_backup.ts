// backend/src/ssp/esspCrypto.ts
import * as crypto from 'crypto';

const GENERATOR = BigInt('7');
const MODULUS   = BigInt('9223372036854775783');
const FIXED_KEY = Buffer.from('0123456701234567', 'hex');

export interface ICryptoTransport {
  sendRaw(cmd: number, params: Buffer): Promise<{ code: number; data: Buffer }>;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) result = (result * base) % mod;
    exp  = exp >> 1n;
    base = (base * base) % mod;
  }
  return result;
}

function writeBigInt64LE(buf: Buffer, val: bigint, off: number): void {
  buf.writeUInt32LE(Number(val & 0xffffffffn), off);
  buf.writeUInt32LE(Number((val >> 32n) & 0xffffffffn), off + 4);
}

function readBigInt64LE(buf: Buffer, off: number): bigint {
  return BigInt(buf.readUInt32LE(off)) | (BigInt(buf.readUInt32LE(off + 4)) << 32n);
}

function crc16(data: Buffer): number {
  let crc = 0xffff;
  for (const b of data) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? ((crc << 1) & 0xffff) ^ 0x8005 : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export class esspCrypto {
  private fullKey:      Buffer  = Buffer.alloc(16);
  private encCount:     number  = 0;
  public  isNegotiated: boolean = false;

  async negotiate(transport: ICryptoTransport): Promise<boolean> {
    const hostRandom = BigInt(2) + (
      readBigInt64LE(crypto.randomBytes(8), 0) % (MODULUS - 4n)
    );
    const hostInter = modPow(GENERATOR, hostRandom, MODULUS);

    const genBuf = Buffer.alloc(8);
    writeBigInt64LE(genBuf, GENERATOR, 0);
    const genRes = await transport.sendRaw(0x4a, genBuf);
    if (genRes.code !== 0xf0) {
      console.error(`[eSSP] SET_GENERATOR fail: 0x${genRes.code.toString(16)}`);
      return false;
    }

    const modBuf = Buffer.alloc(8);
    writeBigInt64LE(modBuf, MODULUS, 0);
    const modRes = await transport.sendRaw(0x4b, modBuf);
    if (modRes.code !== 0xf0) {
      console.error(`[eSSP] SET_MODULUS fail: 0x${modRes.code.toString(16)}`);
      return false;
    }

    const keBuf = Buffer.alloc(8);
    writeBigInt64LE(keBuf, hostInter, 0);
    const keRes = await transport.sendRaw(0x4c, keBuf);
    if (keRes.code !== 0xf0 || keRes.data.length < 8) {
      console.error(`[eSSP] KEY_EXCHANGE fail: 0x${keRes.code.toString(16)}`);
      return false;
    }

    const slaveInter   = readBigInt64LE(keRes.data, 0);
    const sharedSecret = modPow(slaveInter, hostRandom, MODULUS);

    if (sharedSecret < 2n) {
      console.error(`[eSSP] sharedSecret inválido: ${sharedSecret}`);
      return false;
    }

    const negBuf = Buffer.alloc(8);
    writeBigInt64LE(negBuf, sharedSecret, 0);

    this.fullKey      = Buffer.concat([FIXED_KEY, negBuf]);
    this.encCount     = 0;
    this.isNegotiated = true;

    console.log(`[eSSP] ✓ clave negociada | key=${this.fullKey.toString('hex')}`);
    return true;
  }

  encryptPacket(cmd: number, params: Buffer = Buffer.alloc(0)): Buffer {
    const eData    = Buffer.concat([Buffer.from([cmd]), params]);
    const eLen     = eData.length;
    const countBuf = Buffer.alloc(4);
    countBuf.writeUInt32LE(this.encCount, 0);

    const header  = Buffer.concat([Buffer.from([eLen]), countBuf, eData]);
    const baseLen = header.length + 2;
    const padLen  = (16 - (baseLen % 16)) % 16;
    const padding = crypto.randomBytes(padLen);
    const preCrc  = Buffer.concat([header, padding]);
    const crcVal  = crc16(preCrc);
    const crcBuf  = Buffer.from([crcVal & 0xff, (crcVal >> 8) & 0xff]);
    const plain   = Buffer.concat([preCrc, crcBuf]);

    const cipher  = crypto.createCipheriv('aes-128-ecb', this.fullKey, null);
    cipher.setAutoPadding(false);
    const enc = Buffer.concat([cipher.update(plain), cipher.final()]);

    this.encCount++;
    return Buffer.concat([Buffer.from([0x7e]), enc]);
  }

  decryptResponse(respData: Buffer): { code: number; data: Buffer } | null {
    if (!respData || respData[0] !== 0x7e) return null;
    const encBlock = respData.slice(1);
    if (encBlock.length === 0 || encBlock.length % 16 !== 0) return null;

    try {
      const decipher = crypto.createDecipheriv('aes-128-ecb', this.fullKey, null);
      decipher.setAutoPadding(false);
      const plain = Buffer.concat([decipher.update(encBlock), decipher.final()]);

      const eLen   = plain[0];
      const eCount = plain.readUInt32LE(1);
      const eData  = plain.slice(5, 5 + eLen);

      if (eCount !== this.encCount) {
        console.warn(`[eSSP] COUNT mismatch: esperado=${this.encCount} recibido=${eCount}`);
      }

      this.encCount++;
      if (!eData.length) return null;
      return { code: eData[0], data: eData.slice(1) };
    } catch {
      return null;
    }
  }

  reset(): void {
    this.isNegotiated = false;
    this.encCount     = 0;
    this.fullKey      = Buffer.alloc(16);
  }
}
