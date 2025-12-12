/**
 * ARCHIVO ACTUALIZADO: lib/db.ts
 *
 * MEJORAS IMPLEMENTADAS:
 * 1. ✅ Usa Dexie.js para manejo simplificado de IndexedDB
 * 2. ✅ Auto-inicialización segura (previene race conditions)
 * 3. ✅ Tipado completo con TypeScript
 * 4. ✅ Transacciones atómicas
 * 5. ✅ NUEVO: Campos slot y beltDistance para banda transportadora
 */

import Dexie, { Table } from 'dexie';

// Interfaces para los datos
export interface Product {
  id?: number;
  title: string;
  price: number;
  stock: number;
  initialStock?: number; // Stock inicial de referencia
  unit: string;
  image: string;
  rating: number;
  category: string;

  // CAMPOS DE VENTAS
  sales?: number;       // Ventas totales acumuladas (NUNCA se resetea - para ingresos totales)
  dailySales?: number;  // Ventas diarias (se resetea al ajustar stock - para reportes diarios)

  // NUEVOS CAMPOS BANDA TRANSPORTADORA
  slot?: number;         // Número de banda física (1, 2, 3, etc.)
  beltDistance?: number; // Distancia en cm para llegar a posición 0.00

  createdAt: Date;
  updatedAt: Date;
}

export interface Order {
  id?: number;
  total: number;
  status: 'pending' | 'completed' | 'cancelled';
  createdAt: Date;
  items: any[]; // Snapshot de items
}

export interface OrderItem {
  id?: number;
  orderId: number;
  productId: number;
  quantity: number;
  price: number;
  productTitle: string;
}

export interface Batch {
  id?: number;
  productId: number;
  batchCode: string;
  quantity: number;
  expiryDate: string; // YYYY-MM-DD
  createdAt: string;
}

export interface StockMovement {
  id?: number;
  productId: number;
  quantity: number;
  type: 'in' | 'out';
  note?: string;
  createdAt: Date;
}

export interface StockAdjustment {
  id?: number;
  productId: number;
  adjustmentType: 'manual' | 'restock' | 'correction' | 'damage' | 'count';
  quantityBefore: number;
  quantityAfter: number;
  difference: number;
  note?: string;
  userId?: string;
  timestamp: Date;
}

// Clase Dexie personalizada
class StoreDB extends Dexie {
  products!: Table<Product, number>;
  orders!: Table<Order, number>;
  orderItems!: Table<OrderItem, number>;
  batches!: Table<Batch, number>;
  stockMovements!: Table<StockMovement, number>;
  stockAdjustments!: Table<StockAdjustment, number>;

  constructor() {
    super('storeDB');

    // Versión 1 - Schema original
    this.version(1).stores({
      products: '++id, title, stock, category',
      orders: '++id, createdAt, status',
      orderItems: '++id, orderId, productId',
      batches: '++id, productId, expiryDate, batchCode',
      stockMovements: '++id, productId, createdAt, type'
    });

    // Versión 2 - Agregar initialStock y tabla stockAdjustments
    this.version(2).stores({
      products: '++id, title, stock, category, initialStock',
      orders: '++id, createdAt, status',
      orderItems: '++id, orderId, productId',
      batches: '++id, productId, expiryDate, batchCode',
      stockMovements: '++id, productId, createdAt, type',
      stockAdjustments: '++id, productId, timestamp, adjustmentType'
    }).upgrade(async tx => {
      // Migración: Inicializar initialStock = stock actual para productos existentes
      console.log('🔄 Migrando base de datos a versión 2...');
      await tx.table('products').toCollection().modify(product => {
        if (product.initialStock === undefined) {
          product.initialStock = product.stock;
          console.log(`✅ Producto "${product.title}": initialStock = ${product.stock}`);
        }
      });
      console.log('✅ Migración completada');
    });

    // Versión 3 - Agregar campos de banda transportadora
    this.version(3).stores({
      products: '++id, title, stock, category, initialStock, slot',
      orders: '++id, createdAt, status',
      orderItems: '++id, orderId, productId',
      batches: '++id, productId, expiryDate, batchCode',
      stockMovements: '++id, productId, createdAt, type',
      stockAdjustments: '++id, productId, timestamp, adjustmentType'
    }).upgrade(async tx => {
      console.log('🔄 Migrando base de datos a versión 3 (banda transportadora)...');
      await tx.table('products').toCollection().modify(product => {
        if (product.slot === undefined) {
          product.slot = null;
          product.beltDistance = null;
          console.log(`✅ Producto "${product.title}": campos de banda inicializados`);
        }
      });
      console.log('✅ Migración v3 completada');
    });
  }

  // ✅ Método para asegurar inicialización
  async ensureInitialized(): Promise<void> {
    if (!this.isOpen()) {
      await this.open();
    }
  }
}

// Exportar instancia única
export const db = new StoreDB();

// Auto-abrir la base de datos
db.open().catch(err => {
  console.error('Failed to open database:', err);
});

export default db;