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
import http from 'http';
import { WebSocketServer } from 'ws';

import emailRoutes    from './routes/emailRoutes';
import productRoutes  from './routes/productRoutes';
import settingsRoutes from './routes/settingsRoutes';
import paymentRoutes  from './routes/paymentRoutes';
import { SSPService } from './hardware/sspService';
import { startReportScheduler, stopReportScheduler } from './services/reportScheduler';
import {
  createBatch,
  getExpiringBatches,
  getProductBatches,
  getBatchStockSummary,
  deleteBatch,
} from './services/batch.service';

// ==================== CONFIGURACIÓN ====================

const app        = express();
const prisma     = new PrismaClient();
const PORT       = process.env.PORT || 3000;
const SSP_PORT   = process.env.SSP_PORT    ?? 'COM7';
const SSP_COUNTRY = process.env.SSP_COUNTRY ?? 'USD';

const httpServer = http.createServer(app);
const wss        = new WebSocketServer({ server: httpServer, path: '/ws' });
export const sspService = new SSPService();

// ==================== VALIDACIÓN DE SECRETS ====================

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('❌ FATAL: JWT_SECRET must be set and be at least 32 characters');
}
if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.length < 32) {
  throw new Error('❌ FATAL: JWT_REFRESH_SECRET must be set and be at least 32 characters');
}

const JWT_SECRET         = process.env.JWT_SECRET as string;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET as string;

console.log('✅ JWT secrets validated successfully');
console.log('📧 SMTP configured:', process.env.SMTP_HOST);

const SALT_ROUNDS         = 12;
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const COOKIE_MAX_AGE      = 7 * 24 * 60 * 60 * 1000;

// ==================== MIDDLEWARES ====================

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      scriptSrc:  ["'self'"],
      imgSrc:     ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'ws://localhost:3000', 'ws://localhost:8081'],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

app.use(cors({
  origin:         process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 500,
  message: 'Demasiadas peticiones, intenta más tarde',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(generalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Demasiados intentos de login, intenta más tarde',
  skipSuccessfulRequests: true,
});

// ==================== TIPOS ====================

interface JWTPayload {
  userId: number;
  username: string;
  role: string;
}

interface AuthRequest extends Request {
  user?: JWTPayload;
}

// ==================== UTILIDADES JWT ====================

function generateAccessToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

function generateRefreshToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
}

function verifyAccessToken(token: string): JWTPayload | null {
  try { return jwt.verify(token, JWT_SECRET) as JWTPayload; }
  catch { return null; }
}

function verifyRefreshToken(token: string): JWTPayload | null {
  try { return jwt.verify(token, JWT_REFRESH_SECRET) as JWTPayload; }
  catch { return null; }
}

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ==================== MIDDLEWARES DE AUTH ====================

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
  body('username').trim().isLength({ min: 3, max: 50 }).matches(/^[a-zA-Z0-9_-]+$/),
  body('email').trim().isEmail().normalizeEmail(),
  body('password').isLength({ min: 8, max: 128 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/),
];

const loginValidation = [
  body('username').trim().notEmpty(),
  body('password').notEmpty(),
];

// ==================== RUTAS DE AUTH ====================

app.post('/api/auth/register', authLimiter, registerValidation, async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { username, email, password, role } = req.body;

    const existing = await prisma.user.findFirst({ where: { OR: [{ username }, { email }] } });
    if (existing) return res.status(409).json({ error: 'El usuario o email ya existe' });

    const passwordHash = await hashPassword(password);
    const validRoles   = ['ADMIN', 'USER', 'CLIENT'];
    const userRole     = validRoles.includes(role) ? role : 'CLIENT';

    const user = await prisma.user.create({
      data: { username, email, passwordHash, role: userRole, loyaltyPoints: 0 },
      select: { id: true, username: true, email: true, role: true, loyaltyPoints: true, createdAt: true },
    });

    console.log(`[SECURITY] New user registered: ${username} (ID: ${user.id})`);
    res.status(201).json({ message: 'Usuario registrado exitosamente', user });
  } catch (error) {
    console.error('[ERROR] Registration:', error);
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

app.post('/api/auth/login', authLimiter, loginValidation, async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { username, password } = req.body;
    const user = await prisma.user.findUnique({ where: { username } });

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      console.log(`[SECURITY] Failed login: ${username}`);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });

    const payload: JWTPayload = { userId: user.id, username: user.username, role: user.role };
    const accessToken  = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    await prisma.refreshToken.create({
      data: { token: refreshToken, userId: user.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });

    res.cookie('accessToken',  accessToken,  { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 15 * 60 * 1000 });
    res.cookie('refreshToken', refreshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: COOKIE_MAX_AGE });

    console.log(`[SECURITY] Login OK: ${username}`);
    res.json({ message: 'Login exitoso', user: { id: user.id, username: user.username, email: user.email, role: user.role, loyaltyPoints: user.loyaltyPoints } });
  } catch (error) {
    console.error('[ERROR] Login:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

app.post('/api/auth/refresh', async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) return res.status(401).json({ error: 'No autenticado' });

    const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken }, include: { user: true } });
    if (!stored || stored.expiresAt < new Date()) return res.status(403).json({ error: 'Refresh token inválido o expirado' });

    const payload = verifyRefreshToken(refreshToken);
    if (!payload) return res.status(403).json({ error: 'Refresh token inválido' });

    const newAccessToken = generateAccessToken({ userId: stored.user.id, username: stored.user.username, role: stored.user.role });
    res.cookie('accessToken', newAccessToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 15 * 60 * 1000 });
    res.json({ message: 'Token refrescado exitosamente' });
  } catch (error) {
    console.error('[ERROR] Refresh:', error);
    res.status(500).json({ error: 'Error al refrescar token' });
  }
});

