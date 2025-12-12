const { PrismaClient } = require('@prisma/client');
const { stringify } = require('csv-stringify/sync');

const prisma = new PrismaClient();

async function testCSVOutput() {
  console.log('\n📊 GENERANDO CSV DE PRUEBA\n');

  const products = await prisma.product.findMany({
    orderBy: { sales: 'desc' }
  });

  console.log('════════════════════════════════════════════════════════════════');
  console.log('DATOS QUE SE USARÁN EN EL CSV:');
  console.log('════════════════════════════════════════════════════════════════\n');

  for (const p of products) {
    const sales = p.sales || 0;
    const initialStock = p.initialStock || 0;
    const currentStock = p.stock;
    const hasDifference = initialStock > 0 && currentStock < initialStock;
    const difference = hasDifference ? initialStock - currentStock : 0;

    console.log(`📦 ${p.title}`);
    console.log(`   Stock Actual: ${currentStock}`);
    console.log(`   Stock Inicial: ${initialStock}`);
    console.log(`   Ventas: ${sales}`);
    console.log(`   Diferencia: ${hasDifference ? difference : 'N/A'}`);
    console.log(`   Calculado: ${initialStock} - ${currentStock} = ${difference}`);
    console.log('');
  }

  const data = products.map((p) => {
    const sales = p.sales || 0;
    const totalIngresos = sales * p.price;
    const initialStock = p.initialStock || 0;
    const currentStock = p.stock;
    const hasDifference = initialStock > 0 && currentStock < initialStock;
    const difference = hasDifference ? initialStock - currentStock : 0;

    return {
      'ID Producto': p.id,
      'Producto': p.title,
      'Ventas Totales': sales,
      'Stock Actual': currentStock,
      'Stock Inicial': initialStock,
      'Precio Unitario': `$${p.price.toFixed(2)}`,
      'Total Ingresos': `$${totalIngresos.toFixed(2)}`,
      'Diferencia Negativa': hasDifference ? difference : 'N/A',
      'Categoría': p.category || 'N/A',
      'Unidad': p.unit,
    };
  });

  const csv = stringify(data, {
    header: true,
    delimiter: ',',
  });

  console.log('════════════════════════════════════════════════════════════════');
  console.log('CONTENIDO DEL CSV:');
  console.log('════════════════════════════════════════════════════════════════\n');
  console.log(csv);

  await prisma.$disconnect();
}

testCSVOutput().catch(console.error);
