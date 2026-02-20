// backend/src/services/sspService.ts
const SSP = require('@kybarg/ssp');

import { WebSocketServer } from 'ws';

// Direcciones de dispositivos según spec ITL
const NV200_ADDRESS = 0x00;   // Validador de billetes
const SCS_ADDRESS   = 0x10;   // SMART Coin System

let nv200: any = null;
let scs: any   = null;
let wss: WebSocketServer | null = null;
let currentOrderId: string | null = null;
let currentOrderTotal: number = 0; // en centavos
let amountInserted: number = 0;    // acumulado en centavos

// Broadcast a todos los clientes WS conectados (kiosko/frontend)
function broadcast(data: object) {
  if (!wss) return;
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

export function initSSP(wsServer: WebSocketServer, portName = '/dev/ttyUSB0') {
  wss = wsServer;

  // --- NV200 Spectral (Billetes) ---
  nv200 = new SSP({ device: portName, type: 'NV200' });

  nv200.on('OPEN', async () => {
    console.log('[NV200] Puerto abierto');
    await nv200.command('SYNC');
    await nv200.command('HOST_PROTOCOL_VERSION', { version: 8 });
    await nv200.command('SETUP_REQUEST');
    await nv200.command('SET_INHIBITS', { channels: [true, true, true, true, false, false, false, false] });
    await nv200.command('ENABLE');
    console.log('[NV200] Inicializado y habilitado');
    broadcast({ device: 'NV200', event: 'READY' });
  });

  // Evento clave: billete validado en escrow
  nv200.on('READ', ({ channel }: { channel: number }) => {
    console.log(`[NV200] Billete en escrow canal ${channel}`);
    broadcast({ device: 'NV200', event: 'READ', channel });
  });

  // Billete aceptado: el crédito se otorga al llegar a posición segura
  nv200.on('NOTE_CREDIT', ({ channel }: { channel: number }) => {
    const billValues: Record<number, number> = {
      1: 100,   // $1.00 -> 100 centavos (ajustar a tu dataset)
      2: 500,   // $5.00
      3: 1000,  // $10.00
      4: 2000,  // $20.00
    };
    const value = billValues[channel] ?? 0;
    amountInserted += value;
    console.log(`[NV200] Crédito: canal ${channel}, acumulado: ${amountInserted} centavos`);
    broadcast({
      device: 'NV200',
      event: 'NOTE_CREDIT',
      channel,
      valueInserted: amountInserted,
      remaining: Math.max(0, currentOrderTotal - amountInserted),
    });
    checkPaymentComplete();
  });

  nv200.on('STACKED',   () => broadcast({ device: 'NV200', event: 'STACKED' }));
  nv200.on('REJECTED',  () => broadcast({ device: 'NV200', event: 'REJECTED' }));
  nv200.on('UNSAFE_JAM', () => {
    console.error('[NV200] JAM detectado!');
    broadcast({ device: 'NV200', event: 'JAM' });
  });
  nv200.on('STACKER_FULL', () => broadcast({ device: 'NV200', event: 'STACKER_FULL' }));
  nv200.on('DISABLED', () => {
    console.warn('[NV200] Dispositivo deshabilitado. Re-enabling...');
    nv200.command('ENABLE');
  });
  nv200.on('error', (err: Error) => {
    console.error('[NV200] Error:', err.message);
    broadcast({ device: 'NV200', event: 'ERROR', message: err.message });
  });

  nv200.open();

  // --- SMART Coin System (Monedas) ---
  // SCS usa segunda UART o mismo bus con dirección 0x10
  scs = new SSP({ device: portName, type: 'SMART_HOPPER', id: SCS_ADDRESS });

  scs.on('OPEN', async () => {
    console.log('[SCS] Puerto abierto');
    await scs.command('SYNC');
    await scs.command('HOST_PROTOCOL_VERSION', { version: 8 });
    await scs.command('SETUP_REQUEST');
    await scs.command('ENABLE');
    await scs.command('ENABLE_COIN_MECH', { enable: true });
    console.log('[SCS] Inicializado y habilitado');
    broadcast({ device: 'SCS', event: 'READY' });
  });

  // Moneda validada y acreditada
  scs.on('COIN_CREDIT', ({ value, country }: { value: number; country: string }) => {
    amountInserted += value; // value ya viene en centavos
    console.log(`[SCS] Moneda: ${value} centavos (${country}), acumulado: ${amountInserted}`);
    broadcast({
      device: 'SCS',
      event: 'COIN_CREDIT',
      value,
      country,
      valueInserted: amountInserted,
      remaining: Math.max(0, currentOrderTotal - amountInserted),
    });
    checkPaymentComplete();
  });

  scs.on('DISPENSED', ({ value }: { value: number }) => {
    broadcast({ device: 'SCS', event: 'DISPENSED', value });
  });
  scs.on('DISABLED', () => {
    scs.command('ENABLE');
  });
  scs.on('error', (err: Error) => {
    broadcast({ device: 'SCS', event: 'ERROR', message: err.message });
  });

  scs.open();
}

// Iniciar sesión de pago para una orden
export async function startPaymentSession(orderId: string, totalCents: number) {
  currentOrderId   = orderId;
  currentOrderTotal = totalCents;
  amountInserted   = 0;

  // Habilitar ambos dispositivos
  if (nv200) await nv200.command('ENABLE');
  if (scs)   await scs.command('ENABLE');
  if (scs)   await scs.command('ENABLE_COIN_MECH', { enable: true });

  broadcast({
    event: 'PAYMENT_SESSION_STARTED',
    orderId,
    totalCents,
  });
  console.log(`[SSP] Sesión de pago iniciada: orden ${orderId}, total: ${totalCents} centavos`);
}

// Verificar si el pago está completo
async function checkPaymentComplete() {
  if (!currentOrderId) return;
  if (amountInserted >= currentOrderTotal) {
    const change = amountInserted - currentOrderTotal;

    // Deshabilitar ingreso de más dinero
    if (nv200) await nv200.command('DISABLE');
    if (scs)   await scs.command('DISABLE');

    broadcast({
      event: 'PAYMENT_COMPLETE',
      orderId: currentOrderId,
      totalPaid: amountInserted,
      change,
    });
    console.log(`[SSP] Pago completo. Cambio a devolver: ${change} centavos`);

    // Devolver cambio en monedas si aplica
    if (change > 0 && scs) {
      await giveChange(change);
    }

    currentOrderId    = null;
    currentOrderTotal = 0;
    amountInserted    = 0;
  }
}

// Dispensar cambio con el SCS
async function giveChange(amountCents: number) {
  console.log(`[SCS] Dispensando cambio: ${amountCents} centavos`);
  // El SCS decide qué monedas usar internamente (Payout Amount 0x33)
  if (scs) {
    const response = await scs.command('PAYOUT_AMOUNT', {
      amount: amountCents,
      country: 'USD', // Cambiar a tu moneda
      test: false,
    });
    broadcast({ device: 'SCS', event: 'DISPENSING_CHANGE', amount: amountCents });
    console.log('[SCS] Respuesta dispensar:', response);
  }
}

// Cancelar sesión y rechazar dinero
export async function cancelPaymentSession() {
  if (nv200) await nv200.command('REJECT');
  if (nv200) await nv200.command('DISABLE');
  if (scs)   await scs.command('DISABLE');

  if (amountInserted > 0 && scs) {
    await giveChange(amountInserted); // devolver lo que se insertó
  }

  broadcast({ event: 'PAYMENT_CANCELLED', refunded: amountInserted });
  currentOrderId    = null;
  currentOrderTotal = 0;
  amountInserted    = 0;
}
