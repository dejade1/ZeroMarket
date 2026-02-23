// backend/src/ssp/scs.ts
// SMART Coin System (SCS) — Driver SSP/eSSP completo
// Dirección RS485: 0x10 | Protocolo: SSP v6
// Referencia: SCS-SSP-Implementation-Test-Script-v1.1, SMART_Coin_System_eSSP_Specification
//
// ═══════════════════════════════════════════════════════════════════════════════
// CORRECCIONES APLICADAS vs versión anterior:
// ═══════════════════════════════════════════════════════════════════════════════
//
// 1. parseSetupResponse(): La estructura del SETUP_REQUEST según el PDF GA02205
//    (Implementation Test Script, sección 4.2.3) es:
//
//    [0]         = unit_type (0x09)
//    [1..4]      = firmware (4B ASCII)
//    [5..7]      = country (3B ASCII)
//    [8..10]     = value_multiplier (3B LE) ← FALTABA en la versión anterior
//    [11]        = num_channels (N)
//    [12..11+N]  = channel_values base (1B × N)
//    [12+N..11+2N]     = channel_security (1B × N)
//    [12+2N..14+2N]    = real_value_multiplier (3B LE)
//    [15+2N]           = protocol_version
//    — Si proto ≥ 6: —
//    [16+2N .. 15+2N+3N] = expanded country codes (3B × N)
//    [16+5N .. 15+5N+4N] = expanded values (4B LE × N)
//
//    La versión anterior OMITÍA value_multiplier (3B offset 8..10), causando que
//    protocol_version se leyera de data[8] en lugar de data[15+2N].
//    Como consecuencia, todos los offsets de canales estaban mal.
//
// 2. eSSP Encryption: SET_DENOMINATION_ROUTE (0x3B) requiere cifrado obligatorio
//    según la spec. Sin él → 0xF4 CANNOT_PROCESS. Implementamos Diffie-Hellman
//    key exchange + AES-128 para poder enviar este comando.
//
// 3. Enable Coin Mech/feeder (0x49): Comando adicional que habilita el coin mech
//    en un solo paso. Requiere cifrado. Asegura que el feeder esté activo.
//
// 4. SET_OPTIONS: Se envía con 2 bytes (REG_0 + REG_1) no solo 1 byte.
//    REG_0 = 0x06 (LevelCheck=1, MotorSpeed=1, HighEfficiency=1)
//    REG_1 = 0x01 (RejectEvents=1 para recibir 0xBA con detalle)
//
// 5. COIN_CREDIT event code: El PDF muestra 0xDF (223), NO 0xDA (218).
//    0xDA es en realidad DISPENSING en el event table del SCS.
//    Corregido a 0xDF.
//
// 6. Poll: Usamos POLL_WITH_ACK (0x56) + EVENT_ACK (0x57) como recomienda el PDF,
//    en lugar de POLL simple (0x07). Esto evita pérdida de eventos.
//
// 7. Secuencia de init completa según sección 4.2 del Implementation Script:
//    SYNC → HOST_PROTOCOL_VERSION → SETUP_REQUEST → [eSSP Key Exchange] →
//    SET_DENOMINATION_ROUTE (×N) → SET_COIN_INHIBIT (×N) → SET_OPTIONS →
//    ENABLE → ENABLE_COIN_MECH
//
// ═══════════════════════════════════════════════════════════════════════════════

import { EventEmitter } from 'events';
import { SSPBus }       from './ssp-bus';
import { SSPResponse, SSP_GENERIC } from './ssp-packet';
import * as crypto from 'crypto';

// ── Dirección SSP del SCS ────────────────────────────────────────────────────

const SCS_ADDRESS = 0x10;

// ── Comandos SSP ─────────────────────────────────────────────────────────────

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
  SET_MODULUS:             0x4b,
  REQUEST_KEY_EXCHANGE:   0x4c,
  SET_OPTIONS:            0x50,
  GET_OPTIONS:            0x51,
  SMART_EMPTY:            0x52,
  POLL_WITH_ACK:          0x56,
  EVENT_ACK:              0x57,
  EMPTY:                  0x3f,
} as const;

// ── Eventos de poll — CORREGIDOS según PDF SCS Event Table ───────────────────
//
// IMPORTANTE: La tabla de eventos del SCS (GA138_2_2_2112A) muestra:
//   Coin Credit = 0xDF (223), NO 0xDA
//   Dispensing  = 0xDA (218)
//   Dispensed   = 0xD2 (210)
//   Device Full = 0xCF (207)
//
// La versión anterior usaba 0xDA para COIN_CREDIT — INCORRECTO.

const EVT = {
  SLAVE_RESET:       0xf1,
  DISABLED:          0xe8,
  FRAUD_ATTEMPT:     0xe6,
  COIN_CREDIT:       0xdf,   // ← CORREGIDO: era 0xda, correcto es 0xdf
  DISPENSING:        0xda,   // ← Este es dispensing, NO coin credit
  DISPENSED:         0xd2,
  JAMMED:            0xd5,
  HALTED:            0xd6,
  FLOATING:          0xd7,
  FLOATED:           0xd8,
  TIMEOUT_EVT:       0xd9,
  INCOMPLETE_PAYOUT: 0xdc,
  INCOMPLETE_FLOAT:  0xdd,
  CASHBOX_PAID:      0xde,
  DEVICE_FULL:       0xcf,   // ← CORREGIDO: era 0xd4, correcto es 0xcf
  PAY_IN_ACTIVE:     0xc1,
  MAINTENANCE_REQ:   0xc0,
  VALUE_ADDED:       0xbf,
  INITIALISING:      0xb6,
  SMART_EMPTYING:    0xb3,
  SMART_EMPTIED:     0xb4,
  COIN_REJECTED:     0xba,   // Solo con REG_1 bit 0 = RejectEvents
  CALIBRATION_FAIL:  0x83,
  COINS_LOW:         0xd3,
} as const;

