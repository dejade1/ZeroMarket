/**
 * EMAIL SERVICE
 *
 * Servicio para envío de emails usando nodemailer
 * Soporta notificaciones de stock bajo y reportes CSV
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

// Configuración SMTP desde variables de entorno
const SMTP_CONFIG = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASSWORD || '',
  },
};

const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@yourstore.com';
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'Your Store Admin';

// Transporter de nodemailer (singleton)
let transporter: Transporter;

/**
 * Inicializa el transporter de nodemailer
 */
function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport(SMTP_CONFIG);
  }
  return transporter;
}

/**
 * Verifica la conexión SMTP
 */
export async function verifyEmailConnection(): Promise<boolean> {
  try {
    const transport = getTransporter();
    await transport.verify();
    console.log('✅ SMTP connection verified successfully');
    return true;
  } catch (error) {
    console.error('❌ SMTP connection failed:', error);
    return false;
  }
}

/**
 * Envía un email de prueba
 */
export async function sendTestEmail(recipientEmail: string): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const transport = getTransporter();

    const mailOptions = {
      from: `"${EMAIL_FROM_NAME}" <${EMAIL_FROM}>`,
      to: recipientEmail,
      subject: 'Prueba de Conexión - Sistema de Notificaciones',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
              border: 1px solid #ddd;
              border-radius: 8px;
            }
            .header {
              background-color: #F59E0B;
              color: white;
              padding: 20px;
              text-align: center;
              border-radius: 8px 8px 0 0;
            }
            .content {
              padding: 20px;
              background-color: #f9f9f9;
            }
            .footer {
              text-align: center;
              padding: 10px;
              font-size: 12px;
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>✅ Configuración de Email Exitosa</h2>
            </div>
            <div class="content">
              <p>Hola,</p>
              <p>Este es un email de prueba para confirmar que tu configuración SMTP está funcionando correctamente.</p>
              <p><strong>Funcionalidades habilitadas:</strong></p>
              <ul>
                <li>Notificaciones de stock bajo</li>
                <li>Reportes CSV automatizados</li>
                <li>Alertas de productos</li>
              </ul>
              <p>Si recibes este mensaje, significa que el sistema está listo para enviar notificaciones.</p>
            </div>
            <div class="footer">
              <p>Este es un mensaje automático del sistema de administración.</p>
              <p>Fecha: ${new Date().toLocaleString('es-ES')}</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: 'Este es un email de prueba. Si lo recibes, tu configuración SMTP está funcionando correctamente.',
    };

    const info = await transport.sendMail(mailOptions);
    console.log('✅ Test email sent:', info.messageId);

    return {
      success: true,
      message: `Email de prueba enviado exitosamente a ${recipientEmail}`,
    };
  } catch (error) {
    console.error('❌ Error sending test email:', error);
    return {
      success: false,
      message: `Error al enviar email: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Interfaz para productos con stock bajo
 */
export interface LowStockProduct {
  id: number;
  title: string;
  stock: number;
  category?: string;
  price?: number;
}

/**
 * Envía alerta de stock bajo
 */
export async function sendLowStockAlert(
  products: LowStockProduct[],
  recipientEmails: string[]
): Promise<{ success: boolean; message: string }> {
  try {
    if (products.length === 0) {
      return { success: false, message: 'No hay productos con stock bajo' };
    }

    const transport = getTransporter();

    const productRows = products
      .map(
        (p) => `
        <tr>
          <td style="padding: 10px; border: 1px solid #ddd;">${p.title}</td>
          <td style="padding: 10px; border: 1px solid #ddd; text-align: center; color: ${
            p.stock === 0 ? '#EF4444' : '#F59E0B'
          }; font-weight: bold;">
            ${p.stock} ${p.stock === 0 ? '⚠️' : ''}
          </td>
          <td style="padding: 10px; border: 1px solid #ddd;">${p.category || 'N/A'}</td>
          <td style="padding: 10px; border: 1px solid #ddd;">$${p.price?.toFixed(2) || 'N/A'}</td>
        </tr>
      `
      )
      .join('');

    const mailOptions = {
      from: `"${EMAIL_FROM_NAME}" <${EMAIL_FROM}>`,
      to: recipientEmails.join(', '),
      subject: `⚠️ Alerta de Stock Bajo - ${products.length} producto(s) requieren atención`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
            }
            .container {
              max-width: 700px;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              background-color: #EF4444;
              color: white;
              padding: 20px;
              text-align: center;
              border-radius: 8px 8px 0 0;
            }
            .content {
              padding: 20px;
              background-color: #FEF3C7;
              border: 2px solid #F59E0B;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin: 20px 0;
              background-color: white;
            }
            th {
              background-color: #F59E0B;
              color: white;
              padding: 12px;
              text-align: left;
              border: 1px solid #ddd;
            }
            .footer {
              text-align: center;
              padding: 15px;
              font-size: 12px;
              color: #666;
              background-color: #f9f9f9;
              border-radius: 0 0 8px 8px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>⚠️ ALERTA DE STOCK BAJO</h2>
            </div>
            <div class="content">
              <p><strong>Atención Administrador,</strong></p>
              <p>Los siguientes productos tienen stock bajo o agotado y requieren reabastecimiento inmediato:</p>

              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th style="text-align: center;">Stock Actual</th>
                    <th>Categoría</th>
                    <th>Precio</th>
                  </tr>
                </thead>
                <tbody>
                  ${productRows}
                </tbody>
              </table>

              <p><strong>Total de productos afectados:</strong> ${products.length}</p>
              <p style="color: #EF4444;"><strong>Acción requerida:</strong> Realizar pedido de reabastecimiento lo antes posible.</p>
            </div>
            <div class="footer">
              <p>Este es un mensaje automático del sistema de gestión de inventario.</p>
              <p>Fecha: ${new Date().toLocaleString('es-ES')}</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    const info = await transport.sendMail(mailOptions);
    console.log(`✅ Low stock alert sent to ${recipientEmails.length} recipient(s):`, info.messageId);

    return {
      success: true,
      message: `Alerta enviada a ${recipientEmails.length} destinatario(s)`,
    };
  } catch (error) {
    console.error('❌ Error sending low stock alert:', error);
    return {
      success: false,
      message: `Error al enviar alerta: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Envía un reporte CSV por email
 */
export async function sendCSVReport(
  csvContent: string,
  reportType: string,
  reportName: string,
  recipientEmails: string[]
): Promise<{ success: boolean; message: string }> {
  try {
    const transport = getTransporter();

    const reportTitles: { [key: string]: string } = {
      'most-sold': 'Productos Más Vendidos',
      'negative-diff': 'Productos con Diferencias Negativas',
      'adjustments': 'Historial de Ajustes de Stock',
    };

    const title = reportTitles[reportType] || reportName;

    const mailOptions = {
      from: `"${EMAIL_FROM_NAME}" <${EMAIL_FROM}>`,
      to: recipientEmails.join(', '),
      subject: `📊 Reporte: ${title}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              background-color: #3B82F6;
              color: white;
              padding: 20px;
              text-align: center;
              border-radius: 8px 8px 0 0;
            }
            .content {
              padding: 20px;
              background-color: #EFF6FF;
              border: 2px solid #3B82F6;
            }
            .footer {
              text-align: center;
              padding: 15px;
              font-size: 12px;
              color: #666;
              background-color: #f9f9f9;
              border-radius: 0 0 8px 8px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>📊 ${title}</h2>
            </div>
            <div class="content">
              <p>Estimado Administrador,</p>
              <p>Adjunto encontrarás el reporte solicitado en formato CSV.</p>
              <p><strong>Tipo de reporte:</strong> ${title}</p>
              <p><strong>Fecha de generación:</strong> ${new Date().toLocaleString('es-ES')}</p>
              <p>Puedes abrir este archivo con Excel, Google Sheets u otro software de hojas de cálculo.</p>
            </div>
            <div class="footer">
              <p>Este es un reporte automático del sistema de gestión.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      attachments: [
        {
          filename: `${reportName}_${new Date().toISOString().split('T')[0]}.csv`,
          content: csvContent,
          contentType: 'text/csv',
        },
      ],
    };

    const info = await transport.sendMail(mailOptions);
    console.log(`✅ CSV report sent to ${recipientEmails.length} recipient(s):`, info.messageId);

    return {
      success: true,
      message: `Reporte enviado exitosamente a ${recipientEmails.length} destinatario(s)`,
    };
  } catch (error) {
    console.error('❌ Error sending CSV report:', error);
    return {
      success: false,
      message: `Error al enviar reporte: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export default {
  verifyEmailConnection,
  sendTestEmail,
  sendLowStockAlert,
  sendCSVReport,
};
