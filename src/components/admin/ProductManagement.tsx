import React, { useState, useEffect } from 'react';
import { Search, Plus, Image as ImageIcon } from 'lucide-react';
import { getAllProducts, type Product } from '../../lib/inventory';
import { db } from '../../lib/inventory';

export function ProductManagement() {
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [newProduct, setNewProduct] = useState({
    title: '',
    price: '',
    stock: '',
    unit: '',
    image: '',
    rating: '5.0',
    category: ''
  });

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    try {
      const data = await getAllProducts();
      setProducts(data);
    } catch (error) {
      setError('Error al cargar productos');
    }
  }

  const filteredProducts = products.filter(product =>
    product.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    try {
      const stockValue = parseInt(newProduct.stock);
      const productData: Product = {
        title: newProduct.title.trim(),
        price: parseFloat(newProduct.price),
        stock: stockValue,
        initialStock: stockValue, // NUEVO: Establecer stock inicial igual al stock
        unit: newProduct.unit,
        image: newProduct.image.trim(),
        rating: parseFloat(newProduct.rating),
        category: newProduct.category || 'General',
        sales: 0, // Inicializar ventas en 0
        createdAt: new Date(),
        updatedAt: new Date()
      };

      if (!productData.title || !productData.price || !productData.stock || !productData.unit || !productData.image) {
        setError('Todos los campos son obligatorios');
        return;
      }

      if (productData.price <= 0) {
        setError('El precio debe ser mayor que 0');
        return;
      }

      if (productData.stock < 0) {
        setError('El stock no puede ser negativo');
        return;
      }

      if (productData.rating < 0 || productData.rating > 5) {
        setError('La calificación debe estar entre 0 y 5');
        return;
      }

      const productId = await db.products.add(productData);

      // Si el producto tiene stock inicial, crear un lote inicial
      if (productData.stock > 0) {
        const expiryDate = new Date();
        expiryDate.setMonth(expiryDate.getMonth() + 6); // 6 meses de vigencia por defecto

        const batchCode = `INIT-${productId}-${Date.now()}`;

        await db.batches.add({
          productId: productId as number,
          batchCode: batchCode,
          quantity: productData.stock,
          expiryDate: expiryDate.toISOString().split('T')[0],
          createdAt: new Date().toISOString()
        });

        console.log(`[Product] Lote inicial creado para producto ${productId}: ${productData.stock} unidades`);
      }

      setSuccess(`Producto "${productData.title}" agregado correctamente (ID: ${productId})`);
      setNewProduct({
        title: '',
        price: '',
        stock: '',
        unit: '',
        image: '',
        rating: '5.0',
        category: ''
      });
      await loadProducts();
    } catch (error) {
      console.error('Error al agregar producto:', error);
      setError(error instanceof Error ? error.message : 'Error al agregar el producto');
    }
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
                    Nombre del Producto
                  </label>
                  <input
                    type="text"
                    id="title"
                    value={newProduct.title}
                    onChange={(e) => setNewProduct({ ...newProduct, title: e.target.value })}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-yellow-500 focus:border-yellow-500 sm:text-sm"
                  />
                </div>

                <div className="col-span-6 sm:col-span-3">
                  <label htmlFor="price" className="block text-sm font-medium text-gray-700">
                    Precio
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
                    Stock Inicial
                  </label>
                  <input
                    type="number"
                    id="stock"
                    value={newProduct.stock}
                    onChange={(e) => setNewProduct({ ...newProduct, stock: e.target.value })}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-yellow-500 focus:border-yellow-500 sm:text-sm"
                  />
                </div>

                <div className="col-span-6 sm:col-span-3">
                  <label htmlFor="unit" className="block text-sm font-medium text-gray-700">
                    Unidad de Medida
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
                  </select>
                </div>

                <div className="col-span-6 sm:col-span-3">
                  <label htmlFor="rating" className="block text-sm font-medium text-gray-700">
                    Calificación Inicial
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="5"
                    id="rating"
                    value={newProduct.rating}
                    onChange={(e) => setNewProduct({ ...newProduct, rating: e.target.value })}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-yellow-500 focus:border-yellow-500 sm:text-sm"
                  />
                </div>

                <div className="col-span-6 sm:col-span-3">
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

                <div className="col-span-6">
                  <label htmlFor="image" className="block text-sm font-medium text-gray-700">
                    URL de la Imagen
                  </label>
                  <div className="mt-1 flex rounded-md shadow-sm">
                    <input
                      type="url"
                      id="image"
                      value={newProduct.image}
                      onChange={(e) => setNewProduct({ ...newProduct, image: e.target.value })}
                      className="flex-1 block w-full rounded-none rounded-l-md border border-gray-300 focus:ring-yellow-500 focus:border-yellow-500 sm:text-sm"
                      placeholder="https://ejemplo.com/imagen.jpg"
                    />
                    <button
                      type="button"
                      className="relative -ml-px inline-flex items-center space-x-2 rounded-r-md border border-gray-300 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:border-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-500"
                    >
                      <ImageIcon className="h-5 w-5 text-gray-400" />
                      <span>Vista previa</span>
                    </button>
                  </div>
                  {newProduct.image && (
                    <div className="mt-2">
                      <img
                        src={newProduct.image}
                        alt="Vista previa"
                        className="h-32 w-32 object-cover rounded-md"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.src = 'https://via.placeholder.com/150';
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-5">
                <button
                  type="submit"
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-gray-900 bg-yellow-400 hover:bg-yellow-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500"
                >
                  <Plus className="h-5 w-5 mr-2" />
                  Agregar Producto
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
                            Unidad
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Categoría
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Calificación
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {filteredProducts.map((product) => (
                          <tr key={product.id}>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center">
                                <div className="flex-shrink-0 h-10 w-10">
                                  <img className="h-10 w-10 rounded-full object-cover" src={product.image} alt="" />
                                </div>
                                <div className="ml-4">
                                  <div className="text-sm font-medium text-gray-900">{product.title}</div>
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
                              {product.unit}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                                {product.category || 'General'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {product.rating.toFixed(1)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}