import React, { useState, useEffect, useRef } from 'react';
import { DollarSign, CheckCircle, XCircle, Loader2, AlertCircle } from 'lucide-react';

interface CashPaymentProps {
  total: number;
  orderId?: number;
  onSuccess: () => void;
  onCancel: () => void;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3000/ws';

export function CashPayment({ total, orderId, onSuccess, onCancel }: CashPaymentProps) {
  const [status, setStatus]         = useState<'waiting' | 'processing' | 'success' | 'error'>('waiting');
  const [message, setMessage]       = useState('Inserta tus billetes o monedas...');
  const [receivedAmount, setReceivedAmount] = useState(0);
  const [change, setChange]         = useState(0);
  const successCalled               = useRef(false);
  const wsRef                       = useRef<WebSocket | null>(null);

  useEffect(() => {
    startSSPPayment();
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const startSSPPayment = async () => {
    // Conectar WebSocket para eventos en tiempo real del hardware
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => console.log('[CashPayment] WebSocket SSP conectado');

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      switch (data.event) {
        case 'NOTE_CREDIT':
        case 'COIN_CREDIT':
          setReceivedAmount(data.valueInserted / 100);
          setMessage(`Recibido: $${(data.valueInserted / 100).toFixed(2)} — Faltan: $${(data.remaining / 100).toFixed(2)}`);
          break;

        case 'PAYMENT_COMPLETE':
          setChange(data.change / 100);
          setStatus('processing');
          setMessage('Verificando pago...');
          setTimeout(() => {
            setStatus('success');
            setMessage(data.change > 0
              ? `¡Pago completado! Cambio: $${(data.change / 100).toFixed(2)}`
              : '¡Pago completado!');
            setTimeout(() => {
              if (!successCalled.current) {
                successCalled.current = true;
                onSuccess();
              }
            }, 2000);
          }, 1500);
          break;

        case 'PAYMENT_CANCELLED':
          setStatus('error');
          setMessage('Pago cancelado');
          break;

        case 'JAM':
          setStatus('error');
          setMessage('Error en el reciclador — llama al operador');
          break;

        case 'ERROR':
          setStatus('error');
          setMessage(`Error: ${data.message}`);
          break;
      }
    };

    ws.onerror = () => console.warn('[CashPayment] WebSocket no disponible');

    // Iniciar sesión de pago en el backend → activa NV200 + SCS físicamente
    try {
      const res = await fetch(`${API_URL}/payment/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: orderId?.toString() ?? `ORD-${Date.now()}`,
          totalCents: Math.round(total * 100),
        }),
      });
      if (!res.ok) throw new Error('No se pudo iniciar el hardware de pago');
      console.log('[CashPayment] Sesión SSP iniciada');
    } catch (error) {
      console.error('[CashPayment] Error SSP:', error);
      setStatus('error');
      setMessage('No se pudo conectar con el reciclador');
    }
  };

  const handleCancel = async () => {
    try {
      await fetch(`${API_URL}/payment/cancel`, { method: 'POST' });
    } catch (_) {}
    wsRef.current?.close();
    setStatus('error');
    setMessage('Pago cancelado');
    setTimeout(() => onCancel(), 800);
  };

  const progress = Math.min((receivedAmount / total) * 100, 100);

  return (
    <div className="p-6 space-y-6">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
          {status === 'waiting'    && <DollarSign className="w-8 h-8 text-green-600" />}
          {status === 'processing' && <Loader2    className="w-8 h-8 text-yellow-600 animate-spin" />}
          {status === 'success'    && <CheckCircle className="w-8 h-8 text-green-600" />}
          {status === 'error'      && <XCircle    className="w-8 h-8 text-red-600" />}
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Pago en Efectivo</h2>
        <p className="text-gray-600">{message}</p>
        {change > 0 && status === 'success' && (
          <p className="text-xl font-bold text-blue-600 mt-2">Cambio: ${change.toFixed(2)}</p>
        )}
      </div>

      {/* Progreso */}
      <div className="bg-gray-100 rounded-lg p-6">
        <div className="flex justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Recibido:</span>
          <span className="text-lg font-bold text-green-600">${receivedAmount.toFixed(2)}</span>
        </div>
        <div className="flex justify-between mb-4">
          <span className="text-sm font-medium text-gray-700">Total:</span>
          <span className="text-lg font-bold text-gray-900">${total.toFixed(2)}</span>
        </div>
        <div className="w-full bg-gray-300 rounded-full h-4 overflow-hidden">
          <div
            className="bg-green-500 h-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-sm text-center text-gray-500 mt-1">{progress.toFixed(0)}%</p>
      </div>

      {/* Instrucciones */}
      {status === 'waiting' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex gap-2 items-start">
            <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-blue-900 mb-2">💵 Instrucciones:</h3>
              <ol className="list-decimal list-inside space-y-1 text-sm text-blue-800">
                <li>Inserta los billetes en el reciclador</li>
                <li>Espera a que se valide cada billete</li>
                <li>El sistema detectará automáticamente el monto completo</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* Botón cancelar */}
      {status === 'waiting' && (
        <button
          onClick={handleCancel}
          className="w-full py-3 px-4 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
        >
          Cancelar Pago
        </button>
      )}
    </div>
  );
}
