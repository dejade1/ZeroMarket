# Cómo registrar las rutas de Settings en el servidor

Sigue estos pasos para habilitar el endpoint de configuración ESP32:

## Paso 1: Encuentra el archivo principal del servidor

Busca uno de estos archivos en la carpeta `server/`:
- `server.js`
- `index.js`
- `app.js`
- `main.js`

## Paso 2: Importa las rutas de settings

Agrega al inicio del archivo (junto a las otras importaciones):

```javascript
import settingsRoutes from './routes/settings.routes.js';
```

## Paso 3: Registra las rutas

Busca donde están las otras rutas (ejemplo: `app.use('/api/orders', ...)`)

Y agrega:

```javascript
app.use('/api/settings', settingsRoutes);
```

## Paso 4: Inicializar configuraciones por defecto

Después de crear la conexión de Prisma, agrega:

```javascript
import { initializeSettings } from './api/settings.js';

// Después de conectar con la base de datos:
await initializeSettings();
```

## Ejemplo completo:

```javascript
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';

// Importar rutas
import ordersRoutes from './routes/orders.routes.js';
import productsRoutes from './routes/products.routes.js';
import settingsRoutes from './routes/settings.routes.js'; // ✅ NUEVO
import { initializeSettings } from './api/settings.js'; // ✅ NUEVO

const app = express();
const prisma = new PrismaClient();

// Middleware
app.use(cors({ credentials: true, origin: 'http://localhost:5173' }));
app.use(express.json());

// Rutas
app.use('/api/orders', ordersRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/settings', settingsRoutes); // ✅ NUEVO

// Iniciar servidor
const PORT = 3000;
app.listen(PORT, async () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  
  // ✅ Inicializar configuraciones por defecto
  await initializeSettings();
  console.log('✅ Configuraciones inicializadas');
});
```

## Verificar que funciona

1. Reinicia el servidor: `npm run dev`
2. Verifica en consola: `[✅ SETTINGS] Configuraciones por defecto inicializadas`
3. Prueba el endpoint: `http://localhost:3000/api/settings`

## Si tienes dudas

Comparte el contenido de tu archivo principal del servidor para ayudarte a agregarlo.
