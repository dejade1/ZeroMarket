/**
 * ARCHIVO NUEVO: backend/server.ts
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
 * ✅ Automatic report scheduler
 */

import dotenv from 'dotenv';
dotenv.config();

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
import productRoutes from './routes/productRoutes';
import settingsRoutes from './routes/settingsRoutes';
import { startReportScheduler, stopReportScheduler } from './services/reportScheduler';

// ==================== CONFIGURACIÓN ====================

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

// ✅ CORREGIDO: Secretos JWT son OBLIGATORIOS (Seguridad crítica)
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('❌ FATAL: JWT_SECRET must be set in environment and be at least 32 characters');
}

if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.length < 32) {
    throw new Error('❌ FATAL: JWT_REFRESH_SECRET must be set in environment and be at least 32 characters');
}

// After validation, we can safely assert these are strings (using 'as string' to satisfy TypeScript)
const JWT_SECRET = process.env.JWT_SECRET as string;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET as string;

console.log('✅ JWT secrets validated successfully');
console.log('📧 SMTP configured:', process.env.SMTP_HOST);

const SALT_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 días

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
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // 100 requests por IP
    message: 'Demasiadas peticiones, intenta más tarde',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(generalLimiter);

// Rate limiting para autenticación (más estricto)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5, // Solo 5 intentos de login
    message: 'Demasiados intentos de login, intenta más tarde',
    skipSuccessfulRequests: true,
});

// ==================== TIPOS ====================

interface User {
    id: number;
    username: string;
    email: string;
    passwordHash: string;
    role: string;
    loyaltyPoints: number;
    createdAt: Date;
    lastLogin?: Date | null;
}

interface JWTPayload {
    userId: number;
    username: string;
    role: string;
}

interface AuthRequest extends Request {
    user?: JWTPayload;
}

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

// ==================== MIDDLEWARES DE AUTENTICACIÓN ====================

/**
 * Middleware para verificar autenticación
 */
function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
    // Intentar obtener token de cookie
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
 * Middleware para verificar que el usuario es admin
 */
function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
    if (req.user?.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de administrador' });
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
        // Validar inputs
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { username, email, password, role } = req.body;

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

        // Hash de contraseña
        const passwordHash = await hashPassword(password);

        // Validar role
        const validRoles = ['ADMIN', 'USER', 'CLIENT'];
        const userRole = validRoles.includes(role) ? role : 'CLIENT';

        // Crear usuario
        const user = await prisma.user.create({
            data: {
                username,
                email,
                passwordHash,
                role: userRole,
                loyaltyPoints: 0,
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

        // Log de seguridad
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
        // Validar inputs
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { username, password } = req.body;

        // Buscar usuario
        const user = await prisma.user.findUnique({
            where: { username },
        });

        if (!user) {
            // No revelar si el usuario existe o no
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        // Verificar contraseña
        const isValidPassword = await verifyPassword(password, user.passwordHash);

        if (!isValidPassword) {
            // Log de intento fallido
            console.log(`[SECURITY] Failed login attempt for user: ${username}`);
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        // Actualizar último login
        await prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() },
        });

        // Generar tokens
        const payload: JWTPayload = {
            userId: user.id,
            username: user.username,
            role: user.role,
        };

        const accessToken = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        // Guardar refresh token en base de datos
        await prisma.refreshToken.create({
            data: {
                token: refreshToken,
                userId: user.id,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
        });

        // Establecer cookies httpOnly
        res.cookie('accessToken', accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production', // Solo HTTPS en producción
            sameSite: 'strict',
            maxAge: 15 * 60 * 1000, // 15 minutos
        });

        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: COOKIE_MAX_AGE,
        });

        // Log de seguridad
        console.log(`[SECURITY] Successful login: ${username} (ID: ${user.id})`);

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

        // Verificar que el refresh token existe en la base de datos
        const storedToken = await prisma.refreshToken.findUnique({
            where: { token: refreshToken },
            include: { user: true },
        });

        if (!storedToken || storedToken.expiresAt < new Date()) {
            return res.status(403).json({ error: 'Refresh token inválido o expirado' });
        }

        // Verificar firma del token
        const payload = verifyRefreshToken(refreshToken);

        if (!payload) {
            return res.status(403).json({ error: 'Refresh token inválido' });
        }

        // Generar nuevo access token
        const newAccessToken = generateAccessToken({
            userId: storedToken.user.id,
            username: storedToken.user.username,
            role: storedToken.user.role,
        });

        // Establecer nueva cookie
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

        // Eliminar refresh token de la base de datos
        if (refreshToken) {
            await prisma.refreshToken.deleteMany({
                where: { token: refreshToken },
            });
        }

        // Limpiar cookies
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

// ==================== RUTAS DE PUNTOS DE LEALTAD ====================

/**
 * POST /api/users/:userId/points
 * Actualiza los puntos de lealtad de un usuario
 * Solo para usuarios autenticados (el propio usuario o un admin)
 */
app.post('/api/users/:userId/points', authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const targetUserId = parseInt(req.params.userId, 10);
        const { points, orderId } = req.body;

        // Validar que sea un número positivo
        if (!points || points < 0 || isNaN(points)) {
            return res.status(400).json({ error: 'Los puntos deben ser un número positivo' });
        }

        // Verificar que el usuario puede actualizar estos puntos
        // Permitir si es el mismo usuario o si es admin
        if (req.user!.userId !== targetUserId && req.user!.role !== 'ADMIN') {
            return res.status(403).json({ error: 'No tienes permiso para actualizar los puntos de este usuario' });
        }

        // Obtener usuario actual
        const user = await prisma.user.findUnique({
            where: { id: targetUserId },
        });

        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // Calcular nuevos puntos
        const currentPoints = user.loyaltyPoints || 0;
        const newPoints = currentPoints + points;

        // Actualizar puntos
        const updatedUser = await prisma.user.update({
            where: { id: targetUserId },
            data: { loyaltyPoints: newPoints },
            select: {
                id: true,
                username: true,
                loyaltyPoints: true,
            },
        });

        // Log de seguridad
        console.log(`[LOYALTY] User ${user.username} earned ${points} points (Order: ${orderId || 'N/A'}). Total: ${newPoints}`);

        res.json({
            success: true,
            message: 'Puntos actualizados exitosamente',
            user: updatedUser,
        });

    } catch (error) {
        console.error('[ERROR] Update points failed:', error);
        res.status(500).json({ error: 'Error al actualizar puntos' });
    }
});

