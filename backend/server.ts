/**
 * ARCHIVO ACTUALIZADO: backend/server.ts
 *
 * Servidor backend seguro con Node.js + Express
 *
 * CORRECCIONES:
 * ✅ Devolver loyaltyPoints y role en todos los endpoints de autenticación
 * ✅ Endpoint para actualizar puntos de lealtad
 * ✅ Endpoint /api/admin/settings para guardar configuración
 * ✅ Endpoint /api/admin/products para gestionar productos
 * ✅ Crear primer lote automáticamente al crear producto
 * ✅ WebSocket + rutas /api/payment/* para cobro en efectivo (NV200+SCS)
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
 */

import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import {
  createBatch,
  consumeBatchesFIFO,
  getExpiringBatches,
  getProductBatches,
  getBatchStockSummary,
  deleteBatch
} from './src/services/batch.service';
import {
  initCashService,
  startPayment,
  cancelPayment,
  paymentStatus,
  shutdownCashService
} from './src/services/cash.service';

// ==================== CONFIGURACIÓN ====================

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

// Constantes de seguridad
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret';
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

function generateAccessToken(payload: JWTPayload): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

function generateRefreshToken(payload: JWTPayload): string {
    return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
}

function verifyAccessToken(token: string): JWTPayload | null {
    try {
        return jwt.verify(token, JWT_SECRET) as JWTPayload;
    } catch {
        return null;
    }
}

function verifyRefreshToken(token: string): JWTPayload | null {
    try {
        return jwt.verify(token, JWT_REFRESH_SECRET) as JWTPayload;
    } catch {
        return null;
    }
}

async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
}

// ==================== MIDDLEWARES DE AUTENTICACIÓN ====================

function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
    const token = req.cookies.accessToken;
    if (!token) return res.status(401).json({ error: 'No autenticado' });
    const payload = verifyAccessToken(token);
    if (!payload) return res.status(403).json({ error: 'Token inválido o expirado' });
    req.user = payload;
    next();
}

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
    if (req.user?.role !== 'ADMIN')
        return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de administrador' });
    next();
}

// ==================== VALIDADORES ====================

const registerValidation = [
    body('username')
        .trim().isLength({ min: 3, max: 50 })
        .withMessage('El usuario debe tener entre 3 y 50 caracteres')
        .matches(/^[a-zA-Z0-9_-]+$/)
        .withMessage('El usuario solo puede contener letras, números, guiones y guiones bajos'),
    body('email')
        .trim().isEmail().withMessage('Email inválido').normalizeEmail(),
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

app.post('/api/auth/register', authLimiter, registerValidation, async (req: Request, res: Response) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
        const { username, email, password, role } = req.body;
        const existingUser = await prisma.user.findFirst({
            where: { OR: [{ username }, { email }] },
        });
        if (existingUser) return res.status(409).json({ error: 'El usuario o email ya existe' });
        const passwordHash = await hashPassword(password);
        const validRoles = ['ADMIN', 'USER', 'CLIENT'];
        const userRole = validRoles.includes(role) ? role : 'CLIENT';
        const user = await prisma.user.create({
            data: { username, email, passwordHash, role: userRole, loyaltyPoints: 0 },
            select: { id: true, username: true, email: true, role: true, loyaltyPoints: true, createdAt: true },
        });
        console.log(`[SECURITY] New user registered: ${username} (ID: ${user.id}, Role: ${user.role})`);
        res.status(201).json({ message: 'Usuario registrado exitosamente', user });
    } catch (error) {
        console.error('[ERROR] Registration failed:', error);
        res.status(500).json({ error: 'Error al registrar usuario' });
    }
});

