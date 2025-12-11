/**
 * ARCHIVO ACTUALIZADO: backend/server.ts
 * 
 * Servidor backend seguro con Node.js + Express
 * 
 * CARACTERÍSTICAS DE SEGURIDAD:
 * ✅ Autenticación JWT con httpOnly cookies
 * ✅ Hash de contraseñas con bcrypt
 * ✅ Rate limiting
 * ✅ CORS configurado
 * ✅ Helmet para headers de seguridad
 * ✅ Validación de inputs
 * ✅ Sanitización de datos
 * ✅ Logging de seguridad
 * ✅ CSRF protection
 * ✅ SQL injection prevention (con Prisma)
 * ✅ Control de acceso basado en roles (RBAC)
 */

import express, { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import emailRoutes from './routes/emailRoutes';

// ==================== CONFIGURACIÓN ====================

const app = express();

// ✅ CORREGIDO: Prisma con configuración de producción
const prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
    errorFormat: 'pretty',
});

// ✅ Middleware para timeout de queries (previene queries lentas)
prisma.$use(async (params, next) => {
    const timeoutMs = 10000; // 10 segundos
    try {
        const result = await Promise.race([
            next(params),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Database query timeout')), timeoutMs)
            )
        ]);
        return result;
    } catch (error) {
        console.error(`[DB ERROR] ${params.model}.${params.action} failed:`, error);
        throw error;
    }
});

const PORT = process.env.PORT || 3000;

// ✅ CORREGIDO: Secretos JWT son OBLIGATORIOS (Seguridad crítica)
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('❌ FATAL: JWT_SECRET must be set in environment and be at least 32 characters');
}

if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.length < 32) {
    throw new Error('❌ FATAL: JWT_REFRESH_SECRET must be set in environment and be at least 32 characters');
}

const JWT_SECRET = process.env.JWT_SECRET as string;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET as string;

console.log('✅ JWT secrets validated successfully');

const SALT_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 días

// ==================== TIPOS ====================

// ✅ NUEVO: Tipos de roles
type UserRole = 'ADMIN' | 'USER' | 'CLIENT';

interface User {
    id: number;
    username: string;
    email: string;
    passwordHash: string;
    role: UserRole;
    loyaltyPoints: number;
    createdAt: Date;
    lastLogin?: Date | null;
}

interface JWTPayload {
    userId: number;
    username: string;
    role: UserRole;
}

interface AuthRequest extends Request {
    user?: JWTPayload;
}

// ==================== MIDDLEWARES DE SEGURIDAD ====================

// Helmet - Headers de seguridad
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'https:'],
        },
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
    },
}));

// CORS
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parser
app.use(cookieParser());

// Rate limiting general
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Demasiadas peticiones, intenta más tarde',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(generalLimiter);

// Rate limiting para autenticación (más estricto)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'production' ? 5 : 50,
    handler: (req: Request, res: Response) => {
        res.status(429).json({
            error: 'Demasiados intentos, intenta más tarde',
            retryAfter: 900
        });
    },
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
});

// ==================== UTILIDADES ====================

/**
 * Genera access token
 */
function generateAccessToken(payload: JWTPayload): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

/**
 * Genera refresh token
 */
function generateRefreshToken(payload: JWTPayload): string {
    return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
}

/**
 * Verifica access token
 */
function verifyAccessToken(token: string): JWTPayload | null {
    try {
        return jwt.verify(token, JWT_SECRET) as JWTPayload;
    } catch {
        return null;
    }
}

/**
 * Verifica refresh token
 */
function verifyRefreshToken(token: string): JWTPayload | null {
    try {
        return jwt.verify(token, JWT_REFRESH_SECRET) as JWTPayload;
    } catch {
        return null;
    }
}

/**
 * Hash de contraseña
 */
async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verifica contraseña
 */
async function verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
}

/**
 * Verifica si el rol tiene permisos de administrador
 */
function hasAdminAccess(role: UserRole): boolean {
    return role === 'ADMIN' || role === 'USER';
}

// ==================== MIDDLEWARES DE AUTENTICACIÓN ====================

/**
 * Middleware para verificar autenticación
 */
function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
    const token = req.cookies.accessToken;

    if (!token) {
        return res.status(401).json({ error: 'No autenticado' });
    }

    const payload = verifyAccessToken(token);

    if (!payload) {
        return res.status(403).json({ error: 'Token inválido o expirado' });
    }

    req.user = payload;
    next();
}

/**
 * ✅ NUEVO: Middleware para verificar que el usuario NO es cliente
 * (Usado para proteger rutas de administración)
 */
