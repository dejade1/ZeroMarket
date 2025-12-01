import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    const username = 'admin';
    const password = 'admin123'; // Contraseña temporal
    const email = 'admin@example.com';

    console.log(`⏳ Creando usuario administrador: ${username}...`);

    // 1. Verificar si ya existe
    const existingUser = await prisma.user.findUnique({
        where: { username }
    });

    if (existingUser) {
        console.log('⚠️ El usuario admin ya existe.');
        return;
    }

    // 2. Hash de la contraseña
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // 3. Crear usuario
    const user = await prisma.user.create({
        data: {
            username,
            email,
            passwordHash,
            isAdmin: true,
        },
    });

    console.log('✅ Usuario administrador creado exitosamente:');
    console.log(`   User: ${user.username}`);
    console.log(`   Pass: ${password}`);
    console.log('🚀 Ya puedes iniciar sesión en el panel.');
}

main()
    .catch((e) => {
        console.error('❌ Error al crear usuario:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