app.post('/api/auth/logout', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (refreshToken) await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    console.log(`[SECURITY] Logout: ${req.user?.username}`);
    res.json({ message: 'Logout exitoso' });
  } catch (error) {
    res.status(500).json({ error: 'Error al cerrar sesión' });
  }
});

app.get('/api/auth/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, username: true, email: true, role: true, loyaltyPoints: true, createdAt: true, lastLogin: true },
    });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener usuario' });
  }
});

// ==================== PUNTOS DE LEALTAD ====================

app.post('/api/users/:userId/points', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const targetUserId = parseInt(req.params.userId, 10);
    const { points, orderId } = req.body;

    if (!points || points < 0 || isNaN(points))
      return res.status(400).json({ error: 'Los puntos deben ser un número positivo' });
    if (req.user!.userId !== targetUserId && req.user!.role !== 'ADMIN')
      return res.status(403).json({ error: 'Sin permiso' });

    const user = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const newPoints = (user.loyaltyPoints || 0) + points;
    const updated   = await prisma.user.update({
      where: { id: targetUserId },
      data:  { loyaltyPoints: newPoints },
      select: { id: true, username: true, loyaltyPoints: true },
    });

    console.log(`[LOYALTY] ${user.username} +${points} pts (Order: ${orderId || 'N/A'}). Total: ${newPoints}`);
    res.json({ success: true, user: updated });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar puntos' });
  }
});

// ==================== FIFO ====================

async function consumeBatchesFIFO(tx: any, productId: number, quantity: number): Promise<void> {
  if (quantity <= 0) return;
  let remaining = quantity;

  const batches = await tx.batch.findMany({
    where: { productId, quantity: { gt: 0 } },
    orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
  });

  if (!batches.length) { console.warn(`[FIFO] Sin lotes para producto ${productId}`); return; }

  const updates = [];
  for (const batch of batches) {
    if (remaining <= 0) break;
    const toConsume = Math.min(batch.quantity, remaining);
    updates.push(tx.batch.update({ where: { id: batch.id }, data: { quantity: batch.quantity - toConsume } }));
    remaining -= toConsume;
  }

  await Promise.all(updates);
  if (remaining > 0) console.warn(`[FIFO] Stock insuficiente en lotes para producto ${productId}`);
}

