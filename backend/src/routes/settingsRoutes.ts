import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = Router();

// Archivo donde se guardarán los settings
const SETTINGS_FILE = path.join(__dirname, '../../data/settings.json');

// Asegurar que el directorio data existe
async function ensureDataDir() {
  const dataDir = path.join(__dirname, '../../data');
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
}

/**
 * GET /api/admin/settings
 * Obtener configuración
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    await ensureDataDir();

    try {
      const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
      const settings = JSON.parse(data);

      res.json({
        success: true,
        settings
      });
    } catch (error) {
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
    console.error('Error loading settings:', error);
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
  try {
    await ensureDataDir();

    const settings = req.body;

    // Guardar en archivo JSON
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');

    console.log('✅ Settings guardados correctamente:', settings);

    res.json({
      success: true,
      message: 'Configuración guardada correctamente'
    });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({
      success: false,
      message: 'Error al guardar configuración'
    });
  }
});

export default router;
