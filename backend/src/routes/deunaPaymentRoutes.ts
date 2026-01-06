import { Router, Request, Response } from 'express';
import { createDeunaQR, checkDeunaPaymentStatus, handleDeunaWebhook } from '../services/deunaPayment.service';

const router = Router();

console.log('💳 DeUna payment routes loaded');

/**
 * POST /api/payments/deuna/create-qr
 * Crear código QR para pago DeUna
 */
router.post('/create-qr', async (req: Request, res: Response) => {
  try {
    const { amount, orderId, description, webhookUrl } = req.body;

    if (!amount || !orderId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Faltan parámetros requeridos' 
      });
    }

    console.log(`[💳 DEUNA] Creando QR para orden ${orderId}, monto: $${amount}`);

    const qrData = await createDeunaQR({
      amount,
      orderId,
      description: description || `Orden #${orderId}`,
      webhookUrl: webhookUrl || `${process.env.API_URL}/api/payments/deuna/webhook`
    });

    res.json({
      success: true,
      ...qrData
    });

  } catch (error: any) {
    console.error('[❌ DEUNA] Error creando QR:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Error al crear código QR' 
    });
  }
});

/**
 * GET /api/payments/deuna/status/:transactionId
 * Verificar estado de pago DeUna
 */
router.get('/status/:transactionId', async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.params;

    const status = await checkDeunaPaymentStatus(transactionId);

    res.json({
      success: true,
      status: status.status,
      transactionId,
      ...status
    });

  } catch (error: any) {
    console.error('[❌ DEUNA] Error verificando estado:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error al verificar estado del pago' 
    });
  }
});

/**
 * POST /api/payments/deuna/webhook
 * Webhook para notificaciones de DeUna
 * 
 * DeUna enviará notificaciones POST cuando el estado del pago cambie
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    console.log('[🔔 DEUNA WEBHOOK] Notificación recibida:', JSON.stringify(req.body, null, 2));

    const result = await handleDeunaWebhook(req.body);

    // Responder rápido a DeUna (webhook debe responder en < 10s)
    res.json({ 
      success: true, 
      message: 'Webhook procesado',
      ...result
    });

  } catch (error: any) {
    console.error('[❌ DEUNA WEBHOOK] Error procesando webhook:', error);
    
    // Aún así responder 200 para evitar reintentos
    res.json({ 
      success: false, 
      message: error.message 
    });
  }
});

export default router;
