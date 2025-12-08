/**
 * EMAIL ROUTES
 *
 * Rutas para manejo de notificaciones por email y reportes CSV
 */

import { Router, Request, Response } from 'express';
import {
  verifyEmailConnection,
  sendTestEmail,
  sendLowStockAlert,
  sendCSVReport,
} from '../services/emailService';
import {
  generateMostSoldProductsCSV,
  generateNegativeDifferencesCSV,
  generateDailyAdjustmentsCSV,
  generateFullInventoryCSV,
} from '../services/csvService';
import {
  checkLowStock,
  sendLowStockAlertsIfNeeded,
  getStockMonitorStats,
} from '../services/stockMonitor';

const router = Router();

// ==================== EMAIL TESTING ====================

/**
 * POST /api/admin/email/test
 * Envía un email de prueba
 */
router.post('/test', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Email es requerido',
      });
    }

    const result = await sendTestEmail(email);
    return res.json(result);
  } catch (error) {
    console.error('Error sending test email:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al enviar email de prueba',
    });
  }
});

/**
 * GET /api/admin/email/verify
 * Verifica la conexión SMTP
 */
router.get('/verify', async (_req: Request, res: Response) => {
  try {
    const isConnected = await verifyEmailConnection();
    return res.json({
      success: isConnected,
      message: isConnected
        ? 'Conexión SMTP exitosa'
        : 'No se pudo conectar al servidor SMTP',
    });
  } catch (error) {
    console.error('Error verifying email connection:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al verificar conexión SMTP',
    });
  }
});

// ==================== STOCK MONITORING ====================

/**
 * GET /api/admin/stock-monitor/check
 * Verifica productos con stock bajo
 */
router.get('/monitor/check', async (req: Request, res: Response) => {
  try {
    const threshold = req.query.threshold
      ? parseInt(req.query.threshold as string)
      : undefined;

    const products = await checkLowStock(threshold);

    return res.json({
      success: true,
      count: products.length,
      products,
    });
  } catch (error) {
    console.error('Error checking low stock:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al verificar stock bajo',
    });
  }
});

/**
 * POST /api/admin/stock-monitor/alert
 * Envía alerta de stock bajo a emails especificados
 */
router.post('/monitor/alert', async (req: Request, res: Response) => {
  try {
    const { emails, threshold } = req.body;

    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere al menos un email',
      });
    }

    const result = await sendLowStockAlertsIfNeeded(emails, threshold);

    return res.json(result);
  } catch (error) {
    console.error('Error sending stock alert:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al enviar alerta de stock',
    });
  }
});

/**
 * GET /api/admin/stock-monitor/stats
 * Obtiene estadísticas del monitor de stock
 */
router.get('/monitor/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await getStockMonitorStats();
    return res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('Error getting stock monitor stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener estadísticas',
    });
  }
});

// ==================== CSV REPORTS ====================

/**
 * POST /api/admin/reports/most-sold
 * Genera y envía reporte de productos más vendidos
 */
router.post('/reports/most-sold', async (req: Request, res: Response) => {
  try {
    const { emails } = req.body;

    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere al menos un email',
      });
    }

    const csv = await generateMostSoldProductsCSV();
    const result = await sendCSVReport(
      csv,
      'most-sold',
      'productos_mas_vendidos',
      emails
    );

    return res.json(result);
  } catch (error) {
    console.error('Error sending most sold products report:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al enviar reporte',
    });
  }
});

/**
 * POST /api/admin/reports/negative-diff
 * Genera y envía reporte de productos con diferencias negativas
 */
router.post('/reports/negative-diff', async (req: Request, res: Response) => {
  try {
    const { emails } = req.body;

    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere al menos un email',
      });
    }

    const csv = await generateNegativeDifferencesCSV();
    const result = await sendCSVReport(
      csv,
      'negative-diff',
      'productos_diferencias_negativas',
      emails
    );

    return res.json(result);
  } catch (error) {
    console.error('Error sending negative differences report:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al enviar reporte',
    });
  }
});

/**
 * POST /api/admin/reports/adjustments
 * Genera y envía reporte de ajustes del último día
 */
router.post('/reports/adjustments', async (req: Request, res: Response) => {
  try {
    const { emails } = req.body;

    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere al menos un email',
      });
    }

    const csv = await generateDailyAdjustmentsCSV();
    const result = await sendCSVReport(
      csv,
      'adjustments',
      'historial_ajustes',
      emails
    );

    return res.json(result);
  } catch (error) {
    console.error('Error sending adjustments report:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al enviar reporte',
    });
  }
});

/**
 * POST /api/admin/reports/inventory
 * Genera y envía reporte de inventario completo
 */
router.post('/reports/inventory', async (req: Request, res: Response) => {
  try {
    const { emails } = req.body;

    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere al menos un email',
      });
    }

    const csv = await generateFullInventoryCSV();
    const result = await sendCSVReport(
      csv,
      'inventory',
      'inventario_completo',
      emails
    );

    return res.json(result);
  } catch (error) {
    console.error('Error sending inventory report:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al enviar reporte',
    });
  }
});

export default router;
