import React, { useState, useEffect } from 'react';
import { Users, Package, DollarSign, ShoppingCart, Usb, Mail } from 'lucide-react';
import { UserManagement } from './UserManagement';
import { InventoryTable } from './InventoryTable';
import { InventoryManager } from './InventoryManager';
import { ProductManagement } from './ProductManagement';
import { SalesHistory } from './SalesHistory';
import { getAllProducts } from '../../lib/inventory';
import { ledService } from "../../services/LedService";
import type { Product } from '../../lib/inventory';
import ExpiringBatchesAlert from "./ExpiringBatchesAlert";
import BatchSearcher from "./BatchSearcher";
import EmailTasks from "./EmailTasks";

export function Dashboard() {
  const [activeTab, setActiveTab] = useState<
    'users' | 'inventory' | 'stock' | 'products' | 'sales' | 'batches'
  >('inventory');

  const [isSerialConnected, setIsSerialConnected] = useState(false);
  const [serialError, setSerialError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    totalSales: 0,
    totalProducts: 0,
    totalRevenue: 0,
    totalUsers: 0
  });

  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);

  useEffect(() => {
    loadStats();
    loadProducts();
  }, []);

  const loadStats = async () => {
    try {
      const products = await getAllProducts();
      const users = JSON.parse(localStorage.getItem('app_users') || '[]');
      const orders = await db.getAll('orders');
      const orderItems = await db.getAll('orderItems');

      const totalSales = orderItems.reduce((acc, item) => acc + Math.abs(item.quantity), 0);
      const totalRevenue = orders.reduce((acc, order) => acc + Math.abs(order.total), 0);

      setStats({
        totalProducts: products.length,
        totalUsers: users.length,
        totalSales: totalSales,
        totalRevenue: totalRevenue
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  const loadProducts = async () => {
    try {
      const all = await getAllProducts();
      setProducts(all);
      if (all.length > 0 && selectedProductId === null) {
        setSelectedProductId(all[0].id);
      }
    } catch (error) {
      console.error('Error loading products for batches:', error);
    }
  };

  const handleSerialConnect = async () => {
    try {
      setSerialError(null);
      const success = await ledService.connect();
      setIsSerialConnected(success);
      if (!success) {
        setSerialError('No se pudo conectar al Arduino. Verifica que esté conectado y en el puerto correcto.');
      }
    } catch (error) {
      console.error('Error connecting to serial:', error);
      setSerialError('Error al conectar con el Arduino');
      setIsSerialConnected(false);
    }
  };

  const handleTestESP32 = async () => {
    try {
      setSerialError(null);
      const success = await ledService.sendProductSignal(1, 1);
      if (success) {
        alert('Test exitoso: LED encendido');
      } else {
        setSerialError('Error al enviar señal de prueba');
      }
    } catch (error) {
      console.error('Error testing ESP32:', error);
      setSerialError('Error al probar ESP32');
    }
  };

  const selectedProduct = products.find(p => p.id === selectedProductId) || null;

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <h1 className="text-2xl font-bold text-gray-900">Panel de Administración</h1>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleSerialConnect}
                className={`flex items-center px-4 py-2 rounded-md transition-colors ${
                  isSerialConnected
                    ? 'bg-green-100 text-green-800 hover:bg-green-200'
                    : 'bg-yellow-400 hover:bg-yellow-500 text-gray-900'
                }`}
              >
                <Usb className="w-5 h-5 mr-2" />
                {isSerialConnected ? 'ESP32 Conectado' : 'Conectar ESP32'}
              </button>
              {isSerialConnected && (
                <button
                  onClick={handleTestESP32}
                  className="flex items-center px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors"
                >
                  Test LED
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {serialError && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          <div className="bg-red-50 text-red-500 p-4 rounded-md">
            {serialError}
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Métricas Dashboard */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <DollarSign className="h-6 w-6 text-gray-400" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Ingresos Totales</dt>
                    <dd className="text-lg font-semibold text-gray-900">${stats.totalRevenue.toFixed(2)}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <ShoppingCart className="h-6 w-6 text-gray-400" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Ventas Totales</dt>
                    <dd className="text-lg font-semibold text-gray-900">{stats.totalSales}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <Package className="h-6 w-6 text-gray-400" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Productos</dt>
                    <dd className="text-lg font-semibold text-gray-900">{stats.totalProducts}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <Users className="h-6 w-6 text-gray-400" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Usuarios</dt>
                    <dd className="text-lg font-semibold text-gray-900">{stats.totalUsers}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Navegación por paneles */}
        <div className="bg-white shadow rounded-lg mb-8">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8 px-6" aria-label="Tabs">
              <button
                onClick={() => setActiveTab('inventory')}
                className={`${
                  activeTab === 'inventory'
                    ? 'border-yellow-500 text-yellow-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
              >
                <Package className="w-5 h-5 mr-2" />
                Control de Inventario
              </button>

              <button
                onClick={() => setActiveTab('products')}
                className={`${
                  activeTab === 'products'
                    ? 'border-yellow-500 text-yellow-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
              >
                <Package className="w-5 h-5 mr-2" />
                Gestión de Productos
              </button>

              <button
                onClick={() => setActiveTab('stock')}
                className={`${
                  activeTab === 'stock'
                    ? 'border-yellow-500 text-yellow-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
              >
                <Package className="w-5 h-5 mr-2" />
                Ajuste de Stock
              </button>

              <button
                onClick={() => setActiveTab('sales')}
                className={`${
                  activeTab === 'sales'
                    ? 'border-yellow-500 text-yellow-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
              >
                <ShoppingCart className="w-5 h-5 mr-2" />
                Órdenes y Transacciones
              </button>

              <button
                onClick={() => setActiveTab('users')}
                className={`${
                  activeTab === 'users'
                    ? 'border-yellow-500 text-yellow-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
              >
                <Users className="w-5 h-5 mr-2" />
                Usuarios
              </button>

              <button
                onClick={() => setActiveTab('batches')}
                className={`${
                  activeTab === 'batches'
                    ? 'border-yellow-500 text-yellow-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
              >
                <Mail className="w-5 h-5 mr-2" />
                Lotes y Reportes
              </button>
            </nav>
          </div>
        </div>

        {/* Contenido de los paneles */}
        <div className="bg-white shadow rounded-lg p-6">
          {activeTab === 'inventory' && <InventoryTable />}
          {activeTab === 'products' && <ProductManagement />}
          {activeTab === 'stock' && <InventoryManager />}
          {activeTab === 'sales' && <SalesHistory />}
          {activeTab === 'users' && <UserManagement />}

          {activeTab === 'batches' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">Búsqueda de Lotes por Producto</h3>
                <BatchSearcher />
              </div>
              <hr className="my-6" />
              <div>
                <h3 className="text-lg font-semibold mb-4">Lotes Próximos a Caducarse</h3>
                <ExpiringBatchesAlert />
              </div>
              <hr className="my-6" />
              <EmailTasks />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
