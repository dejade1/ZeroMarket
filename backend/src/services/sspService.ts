import { WebSocketServer } from 'ws';

const SSP = require('@kybarg/ssp');

const SCS_ADDRESS = 0x10;

let nv200: any = null;
let scs:   any = null;
let wss: WebSocketServer | null = null;
let currentOrderId: string | null = null;
let currentOrderTotal: number = 0;
let amountInserted: number = 0;
let sspPort: string = '';
let devicesInitialized = false;

function broadcast(data: object) {
  if (!wss) return;
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

export function initSSP(wsServer: WebSocketServer, portName?: string) {
  wss = wsServer;
  sspPort = portName || process.env.SSP_PORT || '';
  console.log(`[SSP] Servicio SSP listo. Puerto configurado: "${sspPort || 'no definido'}"`);
}

async function connectDevices() {
  if (devicesInitialized) return;
  devicesInitialized = true;

  if (!sspPort) {
    console.warn('[SSP] SSP_PORT no definido — modo sin hardware');
    return;
  }

  try {
    // --- NV200 Spectral (Billetes) ---
    nv200 = new SSP({ id: 0 });

    nv200.on('OPEN', async () => {
      console.log('[NV200] Puerto abierto');
      try {
        await nv200.command('SYNC');
        await nv200.command('HOST_PROTOCOL_VERSION', { version: 8 });
        await nv200.command('SETUP_REQUEST');
        await nv200.command('SET_INHIBITS', { channels: [true, true, true, true, false, false, false, false] });
        await nv200.command('ENABLE');
        console.log('[NV200] ✅ Listo');
        broadcast({ device: 'NV200', event: 'READY' });
      } catch (e: any) {
        console.error('[NV200] Error inicializando:', e.message ?? e);
      }
    });

    nv200.on('NOTE_CREDIT', (info: any) => {
      const billValues: Record<number, number> = { 1: 100, 2: 500, 3: 1000, 4: 2000 };
      const value = billValues[info.channel] ?? 0;
      amountInserted += value;
      broadcast({
        device: 'NV200', event: 'NOTE_CREDIT',
        channel: info.channel,
        valueInserted: amountInserted,
        remaining: Math.max(0, currentOrderTotal - amountInserted),
      });
      checkPaymentComplete();
    });

    nv200.on('STACKED',      () => broadcast({ device: 'NV200', event: 'STACKED' }));
    nv200.on('REJECTED',     () => broadcast({ device: 'NV200', event: 'REJECTED' }));
    nv200.on('UNSAFE_JAM',   () => broadcast({ device: 'NV200', event: 'JAM' }));
    nv200.on('STACKER_FULL', () => broadcast({ device: 'NV200', event: 'STACKER_FULL' }));
    nv200.on('ERROR', (err: any) => {
      console.error('[NV200] Error:', err?.message ?? err);
      broadcast({ device: 'NV200', event: 'ERROR', message: err?.message ?? String(err) });
    });

    await nv200.open(sspPort);
    console.log('[NV200] open() llamado en', sspPort);

    // --- SMART Coin System (Monedas) ---
    scs = new SSP({ id: SCS_ADDRESS });

    scs.on('OPEN', async () => {
      console.log('[SCS] Puerto abierto');
      try {
        await scs.command('SYNC');
        await scs.command('HOST_PROTOCOL_VERSION', { version: 8 });
        await scs.command('SETUP_REQUEST');
        await scs.command('ENABLE');
        console.log('[SCS] ✅ Listo');
        broadcast({ device: 'SCS', event: 'READY' });
      } catch (e: any) {
        console.error('[SCS] Error inicializando:', e.message ?? e);
      }
    });

    scs.on('COIN_CREDIT', (info: any) => {
      amountInserted += info.value ?? 0;
      broadcast({
        device: 'SCS', event: 'COIN_CREDIT',
        value: info.value,
        valueInserted: amountInserted,
        remaining: Math.max(0, currentOrderTotal - amountInserted),
      });
      checkPaymentComplete();
    });

    scs.on('ERROR', (err: any) => {
      console.error('[SCS] Error:', err?.message ?? err);
      broadcast({ device: 'SCS', event: 'ERROR', message: err?.message ?? String(err) });
    });

    await scs.open(sspPort);
    console.log('[SCS] open() llamado en', sspPort);

  } catch (err: any) {
    console.error('[SSP] Error abriendo dispositivos:', err?.message ?? err);
    nv200 = null;
    scs   = null;
    devicesInitialized = false; // permitir reintento en el próximo pago
  }
}

export async function startPaymentSession(orderId: string, totalCents: number) {
  currentOrderId    = orderId;
  currentOrderTotal = totalCents;
  amountInserted    = 0;

  await connectDevices();

  try {
    if (nv200) await nv200.command('ENABLE');
    if (scs)   await scs.command('ENABLE');
  } catch (e: any) {
    console.warn('[SSP] Advertencia al habilitar dispositivos:', e.message ?? e);
  }

  broadcast({ event: 'PAYMENT_SESSION_STARTED', orderId, totalCents });
  console.log(`[SSP] Sesión iniciada: orden ${orderId}, total: ${totalCents} centavos`);
}

async function checkPaymentComplete() {
  if (!currentOrderId) return;
  if (amountInserted < currentOrderTotal) return;

  const change = amountInserted - currentOrderTotal;

  try {
    if (nv200) await nv200.command('DISABLE');
    if (scs)   await scs.command('DISABLE');
  } catch (_) {}

  broadcast({
    event: 'PAYMENT_COMPLETE',
    orderId: currentOrderId,
    totalPaid: amountInserted,
    change,
  });

  if (change > 0 && scs) await giveChange(change);

  currentOrderId    = null;
  currentOrderTotal = 0;
  amountInserted    = 0;
}

async function giveChange(amountCents: number) {
  try {
    await scs.command('PAYOUT_AMOUNT', {
      amount: amountCents,
      country: process.env.SSP_CURRENCY || 'USD',
      test: false,
    });
    broadcast({ device: 'SCS', event: 'DISPENSING_CHANGE', amount: amountCents });
  } catch (err: any) {
    console.error('[SCS] Error dispensando cambio:', err?.message ?? err);
  }
}

export async function cancelPaymentSession() {
  try {
    if (nv200) await nv200.command('DISABLE');
    if (scs)   await scs.command('DISABLE');
    if (amountInserted > 0 && scs) await giveChange(amountInserted);
  } catch (_) {}

  broadcast({ event: 'PAYMENT_CANCELLED', refunded: amountInserted });
  currentOrderId    = null;
  currentOrderTotal = 0;
  amountInserted    = 0;
}
