/**
 * PRODUCT ROUTES
 *
 * Rutas API para gestión de productos
 * - Rutas públicas: para la tienda (sin autenticación)
 * - Rutas protegidas: para administración (requieren autenticación de admin)
 * 
 * NOTA: Este router se monta en /api/admin (ver server.ts)
 * Por lo tanto las rutas aquí son relativas a /api/admin
 * Ejemplo: /products -> /api/admin/products
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAdmin, authenticateToken } from '../middleware/auth';
import { createBatch } from '../services/batch.service';

const router = Router();
const prisma = new PrismaClient();

// ==================== PUBLIC ROUTES ====================

/**
 * GET /api/admin/public (PÚBLICA)
 * Obtiene todos los productos para mostrar en la tienda
 * No requiere autenticación
 */
router.get('/public', async (_req: Request, res: Response) => {
  try {
    const products = await prisma.product.findMany({
      where: {
        stock: {
          gt: 0  // Solo productos con stock disponible
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return res.json({
      success: true,
      products
    });
  } catch (error) {
    console.error('Error fetching public products:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener productos'
    });
  }
});

// ==================== ADMIN ROUTES ====================

/**
 * GET /api/admin/products (admin)
 * Obtiene todos los productos (incluyendo sin stock)
 * Requiere autenticación de administrador
 */
router.get('/products', authenticateToken, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const products = await prisma.product.findMany({
      orderBy: {
        createdAt: 'desc'
      }
    });

    return res.json({
      success: true,
      products
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener productos'
    });
  }
});

// ==================== GET SINGLE PRODUCT ====================

/**
 * GET /api/admin/products/:id
 * Obtiene un producto por ID
 */
router.get('/products/:id', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const productId = parseInt(req.params.id);

    if (isNaN(productId)) {
      return res.status(400).json({
        success: false,
        message: 'ID de producto inválido'
      });
    }

    const product = await prisma.product.findUnique({
      where: { id: productId }
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Producto no encontrado'
      });
    }

    return res.json({
      success: true,
      product
    });
  } catch (error) {
    console.error('Error fetching product:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener producto'
    });
  }
});

// ==================== CREATE PRODUCT ====================

/**
 * POST /api/admin/products
 * Crea un nuevo producto
 * ✅ ACTUALIZADO: Si tiene stock inicial, crea automáticamente el primer lote
 * ✅ AGREGADO: Campos slot y slotDistance para hardware
 */
router.post('/products', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const {
      title,
      description,
      price,
      stock,
      unit,
      image,
      rating,
      category,
      slot,           // ✅ Número de slot (hardware)
      slotDistance,   // ✅ Distancia del motor en cm (Float para decimales)
      expiryDate      // ✅ Fecha de vencimiento del primer lote
    } = req.body;

    // Validaciones
    if (!title || !price || stock === undefined || !unit) {
      return res.status(400).json({
        success: false,
        message: 'Campos requeridos: title, price, stock, unit'
      });
    }

    if (price <= 0) {
      return res.status(400).json({
        success: false,
        message: 'El precio debe ser mayor que 0'
      });
    }

    if (stock < 0) {
      return res.status(400).json({
        success: false,
        message: 'El stock no puede ser negativo'
      });
    }

    // ✅ VALIDAR: Si tiene stock inicial, debe proporcionar fecha de vencimiento
    if (stock > 0 && !expiryDate) {
      return res.status(400).json({
        success: false,
        message: 'Debe proporcionar fecha de vencimiento para el stock inicial'
      });
    }

    if (rating !== undefined && (rating < 0 || rating > 5)) {
      return res.status(400).json({
        success: false,
        message: 'La calificación debe estar entre 0 y 5'
      });
    }

    // Crear producto
    const product = await prisma.product.create({
      data: {
        title: title.trim(),
        description: description ? description.trim() : null,
        price: parseFloat(price),
        stock: parseInt(stock),
        initialStock: parseInt(stock),
        unit: unit.trim(),
        image: image ? image.trim() : null,
        rating: rating !== undefined ? parseFloat(rating) : 0,
        category: category ? category.trim() : null,
        slot: slot !== undefined && slot !== null && slot !== '' ? parseInt(slot) : null,           // ✅ Int
        slotDistance: slotDistance !== undefined && slotDistance !== null && slotDistance !== '' ? parseFloat(slotDistance) : null,  // ✅ Float para decimales
        sales: 0
      }
    });

    console.log(`✅ Producto creado: ${product.title} (ID: ${product.id}, Slot: ${product.slot || 'N/A'}, Distancia: ${product.slotDistance || 'N/A'}cm)`);

    // ✅ CREAR PRIMER LOTE AUTOMÁTICAMENTE si tiene stock inicial
    let batchInfo = null;
    if (stock > 0 && expiryDate) {
      try {
        const batch = await createBatch(
          product.id,
          parseInt(stock),
          new Date(expiryDate),
          'SYSTEM' // Usuario por defecto al crear producto
        );
        batchInfo = batch;
        console.log(`📦 Primer lote creado automáticamente: ${batch.batchCode}`);
      } catch (batchError) {
        console.warn(`⚠️ No se pudo crear lote inicial: ${batchError}`);
        // No fallar la creación del producto si falla el lote
      }
    }

    return res.status(201).json({
      success: true,
      message: `Producto "${product.title}" creado exitosamente${batchInfo ? ` con lote ${batchInfo.batchCode}` : ''}`,
      product,
      batch: batchInfo
    });
  } catch (error) {
    console.error('Error creating product:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al crear producto'
    });
  }
});

