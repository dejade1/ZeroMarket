import React, { useState, useEffect } from 'react';
import { X, Plus, Minus, ShoppingCart, CreditCard, User } from 'lucide-react';
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
  const [step, setStep] = useState<CheckoutStep>('cart');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isFinalConsumer, setIsFinalConsumer] = useState(false);
  const [customerData, setCustomerData] = useState<CustomerData>({
    customerName: '',
    customerEmail: '',
    phone: '',
    address: '',
    paymentMethod: 'Efectivo'
  });

  const total = state.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  // ✅ Auto-llenar datos si el usuario está logueado
  useEffect(() => {
    if (step === 'customerData' && user) {
      setCustomerData(prev => ({
        ...prev,
        customerName: user.username || prev.customerName,
        customerEmail: user.email || prev.customerEmail
      }));
    }
  }, [step, user]);

  // ✅ Si se activa "Consumidor Final", llenar con datos genéricos
  useEffect(() => {
    if (isFinalConsumer) {
      setCustomerData({
        customerName: 'Consumidor Final',
        customerEmail: 'consumidorfinal@tienda.com',
        phone: '9999999999',
        address: 'Sin dirección especificada',
        paymentMethod: 'Efectivo'
      });
    } else if (!user && step === 'customerData') {
      setCustomerData({
        customerName: '',
        customerEmail: '',
        phone: '',
        address: '',
        paymentMethod: 'Efectivo'
      });
    }
  }, [isFinalConsumer, user, step]);

  const handleCustomerDataSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStep('paymentMethod');
  };

  const handlePaymentMethodSelect = (method: PaymentMethod) => {
    setSelectedPaymentMethod(method);

    // Actualizar método en customerData
    const paymentMethodName = {
      cash: 'Efectivo',
      card: 'Tarjeta',
      deuna: 'DeUna'
    }[method];

    setCustomerData(prev => ({ ...prev, paymentMethod: paymentMethodName }));
    setStep('processing');
  };

  const handlePaymentSuccess = React.useCallback(async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      await checkout(customerData);

      // Resetear todo
      setCustomerData({
        customerName: '',
        customerEmail: '',
        phone: '',
        address: '',
        paymentMethod: 'Efectivo'
      });
      setStep('cart');
      setSelectedPaymentMethod(null);
      setIsFinalConsumer(false);
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
    if (step === 'processing') {
      setStep('paymentMethod');
      setSelectedPaymentMethod(null);
    } else if (step === 'paymentMethod') {
      setStep('customerData');
    } else if (step === 'customerData') {
      setStep('cart');
    }
  };

  if (!state.isOpen) return null;

  const canBeFinalConsumer = total < 50;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={handleClose}
      />
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl overflow-y-auto">
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-3 bg-white sticky top-0 z-10">
            <div className="flex items-center">
              {step === 'cart' && (
                <>
                  <ShoppingCart className="h-6 w-6 mr-2" />
                  <h2 className="text-lg font-semibold">Carrito de Compras</h2>
                </>
              )}
              {step === 'customerData' && (
                <>
                  <User className="h-6 w-6 mr-2 text-blue-600" />
                  <h2 className="text-lg font-semibold">Datos de Cliente</h2>
                </>
              )}
              {step === 'paymentMethod' && (
                <>
                  <CreditCard className="h-6 w-6 mr-2 text-green-600" />
                  <h2 className="text-lg font-semibold">Método de Pago</h2>
                </>
              )}
              {step === 'processing' && (
                <>
                  <CreditCard className="h-6 w-6 mr-2 text-purple-600" />
                  <h2 className="text-lg font-semibold">Procesando Pago</h2>
                </>
              )}
            </div>
            <button
              onClick={handleClose}
              className="rounded-full p-1 hover:bg-gray-100"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {/* Contenido */}
          <div className="flex-1 overflow-y-auto">
            {/* PASO 1: Carrito */}
            {step === 'cart' && (
              <>
                <div className="p-4">
                  {state.items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500 py-20">
                      <ShoppingCart className="h-16 w-16 mb-4" />
                      <p className="text-lg">Tu carrito está vacío</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {state.items.map((item) => (
                        <div key={item.id} className="flex items-center space-x-4 border-b pb-4">
                          <img
                            src={item.image || 'https://via.placeholder.com/80'}
                            alt={item.title}
                            className="h-20 w-20 object-cover rounded"
                          />
                          <div className="flex-1">
                            <h3 className="font-medium">{item.title}</h3>
                            <p className="text-gray-600">
                              ${item.price.toFixed(2)} por {item.unit}
                            </p>
                            <div className="flex items-center space-x-2 mt-2">
                              <button
                                onClick={() =>
                                  dispatch({
                                    type: 'UPDATE_QUANTITY',
                                    payload: { id: item.id, quantity: Math.max(0, item.quantity - 1) },
                                  })
                                }
                                className="p-1 rounded-full bg-gray-100 hover:bg-gray-200"
                              >
                                <Minus className="h-4 w-4" />
                              </button>
                              <span className="w-8 text-center">{item.quantity}</span>
                              <button
                                onClick={() =>
                                  dispatch({
                                    type: 'UPDATE_QUANTITY',
                                    payload: { id: item.id, quantity: item.quantity + 1 },
                                  })
                                }
                                className="p-1 rounded-full bg-gray-100 hover:bg-gray-200"
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                          <button
                            onClick={() => dispatch({ type: 'REMOVE_ITEM', payload: item.id })}
                            className="text-red-500 hover:text-red-600"
                          >
                            <X className="h-5 w-5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border-t p-4 bg-white sticky bottom-0">
                  <div className="flex justify-between mb-4">
                    <span className="font-semibold">Total:</span>
                    <span className="font-semibold text-xl">${total.toFixed(2)}</span>
                  </div>
                  <button
                    onClick={() => setStep('customerData')}
                    className="w-full bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-medium py-3 px-4 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={state.items.length === 0}
                  >
                    Proceder al Pago
                  </button>
                </div>
              </>
            )}

            {/* PASO 2: Datos del Cliente */}
            {step === 'customerData' && (
              <div className="p-4">
                <form onSubmit={handleCustomerDataSubmit} className="space-y-4">
                  {canBeFinalConsumer && (
                    <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                      <label className="flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isFinalConsumer}
                          onChange={(e) => setIsFinalConsumer(e.target.checked)}
                          className="mr-3 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <div className="flex items-center">
                          <User className="h-5 w-5 mr-2 text-blue-600" />
                          <div>
                            <span className="font-medium text-blue-900">Consumidor Final</span>
                            <p className="text-xs text-blue-700 mt-0.5">
                              No requiere factura (disponible solo para compras menores a $50)
                            </p>
                          </div>
                        </div>
                      </label>
                    </div>
                  )}

                  {user && !isFinalConsumer && (
                    <div className="bg-green-50 border border-green-200 rounded-md p-3 text-sm">
                      <div className="flex items-center text-green-800">
                        <User className="h-5 w-5 mr-2" />
                        <span className="font-medium">Datos cargados desde tu cuenta</span>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Nombre Completo *
                    </label>
                    <input
                      type="text"
                      required
                      value={customerData.customerName}
                      onChange={(e) => setCustomerData({ ...customerData, customerName: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-yellow-400 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-600"
                      placeholder="Juan Pérez"
                      disabled={isFinalConsumer}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email *
                    </label>
                    <input
                      type="email"
                      required
                      value={customerData.customerEmail}
                      onChange={(e) => setCustomerData({ ...customerData, customerEmail: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-yellow-400 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-600"
                      placeholder="juan@example.com"
                      disabled={isFinalConsumer}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Teléfono *
                    </label>
                    <input
                      type="tel"
                      required
                      value={customerData.phone}
                      onChange={(e) => setCustomerData({ ...customerData, phone: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-yellow-400 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-600"
                      placeholder="555-1234"
                      disabled={isFinalConsumer}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Dirección de Envío *
                    </label>
                    <textarea
                      required
                      value={customerData.address}
                      onChange={(e) => setCustomerData({ ...customerData, address: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-yellow-400 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-600"
                      placeholder="Calle Falsa 123, Ciudad, País"
                      rows={3}
                      disabled={isFinalConsumer}
                    />
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      type="button"
                      onClick={handleBack}
                      className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-900 font-medium py-3 px-4 rounded-md transition-colors"
                    >
                      Volver
                    </button>
                    <button
                      type="submit"
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-md transition-colors"
                    >
                      Continuar
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* PASO 3: Selección de Método de Pago */}
            {step === 'paymentMethod' && (
              <PaymentMethodSelector
                total={total}
                onSelect={handlePaymentMethodSelect}
              />
            )}

            {/* PASO 4: Procesamiento de Pago */}
            {step === 'processing' && selectedPaymentMethod && (
              <>
                {selectedPaymentMethod === 'cash' && (
                  <CashPayment
                    total={total}
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
    </div>
  );
}
