const SSP = require('@kybarg/ssp');
import { WebSocketServer } from 'ws';

const SCS_ADDRESS = 0x10;

let nv200: any = null;
let scs: any   = null;
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

function connectDevices() {
  if (devicesInitialized) return;

  if (!sspPort) {
    console.warn('[SSP] SSP_PORT no definido — modo sin hardware');
    devicesInitialized = true;
    return;
  }

  try {
    // --- NV200 Spectral (Billetes) ---
    nv200 = new SSP({ port: sspPort, type: 'NV200' });

    nv200.on('OPEN', async () => {
      console.log('[NV200] Puerto abierto');
      try {
        await nv200.command('SYNC');
        await nv200.command('HOST_PROTOCOL_VERSION', { version: 8 });
        await nv200.command('SETUP_REQUEST');
        await nv200.command('SET_INHIBITS', { channels: [true, true, true, true, false, false, false, false] });
        await nv200.command('ENABLE');
        console.log('[NV200] Listo');
        broadcast({ device: 'NV200', event: 'READY' });
      } catch (e: any) {
        console.error('[NV200] Error inicializando:', e.message);
      }
    });

    nv200.on('READ', ({ channel }: { channel: number }) => {
      broadcast({ device: 'NV200', event: 'READ', channel });
    });

    nv200.on('NOTE_CREDIT', ({ channel }: { channel: number }) => {
      const billValues: Record<number, number> = { 1: 100, 2: 500, 3: 1000, 4: 2000 };
      const value = billValues[channel] ?? 0;
      amountInserted += value;
      broadcast({
        device: 'NV200', event: 'NOTE_CREDIT', channel,
        valueInserted: amountInserted,
        remaining: Math.max(0, currentOrderTotal - amountInserted),
      });
      checkPaymentComplete();
    });

    nv200.on('STACKED',      () => broadcast({ device: 'NV200', event: 'STACKED' }));
    nv200.on('REJECTED',     () => broadcast({ device: 'NV200', event: 'REJECTED' }));
    nv200.on('UNSAFE_JAM',   () => broadcast({ device: 'NV200', event: 'JAM' }));
    nv200.on('STACKER_FULL', () => broadcast({ device: 'NV200', event: 'STACKER_FULL' }));
    nv200.on('DISABLED',     () => nv200.command('ENABLE').catch(() => {}));
    nv200.on('error', (err: Error) => {
      console.error('[NV200] Error:', err.message);
      broadcast({ device: 'NV200', event: 'ERROR', message: err.message });
    });

    nv200.open();

    // --- SMART Coin System (Monedas) ---
    scs   = new SSP({ port: sspPort, type: 'SMART_HOPPER', id: SCS_ADDRESS });

    scs.on('OPEN', async () => {
      console.log('[SCS] Puerto abierto');
      try {
        await scs.command('SYNC');
        await scs.command('HOST_PROTOCOL_VERSION', { version: 8 });
        await scs.command('SETUP_REQUEST');
        await scs.command('ENABLE');
        await scs.command('ENABLE_COIN_MECH', { enable: true });
        console.log('[SCS] Listo');
        broadcast({ device: 'SCS', event: 'READY' });
      } catch (e: any) {
        console.error('[SCS] Error inicializando:', e.message);
      }
    });

    scs.on('COIN_CREDIT', ({ value, country }: { value: number; country: string }) => {
      amountInserted += value;
      broadcast({
        device: 'SCS', event: 'COIN_CREDIT', value, country,
        valueInserted: amountInserted,
        remaining: Math.max(0, currentOrderTotal - amountInserted),
      });
      checkPaymentComplete();
    });

    scs.on('DISPENSED', ({ value }: { value: number }) => {
      broadcast({ device: 'SCS', event: 'DISPENSED', value });
    });
    scs.on('DISABLED', () => scs.command('ENABLE').catch(() => {}));
    scs.on('error', (err: Error) => {
      console.error('[SCS] Error:', err.message);
      broadcast({ device: 'SCS', event: 'ERROR', message: err.message });
    });

    scs.open();
    devicesInitialized = true;
    console.log('[SSP] Dispositivos inicializados en', sspPort);

  } catch (err: any) {
    console.error('[SSP] No se pudo abrir puerto serial:', err.message);
    // No hacer crash — el servidor sigue corriendo sin hardware
    nv200 = null;
    scs   = null;
    devicesInitialized = true; // evitar reintentos infinitos
  }
}

export async function startPaymentSession(orderId: string, totalCents: number) {
  try {
    connectDevices();
    currentOrderId    = orderId;
    currentOrderTotal = totalCents;
    amountInserted    = 0;

    if (nv200) await nv200.command('ENABLE').catch(() => {});
    if (scs)   await scs.command('ENABLE').catch(() => {});
    if (scs)   await scs.command('ENABLE_COIN_MECH', { enable: true }).catch(() => {});

    broadcast({ event: 'PAYMENT_SESSION_STARTED', orderId, totalCents });
    console.log(`[SSP] Sesión iniciada: orden ${orderId}, total: ${totalCents} centavos`);
  } catch (err: any) {
    console.error('[SSP] Error en startPaymentSession:', err.message);
    throw err;
  }
}

async function checkPaymentComplete() {
  if (!currentOrderId) return;
  if (amountInserted >= currentOrderTotal) {
    const change = amountInserted - currentOrderTotal;

    if (nv200) await nv200.command('DISABLE').catch(() => {});
    if (scs)   await scs.command('DISABLE').catch(() => {});

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
    console.error('[SCS] Error dispensando cambio:', err.message);
  }
}

export async function cancelPaymentSession() {
  try {
    if (nv200) await nv200.command('REJECT').catch(() => {});
    if (nv200) await nv200.command('DISABLE').catch(() => {});
    if (scs)   await scs.command('DISABLE').catch(() => {});
    if (amountInserted > 0 && scs) await giveChange(amountInserted);
  } catch (_) {}

  broadcast({ event: 'PAYMENT_CANCELLED', refunded: amountInserted });
  currentOrderId    = null;
  currentOrderTotal = 0;
  amountInserted    = 0;
}
