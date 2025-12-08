/**
 * CSV SERVICE
 *
 * Servicio para generación de reportes en formato CSV
 * Soporta múltiples tipos de reportes
 */

import { stringify } from 'csv-stringify/sync';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Genera CSV de productos más vendidos
 */
export async function generateMostSoldProductsCSV(): Promise<string> {
  try {
    // Obtener todos los productos ordenados por ventas
    const products = await prisma.product.findMany({
      orderBy: {
        sales: 'desc',
      },
      take: 50, // Top 50 productos
    });

    const data = products.map((p) => ({
      ID: p.id,
      Producto: p.title,
      Categoría: p.category || 'N/A',
      'Ventas Totales': p.sales || 0,
      'Stock Actual': p.stock,
      'Stock Inicial': p.initialStock || 0,
      'Precio Unitario': `$${p.price.toFixed(2)}`,
      'Ingresos Estimados': `$${((p.sales || 0) * p.price).toFixed(2)}`,
      Calificación: p.rating?.toFixed(1) || 'N/A',
    }));

    const csv = stringify(data, {
      header: true,
      delimiter: ',',
    });

    console.log(`✅ Generated Most Sold Products CSV: ${products.length} products`);
    return csv;
  } catch (error) {
    console.error('❌ Error generating most sold products CSV:', error);
    throw new Error('Error al generar reporte de productos más vendidos');
  }
}

/**
 * Genera CSV de productos con diferencias negativas
 * (productos donde stock actual < stock inicial)
 */
export async function generateNegativeDifferencesCSV(): Promise<string> {
  try {
    // Productos con stock menor al inicial
    const products = await prisma.product.findMany({
      where: {
        AND: [
          {
            initialStock: {
              not: null,
            },
          },
          {
            OR: [
              {
                stock: {
                  lt: prisma.product.fields.initialStock,
                },
              },
            ],
          },
        ],
      },
    });

    // Filtrar en memoria ya que Prisma no permite comparar campos directamente
    const filteredProducts = products.filter(
      (p) => p.initialStock !== null && p.stock < p.initialStock
    );

    const data = filteredProducts.map((p) => ({
      ID: p.id,
      Producto: p.title,
      Categoría: p.category || 'N/A',
      'Stock Inicial': p.initialStock || 0,
      'Stock Actual': p.stock,
      Diferencia: (p.initialStock || 0) - p.stock,
      'Porcentaje Vendido': p.initialStock
        ? `${(((p.initialStock - p.stock) / p.initialStock) * 100).toFixed(1)}%`
        : 'N/A',
      'Precio Unitario': `$${p.price.toFixed(2)}`,
      'Última Actualización': p.updatedAt.toLocaleString('es-ES'),
    }));

    const csv = stringify(data, {
      header: true,
      delimiter: ',',
    });

    console.log(`✅ Generated Negative Differences CSV: ${filteredProducts.length} products`);
    return csv;
  } catch (error) {
    console.error('❌ Error generating negative differences CSV:', error);
    throw new Error('Error al generar reporte de diferencias negativas');
  }
}

/**
 * Genera CSV del historial de ajustes del último día
 */
export async function generateDailyAdjustmentsCSV(): Promise<string> {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    // Obtener ajustes del último día
    const adjustments = await prisma.stockAdjustment.findMany({
      where: {
        timestamp: {
          gte: yesterday,
        },
      },
      include: {
        product: {
          select: {
            title: true,
            category: true,
          },
        },
      },
      orderBy: {
        timestamp: 'desc',
      },
    });

    const data = adjustments.map((adj) => ({
      ID: adj.id,
      Producto: adj.product.title,
      Categoría: adj.product.category || 'N/A',
      'Tipo de Ajuste': adj.adjustmentType,
      'Stock Anterior': adj.quantityBefore,
      'Stock Nuevo': adj.quantityAfter,
      Diferencia: adj.difference,
      Nota: adj.note || 'Sin nota',
      Usuario: adj.userId || 'Sistema',
      Fecha: adj.timestamp.toLocaleString('es-ES'),
    }));

    const csv = stringify(data, {
      header: true,
      delimiter: ',',
    });

    console.log(`✅ Generated Daily Adjustments CSV: ${adjustments.length} adjustments`);
    return csv;
  } catch (error) {
    console.error('❌ Error generating daily adjustments CSV:', error);
    throw new Error('Error al generar reporte de ajustes diarios');
  }
}

/**
 * Genera CSV de todos los productos (inventario completo)
 */
export async function generateFullInventoryCSV(): Promise<string> {
  try {
    const products = await prisma.product.findMany({
      orderBy: {
        title: 'asc',
      },
    });

    const data = products.map((p) => ({
      ID: p.id,
      Producto: p.title,
      Categoría: p.category || 'N/A',
      Unidad: p.unit,
      'Stock Actual': p.stock,
      'Stock Inicial': p.initialStock || 0,
      Ventas: p.sales || 0,
      'Precio Unitario': `$${p.price.toFixed(2)}`,
      Calificación: p.rating?.toFixed(1) || 'N/A',
      'Fecha Creación': p.createdAt.toLocaleString('es-ES'),
      'Última Actualización': p.updatedAt.toLocaleString('es-ES'),
    }));

    const csv = stringify(data, {
      header: true,
      delimiter: ',',
    });

    console.log(`✅ Generated Full Inventory CSV: ${products.length} products`);
    return csv;
  } catch (error) {
    console.error('❌ Error generating full inventory CSV:', error);
    throw new Error('Error al generar inventario completo');
  }
}

export default {
  generateMostSoldProductsCSV,
  generateNegativeDifferencesCSV,
  generateDailyAdjustmentsCSV,
  generateFullInventoryCSV,
};
