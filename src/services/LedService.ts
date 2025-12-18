const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

class LedService {
  private baseUrl: string = 'http://192.168.0.106'; // IP por defecto
  private isConnected: boolean = false;
  private ipLoaded: boolean = false;

  /**
   * ✅ NUEVO: Cargar IP del ESP32 desde el backend
   */
  async loadESP32IP(): Promise<void> {
    if (this.ipLoaded) return; // Solo cargar una vez

    try {
      // ✅ CORREGIDO: Usar /admin/settings
      const response = await fetch(`${API_URL}/admin/settings/esp32_ip`, {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        const ip = data.setting?.value;
        
        if (ip) {
          this.baseUrl = `http://${ip}`;
          this.ipLoaded = true;
          console.log(`[LedService] ✅ IP ESP32 cargada: ${this.baseUrl}`);
        }
      } else {
        console.warn('[LedService] ⚠ No se pudo cargar IP del backend, usando IP por defecto');
      }
    } catch (error) {
      console.error('[LedService] Error cargando IP:', error);
      console.warn('[LedService] Usando IP por defecto:', this.baseUrl);
    }
  }

  /**
   * ✅ NUEVO: Actualizar IP manualmente
   */
  setESP32IP(ip: string): void {
    this.baseUrl = `http://${ip}`;
    this.ipLoaded = true;
    this.isConnected = false; // Resetear conexión
    console.log(`[LedService] IP actualizada manualmente: ${this.baseUrl}`);
  }

  async connect(): Promise<boolean> {
    try {
      // ✅ Cargar IP antes de conectar
      await this.loadESP32IP();

      console.log(`[LedService] Verificando conexión ESP32 en ${this.baseUrl}...`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.baseUrl}/status`, {
        method: 'GET',
        mode: 'cors',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        this.isConnected = data.status === 'online';
        console.log('[LedService] ✅ ESP32 conectado:', data);
        return this.isConnected;
      }

      console.warn('[LedService] ⚠ Respuesta no OK:', response.status);
      return false;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.warn(`[LedService] ⚠ Timeout: ESP32 no responde en ${this.baseUrl}`);
      } else {
        console.error('[LedService] ❌ Error conectando:', error.message);
      }
      this.isConnected = false;
      return false;
    }
  }

  async dispenseProducts(items: Array<{slot: number, quantity: number, slotDistance: number}>): Promise<boolean> {
    try {
      console.log(`[LedService] 📦 Dispensando ${items.length} productos:`, items);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${this.baseUrl}/dispense`, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ items }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[LedService] Error del ESP32:', errorText);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      console.log('[LedService] ✅ Respuesta ESP32:', result);
      return true;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.error('[LedService] ❌ Timeout: ESP32 no completó dispensación en 30 segundos');
        console.error('[LedService] ⚠ ADVERTENCIA: Stock ya fue descontado pero productos NO dispensados');
      } else {
        console.error('[LedService] ❌ Error:', error.message);
      }
      return false;
    }
  }

  isSupported(): boolean {
    return true;
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  getCurrentIP(): string {
    return this.baseUrl.replace('http://', '');
  }
}

export const ledService = new LedService();
