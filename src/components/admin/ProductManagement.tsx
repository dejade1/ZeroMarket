import React, { useState, useEffect } from 'react';
import { Search, Plus, Edit2, Upload } from 'lucide-react';
import { ProductEditModal } from './ProductEditModal';

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
  slot?: number | null;
  slotDistance?: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

const API_URL = 'http://localhost:3000';

// ==================== COMPONENTE ====================

export function ProductManagement() {
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [loading, setLoading] = useState(false);
  const [newProduct, setNewProduct] = useState({
    title: '',
    description: '',
    price: '',
    stock: '',
    unit: '',
    image: '',
    rating: '5.0',
    category: '',
    slot: '',
    slotDistance: '',
    expiryDate: ''
  });

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    try {
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
    }
  }

  const filteredProducts = products.filter(product =>
    product.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setError('La imagen no puede superar 5MB');
        return;
      }
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setImagePreview(result);
        setNewProduct({ ...newProduct, image: result });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (!newProduct.title || !newProduct.price || !newProduct.stock || !newProduct.unit) {
        setError('Todos los campos marcados con * son obligatorios');
        setLoading(false);
        return;
      }

      const price = parseFloat(newProduct.price);
      const stock = parseInt(newProduct.stock);
      const rating = parseFloat(newProduct.rating);
      const slot = newProduct.slot ? parseInt(newProduct.slot) : null;
      const slotDistance = newProduct.slotDistance ? parseFloat(newProduct.slotDistance) : null;

      if (price <= 0) {
        setError('El precio debe ser mayor que 0');
        setLoading(false);
        return;
      }

      if (stock < 0) {
        setError('El stock no puede ser negativo');
        setLoading(false);
        return;
      }

      if (stock > 0 && !newProduct.expiryDate) {
        setError('Debe ingresar la fecha de vencimiento para el stock inicial');
        setLoading(false);
        return;
      }

      if (rating < 0 || rating > 5) {
        setError('La calificación debe estar entre 0 y 5');
        setLoading(false);
        return;
      }

      const productData = {
        title: newProduct.title.trim(),
        description: newProduct.description.trim() || null,
        price,
        stock,
        unit: newProduct.unit,
        image: newProduct.image.trim() || null,
        rating,
        category: newProduct.category || null,
        slot,
        slotDistance,
        expiryDate: newProduct.expiryDate || null
      };

      const response = await fetch(`${API_URL}/api/admin/products`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(productData)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Error al crear producto');
      }

      setSuccess(result.message || `Producto "${productData.title}" agregado correctamente`);

      setNewProduct({
        title: '',
        description: '',
        price: '',
        stock: '',
        unit: '',
        image: '',
        rating: '5.0',
        category: '',
        slot: '',
        slotDistance: '',
        expiryDate: ''
      });
      setImageFile(null);
      setImagePreview('');

      await loadProducts();
    } catch (error) {
      console.error('Error creating product:', error);
      setError(error instanceof Error ? error.message : 'Error al agregar el producto');
    } finally {
      setLoading(false);
    }
  };

  const handleEditProduct = (product: Product) => {
    setEditingProduct(product);
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async () => {
    await loadProducts();
    setIsEditModalOpen(false);
    setEditingProduct(null);
  };

  /**
   * Formatea slotDistance para mostrar decimales correctamente
   * - Si tiene decimales, los muestra (9.21, 8.30)
   * - Si es entero, muestra .0 (9 -> 9.0)
   */
  const formatSlotDistance = (value: number): string => {
    // Convertir a string para preservar decimales
    const str = value.toString();
    
    // Si ya tiene punto decimal, retornar tal cual
    if (str.includes('.')) {
      return str;
    }
    
    // Si es entero, agregar .0
    return `${str}.0`;
  };

  return (
    <div className="space-y-6">
      <div className="bg-white shadow px-4 py-5 sm:rounded-lg sm:p-6">
        <div className="md:grid md:grid-cols-3 md:gap-6">
          <div className="md:col-span-1">
            <h3 className="text-lg font-medium leading-6 text-gray-900">Nuevo Producto</h3>
            <p className="mt-1 text-sm text-gray-500">
              Agregar un nuevo producto al inventario.
            </p>
          </div>
          <div className="mt-5 md:mt-0 md:col-span-2">
            <form onSubmit={handleSubmit}>
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

              <div className="grid grid-cols-6 gap-6">
                <div className="col-span-6">
                  <label htmlFor="title" className="block text-sm font-medium text-gray-700">
                    Nombre del Producto *
                  </label>
                  <input
                    type="text"
                    id="title"
                    value={newProduct.title}
                    onChange={(e) => setNewProduct({ ...newProduct, title: e.target.value })}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-yellow-500 focus:border-yellow-500 sm:text-sm"
                  />
                </div>

                <div className="col-span-6">
                  <label htmlFor="description" className="block text-sm font-medium text-gray-700">
                    Descripción
                  </label>
                  <textarea
                    id="description"
                    rows={2}
                    value={newProduct.description}
                    onChange={(e) => setNewProduct({ ...newProduct, description: e.target.value })}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-yellow-500 focus:border-yellow-500 sm:text-sm"
                    placeholder="Descripción opcional del producto"
                  />
                </div>

                <div className="col-span-6 sm:col-span-3">
                  <label htmlFor="price" className="block text-sm font-medium text-gray-700">
                    Precio *
                  </label>
                  <div className="mt-1 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <span className="text-gray-500 sm:text-sm">$</span>
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      id="price"
                      value={newProduct.price}
                      onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })}
                      className="block w-full pl-7 pr-12 border border-gray-300 rounded-md focus:ring-yellow-500 focus:border-yellow-500 sm:text-sm"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="col-span-6 sm:col-span-3">
                  <label htmlFor="stock" className="block text-sm font-medium text-gray-700">
                    Stock Actual (unidades físicas) *
                  </label>
                  <input
                    type="number"
                    id="stock"
                    value={newProduct.stock}
                    onChange={(e) => setNewProduct({ ...newProduct, stock: e.target.value })}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-yellow-500 focus:border-yellow-500 sm:text-sm"
                  />
                </div>

                {parseInt(newProduct.stock) > 0 && (
                  <div className="col-span-6">
                    <div className="bg-green-50 border border-green-200 rounded-md p-4">
                      <label htmlFor="expiryDate" className="block text-sm font-medium text-green-900 mb-2">
                        Fecha de Vencimiento del Lote Inicial *
                      </label>
                      <input
                        type="date"
                        id="expiryDate"
                        value={newProduct.expiryDate}
                        onChange={(e) => setNewProduct({ ...newProduct, expiryDate: e.target.value })}
                        min={new Date().toISOString().split('T')[0]}
                        className="block w-full rounded-md border-green-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                        required
                      />
                      <p className="mt-2 text-xs text-green-700">
                        📦 Se creará automáticamente el primer lote con código único (ej: ArrPreBl-1-16122025)
                      </p>
                    </div>
                  </div>
                )}

                <div className="col-span-6 sm:col-span-2">
                  <label htmlFor="unit" className="block text-sm font-medium text-gray-700">
                    Unidad de Medida *
                  </label>
                  <select
                    id="unit"
                    value={newProduct.unit}
                    onChange={(e) => setNewProduct({ ...newProduct, unit: e.target.value })}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-yellow-500 focus:border-yellow-500 sm:text-sm"
                  >
                    <option value="">Seleccionar unidad</option>
                    <option value="kg">Kilogramo (kg)</option>
                    <option value="g">Gramo (g)</option>
                    <option value="l">Litro (l)</option>
                    <option value="ml">Mililitro (ml)</option>
                    <option value="unidad">Unidad</option>
                    <option value="paquete">Paquete</option>
                    <option value="docena">Docena</option>
                    <option value="caja">Caja</option>
                    <option value="botella">Botella</option>
                  </select>
                </div>

                <div className="col-span-6 sm:col-span-2">
                  <label htmlFor="category" className="block text-sm font-medium text-gray-700">
                    Categoría
                  </label>
                  <select
                    id="category"
                    value={newProduct.category}
                    onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-yellow-500 focus:border-yellow-500 sm:text-sm"
                  >
                    <option value="">Seleccionar categoría</option>
                    <option value="Granos">Granos</option>
                    <option value="Aceites">Aceites</option>
                    <option value="Lácteos">Lácteos</option>
                    <option value="Carnes">Carnes</option>
                    <option value="Frutas">Frutas</option>
                    <option value="Verduras">Verduras</option>
                    <option value="Bebidas">Bebidas</option>
                    <option value="Licores">Licores</option>
                    <option value="Panadería">Panadería</option>
                    <option value="Snacks">Snacks</option>
                    <option value="Condimentos">Condimentos</option>
                    <option value="Limpieza">Limpieza</option>
                    <option value="General">General</option>
                  </select>
                </div>

                <div className="col-span-6 sm:col-span-2">
                  <label htmlFor="slot" className="block text-sm font-medium text-gray-700">
                    Slot (Hardware)
                  </label>
                  <input
                    type="number"
                    id="slot"
                    value={newProduct.slot}
                    onChange={(e) => setNewProduct({ ...newProduct, slot: e.target.value })}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-yellow-500 focus:border-yellow-500 sm:text-sm"
                    placeholder="1, 2, 3..."
                  />
                  <p className="mt-1 text-xs text-gray-500">Número de slot ESP32/Arduino</p>
                </div>

                <div className="col-span-6 sm:col-span-3">
                  <label htmlFor="slotDistance" className="block text-sm font-medium text-gray-700">
                    Distancia del Motor (cm)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    id="slotDistance"
                    value={newProduct.slotDistance}
                    onChange={(e) => setNewProduct({ ...newProduct, slotDistance: e.target.value })}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-yellow-500 focus:border-yellow-500 sm:text-sm"
                    placeholder="9.21, 10.53, 15.08..."
                  />
                  <p className="mt-1 text-xs text-gray-500">Centímetros que debe moverse el motor (acepta decimales)</p>
                </div>

                <div className="col-span-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Imagen del Producto
                  </label>

                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-gray-600">Pegar URL de imagen</label>
                      <input
                        type="url"
                        value={newProduct.image}
                        onChange={(e) => {
                          setNewProduct({ ...newProduct, image: e.target.value });
                          setImagePreview(e.target.value);
                        }}
                        placeholder="https://ejemplo.com/imagen.jpg"
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-yellow-500 focus:border-yellow-500 sm:text-sm"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-gray-600">O subir desde computadora</label>
                      <div className="mt-1 flex items-center">
                        <label className="cursor-pointer inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500">
                          <Upload className="h-5 w-5 mr-2" />
                          Seleccionar archivo
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleImageFileChange}
                            className="hidden"
                          />
                        </label>
                        {imageFile && (
                          <span className="ml-3 text-sm text-gray-500">{imageFile.name}</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-gray-500">PNG, JPG, GIF hasta 5MB</p>
                    </div>

                    {(imagePreview || newProduct.image) && (
                      <div className="mt-2">
                        <p className="text-xs text-gray-600 mb-1">Vista previa:</p>
                        <img
                          src={imagePreview || newProduct.image}
                          alt="Vista previa"
                          className="h-32 w-32 object-cover rounded-md border border-gray-200"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.src = 'https://via.placeholder.com/150?text=Error';
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-5">
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-gray-900 bg-yellow-400 hover:bg-yellow-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="h-5 w-5 mr-2" />
                  {loading ? 'Agregando...' : 'Agregar Producto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900">Productos Existentes</h3>

          <div className="mt-4 max-w-xl">
            <div className="mt-1 relative rounded-md shadow-sm">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                className="focus:ring-yellow-500 focus:border-yellow-500 block w-full pl-10 sm:text-sm border-gray-300 rounded-md"
                placeholder="Buscar productos..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-4">
            <div className="flex flex-col">
              <div className="-my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
                <div className="py-2 align-middle inline-block min-w-full sm:px-6 lg:px-8">
                  <div className="shadow overflow-hidden border-b border-gray-200 sm:rounded-lg">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Producto
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Precio
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Stock
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Categoría
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Slot
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Dist. (cm)
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Ventas
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Acciones
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {filteredProducts.map((product) => (
                          <tr key={product.id}>
                            <td className="px-6 py-4 whitespace-nowrap">
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
                                  {product.description && (
                                    <div className="text-xs text-gray-500">{product.description.slice(0, 50)}...</div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              ${product.price.toFixed(2)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {product.stock}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                                {product.category || 'General'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {product.slot ? (
                                <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                                  #{product.slot}
                                </span>
                              ) : (
                                <span className="text-gray-400 text-xs">-</span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {product.slotDistance !== null && product.slotDistance !== undefined ? (
                                <span>{formatSlotDistance(product.slotDistance)} cm</span>
                              ) : (
                                <span className="text-gray-400 text-xs">-</span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {product.sales || 0} unidades
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                              <button
                                onClick={() => handleEditProduct(product)}
                                className="text-yellow-600 hover:text-yellow-900 inline-flex items-center"
                              >
                                <Edit2 className="h-4 w-4 mr-1" />
                                Editar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {filteredProducts.length === 0 && (
                      <div className="text-center py-12 text-gray-500">
                        No se encontraron productos
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {editingProduct && (
        <ProductEditModal
          product={editingProduct}
          isOpen={isEditModalOpen}
          onClose={() => {
            setIsEditModalOpen(false);
            setEditingProduct(null);
          }}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  );
}