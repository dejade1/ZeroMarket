import React, { useState } from 'react';
import { X, UserPlus, KeyRound, LogIn, Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface AdminLoginProps {
  onClose: () => void;
}

type View = 'login' | 'register' | 'recover';

interface User {
  username: string;
  email: string;
  password: string;
  isAdmin: boolean;
}

const STORAGE_KEY = 'app_users';

const getUsers = (): User[] => {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
};

const saveUser = (newUser: User) => {
  const users = getUsers();
  const adminCount = users.filter(u => u.isAdmin).length;
  
  if (newUser.isAdmin && adminCount >= 5) {
    throw new Error('Máximo número de administradores alcanzado (5)');
  }

  if (users.some(user => user.username === newUser.username)) {
    throw new Error('El nombre de usuario ya existe');
  }

  if (users.some(user => user.email === newUser.email)) {
    throw new Error('El email ya está registrado');
  }
  
  users.push(newUser);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
};

const validateUser = (username: string, password: string): User | null => {
  const users = getUsers();
  return users.find(user => user.username === username && user.password === password) || null;
};

export function AdminLogin({ onClose }: AdminLoginProps) {
  const [view, setView] = useState<View>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const resetForm = () => {
    setUsername('');
    setPassword('');
    setEmail('');
    setIsAdmin(false);
    setError('');
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const user = validateUser(username, password);
    
    if (user) {
      if (user.isAdmin) {
        navigate('/admin');
        onClose();
      } else {
        setError('No tienes permisos de administrador');
      }
    } else {
      setError('Usuario o contraseña incorrectos');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres');
      return;
    }

    try {
      const newUser = {
        username,
        email,
        password,
        isAdmin
      };

      saveUser(newUser);
      setMessage('Usuario registrado exitosamente');
      resetForm();
      
      setTimeout(() => {
        setView('login');
        setMessage('');
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al registrar usuario');
    }
  };

  const handleRecover = (e: React.FormEvent) => {
    e.preventDefault();
    const users = getUsers();
    const user = users.find(u => u.email === email);

    if (user) {
      // En un entorno real, aquí enviaríamos un email
      setMessage('Se han enviado instrucciones de recuperación a tu email');
    } else {
      setMessage('Si existe una cuenta con este email, recibirás instrucciones para recuperar tu contraseña');
    }

    setTimeout(() => {
      setView('login');
      setMessage('');
      resetForm();
    }, 3000);
  };

  const handleViewChange = (newView: View) => {
    setView(newView);
    resetForm();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
        
        <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6">
          <div className="absolute right-4 top-4">
            <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="flex justify-between items-center mb-6">
            <button
              onClick={() => handleViewChange('login')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md ${
                view === 'login' ? 'bg-yellow-400 text-gray-900' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <LogIn className="w-5 h-5" />
              <span>Iniciar Sesión</span>
            </button>
            <button
              onClick={() => handleViewChange('register')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md ${
                view === 'register' ? 'bg-yellow-400 text-gray-900' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <UserPlus className="w-5 h-5" />
              <span>Registrarse</span>
            </button>
          </div>

          {error && (
            <div className="bg-red-50 text-red-500 p-3 rounded-md text-sm mb-4">
              {error}
            </div>
          )}

          {message && (
            <div className="bg-green-50 text-green-500 p-3 rounded-md text-sm mb-4">
              {message}
            </div>
          )}

          {view === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-gray-700">
                  Usuario
                </label>
                <input
                  type="text"
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-yellow-500 focus:outline-none focus:ring-yellow-500"
                  required
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Contraseña
                </label>
                <div className="relative mt-1">
                  <input
                    type={showPassword ? "text" : "password"}
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2 pr-10 focus:border-yellow-500 focus:outline-none focus:ring-yellow-500"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-medium py-2 px-4 rounded-md transition-colors"
              >
                Iniciar Sesión
              </button>

              <button
                type="button"
                onClick={() => handleViewChange('recover')}
                className="w-full text-sm text-gray-600 hover:text-gray-900"
              >
                ¿Olvidaste tu contraseña?
              </button>
            </form>
          )}

          {view === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label htmlFor="reg-username" className="block text-sm font-medium text-gray-700">
                  Usuario
                </label>
                <input
                  type="text"
                  id="reg-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-yellow-500 focus:outline-none focus:ring-yellow-500"
                  required
                />
              </div>

              <div>
                <label htmlFor="reg-email" className="block text-sm font-medium text-gray-700">
                  Email
                </label>
                <input
                  type="email"
                  id="reg-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-yellow-500 focus:outline-none focus:ring-yellow-500"
                  required
                />
              </div>

              <div>
                <label htmlFor="reg-password" className="block text-sm font-medium text-gray-700">
                  Contraseña
                </label>
                <div className="relative mt-1">
                  <input
                    type={showPassword ? "text" : "password"}
                    id="reg-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2 pr-10 focus:border-yellow-500 focus:outline-none focus:ring-yellow-500"
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  Mínimo 6 caracteres
                </p>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="isAdmin"
                  checked={isAdmin}
                  onChange={(e) => setIsAdmin(e.target.checked)}
                  className="h-4 w-4 text-yellow-400 focus:ring-yellow-500 border-gray-300 rounded"
                />
                <label htmlFor="isAdmin" className="ml-2 block text-sm text-gray-700">
                  Registrar como administrador
                </label>
              </div>

              <button
                type="submit"
                className="w-full bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-medium py-2 px-4 rounded-md transition-colors"
              >
                Registrar Usuario
              </button>
            </form>
          )}

          {view === 'recover' && (
            <form onSubmit={handleRecover} className="space-y-4">
              <div>
                <label htmlFor="recover-email" className="block text-sm font-medium text-gray-700">
                  Email
                </label>
                <input
                  type="email"
                  id="recover-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-yellow-500 focus:outline-none focus:ring-yellow-500"
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-medium py-2 px-4 rounded-md transition-colors"
              >
                Recuperar Contraseña
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}