import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Clock, Package, DollarSign, TrendingUp, TrendingDown, Filter } from 'lucide-react';
import { db } from '../../lib/inventory';
import type { Order, OrderItem, Product } from '../../lib/inventory';

interface StockMovement {
  id?: number;
  productId: number;
  quantity: number;
  type: 'in' | 'out';
  note?: string;
  createdAt: Date;
}

interface SaleDetail extends Order {
  items: (OrderItem & { product: Product | undefined })[];
}

interface Transaction {
  id: number;
  type: 'sale' | 'stock_in' | 'stock_out';
  date: Date;
  total?: number;
  productName?: string;
  quantity?: number;
  note?: string;
  items?: (OrderItem & { product: Product | undefined })[];
}

// Imagen SVG placeholder como data URI (no requiere conexión a internet)
const PLACEHOLDER_IMAGE = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIGZpbGw9IiNFNUU3RUIiLz48cGF0aCBkPSJNMjAgMTVDMTguMzQzMSAxNSAxNyAxNi4zNDMxIDE3IDE4QzE3IDE5LjY1NjkgMTguMzQzMSAyMSAyMCAyMUMyMS42NTY5IDIxIDIzIDE5LjY1NjkgMjMgMThDMjMgMTYuMzQzMSAyMS42NTY5IDE1IDIwIDE1Wk0xMyAxMkMxMi40NDc3IDEyIDEyIDEyLjQ0NzcgMTIgMTNWMjdDMTIgMjcuNTUyMyAxMi40NDc3IDI4IDEzIDI4SDI3QzI3LjU1MjMgMjggMjggMjcuNTUyMyAyOCAyN1YxM0MyOCAxMi40NDc3IDI3LjU1MjMgMTIgMjcgMTJIMTNaTTI2IDI2SDE0VjE0SDI2VjI2WiIgZmlsbD0iIzlDQTNCMCIvPjwvc3ZnPg==';

