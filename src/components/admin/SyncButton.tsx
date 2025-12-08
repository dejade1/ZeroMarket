import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { db } from '../../lib/db';

export function SyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');

  const syncProducts = async () => {
    setSyncing(true);
    setMessage('');

    try {
      console.log('🔄 Iniciando sincronización de productos...');

      // Obtener todos los productos
      const products = await db.products.toArray();
      console.log(`📦 Total de productos: ${products.length}`);

      let syncedCount = 0;
      let skippedCount = 0;

      for (const product of products) {
        if (!product.stock || product.stock <= 0) {
          console.log(`⏭️  Saltando "${product.title}" - sin stock`);
          skippedCount++;
          continue;
        }

        // Verificar si tiene lotes
        const batches = await db.batches.where('productId').equals(product.id!).toArray();
        const totalBatchQty = batches.reduce((sum, b) => sum + b.quantity, 0);

        if (totalBatchQty === 0 && product.stock > 0) {
          // Crear lote inicial
          const expiryDate = new Date();
          expiryDate.setMonth(expiryDate.getMonth() + 6);

          const batchData = {
            productId: product.id!,
            batchCode: `SYNC-${product.id}-${Date.now()}`,
            quantity: product.stock,
            expiryDate: expiryDate.toISOString().split('T')[0],
            createdAt: new Date().toISOString()
          };

          await db.batches.add(batchData);

          // Inicializar sales en 0 si no existe
          if (product.sales === undefined) {
            await db.products.update(product.id!, { sales: 0 });
          }
          console.log(`✅ Lote creado para "${product.title}": ${product.stock} unidades`);
          syncedCount++;
        } else if (totalBatchQty === product.stock) {
          console.log(`✓ "${product.title}" ya está sincronizado`);
          skippedCount++;
        } else if (totalBatchQty < product.stock) {
          console.warn(`⚠️  "${product.title}" tiene inconsistencia: Stock=${product.stock}, Lotes=${totalBatchQty}`);
          // Crear lote para la diferencia
          const diff = product.stock - totalBatchQty;
          const expiryDate = new Date();
          expiryDate.setMonth(expiryDate.getMonth() + 6);

          await db.batches.add({
            productId: product.id!,
            batchCode: `SYNC-DIFF-${product.id}-${Date.now()}`,
            quantity: diff,
            expiryDate: expiryDate.toISOString().split('T')[0],
            createdAt: new Date().toISOString()
          });

          // Inicializar sales en 0 si no existe
          if (product.sales === undefined) {
            await db.products.update(product.id!, { sales: 0 });
          }
          console.log(`✅ Lote de diferencia creado para "${product.title}": ${diff} unidades`);
          syncedCount++;
        } else {
          skippedCount++;
        }
      }

      console.log('\n📊 RESUMEN:');
      console.log(`✅ Productos sincronizados: ${syncedCount}`);
      console.log(`⏭️  Productos saltados: ${skippedCount}`);
      console.log(`📦 Total procesados: ${products.length}`);

      setMessage(`✅ Sincronización completada: ${syncedCount} productos sincronizados, ${skippedCount} saltados`);

    } catch (error) {
      console.error('❌ Error durante la sincronización:', error);
      setMessage(`❌ Error: ${error instanceof Error ? error.message : 'Error desconocido'}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={syncProducts}
        disabled={syncing}
        className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors ${
          syncing
            ? 'bg-gray-300 cursor-not-allowed'
            : 'bg-green-500 hover:bg-green-600 text-white'
        }`}
        title="Sincronizar productos sin lotes"
      >
        <RefreshCw className={`w-5 h-5 ${syncing ? 'animate-spin' : ''}`} />
        {syncing ? 'Sincronizando...' : 'Sincronizar Lotes'}
      </button>

      {message && (
        <span className={`text-sm ${message.startsWith('✅') ? 'text-green-600' : 'text-red-600'}`}>
          {message}
        </span>
      )}
    </div>
  );
}
