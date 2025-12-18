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

// Configuración por defecto
const DEFAULT_SETTINGS = {
  lowStockAlert: true,
  expiryAlert: true,
  alertThreshold: 2,
  adminEmails: [],
  autoReportTime: '09:00',
  autoReportEnabled: false,
  esp32Enabled: false,
  esp32IpAddress: '192.168.0.106',
  esp32Port: 80,
  // ✅ Nuevas configuraciones individuales
  esp32_ip: '192.168.0.106',
  esp32_timeout: '30000',
  esp32_enabled: 'true'
};

/**
 * Cargar settings desde archivo
 */
async function loadSettings(): Promise<any> {
  await ensureDataDir();
  
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.log('⚠️  Settings file not found, using defaults');
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Guardar settings en archivo
 */
async function saveSettings(settings: any): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

/**
 * GET /api/admin/settings
 * Obtener TODA la configuración
 */
router.get('/', async (req: Request, res: Response) => {
  console.log('🔍 GET /api/admin/settings - Loading settings...');
  try {
    const settings = await loadSettings();
    console.log('✅ Settings loaded from file:', settings);

    res.json({
      success: true,
      settings
    });
  } catch (error) {
    console.error('❌ Error loading settings:', error);
    res.status(500).json({
      success: false,
      message: 'Error al cargar configuración'
    });
  }
});

/**
 * ✅ NUEVO: GET /api/admin/settings/:key
 * Obtener una configuración específica por key
 */
router.get('/:key', async (req: Request, res: Response) => {
  const { key } = req.params;
  console.log(`🔍 GET /api/admin/settings/${key}`);
  
  try {
    const settings = await loadSettings();
    
    if (key in settings) {
      res.json({
        success: true,
        setting: {
          key,
          value: settings[key],
          description: `Configuración de ${key}`
        }
      });
    } else {
      // Si no existe, devolver valor por defecto
      const defaultValue = (DEFAULT_SETTINGS as any)[key] || '';
      res.json({
        success: true,
        setting: {
          key,
          value: defaultValue,
          description: `Configuración de ${key}`
        }
      });
    }
  } catch (error) {
    console.error(`❌ Error loading setting ${key}:`, error);
    res.status(500).json({
      success: false,
      message: `Error al cargar configuración ${key}`
    });
  }
});

/**
 * POST /api/admin/settings
 * Guardar TODA la configuración
 */
router.post('/', async (req: Request, res: Response) => {
  console.log('💾 POST /api/admin/settings - Saving settings...');
  console.log('📦 Received settings:', JSON.stringify(req.body, null, 2));
  
  try {
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
    await saveSettings(settings);
    console.log('✅ Settings saved successfully to:', SETTINGS_FILE);

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

/**
 * ✅ NUEVO: PUT /api/admin/settings/:key
 * Actualizar o crear una configuración específica
 */
router.put('/:key', async (req: Request, res: Response) => {
  const { key } = req.params;
  const { value, description } = req.body;
  
  console.log(`💾 PUT /api/admin/settings/${key}`);
  console.log(`📦 Value: ${value}`);
  
  try {
    if (!value) {
      return res.status(400).json({
        success: false,
        message: 'El valor es requerido'
      });
    }

    // Cargar settings actuales
    const settings = await loadSettings();
    
    // Actualizar el valor
    settings[key] = value;
    
    // Guardar
    await saveSettings(settings);
    
    console.log(`✅ Setting ${key} actualizado a: ${value}`);
    
    res.json({
      success: true,
      setting: {
        key,
        value,
        description: description || `Configuración de ${key}`
      }
    });
  } catch (error) {
    console.error(`❌ Error updating setting ${key}:`, error);
    res.status(500).json({
      success: false,
      message: `Error al actualizar configuración ${key}`
    });
  }
});

export default router;
