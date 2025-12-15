import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = Router();

// Archivo donde se guardarán los settings
const SETTINGS_FILE = path.join(__dirname, '../../data/settings.json');

console.log('⚙️  Settings routes loaded');
console.log('📂 Settings file path:', SETTINGS_FILE);

// Asegurar que el directorio data existe
async function ensureDataDir() {
  const dataDir = path.join(__dirname, '../../data');
  try {
    await fs.access(dataDir);
    console.log('✅ Data directory exists:', dataDir);
  } catch {
    console.log('📁 Creating data directory:', dataDir);
    await fs.mkdir(dataDir, { recursive: true });
  }
}

/**
 * GET /api/admin/settings
 * Obtener configuración
 */
router.get('/', async (req: Request, res: Response) => {
  console.log('🔍 GET /api/admin/settings - Loading settings...');
  try {
    await ensureDataDir();

    try {
      const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
      const settings = JSON.parse(data);
      console.log('✅ Settings loaded from file:', settings);

      res.json({
        success: true,
        settings
      });
    } catch (error) {
      console.log('⚠️  Settings file not found, returning defaults');
      // Si no existe el archivo, devolver settings por defecto
      const defaultSettings = {
        lowStockAlert: true,
        expiryAlert: true,
        alertThreshold: 2,
        adminEmails: [],
        autoReportTime: '09:00',
        autoReportEnabled: false,
        esp32Enabled: false,
        esp32IpAddress: '',
        esp32Port: 80
      };

      res.json({
        success: true,
        settings: defaultSettings
      });
    }
  } catch (error) {
    console.error('❌ Error loading settings:', error);
    res.status(500).json({
      success: false,
      message: 'Error al cargar configuración'
    });
  }
});

/**
 * POST /api/admin/settings
 * Guardar configuración
 */
router.post('/', async (req: Request, res: Response) => {
  console.log('💾 POST /api/admin/settings - Saving settings...');
  console.log('📦 Received settings:', JSON.stringify(req.body, null, 2));
  
  try {
    await ensureDataDir();

    const settings = req.body;

    // Validar que settings tenga la estructura correcta
    if (!settings || typeof settings !== 'object') {
      console.error('❌ Invalid settings format');
      return res.status(400).json({
        success: false,
        message: 'Formato de configuración inválido'
      });
    }

    // Guardar en archivo JSON
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
    console.log('✅ Settings saved successfully to:', SETTINGS_FILE);
    console.log('✅ Saved data:', JSON.stringify(settings, null, 2));

    // Verificar que se guardó correctamente
    const verifyData = await fs.readFile(SETTINGS_FILE, 'utf-8');
    const verifySettings = JSON.parse(verifyData);
    console.log('✅ Verification - File now contains:', verifySettings);

    res.json({
      success: true,
      message: 'Configuración guardada correctamente'
    });
  } catch (error) {
    console.error('❌ Error saving settings:', error);
    res.status(500).json({
      success: false,
      message: 'Error al guardar configuración'
    });
  }
});

export default router;
