// backend/src/services/sspService.ts
// Orquestador NV200 + SCS — bus RS485 compartido COM7
// Expone: initSSP, startPaymentSession, cancelPaymentSession, stopSSP

import { WebSocketServer } from 'ws';
import { SSPBus } from '../ssp/ssp-bus';
import { NV200  } from '../ssp/nv200';
import { SCS    } from '../ssp/scs';

// ── Estado del módulo ─────────────────────────────────────────────────────────

let bus:    SSPBus | null = null;
let nv200:  NV200  | null = null;
let scs:    SCS    | null = null;
let wss:    WebSocketServer | null = null;

let sspPort:      string = '';
let currencyCode: string = 'USD';

let currentOrderId:    string | null = null;
let currentOrderTotal: number  = 0;
let amountInserted:    number  = 0;

let initialized:  boolean = false;
let initializing: boolean = false;
let pollRunning:  boolean = false;
let pollTimer:    NodeJS.Timeout | null = null;

const POLL_INTERVAL_MS = 200; // ms entre ciclos NV200 + SCS
const POLL_DEVICE_GAP  =  20; // ms entre NV200 poll y SCS poll en el mismo ciclo

// ── Broadcast a todos los clientes WS conectados ─────────────────────────────

function broadcast(data: object) {
  if (!wss) return;
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

// ── Utilidades ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── initSSP — llamado una vez al arrancar el servidor ────────────────────────

export function initSSP(wsServer: WebSocketServer, portName?: string) {
  wss          = wsServer;
  sspPort      = portName || process.env.SSP_PORT     || '';
  currencyCode = process.env.SSP_CURRENCY || 'USD';
  console.log(`[SSP] Puerto configurado: "${sspPort || 'no definido'}" | Moneda: ${currencyCode}`);
}

// ── Conexión al hardware — lazy, solo cuando llega el primer pago ─────────────

async function connectHardware(): Promise<boolean> {
  if (initialized) return true;

  // Si ya hay un init en curso, esperar hasta 15s
  if (initializing) {
    for (let i = 0; i < 30 && !initialized; i++) await sleep(500);
    return initialized;
  }

  if (!sspPort) {
    console.warn('[SSP] SSP_PORT no definido — modo sin hardware');
    return false;
  }

  initializing = true;

  try {
    // ── 1. Abrir bus serial compartido ────────────────────────────────
    bus = new SSPBus(sspPort);
    await bus.open();

    // ── 2. Crear drivers ──────────────────────────────────────────────
    nv200 = new NV200(bus);
    scs   = new SCS(bus, currencyCode);

    // ── 3. Registrar listeners ANTES del init para no perder eventos ──
    registerEventListeners();

    // ── 4. Init NV200 (crítico — si falla, abortamos) ─────────────────
    await nv200.init();
    console.log('[SSP] NV200 listo');

    // ── 5. Arrancar poll loop AHORA — NV200 ya está ENABLED ───────────
    //    Crítico: sin polling el NV200 devuelve el billete por watchdog
    startPollLoop();

    // ── 6. Delay RS485 antes de hablar con SCS ────────────────────────
    //    Permite que el bus se asiente después del ENABLE del NV200
    await sleep(300);

    // ── 7. Init SCS (opcional — si falla, monedas deshabilitadas) ──────
    try {
      await scs.init();
      console.log('[SSP] SCS listo — monedas habilitadas');
    } catch (err: any) {
      console.warn('[SSP] SCS no disponible (monedas deshabilitadas):', err.message);
      // El poll loop sigue corriendo para NV200
    }

    // ── 8. Escuchar errores de bus ────────────────────────────────────
    bus.on('error', (err: Error) => {
      console.error('[SSP] Error de bus:', err.message);
      broadcast({ event: 'BUS_ERROR', message: err.message });
    });

    initialized  = true;
    initializing = false;

    console.log('[SSP] ✅ Hardware listo');
    broadcast({ event: 'HARDWARE_READY' });
    return true;

  } catch (err: any) {
    console.error('[SSP] Error inicializando hardware:', err.message ?? err);
    broadcast({ event: 'HARDWARE_ERROR', message: err.message ?? String(err) });
    await cleanupHardware();
    return false;
  }
}

// ── Poll loop interleaved NV200 + SCS ─────────────────────────────────────────
// Un único loop secuencial: primero NV200, pausa, luego SCS.
// Así nunca hay dos comandos en el bus RS485 al mismo tiempo.

function startPollLoop(): void {
  if (pollRunning) return;
  pollRunning = true;

  const tick = async () => {
    if (!pollRunning) return;

    const t0 = Date.now();

    // Poll NV200 siempre
    if (nv200?.isReady) {
      try {
        await nv200.poll();
      } catch (e: any) {
        console.warn('[SSP] NV200 poll error:', e.message);
      }
    }

    // Pequeña pausa entre dispositivos en el mismo bus RS485
    if (scs?.isReady) {
      await sleep(POLL_DEVICE_GAP);
      try {
        await scs.poll();
      } catch (e: any) {
        // No deshabilitar SCS por un timeout puntual — puede ser transitorio
        console.warn('[SSP] SCS poll error:', e.message);
      }
    }

    const elapsed = Date.now() - t0;
    const wait    = Math.max(0, POLL_INTERVAL_MS - elapsed);
    pollTimer     = setTimeout(tick, wait);
  };

  pollTimer = setTimeout(tick, 0);
  console.log('[SSP] Poll loop iniciado');
}

function stopPollLoop(): void {
  pollRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

// ── Registro de listeners de eventos de los drivers ──────────────────────────

function registerEventListeners(): void {
  if (!nv200 || !scs) return;

  // ── NV200: billete en camino al stacker (todavía no es crédito) ───
  nv200.on('NOTE_READ', ({ channel, amount }: { channel: number; amount: number }) => {
    console.log(`[SSP] Billete detectado: canal=${channel} $${(amount / 100).toFixed(2)}`);
    broadcast({
      event:   'BILL_READ',
      channel,
      amount,
      orderId: currentOrderId,
    });
  });

  // ── NV200: billete en el stacker = CRÉDITO REAL ───────────────────
  nv200.on('NOTE_CREDIT', ({ channel, amount, currency }: {
    channel:  number;
    amount:   number;
    currency: string;
  }) => {
    amountInserted += amount;
    const remaining = Math.max(0, currentOrderTotal - amountInserted);
    console.log(
      `[SSP] Billete acreditado: $${(amount / 100).toFixed(2)} | ` +
      `Total insertado: $${(amountInserted / 100).toFixed(2)}`
    );
    broadcast({
      event:         'BILL_CREDIT',
      channel,
      amount,
      currency,
      amountInserted,
      remaining,
      orderId:       currentOrderId,
    });
    checkPaymentComplete();
  });

  // ── NV200: billete rechazado ──────────────────────────────────────
  nv200.on('NOTE_REJECTED', () => {
    console.warn('[SSP] Billete rechazado');
    broadcast({ event: 'BILL_REJECTED', device: 'NV200' });
  });

  // ── NV200: eventos de estado ──────────────────────────────────────
  nv200.on('jam',            (type: string) => broadcast({ event: 'JAM',            device: 'NV200', type }));
  nv200.on('stackerFull',    ()             => broadcast({ event: 'STACKER_FULL',   device: 'NV200' }));
  nv200.on('fraud',          ()             => broadcast({ event: 'FRAUD',          device: 'NV200' }));
  nv200.on('cashboxRemoved', ()             => broadcast({ event: 'CASHBOX_REMOVED',device: 'NV200' }));

  // ── NV200: reset inesperado — marcar para re-init ─────────────────
  nv200.on('reset', () => {
    console.warn('[SSP] NV200 reset inesperado');
    initialized  = false;
    initializing = false;
    broadcast({ event: 'HARDWARE_RESET', device: 'NV200' });
  });

  // ── SCS: moneda aceptada = CRÉDITO REAL ───────────────────────────
  scs.on('COIN_CREDIT', ({ amount, country }: { amount: number; country: string }) => {
    amountInserted += amount;
    const remaining = Math.max(0, currentOrderTotal - amountInserted);
    console.log(
      `[SSP] Moneda acreditada: $${(amount / 100).toFixed(2)} (${country}) | ` +
      `Total insertado: $${(amountInserted / 100).toFixed(2)}`
    );
    broadcast({
      event:         'COIN_CREDIT',
      amount,
      country,
      amountInserted,
      remaining,
      orderId:       currentOrderId,
    });
    checkPaymentComplete();
  });

  // ── SCS: moneda rechazada ─────────────────────────────────────────
  scs.on('COIN_REJECTED', () => {
    console.warn('[SSP] Moneda rechazada');
    broadcast({ event: 'COIN_REJECTED', device: 'SCS' });
  });

  // ── SCS: dispensando cambio ───────────────────────────────────────
  scs.on('dispensing', ({ amount, country }: { amount: number; country: string }) => {
    broadcast({ event: 'CHANGE_DISPENSING', amount, country });
  });

  scs.on('dispensed', ({ amount, country }: { amount: number; country: string }) => {
    console.log(`[SSP] Cambio dispensado: $${(amount / 100).toFixed(2)} (${country})`);
    broadcast({ event: 'CHANGE_DISPENSED', amount, country });
  });

  // ── SCS: eventos de estado ────────────────────────────────────────
  scs.on('jammed',    () => broadcast({ event: 'JAM',       device: 'SCS' }));
  scs.on('coinsLow',  () => broadcast({ event: 'COINS_LOW', device: 'SCS' }));
  scs.on('deviceFull',() => broadcast({ event: 'DEVICE_FULL',device: 'SCS' }));
  scs.on('fraud',     () => broadcast({ event: 'FRAUD',     device: 'SCS' }));

  scs.on('incompletePayout', ({ paid, request, country }: {
    paid: number; request: number; country: string;
  }) => {
    console.warn(`[SSP] Payout incompleto: pagado ${paid}¢ de ${request}¢`);
    broadcast({ event: 'INCOMPLETE_PAYOUT', device: 'SCS', paid, request, country });
  });

  // ── SCS: reset inesperado ─────────────────────────────────────────
  scs.on('reset', () => {
    console.warn('[SSP] SCS reset inesperado');
    broadcast({ event: 'HARDWARE_RESET', device: 'SCS' });
  });
}

// ── Iniciar sesión de pago ────────────────────────────────────────────────────

export async function startPaymentSession(
  orderId:    string,
  totalCents: number
): Promise<void> {
  currentOrderId    = orderId;
  currentOrderTotal = totalCents;
  amountInserted    = 0;

  const hwReady = await connectHardware();

  if (hwReady) {
    // Re-habilitar por si quedaron deshabilitados de una sesión anterior
    try { await nv200?.enable(); } catch (e: any) {
      console.warn('[SSP] NV200 enable warning:', e.message);
    }
    try { await scs?.enable();   } catch (e: any) {
      console.warn('[SSP] SCS enable warning:', e.message);
    }
  }

  broadcast({
    event:      'PAYMENT_SESSION_STARTED',
    orderId,
    totalCents,
    hwReady,
  });
  console.log(`[SSP] Sesión iniciada: ${orderId} | Total: $${(totalCents / 100).toFixed(2)}`);
}

// ── Cancelar sesión de pago ───────────────────────────────────────────────────

export async function cancelPaymentSession(): Promise<void> {
  try { await nv200?.disable(); } catch (_) {}
  try { await scs?.disable();   } catch (_) {}

  // Devolver lo insertado si hay cambio pendiente
  if (amountInserted > 0 && scs?.isReady) {
    try {
      await scs.payoutAmount(amountInserted);
    } catch (e: any) {
      console.error('[SSP] Error devolviendo monto cancelado:', e.message);
    }
  }

  broadcast({
    event:    'PAYMENT_CANCELLED',
    refunded: amountInserted,
  });
    console.log(`[SSP] Sesión cancelada. Devuelto: $${(amountInserted / 100).toFixed(2)}`);

  currentOrderId    = null;
  currentOrderTotal = 0;
  amountInserted    = 0;
}

// ── Verificar si el pago está completo ───────────────────────────────────────

async function checkPaymentComplete(): Promise<void> {
  if (!currentOrderId)                    return;
  if (amountInserted < currentOrderTotal) return;

  const change = amountInserted - currentOrderTotal;

  // Deshabilitar aceptación inmediatamente para no recibir más dinero
  try { await nv200?.disable(); } catch (_) {}
  try { await scs?.disable();   } catch (_) {}

  broadcast({
    event:     'PAYMENT_COMPLETE',
    orderId:   currentOrderId,
    totalPaid: amountInserted,
    change,
  });
  console.log(
    `[SSP] Pago completo. ` +
    `Pagado: $${(amountInserted / 100).toFixed(2)} | ` +
    `Cambio: $${(change / 100).toFixed(2)}`
  );

  // Dispensar cambio si corresponde
  if (change > 0 && scs?.isReady) {
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

// ── Cierre limpio del servidor ────────────────────────────────────────────────

export async function stopSSP(): Promise<void> {
  stopPollLoop();
  try { await nv200?.disable(); } catch (_) {}
  try { await scs?.disable();   } catch (_) {}
  await cleanupHardware();
  console.log('[SSP] Servicio detenido');
}

// ── Limpieza interna de recursos ──────────────────────────────────────────────

async function cleanupHardware(): Promise<void> {
  stopPollLoop();
  try { await bus?.close(); } catch (_) {}
  bus          = null;
  nv200        = null;
  scs          = null;
  initialized  = false;
  initializing = false;
}