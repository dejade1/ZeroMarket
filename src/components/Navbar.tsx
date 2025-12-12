import React, { useState, useRef, useEffect } from 'react';
import { Search, ShoppingCart, Menu, User, MapPin, LogOut, Award } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { ClientLogin } from './ClientLogin';

interface NavbarProps {
  onSearch: (term: string) => void;
  searchTerm: string;
}

export function Navbar({ onSearch, searchTerm }: NavbarProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showClientLogin, setShowClientLogin] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const { state, dispatch } = useCart();
  const { user, isAuthenticated, logout } = useAuth();
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSearch(e.target.value);
  };

  const totalItems = state.items.reduce((sum, item) => sum + item.quantity, 0);

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowUserDropdown(false);
      }
    };

    if (showUserDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showUserDropdown]);

  /**
   * Maneja el clic en el botón de cuenta
   * Si no está autenticado, muestra login
   * Si está autenticado como cliente, muestra dropdown
   */
  const handleAccountClick = () => {
    if (!isAuthenticated) {
      setShowClientLogin(true);
    } else if (user?.role === 'CLIENT') {
      setShowUserDropdown(!showUserDropdown);
    } else {
      // Admin/User - podría mostrar un menú diferente o redirigir
      setShowUserDropdown(!showUserDropdown);
    }
  };

  /**
   * Maneja el logout del usuario
   */
  const handleLogout = async () => {
    try {
      await logout();
      setShowUserDropdown(false);
    } catch (error) {
      console.error('Error al cerrar sesión:', error);
    }
  };

  // Obtener puntos del usuario
  const userPoints = user?.loyaltyPoints || 0;

  return (
    <>
      <nav className="bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center space-x-8">
              <div className="text-2xl font-bold">Tienda</div>
              <div className="hidden md:flex items-center space-x-2">
                <MapPin className="w-5 h-5" />
                <span className="text-sm">Enviar a Usuario</span>
              </div>
            </div>

            <div className="flex-1 max-w-2xl mx-4">
              <div className="relative">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={handleSearchChange}
                  placeholder="Buscar productos..."
                  className="w-full py-2 px-4 pr-10 rounded-md text-gray-900 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
                <button className="absolute right-0 top-0 h-full px-4 text-gray-600 hover:text-gray-900">
                  <Search className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="hidden md:flex items-center space-x-6">
              {/* Botón de cuenta con dropdown */}
              <div className="relative" ref={dropdownRef}>
                <button 
                  onClick={handleAccountClick}
                  className="flex items-center space-x-1 hover:text-yellow-400 transition-colors"
                >
                  <User className="w-5 h-5" />
                  <span>
                    {isAuthenticated && user?.role === 'CLIENT'
                      ? `Hola, ${user.username}`
                      : 'Iniciar Sesión'}
                  </span>
                </button>

                {/* Dropdown menu */}
                {showUserDropdown && isAuthenticated && user?.role === 'CLIENT' && (
                  <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-xl py-2 z-50 border border-gray-200">
                    {/* Header del usuario */}
                    <div className="px-4 py-3 border-b border-gray-200">
                      <p className="text-sm font-semibold text-gray-900">Hola, {user.username}</p>
                      <p className="text-xs text-gray-500">{user.email}</p>
                    </div>

                    {/* Puntos */}
                    <div className="px-4 py-3 border-b border-gray-200">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Award className="w-5 h-5 text-yellow-500" />
                          <span className="text-sm text-gray-700">Mis Puntos</span>
                        </div>
                        <span className="text-lg font-bold text-yellow-500">{userPoints}</span>
                      </div>
                    </div>

                    {/* Opción de cerrar sesión */}
                    <button
                      onClick={handleLogout}
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center space-x-2 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Cerrar Sesión</span>
                    </button>
                  </div>
                )}
              </div>

              <button 
                className="flex items-center space-x-1 hover:text-yellow-400 transition-colors"
                onClick={() => dispatch({ type: 'TOGGLE_CART' })}
              >
                <ShoppingCart className="w-5 h-5" />
                {totalItems > 0 && (
                  <span className="bg-yellow-400 text-gray-900 rounded-full w-5 h-5 flex items-center justify-center text-xs font-semibold">
                    {totalItems}
                  </span>
                )}
              </button>
            </div>

            <button
              className="md:hidden"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              <Menu className="w-6 h-6" />
            </button>
          </div>

          {/* Menú móvil */}
          {isMenuOpen && (
            <div className="md:hidden px-2 pt-2 pb-3 space-y-1">
              <button
                onClick={handleAccountClick}
                className="block w-full text-left px-3 py-2 rounded-md text-white hover:bg-gray-700"
              >
                {isAuthenticated && user?.role === 'CLIENT'
                  ? `Hola, ${user.username}`
                  : 'Iniciar Sesión'}
              </button>
              
              {isAuthenticated && user?.role === 'CLIENT' && (
                <>
                  <div className="px-3 py-2 text-sm text-gray-300">
                    <div className="flex items-center justify-between">
                      <span>Mis Puntos:</span>
                      <span className="text-yellow-400 font-bold">{userPoints}</span>
                    </div>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="block w-full text-left px-3 py-2 rounded-md text-white hover:bg-gray-700"
                  >
                    Cerrar Sesión
                  </button>
                </>
              )}

              <button
                onClick={() => dispatch({ type: 'TOGGLE_CART' })}
                className="block w-full text-left px-3 py-2 rounded-md text-white hover:bg-gray-700"
              >
                Carrito ({totalItems})
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* Modal de login de clientes */}
      {showClientLogin && (
        <ClientLogin onClose={() => setShowClientLogin(false)} />
      )}
    </>
  );
}