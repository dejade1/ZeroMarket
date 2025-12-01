export interface DBSchema {
  products: {
    id: number;
    title: string;
    price: number;
    stock: number;
    unit: string;
    image: string;
    rating: number;
    createdAt: Date;
    updatedAt: Date;
  };
  orders: {
    id: number;
    total: number;
    status: string;
    createdAt: Date;
  };
  orderItems: {
    id: number;
    orderId: number;
    productId: number;
    quantity: number;
    price: number;
  };
  stockMovements: {
    id: number;
    productId: number;
    quantity: number;
    type: 'in' | 'out';
    note?: string;
    createdAt: Date;
  };
  // AGREGADO:
  product_batches: {
    id: number;
    productId: number;
    batchCode: string;
    quantity: number;
    expiryDate: string;
  };
}

class DB {
  private db: IDBDatabase | null = null;
  private readonly dbName = 'storeDB';
  private readonly version = 1;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Productos
        if (!db.objectStoreNames.contains('products')) {
          const productStore = db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
          productStore.createIndex('title', 'title', { unique: false });
          productStore.createIndex('stock', 'stock', { unique: false });
        }
        // Lotes de producto
        if (!db.objectStoreNames.contains('product_batches')) {
          const batchStore = db.createObjectStore('product_batches', { keyPath: 'id', autoIncrement: true });
          batchStore.createIndex('productId', 'productId', { unique: false });
          batchStore.createIndex('expiryDate', 'expiryDate', { unique: false });
        }
        // Órdenes
        if (!db.objectStoreNames.contains('orders')) {
          const orderStore = db.createObjectStore('orders', { keyPath: 'id', autoIncrement: true });
          orderStore.createIndex('status', 'status', { unique: false });
          orderStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // Items de orden
        if (!db.objectStoreNames.contains('orderItems')) {
          const orderItemStore = db.createObjectStore('orderItems', { keyPath: 'id', autoIncrement: true });
          orderItemStore.createIndex('orderId', 'orderId', { unique: false });
          orderItemStore.createIndex('productId', 'productId', { unique: false });
        }

        // Movimientos de stock
        if (!db.objectStoreNames.contains('stockMovements')) {
          const stockMovementStore = db.createObjectStore('stockMovements', { keyPath: 'id', autoIncrement: true });
          stockMovementStore.createIndex('productId', 'productId', { unique: false });
          stockMovementStore.createIndex('type', 'type', { unique: false });
          stockMovementStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });
  }

  async transaction<T>(
    storeName: keyof DBSchema,
    mode: IDBTransactionMode,
    callback: (store: IDBObjectStore) => Promise<T>
  ): Promise<T> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      try {
        const tx = this.db!.transaction(storeName, mode);
        const store = tx.objectStore(storeName);

        let callbackResult: T | undefined;

        tx.oncomplete = () => resolve(callbackResult as T);
        tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
        tx.onerror = () => reject(tx.error || new Error('Transaction error'));

        // Execute the callback. If it resolves, we keep the value and wait
        // for the transaction to complete before resolving the outer promise.
        Promise.resolve()
          .then(() => callback(store))
          .then((res) => {
            callbackResult = res;
            // Note: do not resolve here — wait for tx.oncomplete to ensure
            // all IDB requests have finished and the transaction committed.
          })
          .catch((err) => {
            // If the callback fails, abort the transaction and reject.
            try { tx.abort(); } catch (e) { /* ignore */ }
            reject(err);
          });
      } catch (err) {
        reject(err);
      }
    });
  }

  async getAll<T extends keyof DBSchema>(storeName: T): Promise<DBSchema[T][]> {
    return this.transaction(storeName, 'readonly', async (store) => {
      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    });
  }

  // Obtener todos los registros usando un índice (más eficiente que getAll + filter)
  async getAllByIndex<T extends keyof DBSchema>(
    storeName: T,
    indexName: string,
    query?: IDBValidKey | IDBKeyRange
  ): Promise<DBSchema[T][]> {
    return this.transaction(storeName, 'readonly', async (store) => {
      return new Promise((resolve, reject) => {
        try {
          const index = (store as IDBObjectStore).index(indexName);
          const request = index.getAll(query as IDBValidKey | IDBKeyRange | undefined);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  async get<T extends keyof DBSchema>(
    storeName: T,
    id: number
  ): Promise<DBSchema[T] | undefined> {
    return this.transaction(storeName, 'readonly', async (store) => {
      return new Promise((resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    });
  }

  async add<T extends keyof DBSchema>(
    storeName: T,
    data: Omit<DBSchema[T], 'id'>
  ): Promise<number> {
    return this.transaction(storeName, 'readwrite', async (store) => {
      return new Promise((resolve, reject) => {
        const request = store.add(data);
        request.onsuccess = () => resolve(request.result as number);
        request.onerror = () => reject(request.error);
      });
    });
  }

  async put<T extends keyof DBSchema>(
    storeName: T,
    data: DBSchema[T]
  ): Promise<void> {
    return this.transaction(storeName, 'readwrite', async (store) => {
      return new Promise((resolve, reject) => {
        const request = store.put(data);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });
  }

  async delete<T extends keyof DBSchema>(
    storeName: T,
    id: number
  ): Promise<void> {
    return this.transaction(storeName, 'readwrite', async (store) => {
      return new Promise((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });
  }
}

export const db = new DB();
export default db;