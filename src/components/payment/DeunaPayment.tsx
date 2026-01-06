import React, { useState, useEffect } from 'react';
import { Smartphone, CheckCircle, XCircle, Loader2, QrCode } from 'lucide-react';

interface DeunaPaymentProps {
  total: number;
  orderId?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function DeunaPayment({ total, orderId, onSuccess, onCancel }: DeunaPaymentProps) {
  const [status, setStatus] = useState<'generating' | 'waiting' | 'success' | 'error' | 'expired'>('generating');
  const [message, setMessage] = useState('Generando código QR...');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(300); // 5 minutos

  // Generar QR al montar el componente
  useEffect(() => {
    generateQR();
  }, []);

  // Countdown timer
  useEffect(() => {
    if (status !== 'waiting') return;

    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          setStatus('expired');
          setMessage('El código QR ha expirado');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [status]);

  // Polling para verificar webhook
  useEffect(() => {
    if (status !== 'waiting') return;

    const interval = setInterval(async () => {
      // TODO: Verificar estado del pago en el backend
      // const response = await fetch(`/api/payments/deuna/status/${orderId}`);
      // const data = await response.json();
      // if (data.status === 'approved') { ... }
      
      // Simulación: aprobar automáticamente después de 10 segundos
      // En producción, esto se maneja con webhooks de DeUna
    }, 3000);

    return () => clearInterval(interval);
  }, [status, orderId]);

  const generateQR = async () => {
    setStatus('generating');
    setMessage('Generando código QR...');

    try {
      // TODO: Llamar al backend para generar QR de DeUna
      // const response = await fetch('/api/payments/deuna/create', {
      //   method: 'POST',
      //   body: JSON.stringify({ amount: total, orderId })
      // });
      // const data = await response.json();
      // setQrCode(data.qrCodeUrl);

      // Simulación: generar QR fake
      setTimeout(() => {
        const fakeQR = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
          `deuna://pay?amount=${total}&order=${orderId || 'DEMO'}`
        )}`;
        setQrCode(fakeQR);
        setStatus('waiting');
        setMessage('Escanea el código QR con tu app bancaria');
      }, 2000);
    } catch (error) {
      console.error('Error generando QR:', error);
      setStatus('error');
      setMessage('Error al generar código QR');
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCancel = () => {
    setStatus('error');
    setMessage('Pago cancelado');
    setTimeout(() => onCancel(), 1000);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-purple-100 rounded-full mb-4">
          {status === 'generating' && <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />}
          {status === 'waiting' && <QrCode className="w-8 h-8 text-purple-600" />}
          {status === 'success' && <CheckCircle className="w-8 h-8 text-green-600" />}
          {(status === 'error' || status === 'expired') && <XCircle className="w-8 h-8 text-red-600" />}
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">DeUna! - Transferencia</h2>
        <p className="text-gray-600">{message}</p>
      </div>

      {/* Monto */}
      <div className="bg-gray-100 rounded-lg p-4 text-center">
        <p className="text-sm text-gray-600 mb-1">Total a pagar</p>
        <p className="text-3xl font-bold text-gray-900">${total.toFixed(2)}</p>
      </div>

      {/* QR Code */}
      {status === 'waiting' && qrCode && (
        <div className="flex flex-col items-center space-y-4">
          <div className="bg-white p-4 rounded-lg shadow-lg">
            <img src={qrCode} alt="QR Code" className="w-64 h-64" />
          </div>
          
          {/* Timer */}
          <div className="flex items-center space-x-2 text-gray-600">
            <span className="text-sm">Expira en:</span>
            <span className="font-mono font-bold text-lg">{formatTime(timeLeft)}</span>
          </div>
        </div>
      )}

      {/* Instrucciones */}
      {status === 'waiting' && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <h3 className="font-semibold text-purple-900 mb-2">📱 Instrucciones:</h3>
          <ol className="list-decimal list-inside space-y-1 text-sm text-purple-800">
            <li>Abre tu app bancaria (Banco Pichincha, Produbanco, etc.)</li>
            <li>Busca la opción "Pagar con QR" o "DeUna"</li>
            <li>Escanea el código QR mostrado arriba</li>
            <li>Confirma el pago en tu app</li>
            <li>Espera la confirmación automática</li>
          </ol>
        </div>
      )}

      {/* Botones */}
      <div className="space-y-3">
        {status === 'waiting' && (
          <button
            onClick={handleCancel}
            className="w-full py-3 px-4 bg-gray-200 hover:bg-gray-300 text-gray-900 font-medium rounded-lg transition-colors"
          >
            Cancelar Pago
          </button>
        )}

        {(status === 'error' || status === 'expired') && (
          <>
            <button
              onClick={generateQR}
              className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition-colors"
            >
              Generar Nuevo QR
            </button>
            <button
              onClick={handleCancel}
              className="w-full py-3 px-4 bg-gray-200 hover:bg-gray-300 text-gray-900 font-medium rounded-lg transition-colors"
            >
              Volver
            </button>
          </>
        )}
      </div>
    </div>
  );
}
