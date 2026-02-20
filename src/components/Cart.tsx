import React, { useState, useEffect } from 'react';
import { X, Plus, Minus, ShoppingCart } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { PaymentMethodSelector, PaymentMethod } from './payment/PaymentMethodSelector';
import { CashPayment } from './payment/CashPayment';
import { CardPayment } from './payment/CardPayment';
import { DeunaPayment } from './payment/DeunaPayment';
import type { CustomerData } from '../context/CartContext';

type CheckoutStep = 'cart' | 'customerData' | 'paymentMethod' | 'processing';

export function Cart() {
  const { state, dispatch, checkout } = useCart();
  const { user } = useAuth();
  const [step, setStep]                           = useState<CheckoutStep>('cart');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod | null>(null);
  const [isProcessing, setIsProcessing]           = useState(false);
  const [isFinalConsumer, setIsFinalConsumer]     = useState(false);
  const [createdOrderId, setCreatedOrderId]       = useState<number | undefined>(undefined);
  const [customerData, setCustomerData]           = useState<CustomerData>({
    customerName: '',
    customerEmail: '',
    phone: '',
    address: '',
    paymentMethod: 'Efectivo',
  });

  const total = state.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const canBeFinalConsumer = total < 50;

  // Auto-llenar datos si el usuario está logueado
  useEffect(() => {
    if (step === 'customerData' && user) {
      setCustomerData(prev => ({
        ...prev,
        customerName:  user.username || prev.customerName,
        customerEmail: user.email    || prev.customerEmail,
      }));
    }
  }, [step, user]);

  // Consumidor final
  useEffect(() => {
    if (isFinalConsumer) {
      setCustomerData({
        customerName:  'Consumidor Final',
        customerEmail: 'consumidorfinal@tienda.com',
        phone:         '9999999999',
        address:       'Sin dirección especificada',
        paymentMethod: 'Efectivo',
      });
    } else if (!user && step === 'customerData') {
      setCustomerData({ customerName: '', customerEmail: '', phone: '', address: '', paymentMethod: 'Efectivo' });
    }
  }, [isFinalConsumer, user, step]);

  const handleCustomerDataSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStep('paymentMethod');
  };

  const handlePaymentMethodSelect = (method: PaymentMethod) => {
    setSelectedPaymentMethod(method);
    const paymentMethodName = { cash: 'Efectivo', card: 'Tarjeta', deuna: 'DeUna' }[method];
    setCustomerData(prev => ({ ...prev, paymentMethod: paymentMethodName }));
    setStep('processing');
  };

  const handlePaymentSuccess = React.useCallback(async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      await checkout(customerData);
      setCustomerData({ customerName: '', customerEmail: '', phone: '', address: '', paymentMethod: 'Efectivo' });
      setStep('cart');
      setSelectedPaymentMethod(null);
      setIsFinalConsumer(false);
      setCreatedOrderId(undefined);
      dispatch({ type: 'TOGGLE_CART' });
    } catch (error) {
      console.error('Error en checkout:', error);
      alert('Error al procesar la orden. Por favor intenta de nuevo.');
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, checkout, customerData, dispatch]);

  const handlePaymentCancel = () => {
    setSelectedPaymentMethod(null);
    setStep('paymentMethod');
  };

  const handleClose = () => {
    dispatch({ type: 'TOGGLE_CART' });
    setStep('cart');
    setSelectedPaymentMethod(null);
    setIsFinalConsumer(false);
  };

  const handleBack = () => {
    if (step === 'processing')     { setStep('paymentMethod'); setSelectedPaymentMethod(null); }
    else if (step === 'paymentMethod') setStep('customerData');
    else if (step === 'customerData')  setStep('cart');
  };

  if (!state.isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={handleClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5" />
            <h2 className="text-lg font-semibold">
              {step === 'cart'          && 'Carrito de Compras'}
              {step === 'customerData'  && 'Datos de Cliente'}
              {step === 'paymentMethod' && 'Método de Pago'}
              {step === 'processing'    && 'Procesando Pago'}
            </h2>
          </div>
          <button onClick={handleClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto">

          {/* PASO 1: Carrito */}
          {step === 'cart' && (
            <div className="p-4 space-y-4">
              {state.items.length === 0 ? (
                <p className="text-center text-gray-500 py-8">Tu carrito está vacío</p>
              ) : (
                state.items.map(item => (
                  <div key={item.id} className="flex items-center gap-3 border rounded-lg p-3">
                    <div className="flex-1">
                      <h3 className="font-medium text-sm">{item.title}</h3>
                      <p className="text-xs text-gray-500">${item.price.toFixed(2)} por {item.unit}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => dispatch({ type: 'UPDATE_QUANTITY', payload: { id: item.id, quantity: Math.max(0, item.quantity - 1) } })} className="p-1 rounded-full bg-gray-100 hover:bg-gray-200">
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-6 text-center text-sm">{item.quantity}</span>
                      <button onClick={() => dispatch({ type: 'UPDATE_QUANTITY', payload: { id: item.id, quantity: item.quantity + 1 } })} className="p-1 rounded-full bg-gray-100 hover:bg-gray-200">
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                    <button onClick={() => dispatch({ type: 'REMOVE_ITEM', payload: item.id })} className="text-red-500 hover:text-red-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
              <div className="flex justify-between font-semibold text-lg pt-2 border-t">
                <span>Total:</span>
                <span>${total.toFixed(2)}</span>
              </div>
              <button
                onClick={() => setStep('customerData')}
                disabled={state.items.length === 0}
                className="w-full bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-medium py-3 px-4 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Proceder al Pago
              </button>
            </div>
          )}

          {/* PASO 2: Datos del Cliente */}
          {step === 'customerData' && (
            <div className="p-4">
              {canBeFinalConsumer && (
                <label className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg mb-4 cursor-pointer">
                  <input type="checkbox" checked={isFinalConsumer} onChange={e => setIsFinalConsumer(e.target.checked)} className="mt-1 h-4 w-4" />
                  <div>
                    <p className="font-medium text-sm">Consumidor Final</p>
                    <p className="text-xs text-gray-500">No requiere factura (disponible para compras menores a $50)</p>
                  </div>
                </label>
              )}
              <form onSubmit={handleCustomerDataSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nombre Completo *</label>
                  <input type="text" required value={customerData.customerName} onChange={e => setCustomerData({ ...customerData, customerName: e.target.value })} disabled={isFinalConsumer} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-yellow-400 disabled:bg-gray-100" placeholder="Juan Pérez" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                  <input type="email" required value={customerData.customerEmail} onChange={e => setCustomerData({ ...customerData, customerEmail: e.target.value })} disabled={isFinalConsumer} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-yellow-400 disabled:bg-gray-100" placeholder="juan@example.com" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono *</label>
                  <input type="tel" required value={customerData.phone} onChange={e => setCustomerData({ ...customerData, phone: e.target.value })} disabled={isFinalConsumer} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-yellow-400 disabled:bg-gray-100" placeholder="555-1234" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Dirección *</label>
                  <textarea required value={customerData.address} onChange={e => setCustomerData({ ...customerData, address: e.target.value })} disabled={isFinalConsumer} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-yellow-400 disabled:bg-gray-100" rows={3} placeholder="Calle Falsa 123" />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={handleBack} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-900 font-medium py-3 px-4 rounded-md transition-colors">Volver</button>
                  <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-md transition-colors">Continuar</button>
                </div>
              </form>
            </div>
          )}

          {/* PASO 3: Método de Pago */}
          {step === 'paymentMethod' && (
            <PaymentMethodSelector total={total} onSelect={handlePaymentMethodSelect} />
          )}

          {/* PASO 4: Procesamiento */}
          {step === 'processing' && selectedPaymentMethod && (
            <>
              {selectedPaymentMethod === 'cash' && (
                <CashPayment
                  total={total}
                  orderId={createdOrderId}
                  onSuccess={handlePaymentSuccess}
                  onCancel={handlePaymentCancel}
                />
              )}
              {selectedPaymentMethod === 'card' && (
                <CardPayment
                  total={total}
                  onSuccess={handlePaymentSuccess}
                  onCancel={handlePaymentCancel}
                />
              )}
              {selectedPaymentMethod === 'deuna' && (
                <DeunaPayment
                  total={total}
                  onSuccess={handlePaymentSuccess}
                  onCancel={handlePaymentCancel}
                />
              )}
            </>
          )}

        </div>
      </div>
    </div>
  );
}