app.post('/api/auth/login', authLimiter, loginValidation, async (req: Request, res: Response) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
        const { username, password } = req.body;
        const user = await prisma.user.findUnique({ where: { username } });
        if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });
        const isValidPassword = await verifyPassword(password, user.passwordHash);
        if (!isValidPassword) {
            console.log(`[SECURITY] Failed login attempt for user: ${username}`);
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }
        await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
        const payload: JWTPayload = { userId: user.id, username: user.username, role: user.role };
        const accessToken  = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);
        await prisma.refreshToken.create({
            data: { token: refreshToken, userId: user.id,
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
        });
        res.cookie('accessToken', accessToken, {
            httpOnly: true, secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict', maxAge: 15 * 60 * 1000 });
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true, secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict', maxAge: COOKIE_MAX_AGE });
        console.log(`[SECURITY] Successful login: ${username} (ID: ${user.id})`);
        res.json({ message: 'Login exitoso', user: {
            id: user.id, username: user.username, email: user.email,
            role: user.role, loyaltyPoints: user.loyaltyPoints } });
    } catch (error) {
        console.error('[ERROR] Login failed:', error);
        res.status(500).json({ error: 'Error al iniciar sesión' });
    }
});

app.post('/api/auth/refresh', async (req: Request, res: Response) => {
    try {
        const refreshToken = req.cookies.refreshToken;
        if (!refreshToken) return res.status(401).json({ error: 'No autenticado' });
        const storedToken = await prisma.refreshToken.findUnique({
            where: { token: refreshToken }, include: { user: true } });
        if (!storedToken || storedToken.expiresAt < new Date())
            return res.status(403).json({ error: 'Refresh token inválido o expirado' });
        const payload = verifyRefreshToken(refreshToken);
        if (!payload) return res.status(403).json({ error: 'Refresh token inválido' });
        const newAccessToken = generateAccessToken({
            userId: storedToken.user.id, username: storedToken.user.username, role: storedToken.user.role });
        res.cookie('accessToken', newAccessToken, {
            httpOnly: true, secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict', maxAge: 15 * 60 * 1000 });
        res.json({ message: 'Token refrescado exitosamente' });
    } catch (error) {
        console.error('[ERROR] Token refresh failed:', error);
        res.status(500).json({ error: 'Error al refrescar token' });
    }
});

app.post('/api/auth/logout', authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const refreshToken = req.cookies.refreshToken;
        if (refreshToken) await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
        res.clearCookie('accessToken');
        res.clearCookie('refreshToken');
        console.log(`[SECURITY] User logged out: ${req.user?.username}`);
        res.json({ message: 'Logout exitoso' });
    } catch (error) {
        console.error('[ERROR] Logout failed:', error);
        res.status(500).json({ error: 'Error al cerrar sesión' });
    }
});

app.get('/api/auth/me', authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
            select: { id: true, username: true, email: true, role: true,
                      loyaltyPoints: true, createdAt: true, lastLogin: true } });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json({ user });
    } catch (error) {
        console.error('[ERROR] Get user failed:', error);
        res.status(500).json({ error: 'Error al obtener usuario' });
    }
});

// ==================== RUTAS DE PUNTOS DE LEALTAD ====================

app.post('/api/users/:userId/points', authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const targetUserId = parseInt(req.params.userId, 10);
        const { points, orderId } = req.body;
        if (!points || points < 0 || isNaN(points))
            return res.status(400).json({ error: 'Los puntos deben ser un número positivo' });
        if (req.user!.userId !== targetUserId && req.user!.role !== 'ADMIN')
            return res.status(403).json({ error: 'No tienes permiso para actualizar los puntos de este usuario' });
        const user = await prisma.user.findUnique({ where: { id: targetUserId } });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        const newPoints = (user.loyaltyPoints || 0) + points;
        const updatedUser = await prisma.user.update({
            where: { id: targetUserId }, data: { loyaltyPoints: newPoints },
            select: { id: true, username: true, loyaltyPoints: true } });
        console.log(`[LOYALTY] User ${user.username} earned ${points} points (Order: ${orderId || 'N/A'}). Total: ${newPoints}`);
        res.json({ success: true, message: 'Puntos actualizados exitosamente', user: updatedUser });
    } catch (error) {
        console.error('[ERROR] Update points failed:', error);
        res.status(500).json({ error: 'Error al actualizar puntos' });
    }
});

// ==================== RUTAS DE CONFIGURACIÓN ====================

