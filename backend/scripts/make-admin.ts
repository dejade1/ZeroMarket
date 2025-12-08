/**
 * Script para convertir un usuario existente en administrador
 *
 * Uso: npx ts-node scripts/make-admin.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function makeUserAdmin() {
    try {
        console.log('🔄 Buscando usuario "cliente1"...\n');

        // Buscar el usuario
        const user = await prisma.user.findUnique({
            where: { username: 'cliente1' },
        });

        if (!user) {
            console.log('❌ El usuario "cliente1" no existe.');
            console.log('   Ejecuta primero: npx ts-node scripts/create-admin.ts\n');
            return;
        }

        console.log('👤 Usuario encontrado:');
        console.log(`   ID: ${user.id}`);
        console.log(`   Usuario: ${user.username}`);
        console.log(`   Email: ${user.email}`);
        console.log(`   Admin: ${user.isAdmin ? 'Sí' : 'No'}`);

        if (user.isAdmin) {
            console.log('\n✅ El usuario ya es administrador. No es necesario actualizar.\n');
            return;
        }

        // Actualizar el usuario para darle permisos de administrador
        console.log('\n🔄 Actualizando permisos a administrador...');
        const updatedUser = await prisma.user.update({
            where: { id: user.id },
            data: { isAdmin: true },
        });

        console.log('\n✅ Usuario actualizado exitosamente!\n');
        console.log('📋 Detalles actualizados:');
        console.log(`   ID: ${updatedUser.id}`);
        console.log(`   Usuario: ${updatedUser.username}`);
        console.log(`   Email: ${updatedUser.email}`);
        console.log(`   Admin: ${updatedUser.isAdmin ? 'Sí ✅' : 'No'}`);
        console.log(`   Actualizado: ${new Date().toLocaleString()}`);
        console.log('\n');

    } catch (error) {
        console.error('❌ Error al actualizar el usuario:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

// Ejecutar el script
makeUserAdmin()
    .then(() => {
        console.log('✅ Script completado exitosamente');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Error fatal:', error);
        process.exit(1);
    });