// ==================== RUTAS PROTEGIDAS (EJEMPLO) ====================

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

/**
 * DELETE /api/admin/users/:id
 * Elimina un usuario (solo admin)
 */
app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const userId = parseInt(req.params.id, 10);

        if (isNaN(userId)) {
            return res.status(400).json({ error: 'ID de usuario inválido' });
        }

        // No permitir que el admin se elimine a sí mismo
        if (req.user!.userId === userId) {
            return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
        }

        // Verificar que el usuario existe
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // Eliminar usuario (Prisma eliminará automáticamente registros relacionados por cascade)
        await prisma.user.delete({
            where: { id: userId }
        });

        console.log(`[ADMIN] Usuario eliminado: ${user.username} (ID: ${userId}) por ${req.user!.username}`);

        res.json({ 
            success: true,
            message: `Usuario "${user.username}" eliminado exitosamente` 
        });

    } catch (error) {
        console.error('[ERROR] Delete user failed:', error);
        res.status(500).json({ error: 'Error al eliminar usuario' });
    }
});


// ==================== PUBLIC ROUTES ====================

/**
 * Rutas públicas de productos (sin autenticación)
 * Permite a la tienda obtener productos
 */
// ==================== PUBLIC ROUTES ====================

/**
 * Rutas públicas de productos (sin autenticación)
 * CORREGIDO: Montar en /api/admin para que /api/admin/products funcione
 */
app.use('/api/admin', productRoutes);
console.log('📦 Product routes registered at /api/admin/products');

// ==================== EMAIL & REPORTS ROUTES ====================

/**
 * Rutas de email y reportes (solo admin)
 */
app.use('/api/admin/email', authenticateToken, requireAdmin, emailRoutes);
console.log('📧 Email routes registered at /api/admin/email');

/**
 * Rutas de settings/configuración (solo admin)
 */
app.use('/api/admin/settings', authenticateToken, requireAdmin, settingsRoutes);
console.log('⚙️  Settings routes registered at /api/admin/settings');

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
    });
});

// ==================== INICIO DEL SERVIDOR ====================

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📏 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔒 Security features enabled`);
    console.log(`🎆 Loyalty points system enabled`);
    
    // Iniciar el scheduler de reportes automáticos
    startReportScheduler();
});

// Manejo de cierre graceful
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, closing server...');
    stopReportScheduler();
    await prisma.$disconnect();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, closing server...');
    stopReportScheduler();
    await prisma.$disconnect();
    process.exit(0);
});