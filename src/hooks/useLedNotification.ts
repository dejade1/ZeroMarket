import { useState, useCallback } from 'react';
import { ledService } from '../services/LedService';

interface CartItem {
  id: number;
  quantity: number;
  slot?: number;
  slotDistance?: number;
}

export function useLedNotification() {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    try {
      console.log('[useLedNotification] Intentando conectar con ESP32...');
      const success = await ledService.connect();
      setIsConnected(success);
      
      if (success) {
        setError(null);
        console.log('[useLedNotification] ✓ Conexión exitosa con ESP32');
      } else {
        setError('No se pudo conectar al ESP32');
        console.error('[useLedNotification] ✗ Conexión fallida');
      }
      
      return success;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Error desconocido';
      setError(errorMsg);
      console.error('[useLedNotification] Error al conectar:', errorMsg);
      return false;
    }
  }, []);

  const notifyPurchase = useCallback(async (items: CartItem[]) => {
    console.log('[useLedNotification] === INICIO notifyPurchase ===');
    console.log('[useLedNotification] Items recibidos:', items);
    
    // Verificar conexión antes de enviar
    console.log('[useLedNotification] Verificando conexión...');
    const connected = await connect();
    
    if (!connected) {
      console.error('[useLedNotification] ✗ No hay conexión con ESP32');
      setError('No se pudo conectar al ESP32');
      return false;
    }

    try {
      console.log('[useLedNotification] ✓ Conexión establecida, preparando dispensación...');
      
      // ✅ CONVERTIR items al formato que espera el ESP32
      const esp32Items = items
        .filter(item => item.slot && item.slotDistance) // Solo items con slot configurado
        .map(item => ({
          slot: item.slot!,
          quantity: item.quantity,
          slotDistance: item.slotDistance!
        }));

      if (esp32Items.length === 0) {
        console.warn('[useLedNotification] ⚠ No hay productos con slot configurado');
        return true; // No es error, simplemente no hay nada que dispensar
      }

      console.log('[useLedNotification] 📦 Enviando al ESP32:', esp32Items);
      
      // ✅ ENVIAR TODOS LOS PRODUCTOS DE UNA VEZ (dispensación simultánea)
      const sent = await ledService.dispenseProducts(esp32Items);
      
      if (!sent) {
        console.error('[useLedNotification] ✗ Error en dispensación');
        setError('Error en dispensación de productos');
        return false;
      }
      
      console.log('[useLedNotification] ✓✓✓ Todos los productos dispensados exitosamente');
      return true;
    } catch (err) {
      console.error('[useLedNotification] ✗✗✗ Error en notifyPurchase:', err);
      const errorMsg = err instanceof Error ? err.message : 'Error al notificar compra';
      setError(errorMsg);
      return false;
    }
  }, [connect]);

  const disconnect = useCallback(async () => {
    console.log('[useLedNotification] Desconectando...');
    setIsConnected(false);
    setError(null);
  }, []);

  return {
    isConnected,
    error,
    connect,
    disconnect,
    notifyPurchase
  };
}
