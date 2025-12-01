/**
 * ARCHIVO CORREGIDO: lib/batch-service.ts
 * 
 * MEJORAS IMPLEMENTADAS:
 * 1. ✅ Transacciones atómicas para consistencia de datos
 * 2. ✅ Lógica FIFO robusta
 * 3. ✅ Sincronización automática de stock de producto
 * 4. ✅ Manejo de errores detallado
 * 5. ✅ Validaciones de integridad
 */

import { db } from './db';
import { AppError, ErrorCode } from '../utils/errorHandler';

export interface Batch {
  id?: number;
  productId: number;
  batchCode: string;
  quantity: number;
  expiryDate: string; // YYYY-MM-DD
  createdAt: string;
}

/**
 * Añade un nuevo lote y actualiza el stock del producto
 * Ejecutado dentro de una transacción
 */
export async function addBatch(batch: Batch): Promise<number> {
  return db.transaction('rw', [db.products, db.batches], async () => {
    // 1. Validar producto
    const product = await db.products.get(batch.productId);
    if (!product) {
      throw new AppError(`Producto ${batch.productId} no encontrado`, ErrorCode.NOT_FOUND);
    }

    // 2. Insertar lote
    const batchId = await db.batches.add({
      ...batch,
      createdAt: new Date().toISOString()
    });

    // 3. Actualizar stock total del producto
    const newStock = (product.stock || 0) + batch.quantity;
    await db.products.update(batch.productId, { stock: newStock });

    console.log(`[Batch] Lote añadido. Nuevo stock para ${product.title}: ${newStock}`);
    return batchId;
  });
}

/**
 * Consume stock siguiendo lógica FIFO (First-In, First-Out)
 * Prioriza lotes con fecha de expiración más próxima
 */
export async function consumeBatchesFIFO(
  productId: number,
  quantityToConsume: number
): Promise<void> {
  if (quantityToConsume <= 0) return;

  await db.transaction('rw', [db.products, db.batches], async () => {
    // 1. Obtener producto y validar stock global
    const product = await db.products.get(productId);
    if (!product) {
      throw new AppError('Producto no encontrado', ErrorCode.NOT_FOUND);
    }

    if (product.stock < quantityToConsume) {
      throw new AppError(
        `Stock insuficiente. Solicitado: ${quantityToConsume}, Disponible: ${product.stock}`,
        ErrorCode.VALIDATION_ERROR
      );
    }

    // 2. Obtener lotes ordenados por fecha de expiración (ASC)
    const batches = await db.batches
      .where('productId')
      .equals(productId)
      .toArray();

    // Ordenar en memoria por si el índice no es suficiente
    batches.sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());

    let remainingToConsume = quantityToConsume;
    const batchesToDelete: number[] = [];
    const batchesToUpdate: { id: number, quantity: number }[] = [];

    // 3. Calcular consumo por lote
    for (const batch of batches) {
      if (remainingToConsume <= 0) break;

      if (batch.quantity <= remainingToConsume) {
        // Consumir lote completo
        remainingToConsume -= batch.quantity;
        if (batch.id) batchesToDelete.push(batch.id);
      } else {
        // Consumir parcial
        const newQuantity = batch.quantity - remainingToConsume;
        if (batch.id) batchesToUpdate.push({ id: batch.id, quantity: newQuantity });
        remainingToConsume = 0;
      }
    }

    // 4. Validar que se pudo cubrir la demanda
    if (remainingToConsume > 0) {
      // Esto no debería pasar si product.stock era correcto, pero es una defensa extra
      // Si pasa, significa que product.stock estaba desincronizado con sum(batches)
      console.warn(`[Inconsistency] Stock global dice ${product.stock} pero lotes suman menos.`);
      // Forzamos actualización de stock real
      const realStock = product.stock - quantityToConsume + remainingToConsume; // Lo que realmente había
      await db.products.update(productId, { stock: realStock });

      throw new AppError(
        'Inconsistencia de inventario detectada. Por favor intente de nuevo.',
        ErrorCode.INTERNAL_ERROR
      );
    }

    // 5. Aplicar cambios (Atomicidad garantizada por la transacción)

    // Eliminar lotes vacíos
    if (batchesToDelete.length > 0) {
      await db.batches.bulkDelete(batchesToDelete);
    }

    // Actualizar lotes parciales
    for (const update of batchesToUpdate) {
      await db.batches.update(update.id, { quantity: update.quantity });
    }

    // Actualizar stock total del producto
    const newTotalStock = product.stock - quantityToConsume;
    await db.products.update(productId, { stock: newTotalStock });

    console.log(`[FIFO] Consumidos ${quantityToConsume} unidades de ${product.title}. Stock restante: ${newTotalStock}`);
  });
}

/**
 * Obtiene lotes próximos a vencer
 */
export async function getExpiringBatches(daysThreshold: number = 7): Promise<Batch[]> {
  const today = new Date();
  const thresholdDate = new Date();
  thresholdDate.setDate(today.getDate() + daysThreshold);

  // Convertir a string YYYY-MM-DD para comparación lexicográfica
  const thresholdStr = thresholdDate.toISOString().split('T')[0];
  const todayStr = today.toISOString().split('T')[0];

  return db.batches
    .where('expiryDate')
    .between(todayStr, thresholdStr, true, true)
    .toArray();
}

/**
 * Sincroniza el stock total del producto con la suma de sus lotes
 * Útil para tareas de mantenimiento
 */
export async function syncProductStock(productId: number): Promise<void> {
  await db.transaction('rw', [db.products, db.batches], async () => {
    const batches = await db.batches.where('productId').equals(productId).toArray();
    const totalQuantity = batches.reduce((sum, b) => sum + b.quantity, 0);

    await db.products.update(productId, { stock: totalQuantity });
    console.log(`[Sync] Stock sincronizado para producto ${productId}: ${totalQuantity}`);
  });
}
