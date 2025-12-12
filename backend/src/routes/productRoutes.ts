/**
 * PRODUCT ROUTES
 *
 * Rutas API para gestión de productos
 * - Rutas públicas: para la tienda (sin autenticación)
 * - Rutas protegidas: para administración (requieren autenticación de admin)
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// ==================== PUBLIC ROUTES ====================

/**
 * GET /api/products (PÚBLICA)
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
 * GET /api/admin/products
 * Obtiene todos los productos (incluyendo sin stock)
 * Requiere autenticación de administrador
 */
router.get('/products', requireAdmin, async (_req: Request, res: Response) => {
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
router.get('/products/:id', requireAdmin, async (req: Request, res: Response) => {
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
 */
router.post('/products', requireAdmin, async (req: Request, res: Response) => {
  try {
    const {
      title,
      description,
      price,
      stock,
      unit,
      image,
      rating,
      category
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
        sales: 0
      }
    });

    console.log(`✅ Producto creado: ${product.title} (ID: ${product.id})`);

    return res.status(201).json({
      success: true,
      message: `Producto "${product.title}" creado exitosamente`,
      product
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
 */
router.put('/products/:id', requireAdmin, async (req: Request, res: Response) => {
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
      category
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
 * Elimina un producto
 */
router.delete('/products/:id', requireAdmin, async (req: Request, res: Response) => {
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

    // Eliminar producto (Prisma eliminará automáticamente los batches y ajustes relacionados por onDelete: Cascade)
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
 * PATCH /api/products/:id/sales (PÚBLICA para permitir sincronización desde checkout)
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
