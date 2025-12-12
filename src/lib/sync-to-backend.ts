/**
 * SYNC TO BACKEND
 *
 * Funciones para sincronizar productos de IndexedDB al backend
 */

import { db } from './db';

/**
 * Sincroniza UN producto individual al backend
 * Útil para sincronizar después de modificaciones específicas
 */
export async function syncProductToBackend(productId: number): Promise<boolean> {
  try {
    const product = await db.products.get(productId);

    if (!product) {
      console.warn(`⚠️ Producto ${productId} no encontrado en IndexedDB`);
      return false;
    }

    const response = await fetch(`http://localhost:3000/api/products/${product.id}/sales`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sales: product.sales || 0,
        dailySales: product.dailySales || 0,
        stock: product.stock
      })
    });

    if (response.ok) {
      console.log(`✅ Sincronizado: ${product.title} - Ventas: ${product.sales || 0}, Diarias: ${product.dailySales || 0}, Stock: ${product.stock}`);
      return true;
    } else {
      console.error(`❌ Error sincronizando ${product.title}: ${response.status}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Error en sincronización del producto ${productId}:`, error);
    return false;
  }
}

/**
 * Sincroniza TODOS los productos BIDIRECCIONALMENTE
 * 1. Trae productos nuevos del backend a IndexedDB
 * 2. Actualiza ventas/stock del backend desde IndexedDB
 */
export async function syncAllProductsToBackend(): Promise<void> {
  console.log('🔄 Iniciando sincronización bidireccional...');

  try {
    // PASO 1: Traer productos del backend
    const backendResponse = await fetch('http://localhost:3000/api/products/public');
    if (!backendResponse.ok) {
      console.warn('⚠️ No se pudo obtener productos del backend');
      return;
    }

    const backendData = await backendResponse.json();
    const backendProducts = backendData.products || [];

    console.log(`📥 Productos en backend: ${backendProducts.length}`);

    // PASO 2: Obtener productos de IndexedDB
    const localProducts = await db.products.toArray();
    console.log(`📦 Productos en IndexedDB: ${localProducts.length}`);

    // PASO 3: Crear un mapa de productos locales por ID
    const localProductsMap = new Map(localProducts.map(p => [p.id, p]));

    let newProducts = 0;
    let updatedProducts = 0;

    // PASO 4: Sincronizar del backend a IndexedDB (agregar productos nuevos)
    for (const backendProduct of backendProducts) {
      const localProduct = localProductsMap.get(backendProduct.id);

      if (!localProduct) {
        // Producto nuevo del backend, agregarlo a IndexedDB
        await db.products.add({
          ...backendProduct,
          createdAt: new Date(backendProduct.createdAt),
          updatedAt: new Date(backendProduct.updatedAt)
        });
        console.log(`➕ Nuevo producto agregado: ${backendProduct.title}`);
        newProducts++;
      }
    }

    // PASO 5: Sincronizar de IndexedDB al backend (actualizar ventas/stock)
    for (const product of localProducts) {
      const success = await syncProductToBackend(product.id!);
      if (success) {
        updatedProducts++;
      }
    }

    console.log(`\n✅ Sincronización bidireccional completada:`);
    console.log(`   Productos nuevos: ${newProducts}`);
    console.log(`   Productos actualizados: ${updatedProducts}`);

  } catch (error) {
    console.error('❌ Error en sincronización bidireccional:', error);
  }
}

// Exportar para usar desde la consola del navegador
(window as any).syncAllProductsToBackend = syncAllProductsToBackend;

console.log('💡 Función disponible: window.syncAllProductsToBackend()');
