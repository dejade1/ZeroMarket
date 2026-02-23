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

    //Fix 3 pool independiente
// sspService.ts

        private nv200Ready = false;
        private scsReady   = false;
        private pollTimer: NodeJS.Timeout | null = null;

        async initSSP(): Promise<void> {
        logger.info('[SSP] Inicializando hardware...');

        // ── 1. NV200 (crítico — debe funcionar) ──────────────────────────
        await this.nv200.init();
        this.nv200Ready = true;
        logger.info('[SSP] NV200 listo');

        // ── 2. Arrancar polling de NV200 AHORA, antes de intentar SCS ────
        this.startPollLoop();

        // ── 3. Delay RS485: dar tiempo al bus antes de hablar con SCS ─────
        await sleep(300); // 300ms es suficiente para asentamiento del bus

        // ── 4. SCS (opcional — si falla, monedas deshabilitadas) ──────────
        try {
            await this.scs.init();
            this.scsReady = true;
            logger.info('[SSP] SCS listo — monedas habilitadas');
        } catch (err) {
            logger.warn('[SSP] SCS no disponible (monedas deshabilitadas):', err);
            // NV200 sigue funcionando con polling activo
        }
        }

        // ── Loop de polling interleaved NV200 + SCS ───────────────────────
        private startPollLoop(): void {
        if (this.pollTimer) return;

        const POLL_INTERVAL = 200; // ms por ciclo completo

        const tick = async () => {
            if (!this.pollRunning) return;

            const t0 = Date.now();

            // Siempre poll NV200
            try {
            await this.nv200.poll();
            } catch (e) {
            logger.warn('[SSP] NV200 poll error:', e);
            }

            // Poll SCS solo si está listo
            if (this.scsReady) {
            await sleep(20); // pequeña pausa entre dispositivos en RS485
            try {
                await this.scs.poll();
            } catch (e) {
                logger.warn('[SSP] SCS poll error:', e);
                // No marcar scsReady=false todavía — puede ser timeout puntual
            }
            }

            const elapsed = Date.now() - t0;
            const wait = Math.max(0, POLL_INTERVAL - elapsed);
            this.pollTimer = setTimeout(tick, wait);
        };

        this.pollRunning = true;
        this.pollTimer = setTimeout(tick, 0);
        logger.info('[SSP] Poll loop iniciado');
        }

        stopPollLoop(): void {
        this.pollRunning = false;
        if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
        }



    // 3. Escuchar eventos de crédito
    // En initSSP() o setupEventListeners():

this.nv200.on('NOTE_CREDIT', ({ amount, channel, currency }) => {
  this.session.totalInserted += amount;
  const remaining = Math.max(0, this.session.total - this.session.totalInserted);

  logger.info(`[SSP] 💵 Billete acreditado: $${amount/100} | Inserido: $${this.session.totalInserted/100}`);

  this.broadcast({
    type: 'BILL_CREDIT',
    amount,
    channel,
    currency,
    totalInserted: this.session.totalInserted,
    remaining,
    orderId: this.session.orderId
  });

  if (this.session.totalInserted >= this.session.total) {
    this.broadcast({ type: 'PAYMENT_COMPLETE', orderId: this.session.orderId });
  }
});

this.nv200.on('NOTE_REJECTED', () => {
  this.broadcast({ type: 'BILL_REJECTED' });
});

// SCS — monedas
this.scs.on('COIN_CREDIT', ({ amount, channel }) => {
  this.session.totalInserted += amount;
  const remaining = Math.max(0, this.session.total - this.session.totalInserted);

  this.broadcast({
    type: 'COIN_CREDIT',
    amount,
    channel,
    totalInserted: this.session.totalInserted,
    remaining,
    orderId: this.session.orderId
  });

  if (this.session.totalInserted >= this.session.total) {
    this.broadcast({ type: 'PAYMENT_COMPLETE', orderId: this.session.orderId });
  }
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
