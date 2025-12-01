/**
 * ARCHIVO CORREGIDO: lib/inventory.ts
 * 
 * MEJORAS IMPLEMENTADAS:
 * 1. ✅ Integración con servicio de lotes transaccional
 * 2. ✅ Validación de stock antes de crear orden
 * 3. ✅ Tipos estrictos
 * 4. ✅ Manejo de errores centralizado
 */

import { db } from './db';
import { consumeBatchesFIFO } from './batch-service'; // Usar la versión corregida
import { AppError, ErrorCode } from '../utils/errorHandler';

export interface Product {
  id?: number;
  title: string;
  price: number;
  stock: number;
  unit: string;
  image: string;
  rating: number;
  category: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderItem {
  productId: number;
  quantity: number;
  price: number;
  productTitle: string; // Desnormalización útil para historial
}

export interface Order {
  id?: number;
  items: OrderItem[];
  total: number;
  status: 'pending' | 'completed' | 'cancelled';
  createdAt: Date;
}

/**
 * Crea una nueva orden y actualiza el inventario
 * @param items Items del carrito
 */
export async function createOrder(items: OrderItem[]): Promise<number> {
  if (!items || items.length === 0) {
    throw new AppError('La orden no puede estar vacía', ErrorCode.VALIDATION_ERROR);
  }

  // Usamos una transacción global para toda la orden
  // Si falla un producto, falla toda la orden
  return db.transaction('rw', [db.products, db.batches, db.orders, db.orderItems], async () => {

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
      items: items // Guardamos snapshot de items
    });

    // 3. Procesar cada item (consumir lotes)
    for (const item of items) {
      // Registrar item de orden
      await db.orderItems.add({
        orderId,
        ...item
      });

      // Consumir inventario FIFO
      // Esta función ya maneja su propia lógica, pero al estar dentro
      // de la transacción padre, se une a ella.
      await consumeBatchesFIFO(item.productId, item.quantity);
    }

    console.log(`[Order] Orden #${orderId} creada exitosamente`);
    return orderId;
  });
}

/**
 * Inicializa la base de datos con datos de prueba si está vacía
 */
export async function initializeDB(): Promise<void> {
  const count = await db.products.count();
  if (count > 0) return;

  console.log('Inicializando base de datos...');

  const initialProducts: Product[] = [
    {
      title: "Arroz Premium Extra Largo - 1kg",
      price: 2.99,
      stock: 50,
      unit: "kg",
      image: "https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=800&q=80",
      rating: 4.8,
      category: "Granos",
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      title: "Aceite de Oliva Virgen Extra - 500ml",
      price: 8.50,
      stock: 30,
      unit: "botella",
      image: "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=800&q=80",
      rating: 4.9,
      category: "Aceites",
      createdAt: new Date(),
      updatedAt: new Date()
    },
    // ... más productos
  ];

  await db.transaction('rw', [db.products, db.batches], async () => {
    for (const p of initialProducts) {
      const id = await db.products.add(p);

      // Crear lote inicial para el stock base
      // Asumimos vencimiento en 6 meses
      const expiry = new Date();
      expiry.setMonth(expiry.getMonth() + 6);

      await db.batches.add({
        productId: id,
        batchCode: `INIT-${id}`,
        quantity: p.stock,
        expiryDate: expiry.toISOString().split('T')[0],
        createdAt: new Date().toISOString()
      });
    }
  });
}