export function SalesHistory() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<'all' | 'sale' | 'stock_in' | 'stock_out'>('all');
  const [filterProduct, setFilterProduct] = useState<number>(0);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    loadTransactions();
  }, []);

  const loadTransactions = async () => {
    try {
      const [orders, orderItems, stockMovements, productsData] = await Promise.all([
        db.orders.toArray(),
        db.orderItems.toArray(),
        db.stockMovements.toArray(),
        db.products.toArray()
      ]);

      setProducts(productsData);

      const allTransactions: Transaction[] = [];

      // Agregar ventas
      for (const order of orders) {
        const items = orderItems
          .filter(item => item.orderId === order.id)
          .map(item => ({
            ...item,
            product: productsData.find(p => p.id === item.productId)
          }));

        allTransactions.push({
          id: order.id!,
          type: 'sale',
          date: new Date(order.createdAt),
          total: order.total,
          items
        });
      }

      // Agregar movimientos de stock
      for (const movement of stockMovements) {
        const product = productsData.find(p => p.id === movement.productId);
        allTransactions.push({
          id: movement.id!,
          type: movement.type === 'in' ? 'stock_in' : 'stock_out',
          date: new Date(movement.createdAt),
          productName: product?.title || 'Producto desconocido',
          quantity: Math.abs(movement.quantity),
          note: movement.note
        });
      }

      // Ordenar por fecha más reciente
      allTransactions.sort((a, b) => b.date.getTime() - a.date.getTime());

      setTransactions(allTransactions);
    } catch (error) {
      console.error('Error al cargar transacciones:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredTransactions = transactions.filter(transaction => {
    // Filtrar por tipo
    if (filterType !== 'all' && transaction.type !== filterType) {
      return false;
    }

    // Filtrar por producto
    if (filterProduct !== 0) {
      if (transaction.type === 'sale') {
        // Para ventas, buscar en items
        const hasProduct = transaction.items?.some(item => item.productId === filterProduct);
        if (!hasProduct) return false;
      } else {
        // Para movimientos de stock, verificar productId directamente
        const movement = transactions.find(t => t.id === transaction.id);
        // Necesitamos buscar en stockMovements para obtener productId
        // Por ahora comparamos por nombre de producto
        const product = products.find(p => p.id === filterProduct);
        if (product && transaction.productName !== product.title) return false;
      }
    }

    // Filtrar por rango de fechas
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      fromDate.setHours(0, 0, 0, 0);
      if (transaction.date < fromDate) return false;
    }

    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      if (transaction.date > toDate) return false;
    }

    return true;
  });

  const totalSales = filteredTransactions
    .filter(t => t.type === 'sale')
    .reduce((sum, t) => sum + (t.total || 0), 0);

  const totalStockIn = filteredTransactions
    .filter(t => t.type === 'stock_in')
    .reduce((sum, t) => sum + (t.quantity || 0), 0);

  const totalStockOut = filteredTransactions
    .filter(t => t.type === 'stock_out')
    .reduce((sum, t) => sum + (t.quantity || 0), 0);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Estadísticas */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <DollarSign className="h-6 w-6 text-green-600" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Ventas Totales</dt>
                  <dd className="text-lg font-medium text-gray-900">${totalSales.toFixed(2)}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <TrendingUp className="h-6 w-6 text-blue-600" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Entradas de Stock</dt>
                  <dd className="text-lg font-medium text-gray-900">{totalStockIn} unidades</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <TrendingDown className="h-6 w-6 text-orange-600" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Salidas de Stock</dt>
                  <dd className="text-lg font-medium text-gray-900">{totalStockOut} unidades</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="h-5 w-5 text-gray-400" />
          <h3 className="text-lg font-medium text-gray-900">Filtros</h3>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tipo de Transacción
            </label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as any)}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-yellow-500 focus:ring-yellow-500 sm:text-sm"
            >
              <option value="all">Todas</option>
              <option value="sale">Ventas</option>
              <option value="stock_in">Entradas de Stock</option>
              <option value="stock_out">Salidas de Stock</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Producto
            </label>
            <select
              value={filterProduct}
              onChange={(e) => setFilterProduct(Number(e.target.value))}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-yellow-500 focus:ring-yellow-500 sm:text-sm"
            >
              <option value={0}>Todos los productos</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Fecha Desde
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-yellow-500 focus:ring-yellow-500 sm:text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Fecha Hasta
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-yellow-500 focus:ring-yellow-500 sm:text-sm"
            />
          </div>
        </div>

        {(filterType !== 'all' || filterProduct !== 0 || dateFrom || dateTo) && (
          <div className="mt-4">
            <button
              onClick={() => {
                setFilterType('all');
                setFilterProduct(0);
                setDateFrom('');
                setDateTo('');
              }}
              className="text-sm text-yellow-600 hover:text-yellow-700 font-medium"
            >
              Limpiar filtros
            </button>
          </div>
        )}
      </div>

      {/* Lista de transacciones */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 border-b border-gray-200 sm:px-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900">
            Historial de Transacciones ({filteredTransactions.length})
          </h3>
        </div>

        {filteredTransactions.length === 0 ? (
          <div className="text-center py-12">
            <Package className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No hay transacciones</h3>
            <p className="mt-1 text-sm text-gray-500">
              {transactions.length === 0
                ? 'Las transacciones aparecerán aquí cuando se realicen.'
                : 'No hay transacciones que coincidan con los filtros seleccionados.'}
            </p>
          </div>
        ) : (
          <ul role="list" className="divide-y divide-gray-200">
            {filteredTransactions.map((transaction, index) => (
              <li key={`${transaction.type}-${transaction.id}-${index}`}>
                <div className="px-4 py-4 sm:px-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      {transaction.type === 'sale' && (
                        <div className="flex-shrink-0">
                          <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center">
                            <DollarSign className="h-6 w-6 text-green-600" />
                          </div>
                        </div>
                      )}
                      {transaction.type === 'stock_in' && (
                        <div className="flex-shrink-0">
                          <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                            <TrendingUp className="h-6 w-6 text-blue-600" />
                          </div>
                        </div>
                      )}
                      {transaction.type === 'stock_out' && (
                        <div className="flex-shrink-0">
                          <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center">
                            <TrendingDown className="h-6 w-6 text-orange-600" />
                          </div>
                        </div>
                      )}

                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {transaction.type === 'sale' && 'Venta'}
                          {transaction.type === 'stock_in' && 'Entrada de Stock'}
                          {transaction.type === 'stock_out' && 'Salida de Stock'}
                        </p>
                        <div className="flex items-center mt-1">
                          <Clock className="h-4 w-4 text-gray-400 mr-1" />
                          <p className="text-sm text-gray-500">
                            {format(transaction.date, "d 'de' MMMM 'de' yyyy 'a las' HH:mm", { locale: es })}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      {transaction.type === 'sale' && (
                        <p className="text-sm font-semibold text-green-600">
                          ${transaction.total?.toFixed(2)}
                        </p>
                      )}
                      {transaction.type === 'stock_in' && (
                        <p className="text-sm font-semibold text-blue-600">
                          +{transaction.quantity} unidades
                        </p>
                      )}
                      {transaction.type === 'stock_out' && (
                        <p className="text-sm font-semibold text-orange-600">
                          -{transaction.quantity} unidades
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Detalles de la transacción */}
                  <div className="mt-4">
                    {transaction.type === 'sale' && transaction.items && (
                      <div className="bg-gray-50 rounded-md p-3">
                        <p className="text-xs font-medium text-gray-700 mb-2">Productos:</p>
                        <div className="space-y-2">
                          {transaction.items.map((item) => {
                            const product = item.product;
                            const productTitle = product?.title || 'Producto eliminado';
                            const productImage = product?.image || PLACEHOLDER_IMAGE;
                            
                            return (
                              <div key={item.id} className="flex justify-between items-center text-sm">
                                <div className="flex items-center">
                                  <img
                                    src={productImage}
                                    alt={productTitle}
                                    className="h-6 w-6 rounded-full object-cover mr-2"
                                    onError={(e) => {
                                      const target = e.target as HTMLImageElement;
                                      target.src = PLACEHOLDER_IMAGE;
                                    }}
                                  />
                                  <span className={`${product ? 'text-gray-900' : 'text-gray-500 italic'}`}>
                                    {productTitle}
                                  </span>
                                </div>
                                <div className="flex items-center space-x-3">
                                  <span className="text-gray-500">
                                    {item.quantity} × ${item.price.toFixed(2)}
                                  </span>
                                  <span className="font-medium text-gray-900">
                                    ${(item.quantity * item.price).toFixed(2)}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {(transaction.type === 'stock_in' || transaction.type === 'stock_out') && (
                      <div className="bg-gray-50 rounded-md p-3">
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-xs font-medium text-gray-700">Producto:</p>
                            <p className="text-sm text-gray-900 mt-1">{transaction.productName}</p>
                          </div>
                          {transaction.note && (
                            <div className="text-right">
                              <p className="text-xs font-medium text-gray-700">Nota:</p>
                              <p className="text-sm text-gray-600 mt-1">{transaction.note}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
