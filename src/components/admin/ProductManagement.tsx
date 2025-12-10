import React, { useState, useEffect } from 'react';
import { Search, Plus, Image as ImageIcon, Edit2, Upload } from 'lucide-react';
import { getAllProducts, type Product } from '../../lib/inventory';
import { db } from '../../lib/inventory';
import { generateBatchCode, isValidExpiryDate, formatExpiryDate } from '../../lib/batchCodeGenerator';import { ProductEditModal } from './ProductEditModal';

export function ProductManagement() {
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [newProduct, setNewProduct] = useState({
    title: '',
    price: '',
    stock: '',
    unit: '',
    image: '',
    rating: '5.0',
    category: '',
    slot: '',
    beltDistance: ''
      const [expiryDate, setExpiryDate] = useState('');
      const [expiryDateError, setExpiryDateError] = useState('');
  });

  useEffect(() => {
    loadProducts();
    migrateDatabase();
  }, []);

  async function migrateDatabase() {
    try {
      const products = await db.products.toArray();
      let needsMigration = false;
      
      for (const product of products) {
        if (product.slot === undefined || product.beltDistance === undefined) {
          needsMigration = true;
          break;
        }
      }

      if (needsMigration) {
        console.log('🔄 Migrando productos para agregar campos de banda...');
        await db.products.toCollection().modify(product => {
          if (product.slot === undefined) product.slot = null;
          if (product.beltDistance === undefined) product.beltDistance = null;
        });
        console.log('✅ Migración completada');
      }
    } catch (error) {
      console.error('Error en migración:', error);
    }
  }

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

    try {
      const stockValue = parseInt(newProduct.stock);
      const slotValue = newProduct.slot ? parseInt(newProduct.slot) : undefined;
      const beltDistanceValue = newProduct.beltDistance ? parseFloat(newProduct.beltDistance) : undefined;

      const productData: Product = {
        title: newProduct.title.trim(),
        price: parseFloat(newProduct.price),
        stock: stockValue,
        initialStock: stockValue,
        unit: newProduct.unit,
        image: newProduct.image.trim(),
        rating: parseFloat(newProduct.rating),
        category: newProduct.category || 'General',
        slot: slotValue,
        beltDistance: beltDistanceValue,
        sales: 0,
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

      // Validar slot si está presente
      if (slotValue !== undefined) {
        if (slotValue < 1) {
          setError('El número de slot debe ser mayor o igual a 1');
          return;
        }
        
        const existingProduct = await db.products
          .where('slot')
          .equals(slotValue)
          .first();
        
        if (existingProduct) {
          setError(`El slot ${slotValue} ya está asignado al producto "${existingProduct.title}"`);
          return;
        }
      }

      if (beltDistanceValue !== undefined && beltDistanceValue < 0) {
        setError('La distancia de banda no puede ser negativa');
        return;
      }

      const productId = await db.products.add(productData);

      // Si el producto tiene stock inicial, crear un lote inicial con código automático
      if (productData.stock > 0) {
        const expiryDate = new Date();
        expiryDate.setMonth(expiryDate.getMonth() + 6);

        // Generar código automático: Prefijo-NumLote-Fecha
        const batchCode = await generateBatchCode(productId as number, productData.title);

        await db.batches.add({
          productId: productId as number,
          batchCode: batchCode,
          quantity: productData.stock,
          expiryDate: expiryDate.toISOString().split('T')[0],
          createdAt: new Date().toISOString()
        });

        console.log(`[Product] Lote inicial creado: ${batchCode} (${productData.stock} unidades)`);
      }

      setSuccess(`Producto "${productData.title}" agregado correctamente (ID: ${productId})`);
      setNewProduct({
        title: '',
        price: '',
        stock: '',
        unit: '',
        image: '',
        rating: '5.0',
        category: '',
        slot: '',
        beltDistance: ''
      });
      setImageFile(null);
      setImagePreview('');
      await loadProducts();
    } catch (error) {
      console.error('Error al agregar producto:', error);
      setError(error instanceof Error ? error.message : 'Error al agregar el producto');
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

  return (
    <div className="space-y-6">
      <div className="bg-white shadow px-4 py-5 sm:rounded-lg sm:p-6">
        <div className="md:grid md:grid-cols-3 md:gap-6">
          <div className="md:col-span-1">
            <h3 className="text-lg font-medium leading-6 text-gray-900">Nuevo Producto</h3>
            <p className="mt-1 text-sm text-gray-500">
              Agregar un nuevo producto al inventario con configuración de banda transportadora.
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
                    Stock Inicial *
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

                <div className="col-span-6 sm:col-span-3">
                  <label htmlFor="category" className="block text-sm font-medium text-gray-700">
                    Categoría *
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

                {/* SECCIÓN BANDA TRANSPORTADORA */}
                <div className="col-span-6 border-t pt-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">🎯 Configuración de Banda Transportadora</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="slot" className="block text-sm font-medium text-gray-700">
                        Número de Slot/Banda
                      </label>
                      <input
                        type="number"
                        id="slot"
                        min="1"
                        value={newProduct.slot}
                        onChange={(e) => setNewProduct({ ...newProduct, slot: e.target.value })}
                        placeholder="Ej: 1, 2, 3..."
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-yellow-500 focus:border-yellow-500 sm:text-sm"
                      />
                      <p className="mt-1 text-xs text-gray-500">Banda física asignada (1-20)</p>
                    </div>

                    <div>
                      <label htmlFor="beltDistance" className="block text-sm font-medium text-gray-700">
                        Distancia de Banda (cm)
                      </label>
                      <input
                        type="number"
                        id="beltDistance"
                        step="0.1"
                        min="0"
                        value={newProduct.beltDistance}
                        onChange={(e) => setNewProduct({ ...newProduct, beltDistance: e.target.value })}
                        placeholder="Ej: 15.5"
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-yellow-500 focus:border-yellow-500 sm:text-sm"
                      />
                      <p className="mt-1 text-xs text-gray-500">Distancia para posición 0.00 cm</p>
                    </div>
                  </div>
                </div>

                {/* SECCIÓN IMAGEN */}
                <div className="col-span-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Imagen del Producto *
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
                            Slot
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Banda (cm)
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Categoría
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
                              {product.slot ? (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                  #{product.slot}
                                </span>
                              ) : (
                                <span className="text-gray-400 text-xs">Sin asignar</span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {product.beltDistance !== undefined && product.beltDistance !== null ? (
                                <span className="font-mono">{product.beltDistance.toFixed(2)} cm</span>
                              ) : (
                                <span className="text-gray-400 text-xs">-</span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                                {product.category || 'General'}
                              </span>
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
