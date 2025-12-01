# Guía de Implementación de Mejoras de Seguridad

## 📋 Índice
1. [Resumen de Cambios](#resumen-de-cambios)
2. [Archivos Corregidos](#archivos-corregidos)
3. [Plan de Migración](#plan-de-migración)
4. [Configuración del Backend](#configuración-del-backend)
5. [Configuración del Frontend](#configuración-del-frontend)
6. [Testing](#testing)
7. [Deployment](#deployment)
8. [Checklist de Seguridad](#checklist-de-seguridad)

---

## 1. Resumen de Cambios

### 🔴 Problemas Críticos Resueltos

#### Antes (❌ Inseguro)
```typescript
// Contraseñas en texto plano
const users = [
  { username: 'admin', password: '123456' }
];
localStorage.setItem('users', JSON.stringify(users));

// Comparación directa
if (user.password === inputPassword) {
  // Login
}
```

#### Después (✅ Seguro)
```typescript
// Contraseñas hasheadas con bcrypt
const passwordHash = await bcrypt.hash(password, 12);
const user = await prisma.user.create({
  data: { username, email, passwordHash }
});

// Comparación con hash
const isValid = await bcrypt.compare(inputPassword, user.passwordHash);
```

### 🔐 Mejoras de Seguridad Implementadas

| Característica | Antes | Después |
|----------------|-------|---------|
| **Almacenamiento de contraseñas** | Texto plano | Bcrypt (12 rounds) |
| **Autenticación** | localStorage | JWT + httpOnly cookies |
| **Validación** | Básica | Robusta con express-validator |
| **Rate Limiting** | ❌ No | ✅ Sí (5 intentos/15min) |
| **CORS** | ❌ No configurado | ✅ Configurado correctamente |
| **Headers de seguridad** | ❌ No | ✅ Helmet |
| **Sanitización** | ❌ No | ✅ Sí (XSS protection) |
| **Logging** | ❌ No | ✅ Centralizado |
| **Manejo de errores** | Inconsistente | Centralizado con clases |
| **CSRF Protection** | ❌ No | ✅ SameSite cookies |

---

## 2. Archivos Corregidos

### 📁 Estructura de Archivos Nuevos

```
proyecto/
├── ANALISIS_SEGURIDAD_Y_ERRORES.md          # Análisis completo
├── GUIA_IMPLEMENTACION.md                    # Este archivo
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   └── AdminLogin.tsx                # ✅ Corregido
│   │   ├── utils/
│   │   │   ├── errorHandler.ts               # ✅ Nuevo
│   │   │   └── validation.ts                 # ✅ Nuevo
│   │   └── services/
│   │       └── authService.ts                # ✅ Nuevo
│   └── package.json
│
└── backend/
    ├── src/
    │   ├── server.ts                         # ✅ Nuevo
    │   ├── middleware/
    │   │   ├── auth.ts
    │   │   └── validation.ts
    │   └── routes/
    │       ├── auth.ts
    │       └── users.ts
    ├── prisma/
    │   └── schema.prisma                     # ✅ Nuevo
    ├── .env.example
    └── package.json
```

### 📝 Archivos Proporcionados

1. **CODIGO_CORREGIDO_AdminLogin.tsx**
   - Componente de login con seguridad mejorada
   - Hash de contraseñas (SHA-256 para demo, bcrypt en backend)
   - Validación robusta
   - Rate limiting del lado del cliente
   - Mensajes de error genéricos

2. **CODIGO_CORREGIDO_errorHandler.ts**
   - Sistema centralizado de manejo de errores
   - Clases de error personalizadas
   - Logger con niveles
   - Hooks de React para manejo de errores

3. **CODIGO_CORREGIDO_validation.ts**
   - Validación y sanitización de inputs
   - Protección contra XSS
   - Schemas reutilizables
   - Validación de tipos en runtime

4. **CODIGO_CORREGIDO_backend_server.ts**
   - Servidor Express con seguridad completa
   - JWT con httpOnly cookies
   - Bcrypt para contraseñas
   - Rate limiting
   - Helmet, CORS, validación

---

## 3. Plan de Migración

### Fase 1: Preparación (Día 1)

#### 1.1 Backup
```bash
# Hacer backup completo del proyecto
git add .
git commit -m "Backup before security migration"
git tag -a v1.0-pre-security -m "Version before security improvements"
```

#### 1.2 Crear rama de desarrollo
```bash
git checkout -b feature/security-improvements
```

#### 1.3 Instalar dependencias del backend
```bash
cd backend
npm init -y

# Dependencias de producción
npm install express bcrypt jsonwebtoken helmet cors express-rate-limit cookie-parser express-validator @prisma/client

# Dependencias de desarrollo
npm install -D typescript @types/express @types/bcrypt @types/jsonwebtoken @types/cors @types/cookie-parser prisma ts-node nodemon

# Inicializar TypeScript
npx tsc --init
```

#### 1.4 Instalar dependencias del frontend
```bash
cd ../frontend

# Si no existen
npm install zod # Para validación en runtime
```

### Fase 2: Configuración del Backend (Días 2-3)

#### 2.1 Configurar Prisma

**prisma/schema.prisma**
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"  // o "sqlite" para desarrollo
  url      = env("DATABASE_URL")
}

model User {
  id           Int       @id @default(autoincrement())
  username     String    @unique
  email        String    @unique
  passwordHash String
  isAdmin      Boolean   @default(false)
  createdAt    DateTime  @default(now())
  lastLogin    DateTime?
  
  refreshTokens RefreshToken[]
  
  @@index([username])
  @@index([email])
}

model RefreshToken {
  id        Int      @id @default(autoincrement())
  token     String   @unique
  userId    Int
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  createdAt DateTime @default(now())
  
  @@index([userId])
  @@index([token])
}

model Product {
  id          Int      @id @default(autoincrement())
  title       String
  description String?
  price       Float
  stock       Int
  unit        String
  image       String?
  rating      Float    @default(0)
  category    String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  batches Batch[]
  
  @@index([category])
}

model Batch {
  id             Int      @id @default(autoincrement())
  productId      Int
  product        Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  quantity       Int
  expirationDate DateTime
  createdAt      DateTime @default(now())
  
  @@index([productId])
  @@index([expirationDate])
}
```

#### 2.2 Configurar variables de entorno

**.env**
```env
# Base de datos
DATABASE_URL="postgresql://user:password@localhost:5432/ecommerce"
# Para desarrollo con SQLite:
# DATABASE_URL="file:./dev.db"

# JWT
JWT_SECRET="tu-secreto-super-seguro-minimo-32-caracteres-cambiar-en-produccion"
JWT_REFRESH_SECRET="tu-refresh-secret-super-seguro-minimo-32-caracteres"

# Servidor
PORT=3000
NODE_ENV=development

# Frontend
FRONTEND_URL="http://localhost:5173"

# Bcrypt
SALT_ROUNDS=12
```

**.env.example** (para compartir en git)
```env
DATABASE_URL="postgresql://user:password@localhost:5432/ecommerce"
JWT_SECRET="change-me-in-production"
JWT_REFRESH_SECRET="change-me-in-production"
PORT=3000
NODE_ENV=development
FRONTEND_URL="http://localhost:5173"
SALT_ROUNDS=12
```

#### 2.3 Migrar base de datos
```bash
# Generar migración
npx prisma migrate dev --name init

# Generar cliente Prisma
npx prisma generate
```

#### 2.4 Copiar código del servidor
```bash
# Copiar CODIGO_CORREGIDO_backend_server.ts a backend/src/server.ts
cp ../CODIGO_CORREGIDO_backend_server.ts src/server.ts
```

#### 2.5 Configurar scripts en package.json

**backend/package.json**
```json
{
  "scripts": {
    "dev": "nodemon src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:studio": "prisma studio"
  }
}
```

### Fase 3: Migración del Frontend (Días 4-5)

#### 3.1 Crear estructura de utilidades
```bash
cd frontend/src
mkdir -p utils services
```

#### 3.2 Copiar archivos corregidos
```bash
# Copiar utilidades
cp ../../CODIGO_CORREGIDO_errorHandler.ts utils/errorHandler.ts
cp ../../CODIGO_CORREGIDO_validation.ts utils/validation.ts

# Copiar componente corregido
cp ../../CODIGO_CORREGIDO_AdminLogin.tsx components/AdminLogin.tsx
```

#### 3.3 Crear servicio de autenticación

**frontend/src/services/authService.ts**
```typescript
import { ValidationError } from '../utils/errorHandler';
import { sanitizeString, sanitizeEmail, isValidEmail, isStrongPassword } from '../utils/validation';

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
  /**
   * Login
   */
  async login(credentials: LoginCredentials): Promise<User> {
    const response = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include', // Importante para cookies
      body: JSON.stringify({
        username: sanitizeString(credentials.username),
        password: credentials.password, // No sanitizar contraseña
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new ValidationError(error.error || 'Error al iniciar sesión');
    }

    const data = await response.json();
    return data.user;
  }

  /**
   * Register
   */
  async register(data: RegisterData): Promise<User> {
    // Validaciones del lado del cliente
    if (!isValidEmail(data.email)) {
      throw new ValidationError('Email inválido');
    }

    if (!isStrongPassword(data.password)) {
      throw new ValidationError('Contraseña débil');
    }

    const response = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: sanitizeString(data.username),
        email: sanitizeEmail(data.email),
        password: data.password,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new ValidationError(error.error || 'Error al registrar');
    }

    const result = await response.json();
    return result.user;
  }

  /**
   * Logout
   */
  async logout(): Promise<void> {
    await fetch(`${API_URL}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  }

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<User | null> {
    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        credentials: 'include',
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.user;
    } catch {
      return null;
    }
  }

  /**
   * Refresh token
   */
  async refreshToken(): Promise<void> {
    await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
  }
}

export const authService = new AuthService();
```

#### 3.4 Actualizar variables de entorno

**frontend/.env**
```env
VITE_API_URL=http://localhost:3000
```

#### 3.5 Actualizar componente AdminLogin

Reemplazar el componente actual con el código de `CODIGO_CORREGIDO_AdminLogin.tsx`, pero modificar para usar el servicio:

```typescript
// En lugar de validación local, usar authService
const handleLogin = async (e: React.FormEvent) => {
  e.preventDefault();
  setError('');
  setIsLoading(true);

  try {
    const user = await authService.login({ username, password });
    setSuccess('¡Login exitoso!');
    // Redirigir o actualizar estado global
  } catch (err) {
    if (err instanceof ValidationError) {
      setError(err.message);
    } else {
      setError('Error al iniciar sesión');
    }
  } finally {
    setIsLoading(false);
  }
};
```

### Fase 4: Testing (Día 6)

#### 4.1 Tests del backend

**backend/src/__tests__/auth.test.ts**
```typescript
import request from 'supertest';
import app from '../server';

describe('Authentication', () => {
  describe('POST /api/auth/register', () => {
    it('should register a new user', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: 'Test123!@#',
        });

      expect(response.status).toBe(201);
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user.username).toBe('testuser');
    });

    it('should reject weak password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: '123',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      // Primero registrar
      await request(app)
        .post('/api/auth/register')
        .send({
          username: 'logintest',
          email: 'login@example.com',
          password: 'Test123!@#',
        });

      // Luego login
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'logintest',
          password: 'Test123!@#',
        });

      expect(response.status).toBe(200);
      expect(response.headers['set-cookie']).toBeDefined();
    });

    it('should reject invalid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'nonexistent',
          password: 'wrong',
        });

      expect(response.status).toBe(401);
    });
  });
});
```

#### 4.2 Ejecutar tests
```bash
cd backend
npm test
```

### Fase 5: Deployment (Día 7)

#### 5.1 Preparar para producción

**Checklist:**
- [ ] Cambiar JWT_SECRET a valores seguros (mínimo 32 caracteres aleatorios)
- [ ] Configurar base de datos de producción
- [ ] Habilitar HTTPS
- [ ] Configurar CORS con dominio real
- [ ] Configurar variables de entorno en servidor
- [ ] Habilitar logging a servicio externo (Sentry, LogRocket)
- [ ] Configurar backups de base de datos
- [ ] Configurar CI/CD

#### 5.2 Build
```bash
# Backend
cd backend
npm run build

# Frontend
cd ../frontend
npm run build
```

#### 5.3 Deploy

**Opciones recomendadas:**
- **Backend**: Railway, Render, Fly.io, AWS, DigitalOcean
- **Frontend**: Vercel, Netlify, Cloudflare Pages
- **Base de datos**: Supabase, PlanetScale, Railway

---

## 4. Checklist de Seguridad Pre-Producción

### Backend
- [ ] JWT_SECRET es aleatorio y seguro (mínimo 32 caracteres)
- [ ] JWT_REFRESH_SECRET es diferente del JWT_SECRET
- [ ] HTTPS habilitado
- [ ] Rate limiting configurado
- [ ] Helmet configurado
- [ ] CORS configurado solo para dominios permitidos
- [ ] Validación de inputs en todas las rutas
- [ ] Logging de eventos de seguridad
- [ ] Manejo de errores sin exponer información sensible
- [ ] Base de datos con credenciales seguras
- [ ] Backups automáticos configurados

### Frontend
- [ ] Variables de entorno no exponen secretos
- [ ] Todas las peticiones usan HTTPS
- [ ] Inputs sanitizados antes de mostrar
- [ ] No hay console.log con información sensible
- [ ] Tokens no se almacenan en localStorage
- [ ] Validación del lado del cliente
- [ ] Manejo de errores user-friendly

### General
- [ ] Dependencias actualizadas
- [ ] Vulnerabilidades de npm audit resueltas
- [ ] Tests pasando
- [ ] Documentación actualizada
- [ ] .env.example actualizado
- [ ] .gitignore incluye archivos sensibles

---

## 5. Monitoreo Post-Deployment

### Métricas a monitorear:
1. **Intentos de login fallidos** - Detectar ataques de fuerza bruta
2. **Errores 401/403** - Intentos de acceso no autorizado
3. **Tiempo de respuesta** - Detectar degradación de rendimiento
4. **Uso de CPU/Memoria** - Detectar posibles ataques DoS
5. **Errores 500** - Bugs en producción

### Herramientas recomendadas:
- **Sentry** - Error tracking
- **LogRocket** - Session replay
- **DataDog** - APM y logging
- **Uptime Robot** - Monitoreo de uptime

---

## 6. Recursos Adicionales

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [Prisma Security](https://www.prisma.io/docs/guides/database/advanced-database-tasks/sql-injection)

---

**Última actualización**: 30 de Noviembre de 2025  
**Versión**: 1.0  
**Autor**: Antigravity AI
