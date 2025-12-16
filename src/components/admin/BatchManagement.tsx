import React, { useState, useEffect } from 'react';
import { Package, AlertTriangle, Calendar, BarChart3, Trash2, Info } from 'lucide-react';

// ==================== TIPOS ====================

interface Product {
  id: number;
  title: string;
  stock: number;
  category?: string | null;
}

interface Batch {
  id: number;
  productId: number;
  batchCode: string;
  quantity: number;
  expiryDate: string;
  createdAt: string;
  product?: Product;
}

interface BatchSummary {
  productId: number;
  productTitle: string;
  stockTotal: number;
  stockInBatches: number;
  stockOutsideBatches: number;
  batches: Array<{
    id: number;
    code: string;
    quantity: number;
    expiryDate: string;
    daysUntilExpiry: number;
  }>;
}

const API_URL = 'http://localhost:3000';

// ==================== COMPONENTE ====================

export function BatchManagement() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<number>(0);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [expiringBatches, setExpiringBatches] = useState<Batch[]>([]);
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadProducts();
    loadExpiringBatches();
  }, []);

  useEffect(() => {
    if (selectedProductId > 0) {
      loadProductBatches(selectedProductId);
      loadBatchSummary(selectedProductId);
    }
  }, [selectedProductId]);

  // ==================== FUNCIONES DE CARGA ====================

  async function loadProducts() {
    try {
      const response = await fetch(`${API_URL}/api/admin/products`, {
        credentials: 'include'
      });
      const data = await response.json();
      setProducts(data.products || []);
    } catch (error) {
      console.error('Error loading products:', error);
    }
  }

  async function loadProductBatches(productId: number) {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/admin/batches/product/${productId}`, {
        credentials: 'include'
      });
      const data = await response.json();
      setBatches(data.batches || []);
    } catch (error) {
      console.error('Error loading batches:', error);
      setError('Error al cargar lotes');
    } finally {
      setLoading(false);
    }
  }

  async function loadBatchSummary(productId: number) {
    try {
      const response = await fetch(`${API_URL}/api/admin/batches/product/${productId}/summary`, {
        credentials: 'include'
      });
      const data = await response.json();
      setBatchSummary(data.summary || null);
    } catch (error) {
      console.error('Error loading batch summary:', error);
    }
  }

  async function loadExpiringBatches() {
    try {
      const response = await fetch(`${API_URL}/api/admin/batches/expiring?days=30`, {
        credentials: 'include'
      });
      const data = await response.json();
      setExpiringBatches(data.batches || []);
    } catch (error) {
      console.error('Error loading expiring batches:', error);
    }
  }

  // ==================== FUNCIONES DE ACCIÓN ====================

  async function handleDeleteBatch(batchId: number, batchCode: string) {
    if (!confirm(`¿Está seguro de eliminar el lote ${batchCode}?`)) {
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/admin/batches/${batchId}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al eliminar lote');
      }

      setSuccess(`Lote ${batchCode} eliminado`);
      if (selectedProductId > 0) {
        await loadProductBatches(selectedProductId);
        await loadBatchSummary(selectedProductId);
      }
      await loadExpiringBatches();
    } catch (error: any) {
      setError(error.message || 'Error al eliminar lote');
    }
  }

  // ==================== UTILIDADES ====================

  function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function getDaysUntilExpiry(expiryDate: string): number {
    const expiry = new Date(expiryDate);
    const now = new Date();
    const diffTime = expiry.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  function getExpiryColor(days: number): string {
    if (days < 0) return 'bg-red-100 text-red-800';
    if (days <= 7) return 'bg-orange-100 text-orange-800';
    if (days <= 30) return 'bg-yellow-100 text-yellow-800';
    return 'bg-green-100 text-green-800';
  }

  // ==================== RENDER ====================

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Gestión de Lotes</h2>
        <p className="text-sm text-gray-600 mt-1">Monitoreo de lotes, FIFO automático y alertas de vencimiento</p>
      </div>

      {/* ✅ INFORMACIÓN IMPORTANTE */}
      <div className="bg-blue-50 border-l-4 border-blue-400 p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <Info className="h-5 w-5 text-blue-400" />
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">
              📦 Los lotes se crean automáticamente
            </h3>
            <div className="mt-2 text-sm text-blue-700">
              <ul className="list-disc list-inside space-y-1">
                <li><strong>Primer lote:</strong> Se crea al agregar un producto nuevo en "Gestión de Productos"</li>
                <li><strong>Lotes siguientes:</strong> Se crean al reabastecer en "Ajustes de Stock"</li>
                <li><strong>Nomenclatura:</strong> ArrPreBl-1-16122025 (Producto-Secuencia-Fecha)</li>
                <li><strong>FIFO:</strong> En ventas se consumen automáticamente los lotes más próximos a vencer</li>
                <li><strong>Retiros manuales:</strong> Se selecciona el lote específico en "Ajustes de Stock"</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Mensajes */}
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-md">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 text-green-600 p-4 rounded-md">
          {success}
        </div>
      )}

      {/* Alertas de Vencimiento */}
      {expiringBatches.length > 0 && (
        <div className="bg-orange-50 border-l-4 border-orange-400 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <AlertTriangle className="h-5 w-5 text-orange-400" />
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-orange-800">
                {expiringBatches.length} lote(s) próximo(s) a vencer en 30 días
              </h3>
              <div className="mt-2 text-sm text-orange-700">
                <ul className="list-disc list-inside space-y-1">
                  {expiringBatches.slice(0, 5).map((batch) => {
                    const days = getDaysUntilExpiry(batch.expiryDate);
                    return (
                      <li key={batch.id}>
                        <strong>{batch.batchCode}</strong> - {batch.product?.title} ({batch.quantity} unidades)
                        - Vence en <strong>{days} días</strong> ({formatDate(batch.expiryDate)})
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Selector de Producto */}
      <div className="bg-white shadow rounded-lg p-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Seleccionar Producto para Ver Lotes
        </label>
        <select
          value={selectedProductId}
          onChange={(e) => setSelectedProductId(parseInt(e.target.value))}
          className="w-full md:w-1/2 rounded-md border-gray-300 shadow-sm focus:border-yellow-500 focus:ring-yellow-500"
        >
          <option value={0}>-- Seleccionar producto --</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title} (Stock total: {p.stock})
            </option>
          ))}
        </select>
      </div>

      {/* Resumen de Lotes */}
      {batchSummary && (
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center mb-4">
            <BarChart3 className="h-6 w-6 text-yellow-600 mr-2" />
            <h3 className="text-lg font-semibold">Resumen: {batchSummary.productTitle}</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600">Stock Total</p>
              <p className="text-2xl font-bold text-blue-900">{batchSummary.stockTotal}</p>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600">En Lotes</p>
              <p className="text-2xl font-bold text-green-900">{batchSummary.stockInBatches}</p>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600">Fuera de Lotes</p>
              <p className="text-2xl font-bold text-gray-900">{batchSummary.stockOutsideBatches}</p>
            </div>
          </div>
        </div>
      )}

      {/* Tabla de Lotes */}
      {selectedProductId > 0 && (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold flex items-center">
              <Package className="h-5 w-5 mr-2 text-yellow-600" />
              Lotes del Producto
            </h3>
          </div>
          {loading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400 mx-auto"></div>
            </div>
          ) : batches.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No hay lotes registrados para este producto
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Código de Lote
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Cantidad
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Fecha de Vencimiento
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Días Restantes
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Creado
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {batches.map((batch) => {
                  const daysLeft = getDaysUntilExpiry(batch.expiryDate);
                  return (
                    <tr key={batch.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-mono text-sm font-semibold text-gray-900">
                          {batch.batchCode}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-900">{batch.quantity} unidades</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <Calendar className="h-4 w-4 mr-2 text-gray-400" />
                          <span className="text-sm text-gray-900">{formatDate(batch.expiryDate)}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getExpiryColor(daysLeft)}`}>
                          {daysLeft < 0 ? 'VENCIDO' : `${daysLeft} días`}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(batch.createdAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {batch.quantity === 0 && (
                          <button
                            onClick={() => handleDeleteBatch(batch.id, batch.batchCode)}
                            className="text-red-600 hover:text-red-900 inline-flex items-center"
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Eliminar
                          </button>
                        )}
                        {batch.quantity > 0 && (
                          <span className="text-green-600 text-xs font-medium">Activo</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
