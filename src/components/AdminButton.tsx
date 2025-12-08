/**
 * COMPONENTE: AdminButton
 *
 * Botón flotante de administración que requiere autenticación
 *
 * CARACTERÍSTICAS:
 * ✅ Navegación con React Router
 * ✅ Autenticación requerida
 * ✅ Modal de login
 * ✅ Botón flotante con diseño moderno
 * ✅ Animaciones suaves
 * ✅ Accesibilidad mejorada
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AdminLogin } from './AdminLogin';

export function AdminButton() {
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);

  /**
   * Maneja el clic en el botón de administración
   * Verifica autenticación antes de navegar
   */
  const handleClick = () => {
    if (isAuthenticated) {
      // Si ya está autenticado, navegar directamente
      navigate('/admin');
    } else {
      // Si no está autenticado, mostrar modal de login
      setShowLoginModal(true);
    }
  };

  /**
   * Cierra el modal de login
   * Si el usuario se autenticó exitosamente, navegar al panel
   */
  const handleCloseModal = () => {
    setShowLoginModal(false);
    // Si el usuario se autenticó mientras el modal estaba abierto, navegar
    if (isAuthenticated) {
      navigate('/admin');
    }
  };

  // Efecto para navegar cuando el usuario se autentica
  useEffect(() => {
    if (isAuthenticated && showLoginModal) {
      setShowLoginModal(false);
      navigate('/admin');
    }
  }, [isAuthenticated, showLoginModal, navigate]);

  return (
    <>
      <button
        onClick={handleClick}
        className="fixed bottom-6 left-6 z-50 flex items-center justify-center w-14 h-14 bg-gradient-to-br from-blue-600 to-blue-700 text-white font-bold text-xl rounded-full shadow-lg hover:from-blue-700 hover:to-blue-800 hover:shadow-xl transform hover:scale-110 transition-all duration-200 border-2 border-blue-500"
        title={isAuthenticated ? `Administración (${user?.username})` : "Administración - Iniciar Sesión"}
        aria-label="Abrir panel de administración"
      >
        A
      </button>

      {/* Modal de Login */}
      {showLoginModal && <AdminLogin onClose={handleCloseModal} />}
    </>
  );
}