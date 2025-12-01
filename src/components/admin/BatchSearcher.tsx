import React, { useState, useEffect } from 'react';
import { getBatchesByProduct, Batch } from '../../lib/batch-service';
import { Search, AlertCircle } from 'lucide-react';
import { getAllProducts } from '../../lib/inventory';

interface Product {
  id: number;
  title: string;
  price: number;
  stock: number;
  unit: string;
}

const BatchSearcher: React.FC = () => {
  const [searchInput, setSearchInput] = useState('');
  const [suggestions, setSuggestions] = useState<Product[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [allProducts, setAllProducts] = useState<Product[]>([]);

  // Cargar productos al inicializar
  useEffect(() => {
    async function loadProducts() {
      const products = await getAllProducts();
      setAllProducts(products);
    }
    loadProducts();
  }, []);

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

  const isNearExpiry = (expiryDate: string, daysThreshold: number = 30): boolean => {
    const today = new Date();
    const expiry = new Date(expiryDate);
    const daysUntilExpiry = Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilExpiry <= daysThreshold && daysUntilExpiry > 0;
  };

  const isExpired = (expiryDate: string): boolean => {
    return new Date(expiryDate) < new Date();
  };

  const getDaysUntilExpiry = (expiryDate: string): number => {
    const today = new Date();
    const expiry = new Date(expiryDate);
    return Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  };

  const totalStock = batches.reduce((sum, batch) => sum + batch.quantity, 0);

  return (
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
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded shadow-lg z-10">
                {suggestions.slice(0, 5).map(product => (
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
            className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
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
                {batches.length} lote(s) con stock | Total: <span className="font-bold">{totalStock} unidades</span>
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
                      return (
                        <tr key={index} className="border-b hover:bg-gray-50">
                          <td className="px-4 py-3 font-mono font-semibold">{batch.batchCode}</td>
                          <td className="px-4 py-3 text-center">{batch.quantity}</td>
                          <td className="px-4 py-3 text-center">{batch.expiryDate}</td>
                          <td className="px-4 py-3 text-center font-semibold">
                            {isExpired(batch.expiryDate) ? (
                              <span className="text-red-600">Vencido</span>
                            ) : (
                              <span className={daysRemaining <= 30 ? 'text-orange-600' : 'text-green-600'}>
                                {daysRemaining}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {isExpired(batch.expiryDate) ? (
                              <span className="bg-red-100 text-red-700 px-2 py-1 rounded text-xs font-semibold">Vencido</span>
                            ) : isNearExpiry(batch.expiryDate) ? (
                              <span className="bg-yellow-100 text-yellow-700 px-2 py-1 rounded text-xs font-semibold">⚠️ Próximo</span>
                            ) : (
                              <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-semibold">✓ Ok</span>
                            )}
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
  );
};

export default BatchSearcher;
