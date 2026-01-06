import React from 'react';
import { DollarSign, CreditCard, Smartphone } from 'lucide-react';

export type PaymentMethod = 'cash' | 'card' | 'deuna';

interface PaymentMethodSelectorProps {
  onSelect: (method: PaymentMethod) => void;
  total: number;
}

export function PaymentMethodSelector({ onSelect, total }: PaymentMethodSelectorProps) {
  return (
    <div className="p-6 space-y-4">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Selecciona Método de Pago</h2>
        <p className="text-gray-600">Total a pagar: <span className="font-bold text-xl text-green-600">${total.toFixed(2)}</span></p>
      </div>

      <div className="space-y-3">
        {/* Efectivo */}
        <button
          onClick={() => onSelect('cash')}
          className="w-full p-6 border-2 border-gray-200 rounded-xl hover:border-green-500 hover:bg-green-50 transition-all group"
        >
          <div className="flex items-center space-x-4">
            <div className="p-3 bg-green-100 rounded-full group-hover:bg-green-200 transition-colors">
              <DollarSign className="w-8 h-8 text-green-600" />
            </div>
            <div className="flex-1 text-left">
              <h3 className="text-lg font-semibold text-gray-900">Efectivo</h3>
              <p className="text-sm text-gray-600">Pago con billetes mediante reciclador</p>
            </div>
          </div>
        </button>

        {/* Tarjeta Débito/Crédito */}
        <button
          onClick={() => onSelect('card')}
          className="w-full p-6 border-2 border-gray-200 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all group"
        >
          <div className="flex items-center space-x-4">
            <div className="p-3 bg-blue-100 rounded-full group-hover:bg-blue-200 transition-colors">
              <CreditCard className="w-8 h-8 text-blue-600" />
            </div>
            <div className="flex-1 text-left">
              <h3 className="text-lg font-semibold text-gray-900">Tarjeta Débito/Crédito</h3>
              <p className="text-sm text-gray-600">Pago con punto de venta (POS)</p>
            </div>
          </div>
        </button>

        {/* DeUna - Transferencia Bancaria */}
        <button
          onClick={() => onSelect('deuna')}
          className="w-full p-6 border-2 border-gray-200 rounded-xl hover:border-purple-500 hover:bg-purple-50 transition-all group"
        >
          <div className="flex items-center space-x-4">
            <div className="p-3 bg-purple-100 rounded-full group-hover:bg-purple-200 transition-colors">
              <Smartphone className="w-8 h-8 text-purple-600" />
            </div>
            <div className="flex-1 text-left">
              <h3 className="text-lg font-semibold text-gray-900">DeUna! - Transferencia</h3>
              <p className="text-sm text-gray-600">Pago instantáneo con QR bancario</p>
            </div>
          </div>
        </button>
      </div>

      <div className="mt-6 p-4 bg-gray-50 rounded-lg">
        <p className="text-xs text-gray-600 text-center">
          Todos los métodos de pago son seguros y verificados
        </p>
      </div>
    </div>
  );
}
