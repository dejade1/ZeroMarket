import React, { useState, useEffect } from 'react';
import { Plus, Minus, Save, AlertTriangle } from 'lucide-react';
import { getAllProducts, updateStock, type Product } from '../../lib/inventory';
import { db } from '../../lib/inventory';
import {
  addBatch,
  getBatchesByProduct,
  updateBatchQuantity,
    generateBatchCode,
  Batch
} from '../../lib/batch-service';
import { registerStockAdjustment } from '../../lib/stock-adjustment-service';

export function InventoryManager() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formData, setFormData] = useState<{
    productId: number;
    quantity: number;
    type: 'in' | 'out' | 'delete';
    note: string;
    newPrice: string;
  }>({
    productId: 0,
    quantity: 1,
    type: 'in',
    note: '',
    newPrice: ''
  });

  // Lote/caducidad (entrada)
  const [batchCode, setBatchCode] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  // Selector lote (salida)
  const [lotesDisponibles, setLotesDisponibles] = useState<Batch[]>([]);
  const [selectedLote, setSelectedLote] = useState<number>(0);

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => {
    // Actualiza el código de lote cuando cambia el producto o es entrada
    if (formData.productId && formData.type === 'in') {
      const prod = products.find(p => p.id === formData.productId);
      if (prod) {
        const prefijo = prod.title
          .split(' ')
          .map(word => word.substr(0, 2))
          .join('')
          .substr(0, 8);
        setBatchCode(prefijo + '-' + await generateBatchCode(formData.productId, prod.title));
      }
    }
    // Cuando es salida, cargar lotes del producto seleccionado
    if (formData.productId && formData.type === 'out') {
      getBatchesByProduct(formData.productId)
        .then((batches) => {
          setLotesDisponibles(batches.filter(b => b.quantity > 0));
        });
    }
    if (formData.type === 'in') setSelectedLote(0);
    // Limpia lote seleccionado si cambia a entrada
  }, [formData.productId, formData.type, products]);

  async function loadProducts() {
    try {
      const data = await getAllProducts();
      setProducts(data);
    } catch (error) {
      setError('Error al cargar productos');
    } finally {
      setLoading(false);
    }
  }

  const handleProductSelect = (productId: number) => {
    const selectedProduct = products.find(p => p.id === productId);
    setFormData(prev => ({
      ...prev,
      productId,
      newPrice: selectedProduct ? selectedProduct.price.toString() : ''
    }));
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!formData.productId) {
      setError('Por favor seleccione un producto');
      return;
    }
    const productId = formData.productId;

    try {
      if (formData.type === 'in') {
        // Validar lote y caducidad
        if (!batchCode || !batchCode.trim()) {
          setError('Debe ingresar un código de lote para entradas');
          return;
        }
        if (!expiryDate || !expiryDate.trim()) {
          setError('Debe ingresar una fecha de caducidad para entradas');
          return;
        }

        // Obtener stock actual antes del ajuste
        const product = await db.products.get(productId);
        if (!product) {
          setError('Producto no encontrado');
          return;
        }
        const stockAntes = product.stock;

        // 1. Añadir lote (esto ya actualiza el stock del producto automáticamente)
        await addBatch({
          productId,
          batchCode,
          quantity: formData.quantity,
          expiryDate
        });

        // 2. Registrar movimiento de stock para el historial (compatibilidad)
        await db.stockMovements.add({
          productId,
          quantity: formData.quantity,
          type: 'in',
          note: formData.note,
          createdAt: new Date()
        });

        // 3. Registrar en stockAdjustments con el nuevo stock
        const nuevoStock = stockAntes + formData.quantity;
        await db.stockAdjustments.add({
          productId,
          adjustmentType: 'restock',
          quantityBefore: stockAntes,
          quantityAfter: nuevoStock,
          difference: formData.quantity,
          note: formData.note || `Entrada de lote ${batchCode}`,
          userId: localStorage.getItem('currentUser') || 'system',
          timestamp: new Date()
        });
      } else if (formData.type === 'out') {
        if (!selectedLote) {
          setError('Debe seleccionar un lote para salida');
          return;
        }
        // Encontrar lote por id
        const lote = lotesDisponibles.find(l => l.id === selectedLote);
        if (!lote || lote.quantity < formData.quantity) {
          setError('Cantidad de lote insuficiente');
          return;
        }

        // Obtener stock actual antes del ajuste
        const product = await db.products.get(productId);
        if (!product) {
          setError('Producto no encontrado');
          return;
        }
        const stockAntes = product.stock;

        // 1. Descuenta del lote (esto ya actualiza el stock del producto automáticamente)
        await updateBatchQuantity(lote.id!, lote.quantity - formData.quantity);

        // 2. Registrar movimiento de stock para el historial (compatibilidad)
        await db.stockMovements.add({
          productId,
          quantity: -formData.quantity,
          type: 'out',
          note: formData.note,
          createdAt: new Date()
        });

        // 3. Registrar en stockAdjustments con el nuevo stock
        const nuevoStock = stockAntes - formData.quantity;
        await db.stockAdjustments.add({
          productId,
          adjustmentType: 'manual',
          quantityBefore: stockAntes,
          quantityAfter: nuevoStock,
          difference: -formData.quantity,
          note: formData.note || `Salida de lote ${lote.batchCode}`,
          userId: localStorage.getItem('currentUser') || 'system',
          timestamp: new Date()
        });
      } else if (formData.type === 'delete') {
        // Confirmación antes de eliminar
        const product = await db.products.get(productId);
        if (!product) {
          setError('Producto no encontrado');
          return;
        }

        // Eliminar todos los lotes del producto primero
        const batches = await getBatchesByProduct(productId);
        for (const batch of batches) {
          if (batch.id) {
            await db.batches.delete(batch.id);
          }
        }

        // Registrar ajuste de eliminación
        await db.stockAdjustments.add({
          productId,
          adjustmentType: 'damage',
          quantityBefore: product.stock,
          quantityAfter: 0,
          difference: -product.stock,
          note: formData.note || 'Producto eliminado del inventario',
          userId: localStorage.getItem('currentUser') || 'system',
          timestamp: new Date()
        });

        // Eliminar el producto
        await db.products.delete(productId);

        await loadProducts();
        setSuccess(`Producto "${product.title}" eliminado correctamente del inventario.`);
        setFormData({
          productId: 0,
          quantity: 1,
          type: 'in',
          note: '',
          newPrice: ''
        });
        return; // Salir temprano, no necesitamos actualizar precio
      }

      // Actualiza precio si cambió
      if (formData.newPrice) {
        const product = await db.products.get(productId);
        if (product) {
          const newPrice = parseFloat(formData.newPrice);
          if (!isNaN(newPrice) && newPrice >= 0) {
            await db.products.update(productId, {
              price: newPrice,
              updatedAt: new Date()
            });
          }
        }
      }

      // Resetear ventas a 0 cuando se actualiza el stock
      await db.products.update(productId, {
        sales: 0,
        updatedAt: new Date()
      });

      await loadProducts();
      setSuccess('Stock y lote actualizados correctamente. Ventas del producto reseteadas a 0.');
      setFormData({
        productId: 0,
        quantity: 1,
        type: 'in',
        note: '',
        newPrice: ''
      });
      setBatchCode('');
      setExpiryDate('');
      setSelectedLote(0);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Error al actualizar stock');
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400"></div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-6">Ajuste de Inventario</h2>

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

      <form onSubmit={handleSubmit} className="space-y-4">

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Producto
          </label>
          <select
            value={formData.productId}
            onChange={(e) => handleProductSelect(Number(e.target.value))}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-yellow-500 focus:ring-yellow-500 sm:text-sm"
          >
            <option value={0}>Seleccionar producto</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.title} (Stock actual: {product.stock})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Tipo de Movimiento
          </label>
          <select
            value={formData.type}
            onChange={(e) => setFormData({ ...formData, type: e.target.value as 'in' | 'out' | 'delete' })}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-yellow-500 focus:ring-yellow-500 sm:text-sm"
          >
            <option value="in">Entrada</option>
            <option value="out">Salida</option>
            <option value="delete">Eliminar Producto</option>
          </select>
        </div>

        {formData.type === 'delete' && (
          <div className="bg-red-50 border-l-4 border-red-400 p-4">
            <div className="flex items-start">
              <AlertTriangle className="h-5 w-5 text-red-400 mr-3 mt-0.5" />
              <div>
                <h3 className="text-sm font-medium text-red-800">
                  Advertencia: Eliminación Permanente
                </h3>
                <p className="mt-1 text-sm text-red-700">
                  Esta acción eliminará completamente el producto del inventario, incluyendo todos sus lotes asociados. Esta operación no se puede deshacer.
                </p>
              </div>
            </div>
          </div>
        )}

        {formData.type !== 'delete' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Cantidad
            </label>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, quantity: Math.max(1, prev.quantity - 1) }))}
                className="p-2 rounded-md bg-gray-100 hover:bg-gray-200"
              >
                <Minus className="w-4 h-4" />
              </button>
              <input
                type="number"
                min="1"
                value={formData.quantity}
                onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 1 })}
                className="block w-20 rounded-md border-gray-300 shadow-sm focus:border-yellow-500 focus:ring-yellow-500 sm:text-sm"
              />
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, quantity: prev.quantity + 1 }))}
                className="p-2 rounded-md bg-gray-100 hover:bg-gray-200"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {formData.type === 'in' && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Lote
              </label>
              <input
                type="text"
                value={batchCode}
                onChange={e => setBatchCode(e.target.value)}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-yellow-500 focus:ring-yellow-500 sm:text-sm"
                placeholder="Lote (autogenerado editable)"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fecha de Caducidad
              </label>
              <input
                type="date"
                value={expiryDate}
                onChange={e => setExpiryDate(e.target.value)}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-yellow-500 focus:ring-yellow-500 sm:text-sm"
              />
            </div>
          </>
        )}

        {formData.type === 'out' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Seleccionar lote para salida
            </label>
            <select
              value={selectedLote}
              onChange={e => setSelectedLote(Number(e.target.value))}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-yellow-500 focus:ring-yellow-500 sm:text-sm"
            >
              <option value={0}>Seleccionar lote</option>
                {lotesDisponibles.map(batch => (
                  <option key={batch.id} value={batch.id}>
                    {batch.batchCode} (Disp: {batch.quantity}, Vence: {batch.expiryDate})
                  </option>
                ))}
            </select>
          </div>
        )}

        {formData.type !== 'delete' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nuevo Precio Unitario ($)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={formData.newPrice}
              onChange={(e) => setFormData({ ...formData, newPrice: e.target.value })}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-yellow-500 focus:ring-yellow-500 sm:text-sm"
              placeholder="Dejar vacío para mantener el precio actual"
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Nota
          </label>
          <input
            type="text"
            value={formData.note}
            onChange={(e) => setFormData({ ...formData, note: e.target.value })}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-yellow-500 focus:ring-yellow-500 sm:text-sm"
            placeholder="Razón del ajuste de inventario"
          />
        </div>

        <button
          type="submit"
          className={`flex items-center justify-center w-full font-medium py-2 px-4 rounded-md transition-colors ${
            formData.type === 'delete'
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-yellow-400 hover:bg-yellow-500 text-gray-900'
          }`}
        >
          <Save className="w-5 h-5 mr-2" />
          {formData.type === 'delete' ? 'Eliminar Producto' : 'Guardar Ajuste'}
        </button>
      </form>

      <div className="mt-8">
        <h3 className="text-lg font-medium mb-4">Inventario Actual</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Producto
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Stock
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Precio
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {products.map((product) => (
                <tr key={product.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <img src={product.image} alt="" className="h-8 w-8 rounded-full mr-3" />
                      <span className="text-sm font-medium text-gray-900">{product.title}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      product.stock < 10 ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                    }`}>
                      {product.stock}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${product.price.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