// ==================== ÓRDENES ====================

app.post('/api/orders', async (req: Request, res: Response) => {
  try {
    const { customerName, customerEmail, phone, address, paymentMethod, total, items } = req.body;
    if (!customerName || !customerEmail || !phone || !address || !paymentMethod || !total || !items?.length)
      return res.status(400).json({ error: 'Faltan datos obligatorios' });

    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: { customerName, customerEmail, phone, address, paymentMethod, total, status: 'PENDING' },
      });

      for (const item of items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product || product.stock < item.quantity)
          throw new Error(`Stock insuficiente para producto ID ${item.productId}`);

        await tx.orderItem.create({
          data: { orderId: newOrder.id, productId: item.productId, quantity: item.quantity, price: item.price },
        });
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity }, sales: { increment: item.quantity }, dailySales: { increment: item.quantity } },
        });
        await consumeBatchesFIFO(tx, item.productId, item.quantity);
      }

      return tx.order.update({
        where: { id: newOrder.id },
        data:  { status: 'COMPLETED' },
        include: { items: { include: { product: true } } },
      });
    }, { maxWait: 15000, timeout: 30000 });

    console.log(`[ORDEN] #${order.id} - ${customerName} - $${total}`);
    res.status(201).json({ success: true, order });
  } catch (error: any) {
    console.error('[ERROR] Create order:', error);
    res.status(500).json({ error: error.message || 'Error al crear orden' });
  }
});

app.get('/api/orders', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const orders = await prisma.order.findMany({
      include: { items: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const formatted = orders.map(o => ({
      ...o,
      items: o.items.map(i => ({
        id: i.id, orderId: i.orderId, productId: i.productId,
        quantity: i.quantity, price: i.price,
        productTitle: i.product.title, productImage: i.product.image,
      })),
    }));
    res.json({ success: true, orders: formatted });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener órdenes' });
  }
});

// ==================== LOTES ====================

app.post('/api/admin/batches', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { productId, quantity, expiryDate } = req.body;
    if (!productId || !quantity || !expiryDate)
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    const batch = await createBatch(parseInt(productId), parseInt(quantity), new Date(expiryDate), req.user?.username);
    res.status(201).json({ success: true, message: `Lote ${batch.batchCode} creado`, batch });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/batches/product/:productId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const batches = await getProductBatches(parseInt(req.params.productId));
    res.json({ success: true, batches });
  } catch { res.status(500).json({ error: 'Error al obtener lotes' }); }
});

app.get('/api/admin/batches/expiring', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const batches = await getExpiringBatches(days);
    res.json({ success: true, batches, threshold: `${days} días` });
  } catch { res.status(500).json({ error: 'Error al obtener lotes por vencer' }); }
});

app.get('/api/admin/batches/product/:productId/summary', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const productId = parseInt(req.params.productId, 10);
    if (isNaN(productId)) return res.status(400).json({ error: 'ID inválido' });
    const summary = await getBatchStockSummary(productId);
    res.json({ success: true, summary });
  } catch { res.status(500).json({ error: 'Error al obtener resumen de lotes' }); }
});

app.patch('/api/admin/batches/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const batchId  = parseInt(req.params.id, 10);
    const { quantity } = req.body;
    if (isNaN(batchId)) return res.status(400).json({ error: 'ID inválido' });
    if (quantity === undefined || quantity < 0) return res.status(400).json({ error: 'Cantidad inválida' });
    const batch = await prisma.batch.update({ where: { id: batchId }, data: { quantity } });
    res.json({ success: true, batch });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/batches/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const batchId = parseInt(req.params.id, 10);
    if (isNaN(batchId)) return res.status(400).json({ error: 'ID inválido' });
    await deleteBatch(batchId, req.user?.username);
    res.json({ success: true, message: 'Lote eliminado' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ==================== STOCK ADJUSTMENTS ====================

app.get('/api/admin/stock-adjustments', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const adjustments = await prisma.stockAdjustment.findMany({
      take: limit,
      orderBy: { timestamp: 'desc' },
      include: { product: { select: { title: true } } },
    });
    res.json({ success: true, adjustments });
  } catch { res.status(500).json({ error: 'Error al obtener ajustes de stock' }); }
});

// ==================== ADMIN USERS ====================

app.get('/api/admin/users', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, email: true, role: true, loyaltyPoints: true, createdAt: true, lastLogin: true },
    });
    res.json({ users });
  } catch { res.status(500).json({ error: 'Error al obtener usuarios' }); }
});

