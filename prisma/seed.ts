import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('\n🌱 Iniciando seed de la base de datos...');

  // 1. Crear usuario admin por defecto
  const adminPassword = await bcrypt.hash('admin123', 10);
  
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      password: adminPassword,
      role: 'admin'
    }
  });

  console.log('✅ Usuario admin creado:');
  console.log('   Username: admin');
  console.log('   Password: admin123');
  console.log('   ID:', admin.id);

  // 2. Crear usuario demo (opcional)
  const customerPassword = await bcrypt.hash('customer123', 10);
  
  const customer = await prisma.user.upsert({
    where: { username: 'customer' },
    update: {},
    create: {
      username: 'customer',
      password: customerPassword,
      role: 'customer'
    }
  });

  console.log('\n✅ Usuario cliente demo creado:');
  console.log('   Username: customer');
  console.log('   Password: customer123');
  console.log('   ID:', customer.id);

  console.log('\n🎉 Seed completado exitosamente!\n');
}

main()
  .catch((e) => {
    console.error('\n❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
