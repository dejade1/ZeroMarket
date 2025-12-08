/**
 * Script para resetear todo el stock a cero
 */

// Este script debe ejecutarse en la consola del navegador
// porque usa IndexedDB que solo está disponible en el navegador

async function resetAllStock() {
  // Abrir la base de datos
  const request = indexedDB.open('InventoryDB', 1);

  request.onsuccess = async (event) => {
    const db = event.target.result;
    const transaction = db.transaction(['products'], 'readwrite');
    const productsStore = transaction.objectStore('products');

    // Obtener todos los productos
    const getAllRequest = productsStore.getAll();

    getAllRequest.onsuccess = () => {
      const products = getAllRequest.result;
      console.log(`📦 Encontrados ${products.length} productos`);

      // Actualizar cada producto a stock 0
      products.forEach(product => {
        product.stock = 0;
        product.updatedAt = new Date();
        productsStore.put(product);
      });

      transaction.oncomplete = () => {
        console.log('✅ Stock de todos los productos actualizado a 0');
        console.log('🔄 Recarga la página para ver los cambios');
      };
    };
  };

  request.onerror = () => {
    console.error('❌ Error al abrir la base de datos');
  };
}

// Ejecutar
console.log('🚀 Iniciando reset de stock...');
resetAllStock();
