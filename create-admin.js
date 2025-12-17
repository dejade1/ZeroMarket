/**
 * Script para crear usuario admin
 * Ejecutar desde la carpeta backend: node ../create-admin.js
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  console.log('\n🔧 Creando usuario admin...');

  try {
    // Verificar si ya existe
    const existing = await prisma.user.findUnique({
      where: { username: 'admin' }
    });

    if (existing) {
      console.log('⚠️  El usuario admin ya existe.');
      console.log('   Username: admin');
      console.log('   ID:', existing.id);
      return;
    }

    // Crear hash de contraseña
    const passwordHash = await bcrypt.hash('admin123', 10);

    // Crear usuario admin
    const admin = await prisma.user.create({
      data: {
        username: 'admin',
        password: passwordHash,
        role: 'admin'
      }
    });

    console.log('\n✅ Usuario admin creado exitosamente!');
    console.log('   Username: admin');
    console.log('   Password: admin123');
    console.log('   ID:', admin.id);
    console.log('\n🎉 Ya puedes iniciar sesión en el panel de admin!\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
