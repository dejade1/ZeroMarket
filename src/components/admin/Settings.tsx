/**
 * COMPONENTE: Settings
 *
 * Panel de configuración del sistema
 *
 * CARACTERÍSTICAS:
 * ✅ Configuración general de la aplicación
 * ✅ Ajustes de notificaciones
 * ✅ Configuración de hardware (ESP32/Arduino)
 * ✅ Preferencias de usuario
 * ✅ Gestión de seguridad
 */

import React, { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon,
  Bell,
  Wifi,
  Shield,
  Database,
  Save,
  AlertTriangle,
  Mail,
  Send,
  FileText,
  CheckCircle,
  XCircle
} from 'lucide-react';
import { formatExpiryDate, isExpiryDateSoon } from '../../lib/batchCodeGenerator';

interface AppSettings {
  // Generales
  storeName: string;
  currency: string;
  timezone: string;

  // Notificaciones
  emailNotifications: boolean;
  lowStockAlert: boolean;
  expiryAlert: boolean;
  alertThreshold: number;
  adminEmails: string[];

  // Hardware
  esp32Enabled: boolean;
  arduinoPort: string;
  ledDuration: number;

  // Seguridad
  sessionTimeout: number;
  requireStrongPassword: boolean;
  twoFactorAuth: boolean;
}