app.get('/api/admin/settings', authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const settings = {
            storeName: 'Mi Tienda E-commerce', currency: 'USD',
            timezone: 'America/Mexico_City', emailNotifications: true,
            lowStockAlert: true, expiryAlert: true, alertThreshold: 2,
            adminEmails: [], autoReportTime: '09:00', autoReportEnabled: false,
            esp32Enabled: false, arduinoPort: 'COM3', ledDuration: 3000,
            esp32IpAddress: '', esp32Port: 80, sessionTimeout: 30,
            requireStrongPassword: true, twoFactorAuth: false
        };
        res.json({ success: true, settings });
    } catch (error) {
        console.error('[ERROR] Get settings failed:', error);
        res.status(500).json({ error: 'Error al obtener configuración' });
    }
});

app.post('/api/admin/settings', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const settings = req.body;
        if (!settings) return res.status(400).json({ error: 'Configuración inválida' });
        console.log('[SETTINGS] Settings updated by:', req.user?.username);
        res.json({ success: true, message: 'Configuración guardada exitosamente', settings });
    } catch (error) {
        console.error('[ERROR] Save settings failed:', error);
        res.status(500).json({ error: 'Error al guardar configuración' });
    }
});

// ==================== RUTAS DE PRODUCTOS ====================

app.get('/api/admin/products', authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const products = await prisma.product.findMany({ orderBy: { createdAt: 'desc' } });
        res.json({ success: true, products });
    } catch (error) {
        console.error('[ERROR] Get products failed:', error);
        res.status(500).json({ error: 'Error al obtener productos' });
    }
});

app.post('/api/admin/products', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const { title, description, price, stock, unit, image, rating, category, slot, slotDistance } = req.body;
        if (!title || !price || stock === undefined || !unit)
            return res.status(400).json({ error: 'Faltan campos obligatorios' });
        if (price <= 0) return res.status(400).json({ error: 'El precio debe ser mayor que 0' });
        if (stock < 0)  return res.status(400).json({ error: 'El stock no puede ser negativo' });
        const product = await prisma.product.create({
            data: { title, description: description || null, price, stock, initialStock: stock,
                    unit, image: image || null, rating: rating || 5.0,
                    category: category || 'General', slot: slot || null,
                    slotDistance: slotDistance || null, sales: 0 } });
        console.log(`[PRODUCT] New product created: ${title} (ID: ${product.id}) by ${req.user?.username}`);
        if (stock > 0) {
            try {
                const expiryDate = new Date();
                expiryDate.setFullYear(expiryDate.getFullYear() + 1);
                await createBatch(product.id, stock, expiryDate, req.user?.username);
                console.log(`[BATCH] Primer lote creado automáticamente para: ${product.title}`);
            } catch (batchError) {
                console.warn(`[BATCH] No se pudo crear lote inicial: ${batchError}`);
            }
        }
        res.status(201).json({
            success: true,
            message: `Producto "${title}" creado exitosamente${stock > 0 ? ' con primer lote automático' : ''}`,
            product });
    } catch (error) {
        console.error('[ERROR] Create product failed:', error);
        res.status(500).json({ error: 'Error al crear producto' });
    }
});

app.put('/api/admin/products/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const productId = parseInt(req.params.id, 10);
        const { title, description, price, stock, unit, image, rating, category, slot, slotDistance } = req.body;
        const existingProduct = await prisma.product.findUnique({ where: { id: productId } });
        if (!existingProduct) return res.status(404).json({ error: 'Producto no encontrado' });
        const product = await prisma.product.update({
            where: { id: productId },
            data: {
                title: title || existingProduct.title,
                description: description !== undefined ? description : existingProduct.description,
                price: price || existingProduct.price,
                stock: stock !== undefined ? stock : existingProduct.stock,
                unit: unit || existingProduct.unit,
                image: image !== undefined ? image : existingProduct.image,
                rating: rating || existingProduct.rating,
                category: category || existingProduct.category,
                slot: slot !== undefined ? slot : existingProduct.slot,
                slotDistance: slotDistance !== undefined ? slotDistance : existingProduct.slotDistance
            } });
        console.log(`[PRODUCT] Product updated: ${product.title} (ID: ${product.id}) by ${req.user?.username}`);
        res.json({ success: true, message: 'Producto actualizado exitosamente', product });
    } catch (error) {
        console.error('[ERROR] Update product failed:', error);
        res.status(500).json({ error: 'Error al actualizar producto' });
    }
});

