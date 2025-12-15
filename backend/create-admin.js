require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function createAdmin() {
  try {
    console.log('🔧 Creando usuario administrador...');

    // Datos del admin
    const username = 'admin';
    const email = 'admin@ecommerce.com';
    const password = 'Admin123!'; // Cambia esto después del primer login
    
    // Hash de contraseña
    const passwordHash = await bcrypt.hash(password, 12);

    // Verificar si ya existe
    const existing = await prisma.user.findUnique({
      where: { username }
    });

    if (existing) {
      console.log('⚠️  Usuario admin ya existe. Actualizando a ADMIN...');
      
      const admin = await prisma.user.update({
        where: { username },
        data: {
          role: 'ADMIN',
          passwordHash,
          email
        }
      });

      console.log('✅ Usuario actualizado a administrador:');
      console.log('   Usuario:', admin.username);
      console.log('   Email:', admin.email);
      console.log('   Role:', admin.role);
      console.log('   Contraseña: Admin123!');
      console.log('   ⚠️  IMPORTANTE: Cambia esta contraseña después del primer login');
      return;
    }

    // Crear nuevo admin
    const admin = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        role: 'ADMIN',
        loyaltyPoints: 0
      }
    });

    console.log('✅ Administrador creado exitosamente:');
    console.log('   ID:', admin.id);
    console.log('   Usuario:', admin.username);
    console.log('   Email:', admin.email);
    console.log('   Role:', admin.role);
    console.log('   Contraseña: Admin123!');
    console.log('   ⚠️  IMPORTANTE: Cambia esta contraseña después del primer login');

  } catch (error) {
    console.error('❌ Error al crear/actualizar administrador:', error.message);
    console.error('Detalles:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createAdmin();
