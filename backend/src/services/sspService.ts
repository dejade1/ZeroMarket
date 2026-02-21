import { WebSocketServer } from 'ws';
const SSP = require('@kybarg/ssp');

const NV200_ADDRESS = 0x00;
const SCS_ADDRESS   = 0x10;

let device: any = null;
let wss: WebSocketServer | null = null;
let currentOrderId: string | null = null;
let currentOrderTotal: number = 0;
let amountInserted: number = 0;
let sspPort: string = '';
let devicesInitialized = false;
let deviceReady = false;

function broadcast(data: object) {
  if (!wss) return;
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendCommand(address: number, command: string, args?: any): Promise<any> {
  if (!device) throw new Error('No device');
  device.config.id = address;
  await sleep(100); // esperar entre comandos en bus RS485
  return device.command(command, args);
}

export function initSSP(wsServer: WebSocketServer, portName?: string) {
  wss = wsServer;
  sspPort = portName || process.env.SSP_PORT || '';
  console.log(`[SSP] Puerto configurado: "${sspPort || 'no definido'}"`);
}

async function initNV200() {
  try {
    await sendCommand(NV200_ADDRESS, 'SYNC');          await sleep(200);
    await sendCommand(NV200_ADDRESS, 'HOST_PROTOCOL_VERSION', { version: 8 }); await sleep(200);
    await sendCommand(NV200_ADDRESS, 'SETUP_REQUEST'); await sleep(200);
    await sendCommand(NV200_ADDRESS, 'SET_INHIBITS', {
      channels: [true, true, true, true, false, false, false, false],
    });                                                await sleep(200);
    await sendCommand(NV200_ADDRESS, 'ENABLE');
    console.log('[NV200] ✅ Habilitado');
    broadcast({ device: 'NV200', event: 'READY' });
  } catch (e: any) {
    console.error('[NV200] Error init:', e?.error ?? e?.message ?? e);
  }
}

async function initSCS() {
  try {
    await sendCommand(SCS_ADDRESS, 'SYNC');          await sleep(200);
    await sendCommand(SCS_ADDRESS, 'HOST_PROTOCOL_VERSION', { version: 8 }); await sleep(200);
    await sendCommand(SCS_ADDRESS, 'SETUP_REQUEST'); await sleep(200);
    await sendCommand(SCS_ADDRESS, 'ENABLE');
    console.log('[SCS] ✅ Habilitado');
    broadcast({ device: 'SCS', event: 'READY' });
  } catch (e: any) {
    console.error('[SCS] Error init:', e?.error ?? e?.message ?? e);
  }
}

async function connectDevices() {
  if (devicesInitialized) return;
  devicesInitialized = true;

  if (!sspPort) {
    console.warn('[SSP] SSP_PORT no definido — modo sin hardware');
    return;
  }

  try {
    device = new SSP({
      id: NV200_ADDRESS,
      timeout: 3000,
      commandRetries: 3,
      pollingInterval: 500,
    });

    // Eventos de dinero
    device.on('NOTE_CREDIT', (info: any) => {
      const billValues: Record<number, number> = { 1: 100, 2: 500, 3: 1000, 4: 2000 };
      const value = billValues[info.channel] ?? 0;
      amountInserted += value;
      console.log(`[NV200] 💵 Canal ${info.channel} = $${(value/100).toFixed(2)}, insertado: $${(amountInserted/100).toFixed(2)}`);
      broadcast({
        device: 'NV200', event: 'NOTE_CREDIT',
        channel: info.channel,
        valueInserted: amountInserted,
        remaining: Math.max(0, currentOrderTotal - amountInserted),
      });
      checkPaymentComplete();
    });

    device.on('COIN_CREDIT', (info: any) => {
      const value = info.value ?? 0;
      amountInserted += value;
      console.log(`[SCS] 🪙 $${(value/100).toFixed(2)}, insertado: $${(amountInserted/100).toFixed(2)}`);
      broadcast({
        device: 'SCS', event: 'COIN_CREDIT',
        value,
        valueInserted: amountInserted,
        remaining: Math.max(0, currentOrderTotal - amountInserted),
      });
      checkPaymentComplete();
    });

    device.on('STACKED',      () => broadcast({ device: 'NV200', event: 'STACKED' }));
    device.on('REJECTED',     () => { console.log('[NV200] ❌ Billete rechazado'); broadcast({ device: 'NV200', event: 'REJECTED' }); });
    device.on('UNSAFE_JAM',   () => broadcast({ device: 'NV200', event: 'JAM' }));
    device.on('STACKER_FULL', () => broadcast({ device: 'NV200', event: 'STACKER_FULL' }));

    device.on('OPEN', async () => {
      console.log(`[SSP] ✅ Puerto ${sspPort} abierto — iniciando secuencia de init`);
      await sleep(500); // esperar estabilización del bus
      await initNV200();
      await sleep(500); // pausa entre dispositivos
      await initSCS();
      deviceReady = true;
      console.log('[SSP] ✅ Ambos dispositivos listos');
    });

    device.on('error', (err: any) => {
      console.error('[SSP] Error:', err?.message ?? err);
    });

    await device.open(sspPort);
    console.log(`[SSP] Puerto ${sspPort} abierto`);

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

  if (!devicesInitialized) {
    await connectDevices();
    // Esperar hasta que el init termine (máx 10 segundos)
    for (let i = 0; i < 20 && !deviceReady; i++) {
      await sleep(500);
    }
  }

  if (deviceReady) {
    try {
      await sendCommand(NV200_ADDRESS, 'ENABLE'); await sleep(200);
      await sendCommand(SCS_ADDRESS,   'ENABLE');
    } catch (e: any) {
      console.warn('[SSP] Advertencia re-enable:', e?.error ?? e?.message ?? e);
    }
  }

  broadcast({ event: 'PAYMENT_SESSION_STARTED', orderId, totalCents });
  console.log(`[SSP] 💳 Sesión: ${orderId} | Total: $${(totalCents/100).toFixed(2)}`);
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
  console.log(`[SSP] ✅ Pago completo. Cambio: $${(change/100).toFixed(2)}`);

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