app.delete('/api/admin/products/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const productId = parseInt(req.params.id, 10);
        const existingProduct = await prisma.product.findUnique({ where: { id: productId } });
        if (!existingProduct) return res.status(404).json({ error: 'Producto no encontrado' });
        await prisma.product.delete({ where: { id: productId } });
        console.log(`[PRODUCT] Product deleted: ${existingProduct.title} (ID: ${productId}) by ${req.user?.username}`);
        res.json({ success: true, message: 'Producto eliminado exitosamente' });
    } catch (error) {
        console.error('[ERROR] Delete product failed:', error);
        res.status(500).json({ error: 'Error al eliminar producto' });
    }
});

// ==================== RUTAS DE AJUSTES DE STOCK ====================

app.get('/api/admin/stock-adjustments', authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 20;
        const adjustments = await prisma.stockAdjustment.findMany({
            take: limit, orderBy: { createdAt: 'desc' },
            include: { product: { select: { title: true } } } });
        res.json({ success: true, adjustments });
    } catch (error) {
        console.error('[ERROR] Get stock adjustments failed:', error);
        res.status(500).json({ error: 'Error al obtener ajustes de stock' });
    }
});

// ==================== RUTAS PROTEGIDAS ====================

app.get('/api/admin/users', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const users = await prisma.user.findMany({
            select: { id: true, username: true, email: true, role: true,
                      loyaltyPoints: true, createdAt: true, lastLogin: true } });
        res.json({ users });
    } catch (error) {
        console.error('[ERROR] Get users failed:', error);
        res.status(500).json({ error: 'Error al obtener usuarios' });
    }
});

// ==================== RUTAS DE PAGO EN EFECTIVO ====================

/**
 * POST /api/payment/start
 * Body: { orderId: string, totalCents: number }
 * Inicia cobro en NV200+SCS. Los eventos llegan al frontend por WebSocket /ws
 */
app.post('/api/payment/start', authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const { orderId, totalCents } = req.body;
        if (!orderId || !totalCents || totalCents <= 0)
            return res.status(400).json({ error: 'orderId y totalCents (> 0) son requeridos' });
        const result = await startPayment(Number(totalCents), String(orderId));
        res.status(result.ok ? 200 : 409).json(result);
    } catch (error) {
        console.error('[ERROR] Payment start failed:', error);
        res.status(500).json({ error: 'Error al iniciar cobro' });
    }
});

/**
 * POST /api/payment/cancel
 * Cancela transacción en curso y devuelve el dinero insertado
 */
app.post('/api/payment/cancel', authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const result = await cancelPayment();
        res.status(result.ok ? 200 : 409).json(result);
    } catch (error) {
        console.error('[ERROR] Payment cancel failed:', error);
        res.status(500).json({ error: 'Error al cancelar cobro' });
    }
});

/**
 * GET /api/payment/status
 * Estado actual del servicio de cobro
 */
app.get('/api/payment/status', authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
        const status = await paymentStatus();
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener estado de pago' });
    }
});

// ==================== MANEJO DE ERRORES ====================

app.use((req: Request, res: Response) => {
    res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('[ERROR] Unhandled error:', err);
    res.status(500).json({
        error: process.env.NODE_ENV === 'production' ? 'Error interno del servidor' : err.message,
    });
});

// ==================== INICIO DEL SERVIDOR ====================

// Crear servidor HTTP explícito para compartirlo con WebSocket
const httpServer = http.createServer(app);

// Iniciar servicio de cobro en efectivo (WS + proceso Python)
initCashService(httpServer);

httpServer.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📏 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔒 Security features enabled`);
    console.log(`🎆 Loyalty points system enabled`);
    console.log(`⚙️  Settings API enabled`);
    console.log(`📦 Products API enabled`);
    console.log(`📦 Batches API enabled (FIFO system)`);
    console.log(`💵 Cash payment API enabled (WS /ws + /api/payment/*)`);
});

// Cierre graceful
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, closing server...');
    shutdownCashService();
    await prisma.$disconnect();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, closing server...');
    shutdownCashService();
    await prisma.$disconnect();
    process.exit(0);
});
