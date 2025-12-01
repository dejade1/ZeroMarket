# 💡 Ejemplos Prácticos de Uso

## Índice
1. [Uso del Sistema de Errores](#1-uso-del-sistema-de-errores)
2. [Uso del Sistema de Validación](#2-uso-del-sistema-de-validación)
3. [Integración con el Backend](#3-integración-con-el-backend)
4. [Componentes de React](#4-componentes-de-react)
5. [Casos de Uso Completos](#5-casos-de-uso-completos)

---

## 1. Uso del Sistema de Errores

### 1.1 En un Componente de React

```typescript
import { useErrorHandler, ValidationError } from '../utils/errorHandler';

function ProductForm() {
  const { error, handleError, clearError, hasError } = useErrorHandler();
  const [product, setProduct] = useState({ title: '', price: 0 });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    try {
      // Validación
      if (!product.title) {
        throw new ValidationError('El título es obligatorio');
      }

      if (product.price <= 0) {
        throw new ValidationError('El precio debe ser mayor a 0');
      }

      // Enviar al backend
      const response = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(product),
      });

      if (!response.ok) {
        throw new Error('Error al crear producto');
      }

      // Éxito
      alert('Producto creado exitosamente');
      
    } catch (err) {
      handleError(err);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {hasError && (
        <div className="error-message">
          {error?.message}
        </div>
      )}
      
      <input
        type="text"
        value={product.title}
        onChange={(e) => setProduct({ ...product, title: e.target.value })}
      />
      
      <input
        type="number"
        value={product.price}
        onChange={(e) => setProduct({ ...product, price: Number(e.target.value) })}
      />
      
      <button type="submit">Crear Producto</button>
    </form>
  );
}
```

### 1.2 En un Servicio

```typescript
import { 
  handleAsyncError, 
  DatabaseError, 
  NotFoundError,
  logger 
} from '../utils/errorHandler';

class ProductService {
  async getProduct(id: number) {
    // Opción 1: Con handleAsyncError
    const [error, product] = await handleAsyncError(
      fetch(`/api/products/${id}`).then(r => r.json()),
      'Error al obtener producto'
    );

    if (error) {
      logger.error('Failed to get product', error);
      throw new DatabaseError(error.message);
    }

    if (!product) {
      throw new NotFoundError('Producto');
    }

    return product;
  }

  async createProduct(data: ProductData) {
    // Opción 2: Con try-catch tradicional
    try {
      const response = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new DatabaseError(error.message);
      }

      const product = await response.json();
      logger.info('Product created', { productId: product.id });
      
      return product;
      
    } catch (error) {
      logger.error('Failed to create product', error as Error);
      throw handleError(error);
    }
  }
}
```

---

## 2. Uso del Sistema de Validación

### 2.1 Validación de Formulario de Registro

```typescript
import {
  validateFields,
  sanitizeString,
  sanitizeEmail,
  getPasswordStrength,
  ValidationError,
} from '../utils/validation';

function RegisterForm() {
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [passwordStrength, setPasswordStrength] = useState({ score: 0, feedback: [] });

  // Validar en tiempo real la contraseña
  useEffect(() => {
    if (formData.password) {
      const strength = getPasswordStrength(formData.password);
      setPasswordStrength(strength);
    }
  }, [formData.password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validar todos los campos
    const validation = validateFields([
      {
        value: formData.username,
        fieldName: 'Usuario',
        rules: ['required', 'username'],
      },
      {
        value: formData.email,
        fieldName: 'Email',
        rules: ['required', 'email'],
      },
      {
        value: formData.password,
        fieldName: 'Contraseña',
        rules: ['required', 'password'],
      },
    ]);

    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    // Sanitizar datos antes de enviar
    const sanitizedData = {
      username: sanitizeString(formData.username),
      email: sanitizeEmail(formData.email),
      password: formData.password, // No sanitizar contraseña
    };

    try {
      // Enviar al backend
      await authService.register(sanitizedData);
      alert('Registro exitoso');
    } catch (error) {
      if (error instanceof ValidationError) {
        setErrors([error.message]);
      }
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {errors.length > 0 && (
        <div className="errors">
          {errors.map((error, i) => (
            <p key={i}>{error}</p>
          ))}
        </div>
      )}

      <div>
        <label>Usuario</label>
        <input
          type="text"
          value={formData.username}
          onChange={(e) => setFormData({ ...formData, username: e.target.value })}
        />
      </div>

      <div>
        <label>Email</label>
        <input
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
        />
      </div>

      <div>
        <label>Contraseña</label>
        <input
          type="password"
          value={formData.password}
          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
        />
        
        {/* Indicador de fortaleza */}
        <div className="password-strength">
          <div className="strength-bar">
            <div 
              className="strength-fill"
              style={{ 
                width: `${(passwordStrength.score / 6) * 100}%`,
                backgroundColor: passwordStrength.score < 3 ? 'red' : 
                                 passwordStrength.score < 5 ? 'orange' : 'green'
              }}
            />
          </div>
          {passwordStrength.feedback.length > 0 && (
            <ul className="feedback">
              {passwordStrength.feedback.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <button type="submit">Registrarse</button>
    </form>
  );
}
```

### 2.2 Validación de Producto

```typescript
import {
  validateOrThrow,
  sanitizeString,
  sanitizeNumber,
  productValidationSchema,
} from '../utils/validation';

function ProductEditor({ product, onSave }: ProductEditorProps) {
  const [formData, setFormData] = useState(product);

  const handleSave = async () => {
    try {
      // Validar cada campo
      validateOrThrow(formData.title, 'Título', productValidationSchema.title);
      validateOrThrow(formData.price, 'Precio', productValidationSchema.price);
      validateOrThrow(formData.stock, 'Stock', productValidationSchema.stock);

      // Sanitizar datos
      const sanitizedProduct = {
        ...formData,
        title: sanitizeString(formData.title),
        price: sanitizeNumber(formData.price) || 0,
        stock: sanitizeNumber(formData.stock) || 0,
      };

      // Guardar
      await onSave(sanitizedProduct);
      alert('Producto guardado');
      
    } catch (error) {
      if (error instanceof ValidationError) {
        alert(error.message);
      }
    }
  };

  return (
    <div>
      <input
        type="text"
        value={formData.title}
        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
        placeholder="Título del producto"
      />
      
      <input
        type="number"
        value={formData.price}
        onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
        placeholder="Precio"
      />
      
      <input
        type="number"
        value={formData.stock}
        onChange={(e) => setFormData({ ...formData, stock: Number(e.target.value) })}
        placeholder="Stock"
      />
      
      <button onClick={handleSave}>Guardar</button>
    </div>
  );
}
```

---

## 3. Integración con el Backend

### 3.1 Servicio de Autenticación Completo

```typescript
// services/authService.ts
import { ValidationError, NetworkError, AuthenticationError } from '../utils/errorHandler';
import { sanitizeString, sanitizeEmail } from '../utils/validation';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface LoginCredentials {
  username: string;
  password: string;
}

interface RegisterData {
  username: string;
  email: string;
  password: string;
}

interface User {
  id: number;
  username: string;
  email: string;
  isAdmin: boolean;
}

class AuthService {
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        credentials: 'include', // Importante para cookies
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        
        if (response.status === 401) {
          throw new AuthenticationError(error.error);
        }
        
        if (response.status === 400) {
          throw new ValidationError(error.error);
        }
        
        throw new Error(error.error || 'Error en la petición');
      }

      return response.json();
      
    } catch (error) {
      if (error instanceof AuthenticationError || error instanceof ValidationError) {
        throw error;
      }
      
      if (error instanceof TypeError) {
        throw new NetworkError('Error de conexión. Verifica tu internet.');
      }
      
      throw error;
    }
  }

  async login(credentials: LoginCredentials): Promise<User> {
    const data = await this.request<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: sanitizeString(credentials.username),
        password: credentials.password,
      }),
    });

    return data.user;
  }

  async register(data: RegisterData): Promise<User> {
    const result = await this.request<{ user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: sanitizeString(data.username),
        email: sanitizeEmail(data.email),
        password: data.password,
      }),
    });

    return result.user;
  }

  async logout(): Promise<void> {
    await this.request('/api/auth/logout', {
      method: 'POST',
    });
  }

  async getCurrentUser(): Promise<User | null> {
    try {
      const data = await this.request<{ user: User }>('/api/auth/me');
      return data.user;
    } catch {
      return null;
    }
  }

  async refreshToken(): Promise<void> {
    await this.request('/api/auth/refresh', {
      method: 'POST',
    });
  }
}

export const authService = new AuthService();
```

### 3.2 Hook de Autenticación

```typescript
// hooks/useAuth.ts
import { useState, useEffect, useCallback } from 'react';
import { authService } from '../services/authService';
import { useErrorHandler } from '../utils/errorHandler';

interface User {
  id: number;
  username: string;
  email: string;
  isAdmin: boolean;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const { handleError } = useErrorHandler();

  // Cargar usuario al montar
  useEffect(() => {
    loadUser();
  }, []);

  // Refresh token cada 14 minutos (antes de que expire el access token)
  useEffect(() => {
    if (isAuthenticated) {
      const interval = setInterval(() => {
        authService.refreshToken().catch(() => {
          // Si falla el refresh, hacer logout
          logout();
        });
      }, 14 * 60 * 1000);

      return () => clearInterval(interval);
    }
  }, [isAuthenticated]);

  const loadUser = async () => {
    try {
      const currentUser = await authService.getCurrentUser();
      if (currentUser) {
        setUser(currentUser);
        setIsAuthenticated(true);
      }
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
    }
  };

  const login = useCallback(async (username: string, password: string) => {
    try {
      const loggedUser = await authService.login({ username, password });
      setUser(loggedUser);
      setIsAuthenticated(true);
      return loggedUser;
    } catch (error) {
      handleError(error);
      throw error;
    }
  }, [handleError]);

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch (error) {
      handleError(error);
    } finally {
      setUser(null);
      setIsAuthenticated(false);
    }
  }, [handleError]);

  const register = useCallback(async (data: RegisterData) => {
    try {
      const newUser = await authService.register(data);
      return newUser;
    } catch (error) {
      handleError(error);
      throw error;
    }
  }, [handleError]);

  return {
    user,
    isLoading,
    isAuthenticated,
    login,
    logout,
    register,
  };
}
```

---

## 4. Componentes de React

### 4.1 Componente de Login Completo

```typescript
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useErrorHandler } from '../utils/errorHandler';
import { validateField } from '../utils/validation';

export function LoginForm() {
  const { login } = useAuth();
  const { error, handleError, clearError } = useErrorHandler();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    const usernameValidation = validateField(username, 'Usuario', ['required', 'username']);
    if (!usernameValidation.isValid) {
      errors.username = usernameValidation.errors[0];
    }

    const passwordValidation = validateField(password, 'Contraseña', ['required']);
    if (!passwordValidation.isValid) {
      errors.password = passwordValidation.errors[0];
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      await login(username, password);
      // Redirigir o cerrar modal
    } catch (err) {
      handleError(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="login-form">
      {error && (
        <div className="alert alert-error">
          {error.message}
        </div>
      )}

      <div className="form-group">
        <label htmlFor="username">Usuario</label>
        <input
          type="text"
          id="username"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setFieldErrors({ ...fieldErrors, username: '' });
          }}
          className={fieldErrors.username ? 'error' : ''}
          disabled={isLoading}
        />
        {fieldErrors.username && (
          <span className="field-error">{fieldErrors.username}</span>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="password">Contraseña</label>
        <input
          type="password"
          id="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setFieldErrors({ ...fieldErrors, password: '' });
          }}
          className={fieldErrors.password ? 'error' : ''}
          disabled={isLoading}
        />
        {fieldErrors.password && (
          <span className="field-error">{fieldErrors.password}</span>
        )}
      </div>

      <button type="submit" disabled={isLoading}>
        {isLoading ? 'Iniciando sesión...' : 'Iniciar Sesión'}
      </button>
    </form>
  );
}
```

### 4.2 Ruta Protegida

```typescript
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { user, isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return <div>Cargando...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requireAdmin && !user?.isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

// Uso:
// <Route path="/admin" element={
//   <ProtectedRoute requireAdmin>
//     <AdminDashboard />
//   </ProtectedRoute>
// } />
```

---

## 5. Casos de Uso Completos

### 5.1 Flujo Completo de Registro

```typescript
// 1. Componente de Registro
function RegisterPage() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const { error, handleError, clearError } = useErrorHandler();
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    // Validar
    const validation = validateFields([
      { value: formData.username, fieldName: 'Usuario', rules: ['required', 'username'] },
      { value: formData.email, fieldName: 'Email', rules: ['required', 'email'] },
      { value: formData.password, fieldName: 'Contraseña', rules: ['required', 'password'] },
    ]);

    if (!validation.isValid) {
      handleError(new ValidationError(validation.errors.join(', ')));
      return;
    }

    // Verificar que las contraseñas coincidan
    if (formData.password !== formData.confirmPassword) {
      handleError(new ValidationError('Las contraseñas no coinciden'));
      return;
    }

    setIsLoading(true);

    try {
      await register({
        username: formData.username,
        email: formData.email,
        password: formData.password,
      });

      alert('Registro exitoso. Por favor, inicia sesión.');
      navigate('/login');
      
    } catch (err) {
      handleError(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="register-page">
      <h1>Registrarse</h1>
      
      {error && <ErrorAlert error={error} onClose={clearError} />}
      
      <form onSubmit={handleSubmit}>
        <Input
          label="Usuario"
          value={formData.username}
          onChange={(value) => setFormData({ ...formData, username: value })}
          disabled={isLoading}
        />
        
        <Input
          label="Email"
          type="email"
          value={formData.email}
          onChange={(value) => setFormData({ ...formData, email: value })}
          disabled={isLoading}
        />
        
        <PasswordInput
          label="Contraseña"
          value={formData.password}
          onChange={(value) => setFormData({ ...formData, password: value })}
          showStrength
          disabled={isLoading}
        />
        
        <PasswordInput
          label="Confirmar Contraseña"
          value={formData.confirmPassword}
          onChange={(value) => setFormData({ ...formData, confirmPassword: value })}
          disabled={isLoading}
        />
        
        <button type="submit" disabled={isLoading}>
          {isLoading ? 'Registrando...' : 'Registrarse'}
        </button>
      </form>
    </div>
  );
}
```

### 5.2 Flujo Completo de Gestión de Productos

```typescript
// Servicio de productos
class ProductService {
  async getProducts(): Promise<Product[]> {
    const response = await fetch('/api/products', {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new DatabaseError('Error al obtener productos');
    }

    return response.json();
  }

  async createProduct(data: ProductData): Promise<Product> {
    // Validar
    validateOrThrow(data.title, 'Título', productValidationSchema.title);
    validateOrThrow(data.price, 'Precio', productValidationSchema.price);
    validateOrThrow(data.stock, 'Stock', productValidationSchema.stock);

    // Sanitizar
    const sanitized = {
      ...data,
      title: sanitizeString(data.title),
      price: sanitizeNumber(data.price) || 0,
      stock: sanitizeNumber(data.stock) || 0,
    };

    const response = await fetch('/api/products', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sanitized),
    });

    if (!response.ok) {
      throw new DatabaseError('Error al crear producto');
    }

    return response.json();
  }
}

export const productService = new ProductService();

// Hook de productos
function useProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { handleError } = useErrorHandler();

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    try {
      const data = await productService.getProducts();
      setProducts(data);
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
    }
  };

  const createProduct = async (data: ProductData) => {
    try {
      const newProduct = await productService.createProduct(data);
      setProducts([...products, newProduct]);
      return newProduct;
    } catch (error) {
      handleError(error);
      throw error;
    }
  };

  return {
    products,
    isLoading,
    createProduct,
    reload: loadProducts,
  };
}

// Componente
function ProductManager() {
  const { products, isLoading, createProduct } = useProducts();
  const [showForm, setShowForm] = useState(false);

  if (isLoading) {
    return <Loading />;
  }

  return (
    <div>
      <h1>Productos</h1>
      
      <button onClick={() => setShowForm(true)}>
        Nuevo Producto
      </button>
      
      {showForm && (
        <ProductForm
          onSave={async (data) => {
            await createProduct(data);
            setShowForm(false);
          }}
          onCancel={() => setShowForm(false)}
        />
      )}
      
      <ProductList products={products} />
    </div>
  );
}
```

---

## 📚 Resumen

Estos ejemplos muestran cómo:

✅ **Manejar errores de forma consistente**
- Usar hooks personalizados
- Clases de error específicas
- Logging centralizado

✅ **Validar y sanitizar datos**
- Validación en tiempo real
- Feedback al usuario
- Prevención de XSS

✅ **Integrar con backend seguro**
- Autenticación con JWT
- Refresh tokens automáticos
- Manejo de errores de red

✅ **Crear componentes robustos**
- Estados de carga
- Manejo de errores
- Validación de formularios

✅ **Implementar flujos completos**
- Registro y login
- CRUD de productos
- Rutas protegidas

**¡Todos estos patrones están listos para usar en tu proyecto!** 🚀
