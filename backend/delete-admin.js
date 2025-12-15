require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function deleteAdmin() {
  try {
    // Mostrar usuarios antes
    console.log('📋 Usuarios actuales:');
    const before = await prisma.user.findMany({
      select: { id: true, username: true, email: true, role: true }
    });
    console.table(before);

    // Preguntar cuál eliminar
    const usernameToDelete = 'admin'; // CAMBIA ESTO al que quieras eliminar
    
    const result = await prisma.user.delete({
      where: { username: usernameToDelete }
    });

    console.log(`\n✅ Usuario "${result.username}" eliminado exitosamente`);

    // Mostrar usuarios después
    console.log('\n📋 Usuarios restantes:');
    const after = await prisma.user.findMany({
      select: { id: true, username: true, email: true, role: true }
    });
    console.table(after);

  } catch (error) {
    if (error.code === 'P2025') {
      console.error('❌ Usuario no encontrado');
    } else {
      console.error('❌ Error:', error.message);
    }
  } finally {
    await prisma.$disconnect();
  }
}

deleteAdmin();