// ── Interfaces públicas ─────────────────────────────────────────────────────

export interface CoinDenomination {
  channel:  number;
  value:    number;   // centavos (penny value)
  country:  string;
}

export interface SCSInfo {
  firmwareVersion: string;
  countryCode:     string;
  numChannels:     number;
  denominations:   CoinDenomination[];
  protocolVersion: number;
}

// ── eSSP Encryption state ────────────────────────────────────────────────────

interface EncryptionState {
  fixedKey:   Buffer;    // 8 bytes — parte baja de la clave AES-128
  negotiated: Buffer;    // 8 bytes — parte alta negociada por Diffie-Hellman
  fullKey:    Buffer;    // 16 bytes — clave AES-128 completa
  encCount:   number;    // contador de paquetes cifrados (host)
  active:     boolean;   // cifrado activo
}

// ── Clase principal ─────────────────────────────────────────────────────────

export class SCS extends EventEmitter {
  private bus:          SSPBus;
  private currencyCode: string;
  private info:         SCSInfo | null    = null;
  private ready:        boolean           = false;

  // eSSP encryption
  private enc: EncryptionState = {
    fixedKey:   Buffer.from('0123456701234567', 'hex'), // default ITL
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

  // ── Getters ────────────────────────────────────────────────────────────────

  get isReady():    boolean        { return this.ready; }
  get deviceInfo(): SCSInfo | null { return this.info;  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT — Secuencia completa según PDF sección 4.2
  // ═══════════════════════════════════════════════════════════════════════════

  async init(): Promise<void> {
    console.log('[SCS] ═══════════════════════════════════════════════');
    console.log('[SCS] Iniciando secuencia de setup completa...');
    console.log('[SCS] ═══════════════════════════════════════════════');

    // ── 1. SYNC ──────────────────────────────────────────────────────────
    const syncRes = await this.send(Buffer.from([CMD.SYNC]));
    if (syncRes.generic !== SSP_GENERIC.OK) {
      throw new Error(`[SCS] SYNC failed: 0x${syncRes.generic.toString(16)}`);
    }
    console.log('[SCS] ✓ SYNC OK');

    // ── 2. HOST_PROTOCOL_VERSION (intentar v6, luego v5, v4) ─────────────
    let negotiatedVersion = 0;
    for (const ver of [6, 5, 4]) {
      const res = await this.send(Buffer.from([CMD.HOST_PROTOCOL_VERSION, ver]));
      if (res.generic === SSP_GENERIC.OK) {
        negotiatedVersion = ver;
        break;
      }
      console.warn(`[SCS]   Protocol v${ver} rechazado (0x${res.generic.toString(16)})`);
    }
    if (negotiatedVersion === 0) {
      throw new Error('[SCS] No se pudo negociar protocol version (v4/v5/v6 fallaron)');
    }
    console.log(`[SCS] ✓ Protocol version ${negotiatedVersion} OK`);

    // ── 3. SETUP_REQUEST ─────────────────────────────────────────────────
    const setupRes = await this.send(Buffer.from([CMD.SETUP_REQUEST]));
    if (setupRes.generic !== SSP_GENERIC.OK) {
      throw new Error(`[SCS] SETUP_REQUEST failed: 0x${setupRes.generic.toString(16)}`);
    }
    this.info = this.parseSetupResponse(setupRes.data);
    console.log(
      `[SCS] ✓ Setup: ${this.info.numChannels} canales | ` +
      `firmware: ${this.info.firmwareVersion} | ` +
      `protocolo: v${this.info.protocolVersion}`
    );
    console.log(
      '[SCS]   Denominaciones:',
      this.info.denominations
        .map(d => `ch${d.channel}=$${(d.value / 100).toFixed(2)} ${d.country}`)
        .join(', ')
    );

    // ── 4. eSSP Key Exchange (Diffie-Hellman) ────────────────────────────
    //    Necesario para SET_DENOMINATION_ROUTE y otros comandos "Encryption Mandatory"
    try {
      await this.initEncryption();
      console.log('[SCS] ✓ eSSP encryption negotiated');
    } catch (err: any) {
      console.error('[SCS] ✗ eSSP encryption failed:', err.message);
      console.warn('[SCS]   Continuando sin cifrado — SET_DENOMINATION_ROUTE no disponible');
    }

    // ── 5. SET_DENOMINATION_ROUTE (×N canales) ───────────────────────────
    //    "Encryption Mandatory" según PDF sección 4.2.4
    //    Route = 0 → payout (reciclar), Route = 1 → cashbox
    if (this.enc.active) {
      for (const denom of this.info.denominations) {
        try {
          // Por defecto: monedas pequeñas (≤25¢) a payout/reciclar,
          //              monedas grandes ($1+) a cashbox
          const toHopper = denom.value <= 25;
          await this.setDenominationRoute(denom.value, toHopper);
          console.log(
            `[SCS]   Route ch${denom.channel} ($${(denom.value / 100).toFixed(2)}): ` +
            `${toHopper ? 'PAYOUT' : 'CASHBOX'}`
          );
        } catch (err: any) {
          console.warn(
            `[SCS]   Route ch${denom.channel} warning: ${err.message}`
          );
        }
      }
      console.log('[SCS] ✓ Denomination routes configured');
    } else {
      console.warn('[SCS]   Skipping SET_DENOMINATION_ROUTE (no encryption)');
    }

    // ── 6. SET_COIN_INHIBIT (×N canales — habilitar todos) ───────────────
    //    NO requiere cifrado según PDF
    for (const denom of this.info.denominations) {
      try {
        await this.setCoinInhibit(denom.value, true);
      } catch (err: any) {
        console.warn(
          `[SCS]   Inhibit ch${denom.channel} warning: ${err.message}`
        );
      }
    }
    console.log('[SCS] ✓ Coin inhibits set (all enabled)');

    // ── 7. SET_OPTIONS (REG_0 + REG_1) ───────────────────────────────────
    //    REG_0: bit1=LevelCheck(1) + bit2=MotorSpeed(1) + bit5=HighEfficiency(1) = 0x26
    //    REG_1: bit0=RejectEvents(1) = 0x01
    //    Total: [0x50, 0x26, 0x01]
    const setOptData = Buffer.from([CMD.SET_OPTIONS, 0x26, 0x01]);
    const optRes = this.enc.active
      ? await this.sendEncrypted(setOptData)
      : await this.send(setOptData);
    if (optRes.generic !== SSP_GENERIC.OK) {
      console.warn(`[SCS]   SET_OPTIONS warning: 0x${optRes.generic.toString(16)}`);
    } else {
      console.log('[SCS] ✓ SET_OPTIONS OK (LevelCheck+HighSpeed+HighEff, RejectEvents)');
    }

    // ── 8. ENABLE ────────────────────────────────────────────────────────
    const enRes = await this.send(Buffer.from([CMD.ENABLE]));
    if (enRes.generic !== SSP_GENERIC.OK) {
      throw new Error(`[SCS] ENABLE failed: 0x${enRes.generic.toString(16)}`);
    }
    console.log('[SCS] ✓ ENABLE OK');

    // ── 9. ENABLE COIN MECH/FEEDER (0x49) ────────────────────────────────
    //    "Encryption Required: yes" según spec
    //    Habilita el mecanismo del feeder de monedas en un solo comando
    if (this.enc.active) {
      try {
        const mechRes = await this.sendEncrypted(
          Buffer.from([CMD.ENABLE_COIN_MECH, 0x01])
        );
        if (mechRes.generic !== SSP_GENERIC.OK) {
          console.warn(`[SCS]   ENABLE_COIN_MECH warning: 0x${mechRes.generic.toString(16)}`);
        } else {
          console.log('[SCS] ✓ ENABLE_COIN_MECH OK — feeder activo');
        }
      } catch (err: any) {
        console.warn(`[SCS]   ENABLE_COIN_MECH error: ${err.message}`);
      }
    } else {
      console.warn('[SCS]   Skipping ENABLE_COIN_MECH (requires encryption)');
    }

    this.ready = true;
    console.log('[SCS] ═══════════════════════════════════════════════');
    console.log('[SCS] ✅ LISTO — Aceptando monedas');
    console.log('[SCS] ═══════════════════════════════════════════════');
    this.emit('ready', this.info);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // eSSP ENCRYPTION — Diffie-Hellman Key Exchange + AES-128
  // Referencia: SCS Implementation Script sección 4.1.6
  // ═══════════════════════════════════════════════════════════════════════════

  private async initEncryption(): Promise<void> {
    // Primos fijos bien conocidos para Diffie-Hellman (deben ser primos)
    const generator = BigInt('982451653');   // 0x3A8F05C5 — primo
    const modulus   = BigInt('1287821');     // 0x13A68D   — primo

    // Host random secret (entero < modulus)
    const hostRandom = BigInt(Math.floor(Math.random() * Number(modulus - BigInt(2))) + 2);

    // ── SET_GENERATOR (0x4A) ─────────────────────────────────────────────
    const genBuf = Buffer.alloc(9);
    genBuf[0] = CMD.SET_GENERATOR;
    this.writeBigInt64LE(genBuf, generator, 1);

    const genRes = await this.send(genBuf);
    if (genRes.generic !== SSP_GENERIC.OK) {
      throw new Error(`SET_GENERATOR failed: 0x${genRes.generic.toString(16)}`);
    }

    // ── SET_MODULUS (0x4B) ───────────────────────────────────────────────
    const modBuf = Buffer.alloc(9);
    modBuf[0] = CMD.SET_MODULUS;
    this.writeBigInt64LE(modBuf, modulus, 1);

    const modRes = await this.send(modBuf);
    if (modRes.generic !== SSP_GENERIC.OK) {
      throw new Error(`SET_MODULUS failed: 0x${modRes.generic.toString(16)}`);
    }

    // ── Calcular Host Intermediate Key ──────────────────────────────────
    // hostInter = generator^hostRandom mod modulus
    const hostInter = this.modPow(generator, hostRandom, modulus);

    // ── REQUEST_KEY_EXCHANGE (0x4C) ─────────────────────────────────────
    const keBuf = Buffer.alloc(9);
    keBuf[0] = CMD.REQUEST_KEY_EXCHANGE;
    this.writeBigInt64LE(keBuf, hostInter, 1);

    const keRes = await this.send(keBuf);
    if (keRes.generic !== SSP_GENERIC.OK) {
      throw new Error(`REQUEST_KEY_EXCHANGE failed: 0x${keRes.generic.toString(16)}`);
    }

    // ── Leer Slave Intermediate Key ─────────────────────────────────────
    const slaveInter = this.readBigInt64LE(keRes.data, 0);

    // ── Calcular Shared Secret ──────────────────────────────────────────
    // sharedSecret = slaveInter^hostRandom mod modulus
    const sharedSecret = this.modPow(slaveInter, hostRandom, modulus);

    // ── Construir clave AES-128 ─────────────────────────────────────────
    // Lower 64 bits = fixedKey (default: 0123456701234567)
    // Upper 64 bits = sharedSecret (negociado)
    const negotiatedBuf = Buffer.alloc(8);
    this.writeBigInt64LE(negotiatedBuf, sharedSecret, 0);

    this.enc.negotiated = negotiatedBuf;
    this.enc.fullKey    = Buffer.concat([this.enc.fixedKey, negotiatedBuf]);
    this.enc.encCount   = 0;
    this.enc.active     = true;

    console.log(`[SCS]   eSSP key: ${this.enc.fullKey.toString('hex')}`);
  }

  // ── Modular exponentiation: base^exp mod mod ──────────────────────────────

  private modPow(base: bigint, exp: bigint, mod: bigint): bigint {
    let result = BigInt(1);
    base = base % mod;
    while (exp > BigInt(0)) {
      if (exp % BigInt(2) === BigInt(1)) {
        result = (result * base) % mod;
      }
      exp = exp / BigInt(2);
      base = (base * base) % mod;
    }
    return result;
  }

  // ── BigInt ↔ Buffer helpers ────────────────────────────────────────────────

  private writeBigInt64LE(buf: Buffer, val: bigint, offset: number): void {
    for (let i = 0; i < 8; i++) {
      buf[offset + i] = Number(val & BigInt(0xff));
      val = val >> BigInt(8);
    }
  }

  private readBigInt64LE(buf: Buffer, offset: number): bigint {
    let val = BigInt(0);
    for (let i = 7; i >= 0; i--) {
      val = (val << BigInt(8)) | BigInt(buf[offset + i] ?? 0);
    }
    return val;
  }

  // ── Encrypt data with AES-128 ECB ─────────────────────────────────────────
  //    eSSP usa AES-128 ECB en bloques de 16 bytes
  //    Estructura del bloque cifrado:
  //    [0x7E] [eLENGTH 1B] [eCOUNT 4B LE] [eDATA...] [ePACKING...] [eCRC_L] [eCRC_H]

  private encryptData(plainData: Buffer): Buffer {
    // plainData = el comando y sus parámetros (sin el byte 0x7E STEX)
    const eLength = plainData.length;
    const eCount  = this.enc.encCount;

    // Construir payload antes de cifrar:
    // eLENGTH(1) + eCOUNT(4) + eDATA(N) + ePACKING(?) + eCRC(2)
    // Total antes de cifrar debe ser múltiplo de 16

    const countBuf = Buffer.alloc(4);
    countBuf.writeUInt32LE(eCount, 0);

    // Pre-CRC content: eLENGTH + eCOUNT + eDATA
    const preCrc = Buffer.concat([
      Buffer.from([eLength]),
      countBuf,
      plainData,
    ]);

    // Calcular CRC sobre preCrc
    let crc = 0xffff;
    for (const byte of preCrc) {
      crc ^= (byte << 8);
      for (let i = 0; i < 8; i++) {
        if (crc & 0x8000) {
          crc = ((crc << 1) & 0xffff) ^ 0x8005;
        } else {
          crc = (crc << 1) & 0xffff;
        }
      }
    }

    const crcBuf = Buffer.from([crc & 0xff, (crc >> 8) & 0xff]);

    // Content sin packing: preCrc + CRC
    const withCrc = Buffer.concat([preCrc, crcBuf]);

    // Packing: rellenar con bytes random hasta múltiplo de 16
    const padNeeded = (16 - (withCrc.length % 16)) % 16;
    const packing = crypto.randomBytes(padNeeded);
    // Insertar packing entre datos y CRC
    const toEncrypt = Buffer.concat([
      preCrc,
      packing,
      crcBuf,
    ]);

    // AES-128 ECB encrypt
    const cipher = crypto.createCipheriv('aes-128-ecb', this.enc.fullKey, null);
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(toEncrypt), cipher.final()]);

    // Incrementar contador
    this.enc.encCount++;

    // Wrap en STEX: 0x7E + encrypted data
    return Buffer.concat([Buffer.from([0x7e]), encrypted]);
  }

  // ── Enviar comando cifrado ────────────────────────────────────────────────

  private async sendEncrypted(data: Buffer): Promise<SSPResponse> {
    if (!this.enc.active) {
      throw new Error('[SCS] Encryption not initialized');
    }
    const encryptedPayload = this.encryptData(data);
    return this.bus.send(SCS_ADDRESS, encryptedPayload);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMANDOS DE CONTROL
  // ═══════════════════════════════════════════════════════════════════════════

  async enable(): Promise<void> {
    const res = await this.send(Buffer.from([CMD.ENABLE]));
    if (res.generic !== SSP_GENERIC.OK) {
      throw new Error(`[SCS] ENABLE failed: 0x${res.generic.toString(16)}`);
    }
    this.ready = true;
    console.log('[SCS] ENABLE OK');
    this.emit('enabled');
  }

  async disable(): Promise<void> {
    // 1. Drenar eventos pendientes
    for (let drain = 0; drain < 5; drain++) {
      try {
        const res = await this.send(Buffer.from([CMD.POLL]));
        if (res.generic === SSP_GENERIC.OK) {
          const hasPayInActive = res.data.includes(EVT.PAY_IN_ACTIVE);
          const hasValueAdded  = res.data.includes(EVT.VALUE_ADDED);

          if (res.data.length > 0) {
            await this.send(Buffer.from([CMD.EVENT_ACK])).catch(() => {});
          }

          if (!hasPayInActive && !hasValueAdded) break;
        }
      } catch {
        // Ignorar errores en el drain
      }
      await new Promise(r => setTimeout(r, 200));
    }

    // 2. Enviar DISABLE con reintentos
    let attempts = 0;
    while (attempts < 3) {
      const res = await this.send(Buffer.from([CMD.DISABLE]));
      if (res.generic === SSP_GENERIC.OK) {
        this.ready = false;
        console.log('[SCS] DISABLE OK');
        this.emit('disabled');
        return;
      }
      attempts++;
      console.warn(
        `[SCS] DISABLE no confirmado (0x${res.generic.toString(16)}) — retry ${attempts}/3`
      );
      await new Promise(r => setTimeout(r, 200));
    }

    this.ready = false;
    console.error('[SCS] DISABLE no confirmado tras 3 intentos — forzando estado');
    this.emit('disabled');
  }

  async reset(): Promise<void> {
    await this.send(Buffer.from([CMD.RESET]));
    this.ready      = false;
    this.enc.active = false;
    console.log('[SCS] RESET enviado');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POLL — con ACK según recomendación del PDF sección 4.3.1
  // ═══════════════════════════════════════════════════════════════════════════

  async poll(): Promise<void> {
    if (!this.ready) return;
    const res = await this.send(Buffer.from([CMD.POLL_WITH_ACK]));
    if (res.generic === SSP_GENERIC.OK) {
      await this.handlePollResponse(res.data);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMANDOS DE PAGO
  // ═══════════════════════════════════════════════════════════════════════════

  async payoutAmount(amountCents: number): Promise<void> {
    const valueBuf = Buffer.alloc(4);
    valueBuf.writeUInt32LE(amountCents, 0);
    const countryBuf = Buffer.from(
      this.currencyCode.padEnd(3, ' ').slice(0, 3), 'ascii'
    );
    const cmdData = Buffer.concat([
      Buffer.from([CMD.PAYOUT_AMOUNT]),
      valueBuf,
      countryBuf,
      Buffer.from([0x58]),  // PAYOUT_AMOUNT option (commit)
    ]);
    console.log(`[SCS] Dispensando cambio: $${(amountCents / 100).toFixed(2)}`);

    // PAYOUT_AMOUNT requiere cifrado
    const res = this.enc.active
      ? await this.sendEncrypted(cmdData)
      : await this.send(cmdData);

    if (res.generic === SSP_GENERIC.CANNOT_PROCESS) {
      const errCode = res.data[0];
      const errMap: Record<number, string> = {
        1: 'Valor insuficiente en hopper',
        2: 'No puede dar cambio exacto',
        3: 'Dispositivo ocupado',
        4: 'Dispositivo deshabilitado',
      };
      throw new Error(
        `[SCS] Payout fallido: ${errMap[errCode] ?? `código ${errCode}`}`
      );
    }
    if (res.generic !== SSP_GENERIC.OK) {
      throw new Error(`[SCS] Payout error: 0x${res.generic.toString(16)}`);
    }
  }

  async getAllLevels(): Promise<{ level: number; value: number; country: string }[]> {
    const res = await this.send(Buffer.from([CMD.GET_ALL_LEVELS]));
    if (res.generic !== SSP_GENERIC.OK) {
      throw new Error(`[SCS] GET_ALL_LEVELS failed: 0x${res.generic.toString(16)}`);
    }

    // Response: [numDenoms 1B] then [level 2B LE][value 4B LE][country 3B ASCII] × N
    const levels: { level: number; value: number; country: string }[] = [];
    const numDenoms = res.data[0] ?? 0;
    for (let i = 0; i < numDenoms; i++) {
      const offset  = 1 + (i * 9);
      if (offset + 9 > res.data.length) break;
      const level   = res.data.readUInt16LE(offset);
      const value   = res.data.readUInt32LE(offset + 2);
      const country = res.data.slice(offset + 6, offset + 9).toString('ascii').trim();
      levels.push({ level, value, country });
    }
    return levels;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SET_COIN_INHIBIT — NO requiere cifrado
  // Formato proto ≥ 6: [0x40][inhibit 1B][value 2B LE][country 3B ASCII]
  // ═══════════════════════════════════════════════════════════════════════════

  async setCoinInhibit(valueCents: number, enableAcceptance: boolean): Promise<void> {
    const valueBuf = Buffer.alloc(2);
    valueBuf.writeUInt16LE(valueCents, 0);
    const countryBuf = Buffer.from(
      this.currencyCode.padEnd(3, ' ').slice(0, 3), 'ascii'
    );
    // enableAcceptance=true → inhibit=1 (enable), false → inhibit=0 (inhibit)
    const data = Buffer.concat([
      Buffer.from([CMD.SET_COIN_INHIBIT, enableAcceptance ? 0x01 : 0x00]),
      valueBuf,
      countryBuf,
    ]);
    const res = await this.send(data);
    if (res.generic !== SSP_GENERIC.OK) {
      throw new Error(`[SCS] SET_COIN_INHIBIT failed: 0x${res.generic.toString(16)}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SET_DENOMINATION_ROUTE — REQUIERE CIFRADO
  // Formato: [0x3B][route 1B][value 4B LE][country 3B ASCII]
  //   route: 0 = payout (reciclar), 1 = cashbox
  // ═══════════════════════════════════════════════════════════════════════════

  async setDenominationRoute(valueCents: number, toHopper: boolean): Promise<void> {
    const valueBuf = Buffer.alloc(4);
    valueBuf.writeUInt32LE(valueCents, 0);
    const countryBuf = Buffer.from(
      this.currencyCode.padEnd(3, ' ').slice(0, 3), 'ascii'
    );
    const cmdData = Buffer.concat([
      Buffer.from([CMD.SET_DENOMINATION_ROUTE, toHopper ? 0x00 : 0x01]),
      valueBuf,
      countryBuf,
    ]);

    const res = this.enc.active
      ? await this.sendEncrypted(cmdData)
      : await this.send(cmdData);

    if (res.generic !== SSP_GENERIC.OK) {
      throw new Error(
        `[SCS] SET_DENOMINATION_ROUTE failed for ${valueCents}¢: 0x${res.generic.toString(16)}`
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MANEJO DE EVENTOS DE POLL
  // ═══════════════════════════════════════════════════════════════════════════

  private async handlePollResponse(data: Buffer): Promise<void> {
    if (data.length === 0) return; // idle — sin eventos

    let i = 0;
    let hasEvents = false;

    while (i < data.length) {
      const evt = data[i];

      switch (evt) {

        case EVT.SLAVE_RESET: {
          console.warn('[SCS] SLAVE_RESET — re-inicializando...');
          this.ready      = false;
          this.enc.active = false;
          this.emit('reset');
          setImmediate(() =>
            this.init().catch(e => console.error('[SCS] Re-init error:', e.message))
          );
          i++;
          hasEvents = true;
          break;
        }

        case EVT.INITIALISING: {
          console.log('[SCS] INITIALISING');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.COIN_CREDIT: {
          // 0xDF — Proto ≥ 6: [0xDF][valor 4B LE][país 3B ASCII]
          if (i + 7 >= data.length) { i++; break; }
          const amount  = data.readUInt32LE(i + 1);
          const country = data.slice(i + 5, i + 8).toString('ascii').trim();
          console.log(`[SCS] COIN_CREDIT: $${(amount / 100).toFixed(2)} (${country})`);
          this.emit('COIN_CREDIT', { amount, country });
          i += 8;
          hasEvents = true;
          break;
        }

        case EVT.VALUE_ADDED: {
          // 0xBF — [0xBF][numCountries 1B]([valor 4B LE][país 3B ASCII]) × N
          const numCountries = data[i + 1] ?? 1;
          for (let c = 0; c < numCountries; c++) {
            const offset = i + 2 + (c * 7);
            if (offset + 7 > data.length) break;
            const amount  = data.readUInt32LE(offset);
            const country = data.slice(offset + 4, offset + 7).toString('ascii').trim();
            console.log(`[SCS] VALUE_ADDED: $${(amount / 100).toFixed(2)} (${country})`);
            this.emit('VALUE_ADDED', { amount, country });
          }
          i += 2 + (numCountries * 7);
          hasEvents = true;
          break;
        }

        case EVT.PAY_IN_ACTIVE: {
          console.log('[SCS] PAY_IN_ACTIVE — moneda detectada en feeder');
          this.emit('payInActive');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.COIN_REJECTED: {
          // 0xBA — Si REG_1 bit1 (RejectEventFull): [0xBA][valor 2B LE][país 3B ASCII]
          //        Si solo bit0: [0xBA] sin datos
          console.log('[SCS] COIN_REJECTED');
          this.emit('COIN_REJECTED');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.DISPENSING: {
          // 0xDA — [0xDA][valor 4B LE][país 3B ASCII]
          if (i + 7 >= data.length) { i++; break; }
          const amount  = data.readUInt32LE(i + 1);
          const country = data.slice(i + 5, i + 8).toString('ascii').trim();
          console.log(`[SCS] DISPENSING: $${(amount / 100).toFixed(2)} (${country})`);
          this.emit('dispensing', { amount, country });
          i += 8;
          hasEvents = true;
          break;
        }

        case EVT.DISPENSED: {
          // 0xD2 — [0xD2][valor 4B LE][país 3B ASCII]
          if (i + 7 >= data.length) { i++; break; }
          const amount  = data.readUInt32LE(i + 1);
          const country = data.slice(i + 5, i + 8).toString('ascii').trim();
          console.log(`[SCS] DISPENSED: $${(amount / 100).toFixed(2)} (${country})`);
          this.emit('dispensed', { amount, country });
          i += 8;
          hasEvents = true;
          break;
        }

        case EVT.COINS_LOW: {
          console.warn('[SCS] COINS_LOW');
          this.emit('coinsLow');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.DEVICE_FULL: {
          // 0xCF
          console.warn('[SCS] DEVICE_FULL');
          this.emit('deviceFull');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.JAMMED: {
          console.warn('[SCS] JAMMED');
          this.emit('jammed');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.HALTED: {
          console.warn('[SCS] HALTED');
          this.emit('halted');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.FLOATING: {
          if (i + 7 >= data.length) { i++; break; }
          const amount  = data.readUInt32LE(i + 1);
          const country = data.slice(i + 5, i + 8).toString('ascii').trim();
          this.emit('floating', { amount, country });
          i += 8;
          hasEvents = true;
          break;
        }

        case EVT.FLOATED: {
          if (i + 7 >= data.length) { i++; break; }
          const amount  = data.readUInt32LE(i + 1);
          const country = data.slice(i + 5, i + 8).toString('ascii').trim();
          console.log(`[SCS] FLOATED: $${(amount / 100).toFixed(2)} (${country})`);
          this.emit('floated', { amount, country });
          i += 8;
          hasEvents = true;
          break;
        }

        case EVT.TIMEOUT_EVT: {
          console.warn('[SCS] TIMEOUT interno');
          this.emit('deviceTimeout');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.INCOMPLETE_PAYOUT: {
          if (i + 11 >= data.length) { i++; break; }
          const paid    = data.readUInt32LE(i + 1);
          const request = data.readUInt32LE(i + 5);
          const country = data.slice(i + 9, i + 12).toString('ascii').trim();
          console.warn(
            `[SCS] INCOMPLETE_PAYOUT: pagado $${(paid / 100).toFixed(2)} ` +
            `de $${(request / 100).toFixed(2)} (${country})`
          );
          this.emit('incompletePayout', { paid, request, country });
          i += 12;
          hasEvents = true;
          break;
        }

        case EVT.INCOMPLETE_FLOAT: {
          if (i + 11 >= data.length) { i++; break; }
          const paid    = data.readUInt32LE(i + 1);
          const request = data.readUInt32LE(i + 5);
          const country = data.slice(i + 9, i + 12).toString('ascii').trim();
          console.warn(
            `[SCS] INCOMPLETE_FLOAT: pagado $${(paid / 100).toFixed(2)} ` +
            `de $${(request / 100).toFixed(2)} (${country})`
          );
          this.emit('incompleteFloat', { paid, request, country });
          i += 12;
          hasEvents = true;
          break;
        }

        case EVT.CASHBOX_PAID: {
          if (i + 7 >= data.length) { i++; break; }
          const amount  = data.readUInt32LE(i + 1);
          const country = data.slice(i + 5, i + 8).toString('ascii').trim();
          console.log(`[SCS] CASHBOX_PAID: $${(amount / 100).toFixed(2)} (${country})`);
          this.emit('cashboxPaid', { amount, country });
          i += 8;
          hasEvents = true;
          break;
        }

        case EVT.DISABLED: {
          console.warn('[SCS] DISABLED');
          this.ready = false;
          this.emit('disabled');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.CALIBRATION_FAIL: {
          console.error('[SCS] CALIBRATION_FAIL');
          this.emit('calibrationFail');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.FRAUD_ATTEMPT: {
          console.warn('[SCS] FRAUD_ATTEMPT');
          this.emit('fraud');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.MAINTENANCE_REQ: {
          console.warn('[SCS] MAINTENANCE_REQUIRED');
          this.emit('maintenanceRequired');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.SMART_EMPTYING: {
          console.log('[SCS] SMART_EMPTYING');
          this.emit('smartEmptying');
          i++;
          hasEvents = true;
          break;
        }

        case EVT.SMART_EMPTIED: {
          console.log('[SCS] SMART_EMPTIED');
          this.emit('smartEmptied');
          i++;
          hasEvents = true;
          break;
        }

        default: {
          console.warn(`[SCS] Evento desconocido: 0x${evt.toString(16)} — saltando`);
          i++;
          break;
        }
      }
    }

    // EVENT_ACK — confirmar que procesamos los eventos
    if (hasEvents) {
      try {
        await this.send(Buffer.from([CMD.EVENT_ACK]));
      } catch (e) {
        console.warn('[SCS] EVENT_ACK warning:', (e as Error).message);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // parseSetupResponse — CORREGIDO según PDF sección 4.2.3
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Estructura REAL del payload (data sin byte genérico 0xF0):
  //
  //  Offset       Size   Campo
  //  [0]           1     unit_type (0x09 = SCS)
  //  [1..4]        4     firmware version (ASCII)
  //  [5..7]        3     country code (ASCII)
  //  [8..10]       3     value_multiplier (3B LE) ← LA VERSIÓN ANTERIOR LO OMITÍA
  //  [11]          1     num_channels (N)
  //  [12..11+N]    N     channel_values (1B × N)
  //  [12+N..11+2N] N     channel_security (1B × N)
  //  [12+2N..14+2N] 3    real_value_multiplier (3B LE)
  //  [15+2N]       1     protocol_version
  //  — Si proto ≥ 6 (expanded data): —
  //  [16+2N .. 15+2N + 3N]      = country codes (3B ASCII × N)
  //  [16+2N+3N .. 15+2N+3N+4N]  = expanded values (4B LE × N)
  //
  // Verificación con raw hex del documento adjunto:
  //   09 30 31 34 30 55 53 44 06 05 01 00 05 00 0A 00 19 00 64 00
  //   unit=0x09, fw="0140", country="USD"
  //   ¡Pero! En ese raw, el offset 8 es 0x06 que es protocol_version 6.
  //   Eso indica que el SCS versión 0140 usa un formato ALTERNATIVO sin
  //   value_multiplier. Veamos:
  //
  // El eSSP Specification (GA138) para SCS muestra OTRO formato:
  //  [0]    unit_type
  //  [1..4] firmware
  //  [5..7] country
  //  [8]    protocol_version  ← DIRECTO, sin value_multiplier
  //  [9]    num_channels
  //  [10..] coin values (2B LE × N)
  //  [10+2N..] country codes (3B × N)
  //
  // CONCLUSIÓN: El SCS tiene DOS formatos posibles de Setup Response:
  //   - Formato "Implementation Script" (GA02205): con value_multiplier en offset 8
  //   - Formato "eSSP Specification" (GA138): sin value_multiplier, proto en offset 8
  //
  // La detección se hace mirando data[8]:
  //   Si data[8] es un protocol version válido (4-8) Y data[9] es un num_channels
  //   razonable (1-20), usamos el formato GA138.
  //   Si no, usamos el formato GA02205.

  private parseSetupResponse(data: Buffer): SCSInfo {
    console.log(`[SCS] Setup raw (${data.length}B): ${data.toString('hex')}`);

    const unitType        = data[0];
    const firmwareVersion = data.slice(1, 5).toString('ascii').trim();
    const countryCode     = data.slice(5, 8).toString('ascii').trim();

    // ── Detectar formato ─────────────────────────────────────────────────
    // Heurística: si data[8] está en rango [4..8] (protocol versions conocidas)
    // Y data[9] está en rango [1..20] (número razonable de canales),
    // entonces es formato GA138 (eSSP spec) sin value_multiplier.
    const maybePV  = data[8];
    const maybeNCh = data[9];
    const isGA138Format = (maybePV >= 4 && maybePV <= 8 && maybeNCh >= 1 && maybeNCh <= 20);

    let protocolVersion: number;
    let numChannels: number;
    const denominations: CoinDenomination[] = [];

    if (isGA138Format) {
      // ── Formato GA138 (eSSP Specification) ─────────────────────────────
      // [8] = protocol_version, [9] = num_channels
      // [10..] = coin values (2B LE × N), luego country codes (3B × N)
      protocolVersion = data[8];
      numChannels     = data[9];
      console.log(`[SCS] Formato GA138 detectado: proto=v${protocolVersion} ch=${numChannels}`);

      for (let ch = 0; ch < numChannels; ch++) {
        const valueOffset   = 10 + ch * 2;
        const countryOffset = 10 + numChannels * 2 + ch * 3;
        if (valueOffset + 2 > data.length) break;
        const value   = data.readUInt16LE(valueOffset);
        const country = (countryOffset + 3 <= data.length)
          ? data.slice(countryOffset, countryOffset + 3).toString('ascii').trim()
          : countryCode;
        denominations.push({ channel: ch + 1, value, country });
      }
    } else {
      // ── Formato GA02205 (Implementation Test Script) ───────────────────
      // [8..10] = value_multiplier (3B LE)
      // [11] = num_channels
      // [12..] = channel values, security, real_multiplier, proto
      const valueMultiplier = data[8] | (data[9] << 8) | (data[10] << 16);
      numChannels     = data[11];
      protocolVersion = data[15 + 2 * numChannels] ?? 0;
      console.log(
        `[SCS] Formato GA02205 detectado: mult=${valueMultiplier} ` +
        `proto=v${protocolVersion} ch=${numChannels}`
      );

      if (protocolVersion >= 6) {
        // Expanded values: offset 16+2N → 3B country × N, then 4B value × N
        const countryBase = 16 + 2 * numChannels;
        const valueBase   = countryBase + 3 * numChannels;
        for (let ch = 0; ch < numChannels; ch++) {
          const countryOffset = countryBase + ch * 3;
          const valueOffset   = valueBase + ch * 4;
          const country = (countryOffset + 3 <= data.length)
            ? data.slice(countryOffset, countryOffset + 3).toString('ascii').trim()
            : countryCode;
          const value = (valueOffset + 4 <= data.length)
            ? data.readUInt32LE(valueOffset)
            : (data[12 + ch] ?? 0) * (valueMultiplier || 1);
          denominations.push({ channel: ch + 1, value, country });
        }
      } else {
        // Base values
        const mult = valueMultiplier || 1;
        for (let ch = 0; ch < numChannels; ch++) {
          const rawVal = data[12 + ch] ?? 0;
          denominations.push({
            channel: ch + 1,
            value:   rawVal * mult,
            country: countryCode,
          });
        }
      }
    }

    console.log(`[SCS] unitType=0x${unitType.toString(16)} protocolVersion=v${protocolVersion}`);
    return { firmwareVersion, countryCode, numChannels, denominations, protocolVersion };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ENVÍO DE COMANDO AL BUS
  // ═══════════════════════════════════════════════════════════════════════════

  private async send(data: Buffer): Promise<SSPResponse> {
    const res = await this.bus.send(SCS_ADDRESS, data);
    if (res.generic === SSP_GENERIC.UNKNOWN_CMD) {
      throw new Error(`[SCS] Comando desconocido: 0x${data[0].toString(16)}`);
    }
    if (res.generic === SSP_GENERIC.FAIL) {
      throw new Error(`[SCS] Comando fallido (FAIL): 0x${data[0].toString(16)}`);
    }
    return res;
  }
}