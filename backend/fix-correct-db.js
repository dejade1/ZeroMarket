const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixCorrectDB() {
  console.log('\n🔧 ACTUALIZANDO LA BASE DE DATOS CORRECTA (ecommerce/prisma/dev.db)...\n');

  // Primero verificar qué datos tiene
  const products = await prisma.product.findMany();
  console.log(`📊 Productos actuales en la DB:`);
  products.forEach(p => {
    console.log(`   ${p.title}: Stock ${p.stock}, Ventas ${p.sales || 0}`);
  });

  console.log('\n🔄 Aplicando correcciones...\n');

  // Aceite el cocinero: Stock 8, Ventas 2
  await prisma.product.updateMany({
    where: { title: 'Aceite el cocinero' },
    data: { stock: 8, sales: 2, initialStock: 10 }
  });
  console.log('✅ Aceite el cocinero: Stock 8, Ventas 2');

  // Carne de res: Stock 95, Ventas 5
  await prisma.product.updateMany({
    where: { title: 'carne de res' },
    data: { stock: 95, sales: 5, initialStock: 100 }
  });
  console.log('✅ Carne de res: Stock 95, Ventas 5');

  // Margarina regia: Stock 47, Ventas 6
  await prisma.product.updateMany({
    where: { title: 'margarina regia' },
    data: { stock: 47, sales: 6, initialStock: 53 }
  });
  console.log('✅ Margarina regia: Stock 47, Ventas 6');

  // Tropico seco: Stock 18, Ventas 7
  await prisma.product.updateMany({
    where: { title: 'tropico seco' },
    data: { stock: 18, sales: 7, initialStock: 25 }
  });
  console.log('✅ Tropico seco: Stock 18, Ventas 7');

  console.log('\n✅ Base de datos correcta actualizada!\n');

  await prisma.$disconnect();
}

fixCorrectDB().catch(console.error);
