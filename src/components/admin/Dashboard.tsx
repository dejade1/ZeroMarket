/**
 * COMPONENTE: Dashboard
 *
 * Panel de administración principal con sistema de pestañas mejorado
 *
 * CARACTERÍSTICAS:
 * ✅ 8 pestañas de navegación
 * ✅ Navegación sin recargar página
 * ✅ Indicador visual de pestaña activa
 * ✅ Botón de cierre para volver al inicio
 * ✅ Control de permisos por rol
 * ✅ Diseño responsivo
 * ✅ Estadísticas en tiempo real
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  Users,
  Package,
  Usb,
  BarChart3,
  Settings as SettingsIcon,
  Archive,
  LogOut,
  ShoppingCart
} from 'lucide-react';

// Componentes de pestañas
import { UserManagement } from './UserManagement';
import { InventoryTable } from './InventoryTable';
import { InventoryManager } from './InventoryManager';
import { ProductManagement } from './ProductManagement';
import { SalesHistory } from './SalesHistory';
import { Reports } from './Reports';
import { Settings } from './Settings';
import BatchManager from './BatchManager';
import { SyncButton } from './SyncButton';

// Servicios
import { ledService } from '../../services/LedService';

// Tipo de pestaña
type TabType = 'inventory' | 'products' | 'stock' | 'orders' | 'users' | 'batches' | 'reports' | 'settings';

// Definición de pestañas
interface TabConfig {
  id: TabType;
  label: string;
  icon: React.ElementType;
  component: React.ReactNode;
  requiredRole?: 'admin' | 'user';
}

export function Dashboard() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();

  // Estado
  const [activeTab, setActiveTab] = useState<TabType>('inventory');
  const [isSerialConnected, setIsSerialConnected] = useState(false);
  const [serialError, setSerialError] = useState<string | null>(null);

  // Configuración de pestañas
  const tabs: TabConfig[] = [
    {
      id: 'inventory',
      label: 'Control de Inventario',
      icon: Package,
      component: <InventoryTable />
    },
    {
      id: 'products',
      label: 'Gestión de Productos',
      icon: Package,
      component: <ProductManagement />
    },
    {
      id: 'stock',
      label: 'Ajustes de Stock',
      icon: Archive,
      component: <InventoryManager />
    },
    {
      id: 'orders',
      label: 'Órdenes y Transacciones',
      icon: ShoppingCart,
      component: <SalesHistory />
    },
    {
      id: 'users',
      label: 'Usuarios',
      icon: Users,
      component: <UserManagement />,
      requiredRole: 'admin'
    },
    {
      id: 'batches',
      label: 'Lotes',
      icon: Archive,
      component: <BatchManager />
    },
    {
      id: 'reports',
      label: 'Reportes',
      icon: BarChart3,
      component: <Reports />
    },
    {
      id: 'settings',
      label: 'Configuración',
      icon: SettingsIcon,
      component: <Settings />,
      requiredRole: 'admin'
    }
  ];

  /**
   * Conecta con el hardware ESP32/Arduino
   */
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

  /**
   * Prueba la conexión con ESP32
   */
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

  /**
   * Cierra sesión y vuelve a la página principal
   */
  const handleClose = async () => {
    try {
      await logout();
      navigate('/');
    } catch (error) {
      console.error('Error al cerrar sesión:', error);
      // Navegar de todas formas
      navigate('/');
    }
  };

  /**
   * Cambia de pestaña
   */
  const changeTab = (tabId: TabType) => {
    setActiveTab(tabId);
  };

  /**
   * Obtiene el componente de la pestaña activa
   */
  const getActiveTabComponent = () => {
    const activeTabConfig = tabs.find(tab => tab.id === activeTab);
    return activeTabConfig?.component || null;
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header con botón de cierre */}
      <div className="bg-white shadow-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Título y usuario actual */}
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Panel de Administración</h1>
              {user && (
                <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                  {user.username} {user.isAdmin && '(Admin)'}
                </span>
              )}
            </div>

            {/* Controles de la derecha */}
            <div className="flex items-center gap-2">
              {/* Botón sincronizar lotes */}
              <SyncButton />

              {/* Botón conectar ESP32 */}
              <button
                onClick={handleSerialConnect}
                className={`flex items-center px-3 py-2 rounded-md transition-colors ${
                  isSerialConnected
                    ? 'bg-green-100 text-green-800 hover:bg-green-200'
                    : 'bg-yellow-400 hover:bg-yellow-500 text-gray-900'
                }`}
                title={isSerialConnected ? 'ESP32 Conectado' : 'Conectar ESP32'}
              >
                <Usb className="w-5 h-5" />
              </button>

              {/* Botón test */}
              {isSerialConnected && (
                <button
                  onClick={handleTestESP32}
                  className="flex items-center px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors"
                  title="Probar LED"
                >
                  Test LED
                </button>
              )}

              {/* Botón cerrar sesión */}
              <button
                onClick={handleClose}
                className="flex items-center gap-2 px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-md transition-colors"
                title="Cerrar sesión y volver al inicio"
              >
                <LogOut size={20} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mensaje de error de conexión serial */}
      {serialError && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
            <span className="font-medium">Error:</span>
            <span>{serialError}</span>
          </div>
        </div>
      )}

      {/* Contenedor principal */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Navegación por pestañas */}
        <div className="bg-white shadow-lg rounded-lg mb-8 overflow-hidden">
          <div className="border-b border-gray-200">
            <nav className="flex overflow-x-auto scrollbar-hide" aria-label="Tabs">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    onClick={() => changeTab(tab.id)}
                    className={`
                      flex items-center gap-2 px-6 py-4 whitespace-nowrap font-medium text-sm
                      border-b-2 transition-all duration-200
                      ${isActive
                        ? 'border-blue-600 text-blue-600 bg-blue-50'
                        : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300 hover:bg-gray-50'
                      }
                    `}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon size={18} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Contenido de la pestaña activa */}
        <div className="bg-white shadow-lg rounded-lg p-6 min-h-[500px]">
          {getActiveTabComponent()}
        </div>
      </div>
    </div>
  );
}
