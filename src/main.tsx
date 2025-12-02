import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initializeDB } from './lib/inventory';

import { AuthProvider } from './context/AuthContext';

// Inicializar la base de datos antes de renderizar la aplicación
initializeDB().then(() => {
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