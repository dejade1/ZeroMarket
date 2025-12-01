/**
 * ARCHIVO CORREGIDO: AdminLogin.tsx
 * 
 * CAMBIOS PRINCIPALES:
 * 1. ✅ Eliminado almacenamiento de contraseñas en texto plano
 * 2. ✅ Implementado hash de contraseñas con crypto API
 * 3. ✅ Validación robusta de entradas
 * 4. ✅ Mensajes de error genéricos (no revelan información)
 * 5. ✅ Sanitización de inputs
 * 6. ✅ Rate limiting básico
 * 7. ✅ Manejo de errores mejorado
 * 8. ✅ Tipos TypeScript estrictos
 * 9. ✅ Constantes en lugar de magic numbers
 * 10. ✅ Separación de lógica de negocio
 */

import { useState, useCallback } from 'react';
import { X, Eye, EyeOff, AlertCircle, CheckCircle } from 'lucide-react';

// ==================== CONSTANTES ====================
const VALIDATION = {
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_MAX_LENGTH: 128,
  USERNAME_MIN_LENGTH: 3,
  USERNAME_MAX_LENGTH: 50,
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_DURATION_MS: 15 * 60 * 1000, // 15 minutos
} as const;

const STORAGE_KEYS = {
  USERS: 'app_users_secure',
  LOGIN_ATTEMPTS: 'login_attempts',
  LOCKOUT_UNTIL: 'lockout_until',
} as const;

const ERROR_MESSAGES = {
  INVALID_CREDENTIALS: 'Credenciales inválidas. Por favor, verifica tus datos.',
  ACCOUNT_LOCKED: 'Cuenta bloqueada temporalmente. Intenta más tarde.',
  WEAK_PASSWORD: 'La contraseña debe tener al menos 8 caracteres, incluir mayúsculas, minúsculas, números y símbolos.',
  INVALID_EMAIL: 'Por favor, ingresa un email válido.',
  USERNAME_TOO_SHORT: 'El nombre de usuario debe tener al menos 3 caracteres.',
  GENERIC_ERROR: 'Ocurrió un error. Por favor, intenta nuevamente.',
} as const;

// ==================== TIPOS ====================
interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string; // ✅ Ahora almacenamos hash, no contraseña
  isAdmin: boolean;
  createdAt: string;
  lastLogin?: string;
}

interface AdminLoginProps {
  onClose: () => void;
}

interface LoginAttempt {
  count: number;
  lastAttempt: number;
}

// ==================== UTILIDADES DE SEGURIDAD ====================

/**
 * Hash de contraseña usando Web Crypto API
 * NOTA: En producción, esto debe hacerse en el backend
 */
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sanitiza entrada de usuario para prevenir XSS
 */
function sanitizeInput(input: string): string {
  return input
    .trim()
    .replace(/[<>]/g, '') // Elimina caracteres peligrosos
    .slice(0, 200); // Limita longitud
}

/**
 * Valida formato de email
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Valida fortaleza de contraseña
 */
function isStrongPassword(password: string): boolean {
  if (password.length < VALIDATION.PASSWORD_MIN_LENGTH) return false;
  if (password.length > VALIDATION.PASSWORD_MAX_LENGTH) return false;
  
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  
  return hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar;
}

/**
 * Genera ID único
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ==================== GESTIÓN DE ALMACENAMIENTO SEGURO ====================

/**
 * Parse seguro de JSON desde localStorage
 */
function safeJSONParse<T>(key: string, defaultValue: T): T {
  try {
    const item = localStorage.getItem(key);
    if (!item) return defaultValue;
    return JSON.parse(item) as T;
  } catch (error) {
    console.error(`Error parsing ${key}:`, error);
    return defaultValue;
  }
}

/**
 * Obtiene usuarios almacenados de forma segura
 */
function getStoredUsers(): User[] {
  return safeJSONParse<User[]>(STORAGE_KEYS.USERS, []);
}

/**
 * Guarda usuarios de forma segura
 */
function saveUsers(users: User[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
  } catch (error) {
    console.error('Error saving users:', error);
    throw new Error('No se pudo guardar la información del usuario');
  }
}

// ==================== RATE LIMITING ====================

/**
 * Verifica si la cuenta está bloqueada
 */
function isAccountLocked(): boolean {
  const lockoutUntil = localStorage.getItem(STORAGE_KEYS.LOCKOUT_UNTIL);
  if (!lockoutUntil) return false;
  
  const lockoutTime = parseInt(lockoutUntil, 10);
  if (Date.now() < lockoutTime) {
    return true;
  }
  
  // Lockout expirado, limpiar
  localStorage.removeItem(STORAGE_KEYS.LOCKOUT_UNTIL);
  localStorage.removeItem(STORAGE_KEYS.LOGIN_ATTEMPTS);
  return false;
}