app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'ID inválido' });
    if (req.user!.userId === userId) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    await prisma.user.delete({ where: { id: userId } });
    console.log(`[ADMIN] Usuario eliminado: ${user.username} por ${req.user!.username}`);
    res.json({ success: true, message: `Usuario "${user.username}" eliminado` });
  } catch { res.status(500).json({ error: 'Error al eliminar usuario' }); }
});

// ==================== RUTAS EXTERNAS ====================

app.use('/api/payment',         paymentRoutes);
app.use('/api/products',        productRoutes);
app.use('/api/admin',           productRoutes);
app.use('/api/admin/email',     authenticateToken, requireAdmin, emailRoutes);
app.use('/api/admin/settings',  authenticateToken, requireAdmin, settingsRoutes);

console.log('🛒  Public product routes registered at /api/products');
console.log('📦  Admin product routes registered at /api/admin/products');
console.log('📧  Email routes registered at /api/admin/email');
console.log('⚙️   Settings routes registered at /api/admin/settings');
console.log('📦  Products API enabled');
console.log('🛒  Orders API enabled');
console.log('📦  Batches API enabled (FIFO system - OPTIMIZED)');
console.log('📋  Stock Adjustments API enabled');

// ==================== 404 + ERROR HANDLER ====================

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('[ERROR] Unhandled:', err);
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? 'Error interno del servidor' : err.message,
  });
});

// ==================== SSP HARDWARE ====================

sspService.onEvent = (device, event, data) => {
  const msg = JSON.stringify({ type: 'SSP_EVENT', device, event, data: data.toString('hex') });
  wss.clients.forEach(client => { if (client.readyState === 1) client.send(msg); });
};

async function startSSP(): Promise<void> {
  try {
    const { scsOk, nv200Ok } = await sspService.connect(SSP_PORT);
    console.log(`SSP Puerto ${SSP_PORT} abierto — NV200:${nv200Ok} SCS:${scsOk}`);
    if (nv200Ok || scsOk) {
      await sspService.initDevices(SSP_COUNTRY);
      sspService.startPolling(200);
      console.log(`✅ SSP Hardware listo (${SSP_COUNTRY})`);
    }
  } catch (err) {
    console.error('SSP init error:', err);
  }
}

async function stopSSP(): Promise<void> {
  await sspService.disconnect().catch(() => {});
}

// ==================== WEBSOCKET ====================

wss.on('connection', (ws) => {
  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'SSP_START_SESSION') {
        ws.send(JSON.stringify({ type: 'SSP_SESSION_OK' }));
      }

      if (msg.type === 'SSP_PAYOUT') {
        const { cents, country } = msg;
        const driver = msg.device === 'SCS' ? sspService.scs : sspService.nv200;
        if (driver?.crypto.isNegotiated) {
          const { code } = await driver.payoutAmount(cents, country ?? SSP_COUNTRY);
          ws.send(JSON.stringify({ type: 'SSP_PAYOUT_RESULT', code }));
        }
      }
    } catch (e) {
      console.error('WS msg error', e);
    }
  });
});

// ==================== ARRANQUE ====================

httpServer.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  startReportScheduler();
  await startSSP();
});

// ==================== SHUTDOWN ====================

async function gracefulShutdown(signal: string) {
  console.log(`${signal} received, closing server...`);
  stopReportScheduler();
  await stopSSP();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
