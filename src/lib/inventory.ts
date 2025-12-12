/**
 * ARCHIVO ACTUALIZADO: lib/inventory.ts
 * 
 * MEJORAS IMPLEMENTADAS:
 * 1. ✅ Integración con servicio de lotes transaccional
 * 2. ✅ Validación de stock antes de crear orden
 * 3. ✅ Tipos estrictos
 * 4. ✅ Manejo de errores centralizado
 * 5. ✅ NUEVO: Generación automática de códigos de lote con formato correcto
 */

import { db } from './db';
import { consumeBatchesFIFO, generateBatchCode } from './batch-service';
import { AppError, ErrorCode } from '../utils/errorHandler';

// Re-export db for components that need direct access
export { db };

export interface Product {
  id?: number;
  title: string;
  price: number;
  stock: number;
  initialStock?: number;
  unit: string;
  image: string;
  rating: number;
  category: string;
  slot?: number;
  beltDistance?: number;
  sales?: number;       // Ventas totales acumuladas (NUNCA se resetea)
  dailySales?: number;  // Ventas diarias (se resetea al ajustar stock)
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderItem {
  productId: number;
  quantity: number;
  price: number;
  productTitle: string;
}

export interface Order {
  id?: number;
  items: OrderItem[];
  total: number;
  status: 'pending' | 'completed' | 'cancelled';
  createdAt: Date;
}

/**
 * Obtiene todos los productos de la base de datos
 */
export async function getAllProducts(): Promise<Product[]> {
  await db.ensureInitialized();
  return db.products.toArray();
}

/**
 * Actualiza el stock de un producto de forma incremental
 * @param productId ID del producto
 * @param quantity Cantidad a agregar o quitar
 * @param type 'in' para entrada, 'out' para salida
 * @param note Nota opcional del movimiento
 */
export async function updateStock(
  productId: number,
  quantity: number,
  type: 'in' | 'out',
  note?: string
): Promise<void> {
  await db.ensureInitialized();

  const product = await db.products.get(productId);
  if (!product) {
    throw new AppError(`Producto ${productId} no encontrado`, ErrorCode.NOT_FOUND);
  }

  // Calcular nuevo stock
  const newStock = type === 'in'
    ? product.stock + quantity
    : product.stock - quantity;

  if (newStock < 0) {
    throw new AppError(
      `Stock insuficiente. Disponible: ${product.stock}, solicitado: ${quantity}`,
      ErrorCode.VALIDATION_ERROR
    );
  }

  // Actualizar stock del producto
  await db.products.update(productId, {
    stock: newStock,
    updatedAt: new Date()
  });

  // Registrar movimiento de stock
  await db.stockMovements.add({
    productId,
    quantity: type === 'in' ? quantity : -quantity,
    type,
    note,
    createdAt: new Date()
  });

  console.log(`[Stock] ${type === 'in' ? 'Entrada' : 'Salida'} - Producto ${productId}: ${quantity} unidades. Stock nuevo: ${newStock}`);
}

/**
 * Crea una nueva orden y actualiza el inventario
 * @param items Items del carrito
 */
export async function createOrder(items: OrderItem[]): Promise<number> {
  if (!items || items.length === 0) {
    throw new AppError('La orden no puede estar vacía', ErrorCode.VALIDATION_ERROR);
  }

  // PASO 1: Ejecutar transacción de IndexedDB (sin fetch)
  const orderId = await db.transaction('rw', [db.products, db.batches, db.orders, db.orderItems], async () => {

    // 1. Validar stock de TODOS los productos antes de tocar nada
    for (const item of items) {
      const product = await db.products.get(item.productId);
      if (!product) {
        throw new AppError(`Producto ${item.productId} no encontrado`, ErrorCode.NOT_FOUND);
      }
      if (product.stock < item.quantity) {
        throw new AppError(
          `Stock insuficiente para "${product.title}". Disponible: ${product.stock}`,
          ErrorCode.VALIDATION_ERROR
        );
      }
    }

    // 2. Crear la orden
    const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const orderId = await db.orders.add({
      total,
      status: 'completed',
      createdAt: new Date(),
      items: items
    });

    // 3. Procesar cada item (consumir lotes y actualizar ventas)
    for (const item of items) {
      // Registrar item de orden
      await db.orderItems.add({
        orderId,
        ...item
      });

      // Consumir inventario FIFO
      await consumeBatchesFIFO(item.productId, item.quantity);

      // Incrementar AMBOS contadores de ventas del producto
      const product = await db.products.get(item.productId);
      if (product) {
        const currentSales = product.sales || 0;
        const currentDailySales = product.dailySales || 0;
        const newSales = currentSales + item.quantity;
        const newDailySales = currentDailySales + item.quantity;

        await db.products.update(item.productId, {
          sales: newSales,          // Ventas totales (nunca se resetea)
          dailySales: newDailySales, // Ventas diarias (se resetea al ajustar stock)
          updatedAt: new Date()
        });
      }
    }

    console.log(`[Order] Orden #${orderId} creada exitosamente`);
    return orderId;
  });

  // PASO 2: Sincronizar con el backend DESPUÉS de completar la transacción
  for (const item of items) {
    try {
      const product = await db.products.get(item.productId);
      if (product) {
        // Una sola petición PATCH para actualizar tanto ventas como stock
        await fetch(`http://localhost:3000/api/products/${item.productId}/sales`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sales: product.sales || 0,
            stock: product.stock
          })
        });

        console.log(`✅ Datos sincronizados al backend: ${product.title} - ${product.sales} ventas, ${product.stock} stock`);
      }
    } catch (error) {
      console.error('⚠️ Error sincronizando al backend:', error);
      // No lanzar error - la venta ya se registró localmente
    }
  }

  return orderId;
}

/**
 * Inicializa la base de datos con datos de prueba si está vacía
 * ⚠️ DESACTIVADO: Ahora los productos se agregan manualmente desde el panel admin
 */
export async function initializeDB(): Promise<void> {
  console.log('✅ Base de datos lista (sin datos de prueba automáticos)');

  // Ya no se crean productos automáticamente
  // Los productos se agregan manualmente desde el panel de administración
  return;
}