/**
 * Registra intento de login fallido
 */
function recordFailedAttempt(): void {
  const attempts = safeJSONParse<LoginAttempt>(
    STORAGE_KEYS.LOGIN_ATTEMPTS,
    { count: 0, lastAttempt: Date.now() }
  );
  
  attempts.count += 1;
  attempts.lastAttempt = Date.now();
  
  localStorage.setItem(STORAGE_KEYS.LOGIN_ATTEMPTS, JSON.stringify(attempts));
  
  if (attempts.count >= VALIDATION.MAX_LOGIN_ATTEMPTS) {
    const lockoutUntil = Date.now() + VALIDATION.LOCKOUT_DURATION_MS;
    localStorage.setItem(STORAGE_KEYS.LOCKOUT_UNTIL, lockoutUntil.toString());
  }
}

/**
 * Limpia intentos de login después de éxito
 */
function clearLoginAttempts(): void {
  localStorage.removeItem(STORAGE_KEYS.LOGIN_ATTEMPTS);
  localStorage.removeItem(STORAGE_KEYS.LOCKOUT_UNTIL);
}

// ==================== AUTENTICACIÓN ====================

/**
 * Valida credenciales de usuario
 * ✅ Ahora usa hash de contraseña y no revela información
 */
async function validateCredentials(
  username: string,
  password: string
): Promise<User | null> {
  const users = getStoredUsers();
  const passwordHash = await hashPassword(password);
  
  const user = users.find(
    u => u.username === username && u.passwordHash === passwordHash
  );
  
  return user || null;
}

/**
 * Registra nuevo usuario
 */
async function registerUser(
  username: string,
  email: string,
  password: string,
  isAdmin: boolean = false
): Promise<User> {
  // Validaciones
  if (username.length < VALIDATION.USERNAME_MIN_LENGTH) {
    throw new Error(ERROR_MESSAGES.USERNAME_TOO_SHORT);
  }
  
  if (!isValidEmail(email)) {
    throw new Error(ERROR_MESSAGES.INVALID_EMAIL);
  }
  
  if (!isStrongPassword(password)) {
    throw new Error(ERROR_MESSAGES.WEAK_PASSWORD);
  }
  
  const users = getStoredUsers();
  
  // Verificar si el usuario ya existe
  if (users.some(u => u.username === username || u.email === email)) {
    throw new Error('El usuario o email ya existe');
  }
  
  // Crear nuevo usuario con contraseña hasheada
  const newUser: User = {
    id: generateId(),
    username: sanitizeInput(username),
    email: sanitizeInput(email),
    passwordHash: await hashPassword(password),
    isAdmin,
    createdAt: new Date().toISOString(),
  };
  
  users.push(newUser);
  saveUsers(users);
  
  return newUser;
}

// ==================== COMPONENTE ====================

