/**
 * cash.service.ts
 * Puente entre Node.js y payment_service.py
 *
 * - Levanta payment_service.py como proceso hijo
 * - Parsea eventos JSON de stdout
 * - Broadcastea al WebSocket de CashPayment.tsx
 * - Expone start() y cancel() que llaman al HTTP del proceso Python
 */

import { ChildProcess, spawn } from 'child_process';
import { createInterface }     from 'readline';
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server }    from 'http';
import fetch from 'node-fetch';   // ya viene con Node 18+; si Node 16 agregar node-fetch

const PYTHON_HTTP = 'http://127.0.0.1:5001';
const COM_PORT    = process.env.CASH_COM_PORT || 'COM7';

// ── Tipos de evento que espera CashPayment.tsx ────────────────────────────
export type CashEvent =
  | { event: 'HARDWARE_READY' }
  | { event: 'PAYMENT_STARTED';   totalCents: number; orderId: string }
  | { event: 'NOTE_CREDIT';       valueInserted: number; remaining: number; noteValue: number }
  | { event: 'COIN_CREDIT';       valueInserted: number; remaining: number; coinValue: number }
  | { event: 'PAYMENT_COMPLETE';  change: number; dispensed_ok?: boolean; warning?: string }
  | { event: 'PAYMENT_CANCELLED' }
  | { event: 'JAM';               message: string }
  | { event: 'ERROR';             message: string };

// ── Estado global ─────────────────────────────────────────────────────────
let pyProc: ChildProcess | null = null;
let wss: WebSocketServer | null = null;

/** Inicia el proceso Python y el WebSocket Server */
export function initCashService(httpServer: Server): void {
  // 1. WebSocket en la misma instancia de HTTP (ruta /ws)
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    console.log('[CASH] WS client connected');
    ws.on('close', () => console.log('[CASH] WS client disconnected'));
  });

  // 2. Proceso Python
  pyProc = spawn('python', ['payment_service.py', COM_PORT], {
    cwd:   process.cwd(),         // raíz del repo donde está payment_service.py
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Leer eventos JSON línea a línea desde stdout del proceso
  const rl = createInterface({ input: pyProc.stdout! });
  rl.on('line', (line: string) => {
    try {
      const ev: CashEvent = JSON.parse(line);
      broadcast(ev);
      // Log para trazabilidad en el servidor Node
      console.log('[CASH EVENT]', JSON.stringify(ev));
    } catch {
      // línea no-JSON (debug prints del proceso Python)
      console.log('[CASH PY]', line);
    }
  });

  pyProc.stderr!.on('data', (d: Buffer) => {
    console.error('[CASH PY ERR]', d.toString().trim());
  });

  pyProc.on('exit', (code) => {
    console.warn(`[CASH] payment_service.py exited with code ${code}`);
    broadcast({ event: 'ERROR', message: `Proceso de cobro terminó (código ${code})` });
    pyProc = null;
  });

  console.log(`[CASH] payment_service.py iniciado (COM: ${COM_PORT})`);
}

/** Broadcastea un evento JSON a todos los clientes WS */
function broadcast(ev: CashEvent): void {
  if (!wss) return;
  const msg = JSON.stringify(ev);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

/** POST /api/payment/start */
export async function startPayment(
  totalCents: number,
  orderId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res  = await fetch(`${PYTHON_HTTP}/payment/start`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ totalCents, orderId }),
    });
    return await res.json() as { ok: boolean; error?: string };
  } catch (e: any) {
    return { ok: false, error: `payment_service no disponible: ${e.message}` };
  }
}

/** POST /api/payment/cancel */
export async function cancelPayment(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res  = await fetch(`${PYTHON_HTTP}/payment/cancel`, { method: 'POST' });
    return await res.json() as { ok: boolean; error?: string };
  } catch (e: any) {
    return { ok: false, error: `payment_service no disponible: ${e.message}` };
  }
}

/** GET /api/payment/status */
export async function paymentStatus(): Promise<object> {
  try {
    const res = await fetch(`${PYTHON_HTTP}/payment/status`);
    return await res.json() as object;
  } catch {
    return { status: 'unavailable' };
  }
}

/** Mata el proceso Python al apagar el servidor */
export function shutdownCashService(): void {
  if (pyProc) { pyProc.kill(); pyProc = null; }
  if (wss)    { wss.close();   wss    = null; }
}