// ==================== UPDATE PRODUCT ====================

/**
 * PUT /api/admin/products/:id
 * Actualiza un producto existente
 * ✅ AGREGADO: Soporte para actualizar slot y slotDistance
 */
router.put('/products/:id', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const productId = parseInt(req.params.id);

    if (isNaN(productId)) {
      return res.status(400).json({
        success: false,
        message: 'ID de producto inválido'
      });
    }

    const {
      title,
      description,
      price,
      stock,
      unit,
      image,
      rating,
      category,
      slot,           // ✅ Int
      slotDistance    // ✅ Float
    } = req.body;

    // Verificar que el producto existe
    const existingProduct = await prisma.product.findUnique({
      where: { id: productId }
    });

    if (!existingProduct) {
      return res.status(404).json({
        success: false,
        message: 'Producto no encontrado'
      });
    }

    // Validaciones
    if (price !== undefined && price <= 0) {
      return res.status(400).json({
        success: false,
        message: 'El precio debe ser mayor que 0'
      });
    }

    if (stock !== undefined && stock < 0) {
      return res.status(400).json({
        success: false,
        message: 'El stock no puede ser negativo'
      });
    }

    if (rating !== undefined && (rating < 0 || rating > 5)) {
      return res.status(400).json({
        success: false,
        message: 'La calificación debe estar entre 0 y 5'
      });
    }

    // Construir objeto de actualización solo con campos proporcionados
    const updateData: any = {};

    if (title !== undefined) updateData.title = title.trim();
    if (description !== undefined) updateData.description = description ? description.trim() : null;
    if (price !== undefined) updateData.price = parseFloat(price);
    if (stock !== undefined) updateData.stock = parseInt(stock);
    if (unit !== undefined) updateData.unit = unit.trim();
    if (image !== undefined) updateData.image = image ? image.trim() : null;
    if (rating !== undefined) updateData.rating = parseFloat(rating);
    if (category !== undefined) updateData.category = category ? category.trim() : null;
    if (slot !== undefined) updateData.slot = slot !== null && slot !== '' ? parseInt(slot) : null;  // ✅ Int
    if (slotDistance !== undefined) updateData.slotDistance = slotDistance !== null && slotDistance !== '' ? parseFloat(slotDistance) : null;  // ✅ Float

    // Actualizar producto
    const product = await prisma.product.update({
      where: { id: productId },
      data: updateData
    });

    console.log(`✅ Producto actualizado: ${product.title} (ID: ${product.id})`);

    return res.json({
      success: true,
      message: `Producto "${product.title}" actualizado exitosamente`,
      product
    });
  } catch (error) {
    console.error('Error updating product:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al actualizar producto'
    });
  }
});

// ==================== DELETE PRODUCT ====================

/**
 * DELETE /api/admin/products/:id
 * Elimina un producto y todas sus relaciones
 */
router.delete('/products/:id', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const productId = parseInt(req.params.id);

    if (isNaN(productId)) {
      return res.status(400).json({
        success: false,
        message: 'ID de producto inválido'
      });
    }

    // Verificar que el producto existe
    const existingProduct = await prisma.product.findUnique({
      where: { id: productId }
    });

    if (!existingProduct) {
      return res.status(404).json({
        success: false,
        message: 'Producto no encontrado'
      });
    }

    // ✅ Eliminar todas las relaciones antes de eliminar el producto
    
    // 1. Eliminar OrderItems relacionados
    await prisma.orderItem.deleteMany({
      where: { productId: productId }
    });

    // 2. Eliminar StockAdjustments relacionados
    await prisma.stockAdjustment.deleteMany({
      where: { productId: productId }
    });

    // 3. Eliminar Batches relacionados
    await prisma.batch.deleteMany({
      where: { productId: productId }
    });

    // 4. Finalmente eliminar el producto
    await prisma.product.delete({
      where: { id: productId }
    });

    console.log(`🗑️  Producto eliminado: ${existingProduct.title} (ID: ${productId})`);

    return res.json({
      success: true,
      message: `Producto "${existingProduct.title}" eliminado exitosamente`
    });
  } catch (error) {
    console.error('Error deleting product:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al eliminar producto'
    });
  }
});


/**
 * PATCH /api/admin/:id/sales (PÚBLICA para permitir sincronización desde checkout)
 * Actualiza el contador de ventas y opcionalmente el stock de un producto
 */
router.patch('/:id/sales', async (req: Request, res: Response) => {
  try {
    const productId = parseInt(req.params.id);
    const { sales, dailySales, stock } = req.body;

    if (isNaN(productId)) {
      return res.status(400).json({
        success: false,
        message: 'ID de producto inválido'
      });
    }

    if (typeof sales !== 'number' || sales < 0) {
      return res.status(400).json({
        success: false,
        message: 'Número de ventas inválido'
      });
    }

    // Preparar datos a actualizar
    const updateData: any = { sales };

    // Si se proporciona dailySales, también actualizarlo
    if (typeof dailySales === 'number' && dailySales >= 0) {
      updateData.dailySales = dailySales;
    }

    // Si se proporciona stock, también actualizarlo
    if (typeof stock === 'number' && stock >= 0) {
      updateData.stock = stock;
    }

    const product = await prisma.product.update({
      where: { id: productId },
      data: updateData
    });

    return res.json({
      success: true,
      product
    });
  } catch (error) {
    console.error('Error updating product sales/stock:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al actualizar ventas/stock del producto'
    });
  }
});

export default router;