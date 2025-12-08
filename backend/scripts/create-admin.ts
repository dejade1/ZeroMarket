/**
 * Script para crear el usuario administrador por defecto
 *
 * Usuario: cliente1
 * Contraseña: admin123
 * Email: cliente1@admin.com
 * Rol: Administrador
 *
 * Uso: npx ts-node scripts/create-admin.ts
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const SALT_ROUNDS = 12;

async function createDefaultAdmin() {
    try {
        console.log('🔄 Iniciando creación del administrador por defecto...\n');

        // Verificar si el usuario ya existe
        const existingUser = await prisma.user.findUnique({
            where: { username: 'cliente1' },
        });

        if (existingUser) {
            console.log('⚠️  El usuario "cliente1" ya existe.');
            console.log(`   ID: ${existingUser.id}`);
            console.log(`   Email: ${existingUser.email}`);
            console.log(`   Admin: ${existingUser.isAdmin ? 'Sí' : 'No'}`);
            console.log(`   Creado: ${existingUser.createdAt.toLocaleString()}`);
            console.log('\n✅ No es necesario crear el usuario.\n');
            return;
        }

        // Hash de la contraseña
        console.log('🔐 Generando hash de contraseña...');
        const passwordHash = await bcrypt.hash('admin123', SALT_ROUNDS);

        // Crear el usuario
        console.log('👤 Creando usuario administrador...');
        const user = await prisma.user.create({
            data: {
                username: 'cliente1',
                email: 'cliente1@admin.com',
                passwordHash: passwordHash,
                isAdmin: true,
            },
        });

        console.log('\n✅ Usuario administrador creado exitosamente!\n');
        console.log('📋 Detalles del usuario:');
        console.log(`   ID: ${user.id}`);
        console.log(`   Usuario: ${user.username}`);
        console.log(`   Email: ${user.email}`);
        console.log(`   Admin: ${user.isAdmin ? 'Sí' : 'No'}`);
        console.log(`   Creado: ${user.createdAt.toLocaleString()}`);
        console.log('\n🔑 Credenciales de acceso:');
        console.log('   Usuario: cliente1');
        console.log('   Contraseña: admin123');
        console.log('\n⚠️  IMPORTANTE: Cambia la contraseña después del primer login!\n');

    } catch (error) {
        console.error('❌ Error al crear el usuario administrador:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

// Ejecutar el script
createDefaultAdmin()
    .then(() => {
        console.log('✅ Script completado exitosamente');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Error fatal:', error);
        process.exit(1);
    });
