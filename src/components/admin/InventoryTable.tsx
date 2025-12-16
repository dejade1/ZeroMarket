import React, { useState, useEffect } from 'react';
import { Pencil, Save, X, Settings } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

// ==================== TIPOS ====================

interface Product {
  id: number;
  title: string;
  description?: string | null;
  price: number;
  stock: number;
  initialStock?: number | null;
  unit: string;
  image?: string | null;
  rating: number;
  category?: string | null;
  sales: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}

const API_URL = 'http://localhost:3000';

// ==================== COMPONENTE ====================

export function InventoryTable() {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<Product>>({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);

  // Estados para modal de ajuste
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [adjustingProduct, setAdjustingProduct] = useState<Product | null>(null);
  const [adjustQuantity, setAdjustQuantity] = useState('');
  const [adjustNote, setAdjustNote] = useState('');

  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    loadProducts();
  }, []);

  /**
   * ✅ Carga productos desde el backend
   */
  const loadProducts = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/admin/products`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Error al cargar productos');
      }

      const data = await response.json();
      setProducts(data.products || []);
    } catch (error) {
      console.error('Error loading products:', error);
      setError('Error al cargar productos');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (product: Product) => {
    setEditingId(product.id);
    setEditForm(product);
  };

  /**
   * ✅ Guarda cambios en el backend
   */
  const handleSave = async () => {
    if (!editingId || !editForm) return;

    try {
      const updateData = {
        title: editForm.title,
        image: editForm.image,
        price: Number(editForm.price),
        stock: Number(editForm.stock),
        rating: Number(editForm.rating)
      };

      const response = await fetch(`${API_URL}/api/admin/products/${editingId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateData)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Error al guardar');
      }

      setSuccess('Producto actualizado correctamente');
      setEditingId(null);
      setEditForm({});
      await loadProducts();

      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      console.error('Error saving:', error);
      setError(error instanceof Error ? error.message : 'Error al guardar los cambios');
      setTimeout(() => setError(''), 3000);
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handleChange = (field: keyof Product, value: any) => {
    setEditForm(prev => ({
      ...prev,
      [field]: value
    }));
  };

  /**
   * ✅ Ajusta stock en el backend
   */
  const handleAdjustStock = async () => {
    if (!adjustingProduct || !adjustingProduct.id) return;

    try {
      const adjustment = parseInt(adjustQuantity);

      if (isNaN(adjustment)) {
        setError('Por favor ingresa un número válido');
        return;
      }

      const newStock = adjustingProduct.stock + adjustment;

      if (newStock < 0) {
        setError('El stock no puede ser negativo');
        return;
      }

      const response = await fetch(`${API_URL}/api/admin/products/${adjustingProduct.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ stock: newStock })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Error al ajustar stock');
      }

      setSuccess(`Stock ajustado correctamente: ${adjustment > 0 ? '+' : ''}${adjustment} unidades`);
      setAdjustModalOpen(false);
      setAdjustingProduct(null);
      setAdjustQuantity('');
      setAdjustNote('');
      await loadProducts();

      setTimeout(() => setSuccess(''), 3000);
    } catch (error: any) {
      console.error('Error adjusting stock:', error);
      setError(error.message || 'Error al ajustar stock');
      setTimeout(() => setError(''), 3000);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <h2 className="text-xl font-semibold mb-4">Control de Inventario</h2>

      {error && (
        <div className="mb-4 bg-red-50 text-red-500 p-3 rounded-md text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 bg-green-50 text-green-500 p-3 rounded-md text-sm">
          {success}
        </div>
      )}

      <div className="-my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
        <div className="py-2 align-middle inline-block min-w-full sm:px-6 lg:px-8">
          <div className="shadow overflow-hidden border-b border-gray-200 sm:rounded-lg">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    #
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Producto
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Stock Inicial
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Stock Actual
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Diferencia
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Ventas
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Precio Unitario
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Ingresos Totales
                  </th>
                  {isAdmin && (
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Acciones
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {products.map((product, index) => {
                  const totalSales = product.sales || 0;
                  const totalRevenue = totalSales * product.price;
                  const isEditing = editingId === product.id;

                  // Calcular stock inicial y diferencia
                  const initialStock = product.initialStock ?? product.stock;
                  const difference = product.stock - initialStock;

                  return (
                    <tr key={product.id}>
                      {/* Columna # */}
                      <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-500">
                        {index + 1}
                      </td>

                      {/* Columna Producto */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          {isEditing ? (
                            <div className="space-y-2">
                              <input
                                type="text"
                                value={editForm.title || ''}
                                onChange={(e) => handleChange('title', e.target.value)}
                                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-yellow-500 focus:ring-yellow-500 sm:text-sm"
                                placeholder="Título del producto"
                              />
                              <input
                                type="url"
                                value={editForm.image || ''}
                                onChange={(e) => handleChange('image', e.target.value)}
                                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-yellow-500 focus:ring-yellow-500 sm:text-sm"
                                placeholder="URL de la imagen"
                              />
                            </div>
                          ) : (
                            <div className="flex items-center">
                              <div className="flex-shrink-0 h-10 w-10">
                                <img 
                                  className="h-10 w-10 rounded-full object-cover" 
                                  src={product.image || 'https://via.placeholder.com/150?text=No+Image'} 
                                  alt="" 
                                />
                              </div>
                              <div className="ml-4">
                                <div className="text-sm font-medium text-gray-900">{product.title}</div>
                              </div>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Columna Stock Inicial */}
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {initialStock}
                      </td>

                      {/* Columna Stock Actual */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editForm.stock || 0}
                            onChange={(e) => handleChange('stock', parseInt(e.target.value))}
                            className="block w-24 rounded-md border-gray-300 shadow-sm focus:border-yellow-500 focus:ring-yellow-500 sm:text-sm"
                          />
                        ) : (
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            product.stock < 10 ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                          }`}>
                            {product.stock}
                          </span>
                        )}
                      </td>

                      {/* Columna Diferencia */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2.5 py-1 inline-flex text-xs leading-5 font-bold rounded-full ${
                          difference < 0
                            ? 'bg-red-100 text-red-800'
                            : difference === 0
                              ? 'bg-green-100 text-green-800'
                              : 'bg-blue-100 text-blue-800'
                        }`}>
                          {difference > 0 ? `+${difference}` : difference}
                        </span>
                      </td>

                      {/* Columna Ventas */}
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {totalSales}
                      </td>

                      {/* Columna Precio */}
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.01"
                            value={editForm.price || 0}
                            onChange={(e) => handleChange('price', parseFloat(e.target.value))}
                            className="block w-24 rounded-md border-gray-300 shadow-sm focus:border-yellow-500 focus:ring-yellow-500 sm:text-sm"
                          />
                        ) : (
                          `$${product.price.toFixed(2)}`
                        )}
                      </td>

                      {/* Columna Ingresos */}
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        ${totalRevenue.toFixed(2)}
                      </td>

                      {/* Columna Acciones */}
                      {isAdmin && (
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          {isEditing ? (
                            <div className="flex space-x-2">
                              <button
                                onClick={handleSave}
                                className="text-green-600 hover:text-green-900"
                                title="Guardar cambios"
                              >
                                <Save className="h-5 w-5" />
                              </button>
                              <button
                                onClick={handleCancel}
                                className="text-red-600 hover:text-red-900"
                                title="Cancelar"
                              >
                                <X className="h-5 w-5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex space-x-2">
                              <button
                                onClick={() => handleEdit(product)}
                                className="text-yellow-600 hover:text-yellow-900"
                                title="Editar producto"
                              >
                                <Pencil className="h-5 w-5" />
                              </button>
                              <button
                                onClick={() => {
                                  setAdjustingProduct(product);
                                  setAdjustModalOpen(true);
                                }}
                                className="text-blue-600 hover:text-blue-900"
                                title="Ajustar stock"
                              >
                                <Settings className="h-5 w-5" />
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={2} className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    Totales
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    -
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">
                    {products.reduce((sum, p) => sum + p.stock, 0)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    -
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">
                    {products.reduce((sum, p) => sum + (p.sales || 0), 0)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    -
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">
                    ${products.reduce((sum, p) => sum + (p.sales || 0) * p.price, 0).toFixed(2)}
                  </td>
                  {isAdmin && <td></td>}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      {/* Modal de Ajuste de Stock */}
      {adjustModalOpen && adjustingProduct && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center">
          <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            {/* Header del Modal */}
            <div className="bg-blue-600 text-white px-6 py-4 rounded-t-lg">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Ajustar Stock</h3>
                <button
                  onClick={() => {
                    setAdjustModalOpen(false);
                    setAdjustingProduct(null);
                    setAdjustQuantity('');
                    setAdjustNote('');
                  }}
                  className="text-white hover:text-gray-200"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
            </div>

            {/* Contenido del Modal */}
            <div className="p-6 space-y-4">
              {/* Información del Producto */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-gray-900 mb-2">{adjustingProduct.title}</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-gray-600">Stock Inicial:</span>
                    <span className="ml-2 font-semibold text-gray-900">
                      {adjustingProduct.initialStock ?? adjustingProduct.stock}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">Stock Actual:</span>
                    <span className="ml-2 font-semibold text-gray-900">
                      {adjustingProduct.stock}
                    </span>
                  </div>
                </div>
              </div>

              {/* Input de Cantidad de Ajuste */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Cantidad a Ajustar (usar + o -)
                </label>
                <input
                  type="number"
                  value={adjustQuantity}
                  onChange={(e) => setAdjustQuantity(e.target.value)}
                  placeholder="Ej: +10 o -5"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoFocus
                />
                {adjustQuantity && !isNaN(parseInt(adjustQuantity)) && (
                  <div className="mt-2 text-sm">
                    <span className="text-gray-600">Nuevo stock:</span>
                    <span className={`ml-2 font-bold ${
                      adjustingProduct.stock + parseInt(adjustQuantity) < 0
                        ? 'text-red-600'
                        : 'text-green-600'
                    }`}>
                      {adjustingProduct.stock + parseInt(adjustQuantity)}
                    </span>
                  </div>
                )}
              </div>

              {/* Input de Nota (Opcional) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nota (Opcional)
                </label>
                <textarea
                  value={adjustNote}
                  onChange={(e) => setAdjustNote(e.target.value)}
                  placeholder="Razón del ajuste..."
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                />
              </div>
            </div>

            {/* Footer del Modal */}
            <div className="bg-gray-50 px-6 py-4 rounded-b-lg flex justify-end space-x-3">
              <button
                onClick={() => {
                  setAdjustModalOpen(false);
                  setAdjustingProduct(null);
                  setAdjustQuantity('');
                  setAdjustNote('');
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleAdjustStock}
                disabled={!adjustQuantity || isNaN(parseInt(adjustQuantity)) || parseInt(adjustQuantity) === 0}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Guardar Ajuste
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
