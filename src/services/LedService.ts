class LedService {
  private baseUrl: string = 'http://192.168.18.14'; // ACTUALIZA CON TU IP
  private isConnected: boolean = false;

  async connect(): Promise<boolean> {
    try {
      console.log('[LedService] Verificando conexión ESP32...');

      // ✅ TIMEOUT AUMENTADO: 5 segundos para la comprobación de estado
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
        console.warn('[LedService] ⚠ Timeout: ESP32 no responde en 5 segundos');
      } else {
        console.error('[LedService] ❌ Error conectando:', error.message);
      }
      this.isConnected = false;
      return false;
    }
  }

  async sendProductSignal(productId: number, quantity: number): Promise<boolean> {
    try {
      console.log(`[LedService] 📦 Dispensando producto ${productId}, cantidad ${quantity}`);

      // ✅ TIMEOUT AUMENTADO: 10 segundos para la dispensación
      // (el motor puede tardar varios segundos en girar)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${this.baseUrl}/blink`, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ productId, quantity }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      console.log('[LedService] ✅ Respuesta ESP32:', result);
      return true;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.error('[LedService] ❌ Timeout: ESP32 no completó dispensación en 10 segundos');
      } else {
        console.error('[LedService] ❌ Error:', error.message);
      }
      return false;
    }
  }

  isSupported(): boolean {
    return true; // WiFi siempre disponible
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }
}

export const ledService = new LedService();
