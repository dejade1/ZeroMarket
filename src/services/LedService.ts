class LedService {
  private baseUrl: string = 'http://192.168.0.106'; // ✅ IP actualizada
  private isConnected: boolean = false;

  async connect(): Promise<boolean> {
    try {
      console.log('[LedService] Verificando conexión ESP32...');

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

  /**
   * ✅ NUEVO: Enviar múltiples productos al ESP32 (formato correcto)
   * Formato esperado por ESP32:
   * {
   *   "items": [
   *     {"slot": 1, "quantity": 2, "slotDistance": 9.21},
   *     {"slot": 2, "quantity": 1, "slotDistance": 8.30}
   *   ]
   * }
   */
  async dispenseProducts(items: Array<{slot: number, quantity: number, slotDistance: number}>): Promise<boolean> {
    try {
      console.log(`[LedService] 📦 Dispensando ${items.length} productos:`, items);

      const controller = new AbortController();
      // ✅ AUMENTADO: 30 segundos para dispensación múltiple (era 15s)
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

  /**
   * @deprecated Usar dispenseProducts() en su lugar
   */
  async sendProductSignal(productId: number, quantity: number): Promise<boolean> {
    console.warn('[LedService] ⚠ sendProductSignal() está deprecado, usa dispenseProducts()');
    return false;
  }

  isSupported(): boolean {
    return true;
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }
}

export const ledService = new LedService();
