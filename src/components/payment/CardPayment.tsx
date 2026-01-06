import React, { useState } from 'react';
import { CreditCard, CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface CardPaymentProps {
  total: number;
  onSuccess: () => void;
  onCancel: () => void;
}

export function CardPayment({ total, onSuccess, onCancel }: CardPaymentProps) {
  const [status, setStatus] = useState<'waiting' | 'processing' | 'success' | 'error'>('waiting');
  const [message, setMessage] = useState('Esperando tarjeta...');

  const handleProcessPayment = () => {
    setStatus('processing');
    setMessage('Procesando pago en punto de venta...');

    // TODO: Conectar con API del punto de venta (POS)
    // Simulación de proceso
    setTimeout(() => {
      // Simular aprobación (90% de éxito)
      const approved = Math.random() > 0.1;
      
      if (approved) {
        setStatus('success');
        setMessage('¡Pago aprobado!');
        setTimeout(() => onSuccess(), 2000);
      } else {
        setStatus('error');
        setMessage('Pago rechazado. Intenta con otra tarjeta.');
      }
    }, 3000);
  };

  const handleCancel = () => {
    setStatus('error');
    setMessage('Pago cancelado');
    setTimeout(() => onCancel(), 1000);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
          {status === 'waiting' && <CreditCard className="w-8 h-8 text-blue-600" />}
          {status === 'processing' && <Loader2 className="w-8 h-8 text-yellow-600 animate-spin" />}
          {status === 'success' && <CheckCircle className="w-8 h-8 text-green-600" />}
          {status === 'error' && <XCircle className="w-8 h-8 text-red-600" />}
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Pago con Tarjeta</h2>
        <p className="text-gray-600">{message}</p>
      </div>

      {/* Monto a pagar */}
      <div className="bg-gray-100 rounded-lg p-6 text-center">
        <p className="text-sm text-gray-600 mb-1">Total a pagar</p>
        <p className="text-4xl font-bold text-gray-900">${total.toFixed(2)}</p>
      </div>

      {/* Instrucciones */}
      {status === 'waiting' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 mb-2">💳 Instrucciones:</h3>
          <ol className="list-decimal list-inside space-y-1 text-sm text-blue-800">
            <li>Inserta, desliza o acerca tu tarjeta al lector</li>
            <li>Ingresa tu PIN si es requerido</li>
            <li>Espera la confirmación del banco</li>
            <li>Retira tu tarjeta cuando se indique</li>
          </ol>
        </div>
      )}

      {/* Botones */}
      <div className="space-y-3">
        {status === 'waiting' && (
          <>
            <button
              onClick={handleProcessPayment}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
              Iniciar Pago en POS
            </button>
            <button
              onClick={handleCancel}
              className="w-full py-3 px-4 bg-gray-200 hover:bg-gray-300 text-gray-900 font-medium rounded-lg transition-colors"
            >
              Cancelar
            </button>
          </>
        )}

        {status === 'error' && (
          <button
            onClick={() => {
              setStatus('waiting');
              setMessage('Esperando tarjeta...');
            }}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            Reintentar
          </button>
        )}
      </div>
    </div>
  );
}
