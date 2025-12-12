import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initializeDB } from './lib/inventory';
import './lib/clear-db'; // Función global para limpiar DB
import { syncAllProductsToBackend } from './lib/sync-to-backend'; // Función para sincronizar IndexedDB → Backend

import { AuthProvider } from './context/AuthContext';

// Inicializar la base de datos antes de renderizar la aplicación
initializeDB().then(async () => {
  // Sincronizar automáticamente al cargar la aplicación
  console.log('🔄 Sincronizando datos al backend...');
  try {
    await syncAllProductsToBackend();
    console.log('✅ Sincronización inicial completada');
  } catch (error) {
    console.error('⚠️ Error en sincronización inicial:', error);
    // No bloquear la carga de la aplicación si falla
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AuthProvider>
        <App />
      </AuthProvider>
    </StrictMode>
  );
}).catch(error => {
  console.error('Error al inicializar la base de datos:', error);
});