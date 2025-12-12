const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixInconsistentStocks() {
  console.log('\n🔧 CORRIGIENDO INCONSISTENCIAS DE STOCK...\n');

  // Margarina: 53 - 6 ventas = 47 (no 49)
  const margarina = await prisma.product.update({
    where: { id: 4 },
    data: { stock: 47 }
  });
  console.log('✅ Margarina regia: Stock 49 → 47 (53 inicial - 6 ventas)');

  // Tropico: 25 - 7 ventas = 18 (no 19)
  const tropico = await prisma.product.update({
    where: { id: 3 },
    data: { stock: 18 }
  });
  console.log('✅ Tropico seco: Stock 19 → 18 (25 inicial - 7 ventas)');

  console.log('\n✅ Inconsistencias corregidas. Ahora Stock Actual = Stock Inicial - Ventas\n');

  await prisma.$disconnect();
}

fixInconsistentStocks().catch(console.error);
