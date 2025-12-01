import React, { useState, useEffect } from 'react';
import { Batch, getExpiringBatches } from '../../lib/batch-service';
import { AlertTriangle, Calendar } from 'lucide-react';
import { getAllProducts } from '../../lib/inventory';

interface BatchWithProduct extends Batch {
  productName?: string;
}

const ExpiringBatchesAlert: React.FC = () => {
  const [expiringBatches, setExpiringBatches] = useState<BatchWithProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [daysThreshold, setDaysThreshold] = useState(30);

  useEffect(() => {
    async function fetchExpiringBatches() {
      try {
        setLoading(true);
        // Obtener lotes próximos a vencer usando el servicio optimizado (usa índice)
        const allProducts = await getAllProducts() || [];
        const productMap = new Map(allProducts.map(p => [p.id, p.title]));

        const batches = await getExpiringBatches(daysThreshold);
        const expiring = (batches as Batch[])
          .filter(b => b.quantity > 0)
          .map((batch: Batch) => ({
            ...batch,
            productName: productMap.get(batch.productId) || `Producto #${batch.productId}`
          }))
          .sort((a: BatchWithProduct, b: BatchWithProduct) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());

        setExpiringBatches(expiring);
      } catch (error) {
        console.error('Error al cargar lotes próximos a vencer:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchExpiringBatches();
  }, [daysThreshold]);

  const getDaysUntilExpiry = (expiryDate: string): number => {
    const today = new Date();
    const expiry = new Date(expiryDate);
    return Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  };

  const getAlertColor = (daysUntilExpiry: number) => {
    if (daysUntilExpiry <= 7) return 'bg-red-50 border-red-200';
    if (daysUntilExpiry <= 15) return 'bg-orange-50 border-orange-200';
    return 'bg-yellow-50 border-yellow-200';
  };

  const getAlertIcon = (daysUntilExpiry: number) => {
    if (daysUntilExpiry <= 7) return '🔴';
    if (daysUntilExpiry <= 15) return '🟠';
    return '🟡';
  };

  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden">
      <div className="bg-red-600 text-white p-4 flex items-center justify-between">
        <div className="flex items-center">
          <AlertTriangle className="h-6 w-6 mr-2" />
          <h2 className="text-xl font-bold">Lotes Próximos a Caducarse</h2>
        </div>
        <div className="text-3xl font-bold">{expiringBatches.length}</div>
      </div>

      <div className="p-4">
        <div className="mb-4">
          <label className="block text-sm font-semibold mb-2">Mostrar lotes que vencen en:</label>
          <select
            value={daysThreshold}
            onChange={(e) => setDaysThreshold(Number(e.target.value))}
            className="border rounded px-3 py-2 w-full sm:w-48"
          >
            <option value={7}>7 días</option>
            <option value={14}>14 días</option>
            <option value={30}>30 días</option>
            <option value={60}>60 días</option>
            <option value={90}>90 días</option>
          </select>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-500">
            <div className="animate-spin h-8 w-8 border-4 border-blue-200 border-t-blue-600 rounded-full mx-auto mb-2"></div>
            Cargando información de lotes...
          </div>
        ) : expiringBatches.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No hay lotes próximos a vencer en los próximos {daysThreshold} días</p>
          </div>
        ) : (
          <div className="space-y-3">
            {expiringBatches.map((batch) => {
              const daysUntil = getDaysUntilExpiry(batch.expiryDate);
              return (
                <div
                  key={`${batch.productId}-${batch.batchCode}`}
                  className={`border-l-4 p-4 rounded ${getAlertColor(daysUntil)}`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-2xl">{getAlertIcon(daysUntil)}</span>
                        <span className="font-mono font-bold text-lg">{batch.batchCode}</span>
                      </div>
                      <p className="text-sm text-gray-600">{batch.productName}</p>
                      <p className="text-sm font-semibold mt-1">
                        Cantidad en Stock: <span className="text-blue-600">{batch.quantity} unidades</span>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">Vence en:</p>
                      <p className="text-lg font-bold text-red-600">{daysUntil} días</p>
                      <p className="text-xs text-gray-500">{batch.expiryDate}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-gray-50 p-4 border-t text-sm text-gray-600">
        <p>🔴 Crítico (0-7 días) | 🟠 Urgente (8-15 días) | 🟡 Precaución (16-30 días)</p>
      </div>
    </div>
  );
};

export default ExpiringBatchesAlert;