export function AdminLogin({ onClose }: AdminLoginProps) {
  // Estado
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // ==================== HANDLERS ====================

  /**
   * Maneja el login
   */
  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    
    // Verificar si está bloqueado
    if (isAccountLocked()) {
      setError(ERROR_MESSAGES.ACCOUNT_LOCKED);
      return;
    }
    
    setIsLoading(true);
    
    try {
      // Sanitizar inputs
      const sanitizedUsername = sanitizeInput(username);
      const sanitizedPassword = sanitizeInput(password);
      
      // Validar credenciales
      const user = await validateCredentials(sanitizedUsername, sanitizedPassword);
      
      if (!user) {
        recordFailedAttempt();
        setError(ERROR_MESSAGES.INVALID_CREDENTIALS);
        return;
      }
      
      // Login exitoso
      clearLoginAttempts();
      
      // Actualizar último login
      const users = getStoredUsers();
      const updatedUsers = users.map(u =>
        u.id === user.id ? { ...u, lastLogin: new Date().toISOString() } : u
      );
      saveUsers(updatedUsers);
      
      // ⚠️ NOTA: En producción, aquí se debe:
      // 1. Enviar credenciales al backend
      // 2. Recibir JWT token
      // 3. Almacenar token en httpOnly cookie
      // 4. NO almacenar información sensible en localStorage
      
      setSuccess('¡Login exitoso!');
      setTimeout(() => {
        onClose();
        // Aquí se debe redirigir al dashboard
      }, 1000);
      
    } catch (err) {
      console.error('Login error:', err);
      setError(ERROR_MESSAGES.GENERIC_ERROR);
    } finally {
      setIsLoading(false);
    }
  }, [username, password, onClose]);

  /**
   * Maneja el registro
   */
  const handleRegister = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsLoading(true);
    
    try {
      await registerUser(username, email, password, false);
      setSuccess('¡Registro exitoso! Ahora puedes iniciar sesión.');
      
      // Limpiar formulario
      setUsername('');
      setEmail('');
      setPassword('');
      
      // Cambiar a modo login después de 2 segundos
      setTimeout(() => {
        setIsLogin(true);
        setSuccess('');
      }, 2000);
      
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(ERROR_MESSAGES.GENERIC_ERROR);
      }
    } finally {
      setIsLoading(false);
    }
  }, [username, email, password]);

  // ==================== RENDER ====================

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 relative">
        {/* Botón cerrar */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Cerrar"
        >
          <X size={24} />
        </button>

        {/* Título */}
        <h2 className="text-2xl font-bold text-gray-800 mb-6">
          {isLogin ? 'Iniciar Sesión' : 'Registrarse'}
        </h2>

        {/* Mensajes de error/éxito */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
            <AlertCircle className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {success && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-start gap-2">
            <CheckCircle className="text-green-500 flex-shrink-0 mt-0.5" size={20} />
            <p className="text-sm text-green-700">{success}</p>
          </div>
        )}

        {/* Formulario */}
        <form onSubmit={isLogin ? handleLogin : handleRegister}>
          {/* Campo Usuario */}
          <div className="mb-4">
            <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
              Usuario
            </label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
              minLength={VALIDATION.USERNAME_MIN_LENGTH}
              maxLength={VALIDATION.USERNAME_MAX_LENGTH}
              disabled={isLoading}
              autoComplete="username"
            />
          </div>

          {/* Campo Email (solo en registro) */}
          {!isLogin && (
            <div className="mb-4">
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Email
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
                disabled={isLoading}
                autoComplete="email"
              />
            </div>
          )}

          {/* Campo Contraseña */}
          <div className="mb-6">
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
              Contraseña
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-12"
                required
                minLength={VALIDATION.PASSWORD_MIN_LENGTH}
                maxLength={VALIDATION.PASSWORD_MAX_LENGTH}
                disabled={isLoading}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            {!isLogin && (
              <p className="mt-1 text-xs text-gray-500">
                Mínimo 8 caracteres, incluye mayúsculas, minúsculas, números y símbolos
              </p>
            )}
          </div>

          {/* Botón Submit */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
          >
            {isLoading ? 'Procesando...' : (isLogin ? 'Iniciar Sesión' : 'Registrarse')}
          </button>
        </form>

        {/* Toggle Login/Register */}
        <div className="mt-4 text-center">
          <button
            onClick={() => {
              setIsLogin(!isLogin);
              setError('');
              setSuccess('');
            }}
            className="text-sm text-blue-600 hover:text-blue-700 transition-colors"
            disabled={isLoading}
          >
            {isLogin ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión'}
          </button>
        </div>

        {/* Advertencia de seguridad */}
        <div className="mt-6 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-xs text-yellow-800">
            ⚠️ <strong>Nota de Desarrollo:</strong> Este sistema de autenticación es solo para demostración. 
            En producción, debe implementarse un backend real con autenticación JWT y almacenamiento seguro.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * ==================== NOTAS DE IMPLEMENTACIÓN ====================
 * 
 * MEJORAS IMPLEMENTADAS:
 * ✅ Hash de contraseñas (SHA-256)
 * ✅ Validación robusta de inputs
 * ✅ Sanitización contra XSS
 * ✅ Rate limiting básico
 * ✅ Mensajes de error genéricos
 * ✅ Tipos TypeScript estrictos
 * ✅ Constantes en lugar de magic numbers
 * ✅ Manejo de errores mejorado
 * ✅ Accesibilidad (labels, aria-labels)
 * ✅ UX mejorada (loading states, feedback)
 * 
 * PENDIENTE PARA PRODUCCIÓN:
 * 🔴 Implementar backend real (Node.js + Express/NestJS)
 * 🔴 Usar JWT con httpOnly cookies
 * 🔴 Implementar refresh tokens
 * 🔴 Usar bcrypt/argon2 en lugar de SHA-256
 * 🔴 Implementar CAPTCHA
 * 🔴 Implementar 2FA
 * 🔴 Logging de eventos de seguridad
 * 🔴 Implementar HTTPS
 * 🔴 Implementar CSRF protection
 * 🔴 Rate limiting a nivel de servidor
 * 🔴 Validación server-side
 */
