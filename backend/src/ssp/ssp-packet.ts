// Forward CRC-16, polynomial 0x8005, seed 0xFFFF — MSB-first (PDF GA02204)
export function crc16(data: Buffer): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= (byte << 8);
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) & 0xffff) ^ 0x8005;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc;
}

// Byte stuffing: cualquier 0x7F en datos se duplica (excepto el STX inicial)
export function byteStuff(data: Buffer): Buffer {
  const result: number[] = [];
  for (const byte of data) {
    result.push(byte);
    if (byte === 0x7f) result.push(0x7f);
  }
  return Buffer.from(result);
}

// Revertir byte stuffing en respuesta recibida
export function byteUnstuff(data: Buffer): Buffer {
  const result: number[] = [];
  let i = 0;
  while (i < data.length) {
    result.push(data[i]);
    if (data[i] === 0x7f && data[i + 1] === 0x7f) i++; // saltar duplicado
    i++;
  }
  return Buffer.from(result);
}

export interface SSPPacket {
  address: number;  // 0x00 NV200, 0x10 SCS
  seqBit: boolean;  // alternado por comando
  data:   Buffer;   // comando + parámetros
}

// Construir packet completo listo para enviar por serial
// Estructura: STX | SEQID | LENGTH | DATA | CRC_L | CRC_H
export function buildPacket(packet: SSPPacket): Buffer {
  const seqId = packet.seqBit
    ? (0x80 | (packet.address & 0x7f))
    : (packet.address & 0x7f);

  // Bytes sobre los que se calcula CRC: SEQID + LENGTH + DATA
  const lengthByte = packet.data.length;
  const crcInput   = Buffer.concat([
    Buffer.from([seqId, lengthByte]),
    packet.data,
  ]);

  const crc     = crc16(crcInput);
  const crcLow  = crc & 0xff;
  const crcHigh = (crc >> 8) & 0xff;

  // Packet sin stuffing todavía
  const raw = Buffer.concat([
    Buffer.from([seqId, lengthByte]),
    packet.data,
    Buffer.from([crcLow, crcHigh]),
  ]);

  // Aplicar byte stuffing al contenido (no al STX)
  const stuffed = byteStuff(raw);

  // Agregar STX al inicio
  return Buffer.concat([Buffer.from([0x7f]), stuffed]);
}

export interface SSPResponse {
  address:  number;
  seqBit:   boolean;
  data:     Buffer;   // data sin el byte genérico de respuesta
  generic:  number;   // 0xF0=OK, 0xF1=Reset, 0xF2=Unknown, 0xF5=Busy, etc.
  valid:    boolean;  // CRC correcto
}

// Parsear respuesta cruda recibida del dispositivo
export function parseResponse(raw: Buffer): SSPResponse | null {
  if (raw.length < 6) return null;

  // raw[0] debe ser STX 0x7F
  if (raw[0] !== 0x7f) return null;

  // Deshacer byte stuffing (desde raw[1] en adelante)
  const unstuffed = byteUnstuff(raw.slice(1));

  if (unstuffed.length < 5) return null;

  const seqId     = unstuffed[0];
  const address   = seqId & 0x7f;
  const seqBit    = !!(seqId & 0x80);
  const length    = unstuffed[1];
  const data      = unstuffed.slice(2, 2 + length);
  const crcLow    = unstuffed[2 + length];
  const crcHigh   = unstuffed[3 + length];
  const receivedCrc = crcLow | (crcHigh << 8);

  // Verificar CRC
  const crcInput    = Buffer.concat([Buffer.from([seqId, length]), data]);
  const computedCrc = crc16(crcInput);
  const valid       = receivedCrc === computedCrc;

  const generic = data[0] ?? 0x00;
  const payload = data.slice(1); // data sin el byte genérico

  return { address, seqBit, data: payload, generic, valid };
}

// Códigos de respuesta genérica (PDF sección 4.1.8)
export const SSP_GENERIC = {
  OK:           0xf0,
  RESET:        0xf1,
  UNKNOWN_CMD:  0xf2,
  WRONG_PARAMS: 0xf3,
  OUT_OF_RANGE: 0xf4,
  CANNOT_PROCESS: 0xf5,
  SOFTWARE_ERR: 0xf6,
  FAIL:         0xf8,
  KEY_NOT_SET:  0xfa,
} as const;
