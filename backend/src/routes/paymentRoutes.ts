import { Router } from 'express';
import { startPaymentSession, cancelPaymentSession } from '../services/sspService';

const router = Router();

// POST /api/payment/start
router.post('/start', async (req, res) => {
  const { orderId, totalCents } = req.body;
  if (!orderId || !totalCents) {
    return res.status(400).json({ error: 'orderId y totalCents son requeridos' });
  }
  try {
    await startPaymentSession(orderId, totalCents);
    res.json({ ok: true, message: 'Sesión de pago iniciada', orderId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payment/cancel
router.post('/cancel', async (_req, res) => {
  try {
    await cancelPaymentSession();
    res.json({ ok: true, message: 'Pago cancelado' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
