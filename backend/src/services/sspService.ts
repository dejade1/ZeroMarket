import { WebSocketServer } from 'ws';
import { SSPBus }  from '../ssp/ssp-bus';
import { NV200 }   from '../ssp/nv200';
import { SCS }     from '../ssp/scs';

// ── Estado global ────────────────────────────────────────────────────────────
let bus:    SSPBus | null = null;
let nv200:  NV200  | null = null;
let scs:    SCS    | null = null;
let wss:    WebSocketServer | null = null;

let sspPort:      string = '';
let currencyCode: string = 'USD';

let currentOrderId:    string | null = null;
let currentOrderTotal: number = 0;
let amountInserted:    number = 0;

let initialized:  boolean = false;
let initializing: boolean = false;

// ── Broadcast a todos los clientes WS conectados ─────────────────────────────
function broadcast(data: object) {
  if (!wss) return;
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

// ── Init del servicio — llamado una vez al arrancar el servidor ──────────────
export function initSSP(wsServer: WebSocketServer, portName?: string) {
  wss          = wsServer;
  sspPort      = portName || process.env.SSP_PORT      || '';
  currencyCode = process.env.SSP_CURRENCY || 'USD';
  console.log(`[SSP] Puerto configurado: "${sspPort || 'no definido'}" | Moneda: ${currencyCode}`);
}

// ── Conexión al hardware — lazy, solo cuando llega el primer pago ────────────
async function connectHardware(): Promise<boolean> {
  if (initialized)  return true;
  if (initializing) {
    // Esperar a que termine el init en curso (máx 15s)
    for (let i = 0; i < 30 && !initialized; i++) {
      await sleep(500);
    }
    return initialized;
  }

  if (!sspPort) {
    console.warn('[SSP] SSP_PORT no definido — modo sin hardware');
    return false;
  }

  initializing = true;

  try {
    // 1. Abrir bus serial compartido
    bus = new SSPBus(sspPort);
    await bus.open();

    // 2. Crear drivers
    const currency = currencyCode;
    nv200 = new NV200(bus);
    scs   = new SCS(bus, currency);

    // 3. Escuchar eventos de crédito
    nv200.on('credit', (_channel: number, valueCents: number) => {
      amountInserted += valueCents;
      console.log(`[SSP] 💵 Billete: +${valueCents}¢ | Total: ${amountInserted}¢ / ${currentOrderTotal}¢`);
      broadcast({
        event:          'CREDIT',
        device:         'NV200',
        valueCents,
        amountInserted,
        remaining:      Math.max(0, currentOrderTotal - amountInserted),
      });
      checkPaymentComplete();
    });

    scs.on('valueAdded', (valueCents: number, country: string) => {
      amountInserted += valueCents;
      console.log(`[SSP] 🪙 Moneda: +${valueCents}¢ (${country}) | Total: ${amountInserted}¢ / ${currentOrderTotal}¢`);
      broadcast({
        event:          'CREDIT',
        device:         'SCS',
        valueCents,
        amountInserted,
        remaining:      Math.max(0, currentOrderTotal - amountInserted),
      });
      checkPaymentComplete();
    });

    // 4. Escuchar eventos de error/estado
    nv200.on('jam',          (type: string) => broadcast({ event: 'JAM',          device: 'NV200', type }));
    nv200.on('rejected',     ()             => broadcast({ event: 'REJECTED',     device: 'NV200' }));
    nv200.on('stackerFull',  ()             => broadcast({ event: 'STACKER_FULL', device: 'NV200' }));
    nv200.on('fraud',        ()             => broadcast({ event: 'FRAUD',        device: 'NV200' }));
    nv200.on('cashboxRemoved', ()           => broadcast({ event: 'CASHBOX_REMOVED', device: 'NV200' }));

    scs.on('jammed',         ()             => broadcast({ event: 'JAM',          device: 'SCS' }));
    scs.on('coinsLow',       ()             => broadcast({ event: 'COINS_LOW',    device: 'SCS' }));
    scs.on('rejected',       ()             => broadcast({ event: 'REJECTED',     device: 'SCS' }));
    scs.on('incompletePayout', (paid: number, request: number) =>
      broadcast({ event: 'INCOMPLETE_PAYOUT', device: 'SCS', paid, request })
    );

    // Reset inesperado — reinit automático ya está dentro de cada driver
    nv200.on('reset', () => { initialized = false; initializing = false; });
    scs.on('reset',   () => { initialized = false; initializing = false; });

    bus.on('error', (err: Error) => {
      console.error('[SSP] Error de bus:', err.message);
      broadcast({ event: 'BUS_ERROR', message: err.message });
    });

    // 5. Inicializar NV200 primero, luego SCS (secuencial en bus RS485)
    await nv200.init();
    await scs.init();

    // 6. Arrancar polling automático
    bus.startPolling();

    initialized  = true;
    initializing = false;

    console.log('[SSP] ✅ Hardware listo — NV200 + SCS inicializados');
    broadcast({ event: 'HARDWARE_READY' });
    return true;

  } catch (err: any) {
    console.error('[SSP] Error inicializando hardware:', err.message ?? err);
    broadcast({ event: 'HARDWARE_ERROR', message: err.message ?? String(err) });

    // Limpiar para permitir reintento
    try { bus?.stopPolling(); await bus?.close(); } catch (_) {}
    bus   = null;
    nv200 = null;
    scs   = null;
    initialized  = false;
    initializing = false;
    return false;
  }
}

// ── Iniciar sesión de pago ────────────────────────────────────────────────────
export async function startPaymentSession(orderId: string, totalCents: number) {
  currentOrderId    = orderId;
  currentOrderTotal = totalCents;
  amountInserted    = 0;

  const hwReady = await connectHardware();

  if (hwReady) {
    try {
      // Re-habilitar ambos dispositivos por si quedaron deshabilitados
      await nv200?.enable();
      await scs?.enable();
    } catch (e: any) {
      console.warn('[SSP] Advertencia al re-habilitar:', e.message);
    }
  }

  broadcast({
    event:      'PAYMENT_SESSION_STARTED',
    orderId,
    totalCents,
    hwReady,
  });
  console.log(`[SSP] 💳 Sesión iniciada: ${orderId} | Total: $${(totalCents / 100).toFixed(2)}`);
}

// ── Cancelar sesión de pago ───────────────────────────────────────────────────
export async function cancelPaymentSession() {
  try {
    await nv200?.disable();
    await scs?.disable();

    // Devolver lo insertado si hay cambio pendiente
    if (amountInserted > 0 && scs) {
      await scs.payoutAmount(amountInserted);
    }
  } catch (e: any) {
    console.warn('[SSP] Error al cancelar sesión:', e.message);
  }

  broadcast({ event: 'PAYMENT_CANCELLED', refunded: amountInserted });
  console.log(`[SSP] ❌ Sesión cancelada. Devuelto: ${amountInserted}¢`);

  currentOrderId    = null;
  currentOrderTotal = 0;
  amountInserted    = 0;
}

// ── Cierre limpio del servidor ────────────────────────────────────────────────
export async function stopSSP() {
  try {
    bus?.stopPolling();
    await nv200?.disable();
    await scs?.disable();
    await bus?.close();
  } catch (_) {}

  bus   = null;
  nv200 = null;
  scs   = null;
  initialized  = false;
  initializing = false;
  console.log('[SSP] Servicio detenido');
}

// ── Verificar si el pago está completo ───────────────────────────────────────
async function checkPaymentComplete() {
  if (!currentOrderId)                       return;
  if (amountInserted < currentOrderTotal)    return;

  const change = amountInserted - currentOrderTotal;

  // Deshabilitar aceptación inmediatamente
  try {
    await nv200?.disable();
    await scs?.disable();
  } catch (_) {}

  broadcast({
    event:      'PAYMENT_COMPLETE',
    orderId:    currentOrderId,
    totalPaid:  amountInserted,
    change,
  });
  console.log(`[SSP] ✅ Pago completo. Pagado: ${amountInserted}¢ | Cambio: ${change}¢`);

  // Dispensar cambio si corresponde
  if (change > 0 && scs) {
    try {
      await scs.payoutAmount(change);
    } catch (e: any) {
      console.error('[SSP] Error dispensando cambio:', e.message);
      broadcast({ event: 'CHANGE_ERROR', message: e.message, change });
    }
  }

  currentOrderId    = null;
  currentOrderTotal = 0;
  amountInserted    = 0;
}

// ── Utilidades ────────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