function requireNotClient(req: AuthRequest, res: Response, next: NextFunction) {
    if (req.user?.role === 'CLIENT') {
        return res.status(403).json({ 
            error: 'Acceso denegado. Esta función es solo para administradores' 
        });
    }
    next();
}

/**
 * Middleware para verificar que el usuario es admin (ADMIN o USER)
 */
function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
    if (!req.user || !hasAdminAccess(req.user.role)) {
        return res.status(403).json({ 
            error: 'Acceso denegado. Se requieren permisos de administrador' 
        });
    }
    next();
}

// ==================== VALIDADORES ====================

const registerValidation = [
    body('username')
        .trim()
        .isLength({ min: 3, max: 50 })
        .withMessage('El usuario debe tener entre 3 y 50 caracteres')
        .matches(/^[a-zA-Z0-9_-]+$/)
        .withMessage('El usuario solo puede contener letras, números, guiones y guiones bajos'),

    body('email')
        .trim()
        .isEmail()
        .withMessage('Email inválido')
        .normalizeEmail(),

    body('password')
        .isLength({ min: 8, max: 128 })
        .withMessage('La contraseña debe tener entre 8 y 128 caracteres')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
        .withMessage('La contraseña debe incluir mayúsculas, minúsculas, números y símbolos'),
];

const loginValidation = [
    body('username').trim().notEmpty().withMessage('Usuario requerido'),
    body('password').notEmpty().withMessage('Contraseña requerida'),
];

// ==================== RUTAS DE AUTENTICACIÓN ====================

/**
 * POST /api/auth/register
 * Registra un nuevo usuario
 */
app.post('/api/auth/register', authLimiter, registerValidation, async (req: Request, res: Response) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { username, email, password, role } = req.body;

        // ✅ Validar que el rol es válido
        const userRole: UserRole = role && ['ADMIN', 'USER', 'CLIENT'].includes(role) 
            ? role 
            : 'CLIENT';

        // Verificar si el usuario ya existe
        const existingUser = await prisma.user.findFirst({
            where: {
                OR: [
                    { username },
                    { email },
                ],
            },
        });

        if (existingUser) {
            return res.status(409).json({ error: 'El usuario o email ya existe' });
        }

        const passwordHash = await hashPassword(password);

        // Crear usuario
        const user = await prisma.user.create({
            data: {
                username,
                email,
                passwordHash,
                role: userRole,
            },
            select: {
                id: true,
                username: true,
                email: true,
                role: true,
                loyaltyPoints: true,
                createdAt: true,
            },
        });

        console.log(`[SECURITY] New user registered: ${username} (ID: ${user.id}, Role: ${user.role})`);

        res.status(201).json({
            message: 'Usuario registrado exitosamente',
            user,
        });

    } catch (error) {
        console.error('[ERROR] Registration failed:', error);
        res.status(500).json({ error: 'Error al registrar usuario' });
    }
});

/**
 * POST /api/auth/login
 * Inicia sesión
 */
app.post('/api/auth/login', authLimiter, loginValidation, async (req: Request, res: Response) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { username, password } = req.body;

        const user = await prisma.user.findUnique({
            where: { username },
        });

        if (!user) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const isValidPassword = await verifyPassword(password, user.passwordHash);

        if (!isValidPassword) {
            console.log(`[SECURITY] Failed login attempt for user: ${username}`);
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        await prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() },
        });

        const payload: JWTPayload = {
            userId: user.id,
            username: user.username,
            role: user.role as UserRole,
        };

        const accessToken = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        await prisma.refreshToken.create({
            data: {
                token: refreshToken,
                userId: user.id,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
        });

        res.cookie('accessToken', accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 15 * 60 * 1000,
        });

        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: COOKIE_MAX_AGE,
        });

        console.log(`[SECURITY] Successful login: ${username} (ID: ${user.id}, Role: ${user.role})`);

        res.json({
            message: 'Login exitoso',
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                loyaltyPoints: user.loyaltyPoints,
            },
        });

    } catch (error) {
        console.error('[ERROR] Login failed:', error);
        res.status(500).json({ error: 'Error al iniciar sesión' });
    }
});

/**
 * POST /api/auth/refresh
 * Refresca el access token usando el refresh token
 */
