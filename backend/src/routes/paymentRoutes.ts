import { Router, Request, Response } from 'express';
import { sspService } from '../server';

const router = Router();

// POST /api/payment/start
router.post('/start', async (req: Request, res: Response) => {
  const { orderId, totalCents } = req.body;

  if (!orderId || !totalCents) {
    return res.status(400).json({ error: 'orderId y totalCents son requeridos' });
  }
  if (typeof totalCents !== 'number' || totalCents <= 0) {
    return res.status(400).json({ error: 'totalCents debe ser un número positivo' });
  }

  try {
    await sspService.startPaymentSession(orderId, totalCents);
    res.json({ ok: true, message: 'Sesión de pago iniciada', orderId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payment/cancel
router.post('/cancel', async (_req: Request, res: Response) => {
  try {
    await sspService.cancelPaymentSession();
    res.json({ ok: true, message: 'Pago cancelado' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/payment/status
router.get('/status', (_req: Request, res: Response) => {
  const status = sspService.getSessionStatus();
  res.json({ ok: true, status });
});

export default router;
