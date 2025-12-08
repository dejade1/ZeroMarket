/**
 * Script de sincronización para productos sin lotes
 * Ejecutar en la consola del navegador en http://localhost:5173/admin
 *
 * Este script crea lotes iniciales para productos que tienen stock pero no tienen lotes asociados.
 */

async function syncProductsWithoutBatches() {
  console.log('🔄 Iniciando sincronización de productos sin lotes...');

  try {
    // Abrir la base de datos
    const dbRequest = indexedDB.open('storeDB', 1);

    dbRequest.onsuccess = async (event) => {
      const db = event.target.result;

      // Obtener todos los productos
      const productsTransaction = db.transaction(['products'], 'readonly');
      const productsStore = productsTransaction.objectStore('products');
      const productsRequest = productsStore.getAll();

      productsRequest.onsuccess = async () => {
        const products = productsRequest.result;
        console.log(`📦 Productos encontrados: ${products.length}`);

        let syncCount = 0;

        for (const product of products) {
          if (!product.stock || product.stock <= 0) {
            console.log(`⏭️  Saltando producto ${product.id} (${product.title}) - sin stock`);
            continue;
          }

          // Verificar si ya tiene lotes
          const batchesTransaction = db.transaction(['batches'], 'readonly');
          const batchesStore = batchesTransaction.objectStore('batches');
          const batchesIndex = batchesStore.index('productId');
          const batchesRequest = batchesIndex.getAll(product.id);

          await new Promise((resolve) => {
            batchesRequest.onsuccess = async () => {
              const batches = batchesRequest.result;
              const totalBatchQuantity = batches.reduce((sum, b) => sum + b.quantity, 0);

              if (totalBatchQuantity === 0 && product.stock > 0) {
                // Crear lote inicial
                const expiryDate = new Date();
                expiryDate.setMonth(expiryDate.getMonth() + 6);

                const batchData = {
                  productId: product.id,
                  batchCode: `SYNC-${product.id}-${Date.now()}`,
                  quantity: product.stock,
                  expiryDate: expiryDate.toISOString().split('T')[0],
                  createdAt: new Date().toISOString()
                };

                const addTransaction = db.transaction(['batches'], 'readwrite');
                const addStore = addTransaction.objectStore('batches');
                addStore.add(batchData);

                await new Promise((resolveAdd) => {
                  addTransaction.oncomplete = () => {
                    console.log(`✅ Lote creado para ${product.title}: ${product.stock} unidades`);
                    syncCount++;
                    resolveAdd();
                  };
                });
              } else {
                console.log(`✓ Producto ${product.id} (${product.title}) ya tiene lotes`);
              }
              resolve();
            };
          });
        }

        console.log(`\n🎉 Sincronización completada: ${syncCount} lotes creados`);
        alert(`Sincronización completada: ${syncCount} productos sincronizados`);
      };
    };

    dbRequest.onerror = () => {
      console.error('❌ Error al abrir la base de datos');
    };

  } catch (error) {
    console.error('❌ Error durante la sincronización:', error);
  }
}

// Ejecutar la sincronización
syncProductsWithoutBatches();
