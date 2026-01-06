import React, { useState } from 'react';
import { Banknote, CreditCard, Smartphone, Check } from 'lucide-react';

export type PaymentMethod = 'cash' | 'card' | 'deuna';

interface PaymentMethodSelectorProps {
  onSelect: (method: PaymentMethod) => void;
  selected?: PaymentMethod;
  disabled?: boolean;
}

export function PaymentMethodSelector({ onSelect, selected, disabled = false }: PaymentMethodSelectorProps) {
  const paymentMethods = [
    {
      id: 'cash' as PaymentMethod,
      name: 'Efectivo',
      description: 'Pago con billetes y reciclador',
      icon: Banknote,
      color: 'green',
      bgColor: 'bg-green-50',
      borderColor: 'border-green-500',
      textColor: 'text-green-700',
      hoverColor: 'hover:bg-green-100'
    },
    {
      id: 'card' as PaymentMethod,
      name: 'Tarjeta',
      description: 'Débito o Crédito',
      icon: CreditCard,
      color: 'blue',
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-500',
      textColor: 'text-blue-700',
      hoverColor: 'hover:bg-blue-100'
    },
    {
      id: 'deuna' as PaymentMethod,
      name: 'DeUna',
      description: 'Transferencia bancaria instantánea',
      icon: Smartphone,
      color: 'purple',
      bgColor: 'bg-purple-50',
      borderColor: 'border-purple-500',
      textColor: 'text-purple-700',
      hoverColor: 'hover:bg-purple-100'
    }
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900">Selecciona tu método de pago</h3>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {paymentMethods.map((method) => {
          const Icon = method.icon;
          const isSelected = selected === method.id;
          
          return (
            <button
              key={method.id}
              onClick={() => !disabled && onSelect(method.id)}
              disabled={disabled}
              className={`
                relative p-6 rounded-xl border-2 transition-all duration-200
                ${isSelected 
                  ? `${method.bgColor} ${method.borderColor} ring-2 ring-${method.color}-300` 
                  : 'bg-white border-gray-200 hover:border-gray-300'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:shadow-md'}
              `}
            >
              {/* Check icon cuando está seleccionado */}
              {isSelected && (
                <div className={`absolute top-3 right-3 ${method.bgColor} rounded-full p-1`}>
                  <Check className={`w-5 h-5 ${method.textColor}`} />
                </div>
              )}
              
              {/* Icon principal */}
              <div className="flex flex-col items-center text-center space-y-3">
                <div className={`
                  p-4 rounded-full
                  ${isSelected ? method.bgColor : 'bg-gray-100'}
                `}>
                  <Icon className={`
                    w-8 h-8
                    ${isSelected ? method.textColor : 'text-gray-600'}
                  `} />
                </div>
                
                <div>
                  <h4 className={`
                    font-semibold text-lg
                    ${isSelected ? method.textColor : 'text-gray-900'}
                  `}>
                    {method.name}
                  </h4>
                  <p className={`
                    text-sm mt-1
                    ${isSelected ? method.textColor : 'text-gray-500'}
                  `}>
                    {method.description}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      
      {/* Información adicional */}
      {selected && (
        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800">
            {selected === 'cash' && '💵 Inserta tus billetes en el reciclador automático'}
            {selected === 'card' && '💳 Acerca tu tarjeta al punto de pago'}
            {selected === 'deuna' && '📱 Escanea el código QR con la app DeUna o Banco Pichincha'}
          </p>
        </div>
      )}
    </div>
  );
}
