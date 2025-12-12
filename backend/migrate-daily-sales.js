/**
 * Script de migración para inicializar dailySales
 * Copia el valor de sales a dailySales para todos los productos existentes
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function migrateDailySales() {
  console.log('🔄 Iniciando migración de dailySales...\n');

  try {
    // Obtener todos los productos
    const products = await prisma.product.findMany();

    console.log(`📦 Productos encontrados: ${products.length}\n`);

    let updatedCount = 0;

    for (const product of products) {
      // Copiar sales a dailySales si dailySales es 0
      if (product.dailySales === 0 && product.sales > 0) {
        await prisma.product.update({
          where: { id: product.id },
          data: { dailySales: product.sales }
        });

        console.log(`✅ ${product.title}: dailySales = ${product.sales}`);
        updatedCount++;
      } else {
        console.log(`⏭️  ${product.title}: Ya tiene dailySales = ${product.dailySales}`);
      }
    }

    console.log(`\n✅ Migración completada!`);
    console.log(`   Productos actualizados: ${updatedCount}`);
    console.log(`   Productos sin cambios: ${products.length - updatedCount}`);

  } catch (error) {
    console.error('❌ Error en la migración:', error);
  } finally {
    await prisma.$disconnect();
  }
}

migrateDailySales();
