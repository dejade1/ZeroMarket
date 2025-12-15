/**
 * REPORT SCHEDULER
 * 
 * Servicio para enviar reportes automáticamente según configuración
 * Revisa cada minuto si es hora de enviar el reporte diario
 */

import cron from 'node-cron';
import fs from 'fs/promises';
import path from 'path';
import { generateCompleteReportCSV } from './csvService';
import { sendCSVReport } from './emailService';

const SETTINGS_FILE = path.join(__dirname, '../../data/settings.json');

interface Settings {
  autoReportEnabled: boolean;
  autoReportTime: string;
  adminEmails: string[];
}

let lastSentDate: string | null = null;

/**
 * Carga la configuración desde el archivo
 */
async function loadSettings(): Promise<Settings | null> {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}

/**
 * Verifica si es hora de enviar el reporte
 */
async function checkAndSendReport() {
  try {
    const settings = await loadSettings();

    if (!settings || !settings.autoReportEnabled) {
      return;
    }

    if (!settings.adminEmails || settings.adminEmails.length === 0) {
      return;
    }

    // Obtener hora actual
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const currentDate = now.toISOString().split('T')[0];

    // Verificar si es la hora configurada y no se ha enviado hoy
    if (currentTime === settings.autoReportTime && lastSentDate !== currentDate) {
      console.log(`🔔 [SCHEDULER] Es hora de enviar reporte automático: ${currentTime}`);
      console.log(`📧 [SCHEDULER] Enviando a: ${settings.adminEmails.join(', ')}`);

      // Generar y enviar reporte
      const csv = await generateCompleteReportCSV();
      const result = await sendCSVReport(
        csv,
        'complete',
        'reporte_completo_automatico',
        settings.adminEmails
      );

      if (result.success) {
        lastSentDate = currentDate;
        console.log(`✅ [SCHEDULER] Reporte enviado exitosamente a ${result.sent}/${result.total} destinatarios`);
      } else {
        console.error(`❌ [SCHEDULER] Error al enviar reporte: ${result.message}`);
      }
    }
  } catch (error) {
    console.error('❌ [SCHEDULER] Error checking scheduled report:', error);
  }
}

/**
 * Inicia el scheduler
 * Ejecuta cada minuto para verificar si es hora de enviar
 */
export function startReportScheduler() {
  console.log('🔔 [SCHEDULER] Report scheduler iniciado');
  console.log('🕒 [SCHEDULER] Verificando cada minuto si hay reportes programados...');

  // Ejecutar cada minuto
  cron.schedule('* * * * *', async () => {
    await checkAndSendReport();
  });

  console.log('✅ [SCHEDULER] Cron job registrado exitosamente');
}

/**
 * Detiene el scheduler (para testing o shutdown graceful)
 */
export function stopReportScheduler() {
  console.log('🛑 [SCHEDULER] Report scheduler detenido');
  cron.getTasks().forEach(task => task.stop());
}