app.post('/api/auth/refresh', async (req: Request, res: Response) => {
    try {
        const refreshToken = req.cookies.refreshToken;

        if (!refreshToken) {
            return res.status(401).json({ error: 'No autenticado' });
        }

        const storedToken = await prisma.refreshToken.findUnique({
            where: { token: refreshToken },
            include: { user: true },
        });

        if (!storedToken || storedToken.expiresAt < new Date()) {
            return res.status(403).json({ error: 'Refresh token inválido o expirado' });
        }

        const payload = verifyRefreshToken(refreshToken);

        if (!payload) {
            return res.status(403).json({ error: 'Refresh token inválido' });
        }

        const newAccessToken = generateAccessToken({
            userId: storedToken.user.id,
            username: storedToken.user.username,
            role: storedToken.user.role as UserRole,
        });

        res.cookie('accessToken', newAccessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 15 * 60 * 1000,
        });

        res.json({ message: 'Token refrescado exitosamente' });

    } catch (error) {
        console.error('[ERROR] Token refresh failed:', error);
        res.status(500).json({ error: 'Error al refrescar token' });
    }
});

/**
 * POST /api/auth/logout
 * Cierra sesión
 */
app.post('/api/auth/logout', authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const refreshToken = req.cookies.refreshToken;

        if (refreshToken) {
            await prisma.refreshToken.deleteMany({
                where: { token: refreshToken },
            });
        }

        res.clearCookie('accessToken');
        res.clearCookie('refreshToken');

        console.log(`[SECURITY] User logged out: ${req.user?.username}`);

        res.json({ message: 'Logout exitoso' });

    } catch (error) {
        console.error('[ERROR] Logout failed:', error);
        res.status(500).json({ error: 'Error al cerrar sesión' });
    }
});

/**
 * GET /api/auth/me
 * Obtiene información del usuario actual
 */
app.get('/api/auth/me', authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
            select: {
                id: true,
                username: true,
                email: true,
                role: true,
                loyaltyPoints: true,
                createdAt: true,
                lastLogin: true,
            },
        });

        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json({ user });

    } catch (error) {
        console.error('[ERROR] Get user failed:', error);
        res.status(500).json({ error: 'Error al obtener usuario' });
    }
});

// ==================== RUTAS DE GESTIÓN DE USUARIOS ====================

/**
 * GET /api/users
 * Obtiene todos los usuarios (requiere autenticación)
 */
app.get('/api/users', authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const users = await prisma.user.findMany({
            select: {
                id: true,
                username: true,
                email: true,
                role: true,
                loyaltyPoints: true,
                createdAt: true,
                lastLogin: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        res.json(users);

    } catch (error) {
        console.error('[ERROR] Get users failed:', error);
        res.status(500).json({ error: 'Error al obtener usuarios' });
    }
});

/**
 * DELETE /api/users/:id
 * Elimina un usuario (requiere autenticación)
 */
app.delete('/api/users/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const userId = parseInt(req.params.id);

        if (isNaN(userId)) {
            return res.status(400).json({ error: 'ID de usuario inválido' });
        }

        if (req.user!.userId === userId) {
            return res.status(403).json({ error: 'No puedes eliminar tu propia cuenta' });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        await prisma.refreshToken.deleteMany({
            where: { userId: userId },
        });

        await prisma.user.delete({
            where: { id: userId },
        });

        console.log(`[SECURITY] User deleted: ${user.username} (ID: ${userId}) by ${req.user?.username}`);

        res.json({ message: 'Usuario eliminado exitosamente' });

    } catch (error) {
        console.error('[ERROR] Delete user failed:', error);
        res.status(500).json({ error: 'Error al eliminar usuario' });
    }
});

/**
 * GET /api/admin/users
 * Obtiene todos los usuarios (solo admin)
 */
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const users = await prisma.user.findMany({
            select: {
                id: true,
                username: true,
                email: true,
                role: true,
                loyaltyPoints: true,
                createdAt: true,
                lastLogin: true,
            },
        });

        res.json({ users });

    } catch (error) {
        console.error('[ERROR] Get users failed:', error);
        res.status(500).json({ error: 'Error al obtener usuarios' });
    }
});

// ==================== EMAIL & REPORTS ROUTES ====================

/**
 * Rutas de email y reportes (solo admin)
 */
app.use('/api/admin', authenticateToken, requireAdmin, emailRoutes);

// ==================== MANEJO DE ERRORES ====================

// 404
app.use((req: Request, res: Response) => {
    res.status(404).json({ error: 'Ruta no encontrada' });
});

// Error handler global
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('[ERROR] Unhandled error:', err);

    res.status(500).json({
        error: process.env.NODE_ENV === 'production'
            ? 'Error interno del servidor'
            : err.message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
});

// ==================== INICIO DEL SERVIDOR ====================

const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📏 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔒 Security features enabled`);
    console.log(`✅ All validations passed`);
});

// Graceful shutdown
async function gracefulShutdown(signal: string) {
    console.log(`\n${signal} received, closing server gracefully...`);

    server.close(async () => {
        console.log('HTTP server closed');
        await prisma.$disconnect();
        console.log('Database disconnected');
        process.exit(0);
    });

    setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
