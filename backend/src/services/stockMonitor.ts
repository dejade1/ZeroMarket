/**
 * STOCK MONITOR SERVICE
 *
 * Servicio para monitorear niveles de stock y enviar alertas
 */

import { PrismaClient } from '@prisma/client';
import { sendLowStockAlert } from './emailService';

const prisma = new PrismaClient();

// Tipo para producto con stock bajo
export interface LowStockProduct {
  id: number;
  title: string;
  stock: number;
  category?: string;
  price: number;
}

// Configuración desde variables de entorno
const LOW_STOCK_THRESHOLD = parseInt(process.env.LOW_STOCK_THRESHOLD || '2');
const ENABLE_AUTO_ALERTS = process.env.ENABLE_AUTO_STOCK_ALERTS === 'true';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';

// Caché para evitar enviar alertas duplicadas
const alertSentCache = new Map<number, number>(); // productId -> timestamp

/**
 * Verifica productos con stock bajo
 */
export async function checkLowStock(
  threshold: number = LOW_STOCK_THRESHOLD
): Promise<LowStockProduct[]> {
  try {
    const lowStockProducts = await prisma.product.findMany({
      where: {
        stock: {
          lte: threshold,
        },
      },
      orderBy: {
        stock: 'asc',
      },
    });

    const products: LowStockProduct[] = lowStockProducts.map((p) => ({
      id: p.id,
      title: p.title,
      stock: p.stock,
      category: p.category || undefined,
      price: p.price,
    }));

    console.log(`🔍 Stock check: Found ${products.length} products with stock <= ${threshold}`);
    return products;
  } catch (error) {
    console.error('❌ Error checking low stock:', error);
    throw new Error('Error al verificar stock bajo');
  }
}

/**
 * Verifica si ya se envió una alerta reciente para un producto
 * (dentro de las últimas 24 horas)
 */
function wasAlertSentRecently(productId: number): boolean {
  const lastAlertTime = alertSentCache.get(productId);
  if (!lastAlertTime) return false;

  const twentyFourHours = 24 * 60 * 60 * 1000;
  const timeSinceLastAlert = Date.now() - lastAlertTime;

  return timeSinceLastAlert < twentyFourHours;
}

/**
 * Marca un producto como alertado
 */
function markProductAsAlerted(productId: number): void {
  alertSentCache.set(productId, Date.now());
}

/**
 * Envía alertas de stock bajo si es necesario
 */
export async function sendLowStockAlertsIfNeeded(
  recipientEmails: string[] = [],
  threshold: number = LOW_STOCK_THRESHOLD
): Promise<{ success: boolean; message: string; productCount: number }> {
  try {
    if (!ENABLE_AUTO_ALERTS && recipientEmails.length === 0) {
      return {
        success: false,
        message: 'Alertas automáticas deshabilitadas',
        productCount: 0,
      };
    }

    const lowStockProducts = await checkLowStock(threshold);

    if (lowStockProducts.length === 0) {
      return {
        success: true,
        message: 'No hay productos con stock bajo',
        productCount: 0,
      };
    }

    // Filtrar productos que ya tuvieron alerta reciente
    const productsToAlert = lowStockProducts.filter((p) => !wasAlertSentRecently(p.id));

    if (productsToAlert.length === 0) {
      return {
        success: true,
        message: 'Alertas ya enviadas recientemente para todos los productos',
        productCount: lowStockProducts.length,
      };
    }

    // Determinar destinatarios
    const emails =
      recipientEmails.length > 0
        ? recipientEmails
        : ADMIN_EMAIL
        ? [ADMIN_EMAIL]
        : [];

    if (emails.length === 0) {
      return {
        success: false,
        message: 'No hay emails configurados para recibir alertas',
        productCount: productsToAlert.length,
      };
    }

    // Enviar alertas individuales para cada producto
    let successCount = 0;
    for (const product of productsToAlert) {
      const result = await sendLowStockAlert({
        productName: product.title,
        currentStock: product.stock,
        threshold,
        emails
      });

      if (result.success) {
        markProductAsAlerted(product.id);
        successCount++;
      }
    }

    const allSuccess = successCount === productsToAlert.length;

    return {
      success: allSuccess,
      message: allSuccess
        ? `Alertas enviadas exitosamente para ${successCount} productos`
        : `Alertas enviadas para ${successCount} de ${productsToAlert.length} productos`,
      productCount: productsToAlert.length,
    };
  } catch (error) {
    console.error('❌ Error sending low stock alerts:', error);
    return {
      success: false,
      message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      productCount: 0,
    };
  }
}

/**
 * Limpia el caché de alertas enviadas (útil para testing)
 */
export function clearAlertCache(): void {
  alertSentCache.clear();
  console.log('🗑️ Alert cache cleared');
}

/**
 * Obtiene estadísticas del monitor de stock
 */
export async function getStockMonitorStats(): Promise<{
  totalProducts: number;
  lowStockProducts: number;
  outOfStockProducts: number;
  threshold: number;
  autoAlertsEnabled: boolean;
}> {
  try {
    const totalProducts = await prisma.product.count();
    const lowStockProducts = await prisma.product.count({
      where: {
        stock: {
          lte: LOW_STOCK_THRESHOLD,
          gt: 0,
        },
      },
    });
    const outOfStockProducts = await prisma.product.count({
      where: {
        stock: 0,
      },
    });

    return {
      totalProducts,
      lowStockProducts,
      outOfStockProducts,
      threshold: LOW_STOCK_THRESHOLD,
      autoAlertsEnabled: ENABLE_AUTO_ALERTS,
    };
  } catch (error) {
    console.error('❌ Error getting stock monitor stats:', error);
    throw new Error('Error al obtener estadísticas del monitor');
  }
}

export default {
  checkLowStock,
  sendLowStockAlertsIfNeeded,
  clearAlertCache,
  getStockMonitorStats,
};
