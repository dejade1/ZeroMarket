import React, { useState, useEffect } from 'react';
import { getBatchesByProduct, Batch } from '../../lib/batch-service';
import { AlertCircle, Package } from 'lucide-react';

interface Props {
  productId: number;
  productName: string;
}

const BatchManager: React.FC<Props> = ({ productId, productName }) => {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchBatches() {
      try {
        const b = await getBatchesByProduct(productId);
        setBatches(b);
      } catch (error) {
        console.error('Error al cargar lotes:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchBatches();
  }, [productId]);

  const isNearExpiry = (expiryDate: string, daysThreshold: number = 30): boolean => {
    const today = new Date();
    const expiry = new Date(expiryDate);
    const daysUntilExpiry = Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilExpiry <= daysThreshold && daysUntilExpiry > 0;
  };

  const isExpired = (expiryDate: string): boolean => {
    return new Date(expiryDate) < new Date();
  };

  const totalStock = batches.reduce((sum, batch) => sum + batch.quantity, 0);

  return (
    <div className="bg-white rounded-lg p-6 shadow-md">
      <div className="flex items-center mb-4">
        <Package className="h-6 w-6 mr-2 text-blue-600" />
        <h3 className="text-xl font-semibold">Lotes de {productName}</h3>
      </div>

      {loading ? (
        <p className="text-gray-500">Cargando lotes...</p>
      ) : batches.filter(b => b.quantity > 0).length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <AlertCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p>No hay lotes activos para este producto</p>
        </div>
      ) : (
        <div>
          <div className="mb-4 p-4 bg-gray-100 rounded">
            <p className="font-semibold">Stock Total en Lotes: <span className="text-blue-600">{totalStock} unidades</span></p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-200">
                  <th className="border px-4 py-2 text-left">Código Lote</th>
                  <th className="border px-4 py-2 text-center">Cantidad</th>
                  <th className="border px-4 py-2 text-center">Fecha Caducidad</th>
                  <th className="border px-4 py-2 text-center">Estado</th>
                </tr>
              </thead>
              <tbody>
                {batches
                  .filter(batch => batch.quantity > 0)
                  .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())
                  .map(batch => (
                    <tr key={batch.id} className="hover:bg-gray-50">
                      <td className="border px-4 py-2 font-mono font-semibold">{batch.batchCode}</td>
                      <td className="border px-4 py-2 text-center">{batch.quantity}</td>
                      <td className="border px-4 py-2 text-center">{batch.expiryDate}</td>
                      <td className="border px-4 py-2 text-center">
                        {isExpired(batch.expiryDate) ? (
                          <span className="bg-red-100 text-red-700 px-3 py-1 rounded text-xs font-semibold">Vencido</span>
                        ) : isNearExpiry(batch.expiryDate) ? (
                          <span className="bg-yellow-100 text-yellow-700 px-3 py-1 rounded text-xs font-semibold">⚠️ Por Vencer</span>
                        ) : (
                          <span className="bg-green-100 text-green-700 px-3 py-1 rounded text-xs font-semibold">✓ Vigente</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default BatchManager;
