import React, { useState, useEffect } from 'react';
import { getBatchesByProduct, Batch } from '../../lib/batch-service';
import { db } from '../../lib/inventory';
import { Search, AlertCircle, Package, Calendar } from 'lucide-react';
import { getAllProducts } from '../../lib/inventory';

interface Product {
  id: number;
  title: string;
  price: number;
  stock: number;
  unit: string;
}

const BatchManager: React.FC = () => {
  const [searchInput, setSearchInput] = useState('');
  const [suggestions, setSuggestions] = useState<Product[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [expiringBatches, setExpiringBatches] = useState<{
    critical: Batch[];
    warning: Batch[];
    caution: Batch[];
    good: Batch[];
    excellent: Batch[];
  }>({ critical: [], warning: [], caution: [], good: [], excellent: [] });

  // Cargar productos y lotes al inicializar
  useEffect(() => {
    async function loadData() {
      const products = await getAllProducts();
      setAllProducts(products);
      await loadExpiringBatches();
    }
    loadData();
  }, []);

  // Cargar todos los lotes y clasificarlos por vencimiento
  const loadExpiringBatches = async () => {
    try {
      const allBatches = await db.batches.toArray();
      const activeBatches = allBatches.filter(b => b.quantity > 0);
      
      const categorized = {
        critical: [] as Batch[],
        warning: [] as Batch[],
        caution: [] as Batch[],
        good: [] as Batch[],
        excellent: [] as Batch[]
      };

      activeBatches.forEach(batch => {
        const days = getDaysUntilExpiry(batch.expiryDate);
        if (days < 0) return; // Ignorar vencidos
        
        if (days < 7) categorized.critical.push(batch);
        else if (days >= 7 && days < 15) categorized.warning.push(batch);
        else if (days >= 15 && days < 30) categorized.caution.push(batch);
        else if (days >= 30 && days < 60) categorized.good.push(batch);
        else categorized.excellent.push(batch);
      });

      setExpiringBatches(categorized);
    } catch (error) {
      console.error('Error al cargar lotes:', error);
    }
  };

  // Mostrar sugerencias mientras se escribe
  const handleInputChange = (value: string) => {
    setSearchInput(value);
    setSelectedProduct(null);
    setBatches([]);
    setSearched(false);

    if (value.length > 0) {
      const filtered = allProducts.filter(p =>
        p.title.toLowerCase().includes(value.toLowerCase())
      );
      setSuggestions(filtered);
    } else {
      setSuggestions([]);
    }
  };

  // Seleccionar un producto de las sugerencias
  const handleSelectProduct = async (product: Product) => {
    setSelectedProduct(product);
    setSearchInput(product.title);
    setSuggestions([]);
    await fetchBatches(product.id);
  };

  // Buscar por Enter o clic en botón
  const handleSearch = async () => {
    if (selectedProduct) {
      await fetchBatches(selectedProduct.id);
    } else if (searchInput.length > 0) {
      const filtered = allProducts.filter(p =>
        p.title.toLowerCase().includes(searchInput.toLowerCase())
      );
      if (filtered.length === 1) {
        setSelectedProduct(filtered[0]);
        await fetchBatches(filtered[0].id);
      } else if (filtered.length === 0) {
        alert('No se encontró ningún producto con ese nombre');
      }
    } else {
      alert('Por favor ingresa un nombre de producto');
    }
  };

  // Obtener lotes del producto
  const fetchBatches = async (productId: number) => {
    try {
      setLoading(true);
      const result = await getBatchesByProduct(productId);
      // Filtrar lotes con cantidad > 0
      const activeBatches = result.filter(batch => batch.quantity > 0);
      setBatches(activeBatches);
      setSearched(true);
    } catch (error) {
      console.error('Error al buscar lotes:', error);
      alert('Error al buscar lotes');
    } finally {
      setLoading(false);
    }
  };

  const getDaysUntilExpiry = (expiryDate: string): number => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(expiryDate);
    expiry.setHours(0, 0, 0, 0);
    return Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  };

  const getExpiryColorClass = (days: number): { bg: string; text: string; border: string } => {
    if (days < 7) return { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300' };
    if (days >= 7 && days < 15) return { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-300' };
    if (days >= 15 && days < 30) return { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-300' };
    if (days >= 30 && days < 60) return { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-300' };
    return { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300' };
  };

  const getProductName = async (productId: number): Promise<string> => {
    const product = await db.products.get(productId);
    return product?.title || 'Producto Desconocido';
  };

  const totalStock = batches.reduce((sum, batch) => sum + batch.quantity, 0);

  return (
    <div className="space-y-6">
      {/* Buscador de Lotes */}
      <div className="bg-white rounded-lg p-6 shadow-md">
        <div className="flex items-center mb-6">
          <Search className="h-6 w-6 mr-2 text-blue-600" />
          <h2 className="text-2xl font-bold">Búsqueda de Lotes por Producto</h2>
        </div>

        <div className="relative mb-6">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Escribe el nombre del producto (Ej: Arroz, Leche...)"
                className="w-full border rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              
              {/* Sugerencias */}
              {suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded shadow-lg z-10 max-h-60 overflow-y-auto">
                  {suggestions.slice(0, 10).map(product => (
                    <button
                      key={product.id}
                      onClick={() => handleSelectProduct(product)}
                      className="w-full text-left px-4 py-2 hover:bg-blue-50 border-b last:border-b-0"
                    >
                      <div className="font-semibold">{product.title}</div>
                      <div className="text-xs text-gray-500">Stock: {product.stock} {product.unit}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            <button
              onClick={handleSearch}
              disabled={loading}
              className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
            >
              {loading ? 'Buscando...' : 'Buscar'}
            </button>
          </div>
        </div>

        {searched && !loading && (
          <div className="space-y-4">
            {selectedProduct && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-blue-900 mb-2">{selectedProduct.title}</h3>
                <p className="text-sm text-blue-700">
                  {batches.length} lote(s) activo(s) | Total: <span className="font-bold">{totalStock} unidades</span>
                </p>
              </div>
            )}

            {batches.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <AlertCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No hay lotes activos para este producto</p>
              </div>
            ) : (
              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-100 border-b">
                      <th className="px-4 py-3 text-left font-semibold">Código Lote</th>
                      <th className="px-4 py-3 text-center font-semibold">Cantidad</th>
                      <th className="px-4 py-3 text-center font-semibold">Fecha Caducidad</th>
                      <th className="px-4 py-3 text-center font-semibold">Días Restantes</th>
                      <th className="px-4 py-3 text-center font-semibold">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches
                      .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())
                      .map((batch, index) => {
                        const daysRemaining = getDaysUntilExpiry(batch.expiryDate);
                        const colorClass = getExpiryColorClass(daysRemaining);
                        return (
                          <tr key={index} className="border-b hover:bg-gray-50">
                            <td className="px-4 py-3 font-mono font-semibold">{batch.batchCode}</td>
                            <td className="px-4 py-3 text-center">{batch.quantity}</td>
                            <td className="px-4 py-3 text-center">{batch.expiryDate}</td>
                            <td className="px-4 py-3 text-center font-bold">
                              <span className={colorClass.text}>{daysRemaining} días</span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`${colorClass.bg} ${colorClass.text} px-3 py-1 rounded-full text-xs font-semibold border ${colorClass.border}`}>
                                {daysRemaining < 7 ? '🔴 CRÍTICO' :
                                 daysRemaining < 15 ? '🟠 URGENTE' :
                                 daysRemaining < 30 ? '🟡 ATENCIÓN' :
                                 daysRemaining < 60 ? '🟢 BUENO' : '🔵 EXCELENTE'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Alertas de Lotes Próximos a Vencer */}
      <div className="bg-white rounded-lg p-6 shadow-md">
        <div className="flex items-center mb-6">
          <Calendar className="h-6 w-6 mr-2 text-orange-600" />
          <h2 className="text-2xl font-bold">Alertas de Vencimiento - Todos los Lotes</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* CRÍTICO: Menos de 7 días */}
          <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-red-800 flex items-center gap-2">
                <span className="text-2xl">🔴</span>
                CRÍTICO (&lt; 7 días)
              </h3>
              <span className="bg-red-200 text-red-900 px-3 py-1 rounded-full font-bold text-sm">
                {expiringBatches.critical.length}
              </span>
            </div>
            {expiringBatches.critical.length === 0 ? (
              <p className="text-sm text-red-600">No hay lotes críticos</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {expiringBatches.critical.map((batch, idx) => (
                  <BatchAlert key={idx} batch={batch} getProductName={getProductName} getDays={getDaysUntilExpiry} />
                ))}
              </div>
            )}
          </div>

          {/* URGENTE: 7-14 días */}
          <div className="bg-orange-50 border-2 border-orange-300 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-orange-800 flex items-center gap-2">
                <span className="text-2xl">🟠</span>
                URGENTE (7-14 días)
              </h3>
              <span className="bg-orange-200 text-orange-900 px-3 py-1 rounded-full font-bold text-sm">
                {expiringBatches.warning.length}
              </span>
            </div>
            {expiringBatches.warning.length === 0 ? (
              <p className="text-sm text-orange-600">No hay lotes urgentes</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {expiringBatches.warning.map((batch, idx) => (
                  <BatchAlert key={idx} batch={batch} getProductName={getProductName} getDays={getDaysUntilExpiry} />
                ))}
              </div>
            )}
          </div>

          {/* ATENCIÓN: 15-29 días */}
          <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-yellow-800 flex items-center gap-2">
                <span className="text-2xl">🟡</span>
                ATENCIÓN (15-29 días)
              </h3>
              <span className="bg-yellow-200 text-yellow-900 px-3 py-1 rounded-full font-bold text-sm">
                {expiringBatches.caution.length}
              </span>
            </div>
            {expiringBatches.caution.length === 0 ? (
              <p className="text-sm text-yellow-600">No hay lotes en atención</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {expiringBatches.caution.map((batch, idx) => (
                  <BatchAlert key={idx} batch={batch} getProductName={getProductName} getDays={getDaysUntilExpiry} />
                ))}
              </div>
            )}
          </div>

          {/* BUENO: 30-59 días */}
          <div className="bg-green-50 border-2 border-green-300 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-green-800 flex items-center gap-2">
                <span className="text-2xl">🟢</span>
                BUENO (30-59 días)
              </h3>
              <span className="bg-green-200 text-green-900 px-3 py-1 rounded-full font-bold text-sm">
                {expiringBatches.good.length}
              </span>
            </div>
            {expiringBatches.good.length === 0 ? (
              <p className="text-sm text-green-600">No hay lotes en este rango</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {expiringBatches.good.slice(0, 5).map((batch, idx) => (
                  <BatchAlert key={idx} batch={batch} getProductName={getProductName} getDays={getDaysUntilExpiry} />
                ))}
                {expiringBatches.good.length > 5 && (
                  <p className="text-xs text-green-700 italic">+{expiringBatches.good.length - 5} más...</p>
                )}
              </div>
            )}
          </div>

          {/* EXCELENTE: 60+ días */}
          <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-blue-800 flex items-center gap-2">
                <span className="text-2xl">🔵</span>
                EXCELENTE (≥60 días)
              </h3>
              <span className="bg-blue-200 text-blue-900 px-3 py-1 rounded-full font-bold text-sm">
                {expiringBatches.excellent.length}
              </span>
            </div>
            {expiringBatches.excellent.length === 0 ? (
              <p className="text-sm text-blue-600">No hay lotes en este rango</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {expiringBatches.excellent.slice(0, 5).map((batch, idx) => (
                  <BatchAlert key={idx} batch={batch} getProductName={getProductName} getDays={getDaysUntilExpiry} />
                ))}
                {expiringBatches.excellent.length > 5 && (
                  <p className="text-xs text-blue-700 italic">+{expiringBatches.excellent.length - 5} más...</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Componente para mostrar alerta individual de lote
const BatchAlert: React.FC<{
  batch: Batch;
  getProductName: (id: number) => Promise<string>;
  getDays: (date: string) => number;
}> = ({ batch, getProductName, getDays }) => {
  const [productName, setProductName] = useState('Cargando...');

  useEffect(() => {
    getProductName(batch.productId).then(setProductName);
  }, [batch.productId]);

  const days = getDays(batch.expiryDate);

  return (
    <div className="bg-white rounded p-3 shadow-sm border">
      <div className="font-semibold text-sm text-gray-900">{productName}</div>
      <div className="text-xs text-gray-600 mt-1">
        <span className="font-mono font-bold">{batch.batchCode}</span> | {batch.quantity} uds
      </div>
      <div className="text-xs text-gray-500 mt-1">
        Vence: {batch.expiryDate} <span className="font-bold">({days}d)</span>
      </div>
    </div>
  );
};

export default BatchManager;