export function Settings() {
  const [settings, setSettings] = useState<AppSettings>({
    storeName: 'Mi Tienda E-commerce',
    currency: 'USD',
    timezone: 'America/Mexico_City',
    emailNotifications: true,
    lowStockAlert: true,
    expiryAlert: true,
    alertThreshold: 2,
    adminEmails: [],
    esp32Enabled: false,
    arduinoPort: 'COM3',
    ledDuration: 3000,
    sessionTimeout: 30,
    requireStrongPassword: true,
    twoFactorAuth: false
  });

  const [activeSection, setActiveSection] = useState<'general' | 'notifications' | 'hardware' | 'security'>('general');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Email configuration states
  const [newEmail, setNewEmail] = useState('');
  const [emailStatus, setEmailStatus] = useState<{
    type: 'success' | 'error' | null;
    message: string;
  }>({ type: null, message: '' });
  const [sendingTest, setSendingTest] = useState(false);
  const [sendingReport, setSendingReport] = useState<string | null>(null);

  useEffect(() => {
    // Cargar configuración guardada
    const savedSettings = localStorage.getItem('app_settings');
    if (savedSettings) {
      setSettings(JSON.parse(savedSettings));
    }
  }, []);

  /**
   * Guarda la configuración
   */
  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      // Guardar en localStorage
      localStorage.setItem('app_settings', JSON.stringify(settings));

      // Simular guardado en backend
      await new Promise(resolve => setTimeout(resolve, 1000));

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Error al guardar la configuración');
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Actualiza un valor de configuración
   */
  const updateSetting = (key: keyof AppSettings, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  /**
   * Agrega un nuevo email a la lista de administradores
   */
  const handleAddEmail = () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!newEmail.trim()) {
      setEmailStatus({ type: 'error', message: 'Por favor ingrese un email' });
      return;
    }

    if (!emailRegex.test(newEmail)) {
      setEmailStatus({ type: 'error', message: 'Email inválido' });
      return;
    }

    if (settings.adminEmails.includes(newEmail)) {
      setEmailStatus({ type: 'error', message: 'Este email ya está agregado' });
      return;
    }

    setSettings(prev => ({
      ...prev,
      adminEmails: [...prev.adminEmails, newEmail]
    }));
    setNewEmail('');
    setEmailStatus({ type: 'success', message: 'Email agregado correctamente' });
    setTimeout(() => setEmailStatus({ type: null, message: '' }), 3000);
  };

  /**
   * Elimina un email de la lista
   */
  const handleRemoveEmail = (email: string) => {
    setSettings(prev => ({
      ...prev,
      adminEmails: prev.adminEmails.filter(e => e !== email)
    }));
  };

  /**
   * Envía un email de prueba
   */
  const handleSendTestEmail = async () => {
    if (settings.adminEmails.length === 0) {
      setEmailStatus({ type: 'error', message: 'Agregue al menos un email primero' });
      return;
    }

    setSendingTest(true);
    setEmailStatus({ type: null, message: '' });

    try {
      const response = await fetch('http://localhost:3000/api/admin/email/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include', // Envía cookies automáticamente
        body: JSON.stringify({
          email: settings.adminEmails[0]
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setEmailStatus({ type: 'success', message: `Email de prueba enviado a ${settings.adminEmails[0]}` });
      } else {
        setEmailStatus({ type: 'error', message: data.message || 'Error al enviar email' });
      }
    } catch (error) {
      setEmailStatus({ type: 'error', message: 'Error de conexión con el servidor' });
    } finally {
      setSendingTest(false);
      setTimeout(() => setEmailStatus({ type: null, message: '' }), 5000);
    }
  };

  /**
   * Envía un reporte CSV por email
   */
  const handleSendCSVReport = async (reportType: 'most-sold' | 'negative-diff' | 'adjustments') => {
    if (settings.adminEmails.length === 0) {
      setEmailStatus({ type: 'error', message: 'Agregue al menos un email primero' });
      return;
    }

    setSendingReport(reportType);
    setEmailStatus({ type: null, message: '' });

    try {
      const response = await fetch(`http://localhost:3000/api/admin/reports/${reportType}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include', // Envía cookies automáticamente
        body: JSON.stringify({
          emails: settings.adminEmails
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setEmailStatus({ type: 'success', message: `Reporte enviado a ${settings.adminEmails.length} email(s)` });
      } else {
        setEmailStatus({ type: 'error', message: data.message || 'Error al enviar reporte' });
      }
    } catch (error) {
      setEmailStatus({ type: 'error', message: 'Error de conexión con el servidor' });
    } finally {
      setSendingReport(null);
      setTimeout(() => setEmailStatus({ type: null, message: '' }), 5000);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <SettingsIcon size={28} />
          Configuración
        </h2>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className={`flex items-center gap-2 px-6 py-2 rounded-lg transition-colors ${
            saveSuccess
              ? 'bg-green-600 text-white'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          } disabled:bg-gray-400 disabled:cursor-not-allowed`}
        >
          <Save size={20} />
          {isSaving ? 'Guardando...' : saveSuccess ? '¡Guardado!' : 'Guardar Cambios'}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-6">
        {/* Menú lateral */}
        <div className="col-span-1 space-y-2">
          <button
            onClick={() => setActiveSection('general')}
            className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
              activeSection === 'general'
                ? 'bg-blue-100 text-blue-700 font-semibold'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <SettingsIcon size={18} className="inline mr-2" />
            General
          </button>
          <button
            onClick={() => setActiveSection('notifications')}
            className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
              activeSection === 'notifications'
                ? 'bg-blue-100 text-blue-700 font-semibold'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <Bell size={18} className="inline mr-2" />
            Notificaciones
          </button>
          <button
            onClick={() => setActiveSection('hardware')}
            className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
              activeSection === 'hardware'
                ? 'bg-blue-100 text-blue-700 font-semibold'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <Wifi size={18} className="inline mr-2" />
            Hardware
          </button>
          <button
            onClick={() => setActiveSection('security')}
            className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
              activeSection === 'security'
                ? 'bg-blue-100 text-blue-700 font-semibold'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <Shield size={18} className="inline mr-2" />
            Seguridad
          </button>
        </div>

        {/* Contenido de configuración */}
        <div className="col-span-3 bg-white rounded-lg shadow p-6">
          {/* Configuración General */}
          {activeSection === 'general' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Configuración General</h3>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nombre de la Tienda
                </label>
                <input
                  type="text"
                  value={settings.storeName}
                  onChange={(e) => updateSetting('storeName', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Moneda
                </label>
                <select
                  value={settings.currency}
                  onChange={(e) => updateSetting('currency', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="USD">USD - Dólar Americano</option>
                  <option value="MXN">MXN - Peso Mexicano</option>
                  <option value="EUR">EUR - Euro</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Zona Horaria
                </label>
                <select
                  value={settings.timezone}
                  onChange={(e) => updateSetting('timezone', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="America/Mexico_City">Ciudad de México</option>
                  <option value="America/New_York">Nueva York</option>
                  <option value="Europe/Madrid">Madrid</option>
                </select>
              </div>
            </div>
          )}

          {/* Configuración de Notificaciones */}
          {activeSection === 'notifications' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Notificaciones</h3>

              {/* Status message */}
              {emailStatus.type && (
                <div className={`p-3 rounded-lg flex items-center gap-2 ${
                  emailStatus.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  {emailStatus.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
                  <span className="text-sm">{emailStatus.message}</span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Notificaciones por Email</p>
                  <p className="text-sm text-gray-500">Recibir alertas por correo electrónico</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.emailNotifications}
                    onChange={(e) => updateSetting('emailNotifications', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Alerta de Stock Bajo</p>
                  <p className="text-sm text-gray-500">Notificar cuando el stock sea bajo</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.lowStockAlert}
                    onChange={(e) => updateSetting('lowStockAlert', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Alerta de Caducidad</p>
                  <p className="text-sm text-gray-500">Notificar productos próximos a caducar</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.expiryAlert}
                    onChange={(e) => updateSetting('expiryAlert', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Umbral de Stock Bajo
                </label>
                <input
                  type="number"
                  value={settings.alertThreshold}
                  onChange={(e) => updateSetting('alertThreshold', parseInt(e.target.value))}
                  min="1"
                  max="100"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-sm text-gray-500">
                  Se enviará alerta cuando el stock sea menor o igual a este número
                </p>
              </div>

              {/* Separator */}
              <hr className="my-6 border-gray-200" />

              {/* Email Configuration Section */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <Mail className="text-blue-600" size={20} />
                  <h4 className="text-md font-semibold text-gray-900">
                    Emails de Administradores
                  </h4>
                </div>
                <p className="text-sm text-gray-500">
                  Los emails configurados recibirán notificaciones cuando el stock llegue a {settings.alertThreshold} artículos y reportes CSV.
                </p>

                {/* Add email input */}
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAddEmail()}
                    placeholder="admin@ejemplo.com"
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={handleAddEmail}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                  >
                    <Mail size={18} />
                    Agregar
                  </button>
                </div>

                {/* List of emails */}
                {settings.adminEmails.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-700">
                      Emails configurados ({settings.adminEmails.length}):
                    </p>
                    <div className="space-y-2">
                      {settings.adminEmails.map((email, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                        >
                          <div className="flex items-center gap-2">
                            <Mail size={16} className="text-gray-500" />
                            <span className="text-sm text-gray-900">{email}</span>
                          </div>
                          <button
                            onClick={() => handleRemoveEmail(email)}
                            className="text-red-600 hover:text-red-700 text-sm font-medium"
                          >
                            Eliminar
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Test email button */}
                {settings.adminEmails.length > 0 && (
                  <button
                    onClick={handleSendTestEmail}
                    disabled={sendingTest}
                    className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center gap-2 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    <Send size={18} />
                    {sendingTest ? 'Enviando...' : `Enviar Email de Prueba a ${settings.adminEmails[0]}`}
                  </button>
                )}
              </div>

              {/* CSV Reports Section */}
              {settings.adminEmails.length > 0 && (
                <>
                  <hr className="my-6 border-gray-200" />
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-4">
                      <FileText className="text-blue-600" size={20} />
                      <h4 className="text-md font-semibold text-gray-900">
                        Reportes CSV por Email
                      </h4>
                    </div>
                    <p className="text-sm text-gray-500">
                      Enviar reportes en formato CSV a los {settings.adminEmails.length} email(s) configurado(s).
                    </p>

                    <div className="grid grid-cols-1 gap-3">
                      <button
                        onClick={() => handleSendCSVReport('most-sold')}
                        disabled={sendingReport === 'most-sold'}
                        className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 disabled:bg-gray-400 disabled:cursor-not-allowed"
                      >
                        <FileText size={18} />
                        {sendingReport === 'most-sold' ? 'Enviando...' : 'Productos Más Vendidos'}
                      </button>

                      <button
                        onClick={() => handleSendCSVReport('negative-diff')}
                        disabled={sendingReport === 'negative-diff'}
                        className="px-4 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors flex items-center justify-center gap-2 disabled:bg-gray-400 disabled:cursor-not-allowed"
                      >
                        <FileText size={18} />
                        {sendingReport === 'negative-diff' ? 'Enviando...' : 'Productos con Diferencias Negativas'}
                      </button>

                      <button
                        onClick={() => handleSendCSVReport('adjustments')}
                        disabled={sendingReport === 'adjustments'}
                        className="px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center justify-center gap-2 disabled:bg-gray-400 disabled:cursor-not-allowed"
                      >
                        <FileText size={18} />
                        {sendingReport === 'adjustments' ? 'Enviando...' : 'Historial de Ajustes del Último Día'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Configuración de Hardware */}
          {activeSection === 'hardware' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Configuración de Hardware</h3>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex gap-3">
                <AlertTriangle size={20} className="text-yellow-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-yellow-800">Configuración Avanzada</p>
                  <p className="text-sm text-yellow-700">
                    Cambiar estos valores puede afectar el funcionamiento del hardware
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Habilitar ESP32/Arduino</p>
                  <p className="text-sm text-gray-500">Activar comunicación con hardware externo</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.esp32Enabled}
                    onChange={(e) => updateSetting('esp32Enabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Puerto Serial
                </label>
                <input
                  type="text"
                  value={settings.arduinoPort}
                  onChange={(e) => updateSetting('arduinoPort', e.target.value)}
                  disabled={!settings.esp32Enabled}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                  placeholder="COM3 o /dev/ttyUSB0"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Duración LED (ms)
                </label>
                <input
                  type="number"
                  value={settings.ledDuration}
                  onChange={(e) => updateSetting('ledDuration', parseInt(e.target.value))}
                  disabled={!settings.esp32Enabled}
                  min="1000"
                  max="10000"
                  step="500"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
                <p className="mt-1 text-sm text-gray-500">
                  Tiempo que permanece encendido el LED indicador
                </p>
              </div>
            </div>
          )}

          {/* Configuración de Seguridad */}
          {activeSection === 'security' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Seguridad</h3>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tiempo de Sesión (minutos)
                </label>
                <input
                  type="number"
                  value={settings.sessionTimeout}
                  onChange={(e) => updateSetting('sessionTimeout', parseInt(e.target.value))}
                  min="5"
                  max="120"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-sm text-gray-500">
                  La sesión expirará después de este tiempo de inactividad
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Requerir Contraseña Fuerte</p>
                  <p className="text-sm text-gray-500">
                    Obligar contraseñas con mayúsculas, minúsculas, números y símbolos
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.requireStrongPassword}
                    onChange={(e) => updateSetting('requireStrongPassword', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Autenticación de Dos Factores</p>
                  <p className="text-sm text-gray-500">Seguridad adicional con código temporal</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.twoFactorAuth}
                    onChange={(e) => updateSetting('twoFactorAuth', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="font-medium text-blue-900 mb-2">💡 Recomendaciones de Seguridad</p>
                <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                  <li>Cambiar contraseñas regularmente</li>
                  <li>No compartir credenciales de administrador</li>
                  <li>Revisar logs de acceso periódicamente</li>
                  <li>Mantener el sistema actualizado</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
