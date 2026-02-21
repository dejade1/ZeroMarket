import { WebSocketServer } from 'ws';
const SSP = require('@kybarg/ssp');

const NV200_ADDRESS = 0x00;
const SCS_ADDRESS   = 0x10;

let device: any   = null; // Una sola instancia SSP, cambiamos id por comando
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

async function sendCommand(address: number, command: string, args?: any) {
  if (!device) return;
  const prevId = device.config.id;
  device.config.id = address;
  try {
    const result = await device.command(command, args);
    return result;
  } finally {
    device.config.id = prevId;
  }
}

export function initSSP(wsServer: WebSocketServer, portName?: string) {
  wss = wsServer;
  sspPort = portName || process.env.SSP_PORT || '';
  console.log(`[SSP] Servicio SSP listo. Puerto: "${sspPort || 'no definido'}"`);
}

async function connectDevices() {
  if (devicesInitialized) return;
  devicesInitialized = true;

  if (!sspPort) {
    console.warn('[SSP] SSP_PORT no definido — modo sin hardware');
    return;
  }

  try {
    // Una sola instancia, arrancamos con id=0 (NV200)
    device = new SSP({
      id: NV200_ADDRESS,
      timeout: 3000,
      commandRetries: 3,
      pollingInterval: 300,
    });

    device.on('OPEN', async () => {
      console.log(`[SSP] Puerto ${sspPort} abierto`);

      try {
        // --- Inicializar NV200 (address 0x00) ---
        await sendCommand(NV200_ADDRESS, 'SYNC');
        await sendCommand(NV200_ADDRESS, 'HOST_PROTOCOL_VERSION', { version: 8 });
        await sendCommand(NV200_ADDRESS, 'SETUP_REQUEST');
        await sendCommand(NV200_ADDRESS, 'SET_INHIBITS', {
          channels: [true, true, true, true, false, false, false, false],
        });
        await sendCommand(NV200_ADDRESS, 'ENABLE');
        console.log('[NV200] ✅ Habilitado');
        broadcast({ device: 'NV200', event: 'READY' });
      } catch (e: any) {
        console.error('[NV200] Error init:', e?.error ?? e?.message ?? e);
      }

      try {
        // --- Inicializar SCS (address 0x10) ---
        await sendCommand(SCS_ADDRESS, 'SYNC');
        await sendCommand(SCS_ADDRESS, 'HOST_PROTOCOL_VERSION', { version: 8 });
        await sendCommand(SCS_ADDRESS, 'SETUP_REQUEST');
        await sendCommand(SCS_ADDRESS, 'ENABLE');
        console.log('[SCS] ✅ Habilitado');
        broadcast({ device: 'SCS', event: 'READY' });
      } catch (e: any) {
        console.error('[SCS] Error init:', e?.error ?? e?.message ?? e);
      }

      // Polling continuo — recibe eventos de AMBOS dispositivos
      device.config.id = NV200_ADDRESS;
      await device.poll(true);
    });

    // Eventos NV200
    device.on('NOTE_CREDIT', (info: any) => {
      const billValues: Record<number, number> = { 1: 100, 2: 500, 3: 1000, 4: 2000 };
      const value = billValues[info.channel] ?? 0;
      amountInserted += value;
      console.log(`[NV200] Billete canal ${info.channel} → $${(value/100).toFixed(2)}, total: $${(amountInserted/100).toFixed(2)}`);
      broadcast({
        device: 'NV200', event: 'NOTE_CREDIT',
        channel: info.channel,
        valueInserted: amountInserted,
        remaining: Math.max(0, currentOrderTotal - amountInserted),
      });
      checkPaymentComplete();
    });

    device.on('COIN_CREDIT', (info: any) => {
      amountInserted += info.value ?? 0;
      console.log(`[SCS] Moneda $${((info.value ?? 0)/100).toFixed(2)}, total: $${(amountInserted/100).toFixed(2)}`);
      broadcast({
        device: 'SCS', event: 'COIN_CREDIT',
        value: info.value,
        valueInserted: amountInserted,
        remaining: Math.max(0, currentOrderTotal - amountInserted),
      });
      checkPaymentComplete();
    });

    device.on('STACKED',      () => broadcast({ device: 'NV200', event: 'STACKED' }));
    device.on('REJECTED',     () => broadcast({ device: 'NV200', event: 'REJECTED' }));
    device.on('UNSAFE_JAM',   () => broadcast({ device: 'NV200', event: 'JAM' }));
    device.on('STACKER_FULL', () => broadcast({ device: 'NV200', event: 'STACKER_FULL' }));
    device.on('ERROR', (err: any) => {
      const msg = err?.message ?? String(err);
      console.error('[SSP] Error:', msg);
      broadcast({ event: 'ERROR', message: msg });
    });

    await device.open(sspPort);

  } catch (err: any) {
    console.error('[SSP] Error abriendo puerto:', err?.message ?? err);
    device = null;
    devicesInitialized = false;
  }
}

export async function startPaymentSession(orderId: string, totalCents: number) {
  currentOrderId    = orderId;
  currentOrderTotal = totalCents;
  amountInserted    = 0;

  await connectDevices();

  try {
    if (device) {
      await sendCommand(NV200_ADDRESS, 'ENABLE');
      await sendCommand(SCS_ADDRESS,   'ENABLE');
    }
  } catch (e: any) {
    console.warn('[SSP] Advertencia al re-habilitar:', e?.error ?? e?.message ?? e);
  }

  broadcast({ event: 'PAYMENT_SESSION_STARTED', orderId, totalCents });
  console.log(`[SSP] Sesión iniciada: orden ${orderId}, total: $${(totalCents/100).toFixed(2)}`);
}

async function checkPaymentComplete() {
  if (!currentOrderId) return;
  if (amountInserted < currentOrderTotal) return;

  const change = amountInserted - currentOrderTotal;
  try {
    await sendCommand(NV200_ADDRESS, 'DISABLE');
    await sendCommand(SCS_ADDRESS,   'DISABLE');
  } catch (_) {}

  broadcast({ event: 'PAYMENT_COMPLETE', orderId: currentOrderId, totalPaid: amountInserted, change });
  if (change > 0) await giveChange(change);

  currentOrderId    = null;
  currentOrderTotal = 0;
  amountInserted    = 0;
}

async function giveChange(amountCents: number) {
  try {
    await sendCommand(SCS_ADDRESS, 'PAYOUT_AMOUNT', {
      amount: amountCents,
      country: process.env.SSP_CURRENCY || 'USD',
      test: false,
    });
    broadcast({ device: 'SCS', event: 'DISPENSING_CHANGE', amount: amountCents });
  } catch (err: any) {
    console.error('[SCS] Error dispensando cambio:', err?.error ?? err?.message ?? err);
  }
}

export async function cancelPaymentSession() {
  try {
    await sendCommand(NV200_ADDRESS, 'DISABLE');
    await sendCommand(SCS_ADDRESS,   'DISABLE');
    if (amountInserted > 0) await giveChange(amountInserted);
  } catch (_) {}

  broadcast({ event: 'PAYMENT_CANCELLED', refunded: amountInserted });
  currentOrderId    = null;
  currentOrderTotal = 0;
  amountInserted    = 0;
}
