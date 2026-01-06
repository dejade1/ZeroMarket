import React, { useState, useEffect } from 'react';
import { DollarSign, CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface CashPaymentProps {
  total: number;
  onSuccess: () => void;
  onCancel: () => void;
}

export function CashPayment({ total, onSuccess, onCancel }: CashPaymentProps) {
  const [status, setStatus] = useState<'waiting' | 'processing' | 'success' | 'error'>('waiting');
  const [message, setMessage] = useState('Esperando billetes...');
  const [receivedAmount, setReceivedAmount] = useState(0);

  // Simulación de recepción de billetes
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (status === 'waiting') {
      // TODO: Conectar con API del reciclador de billetes
      // Por ahora, simulación
      interval = setInterval(() => {
        setReceivedAmount(prev => {
          const newAmount = prev + 1;
          if (newAmount >= total) {
            setStatus('processing');
            setMessage('Verificando billetes...');
            
            setTimeout(() => {
              setStatus('success');
              setMessage('¡Pago completado!');
              setTimeout(() => onSuccess(), 2000);
            }, 2000);
            
            return total;
          }
          return newAmount;
        });
      }, 500);
    }

    return () => clearInterval(interval);
  }, [status, total, onSuccess]);

  const handleCancel = () => {
    setStatus('error');
    setMessage('Pago cancelado');
    setTimeout(() => onCancel(), 1000);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
          {status === 'waiting' && <DollarSign className="w-8 h-8 text-green-600" />}
          {status === 'processing' && <Loader2 className="w-8 h-8 text-yellow-600 animate-spin" />}
          {status === 'success' && <CheckCircle className="w-8 h-8 text-green-600" />}
          {status === 'error' && <XCircle className="w-8 h-8 text-red-600" />}
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Pago en Efectivo</h2>
        <p className="text-gray-600">{message}</p>
      </div>

      {/* Progreso de pago */}
      <div className="bg-gray-100 rounded-lg p-6">
        <div className="flex justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Recibido:</span>
          <span className="text-lg font-bold text-green-600">${receivedAmount.toFixed(2)}</span>
        </div>
        <div className="flex justify-between mb-4">
          <span className="text-sm font-medium text-gray-700">Total:</span>
          <span className="text-lg font-bold text-gray-900">${total.toFixed(2)}</span>
        </div>

        {/* Barra de progreso */}
        <div className="w-full bg-gray-300 rounded-full h-4 overflow-hidden">
          <div 
            className="bg-green-500 h-full transition-all duration-300"
            style={{ width: `${Math.min((receivedAmount / total) * 100, 100)}%` }}
          />
        </div>
      </div>

      {/* Instrucciones */}
      {status === 'waiting' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 mb-2">💵 Instrucciones:</h3>
          <ol className="list-decimal list-inside space-y-1 text-sm text-blue-800">
            <li>Inserta los billetes en el reciclador</li>
            <li>Espera a que se valide cada billete</li>
            <li>El sistema detectará automáticamente cuando el monto sea completo</li>
          </ol>
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
