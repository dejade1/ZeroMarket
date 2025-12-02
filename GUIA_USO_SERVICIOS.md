# 📚 Guía de Uso de Servicios Implementados

## 🎯 Cómo Usar los Nuevos Servicios

Esta guía muestra cómo usar los servicios corregidos en tus componentes.

---

## 1. Sistema de Manejo de Errores

### Uso Básico en Componentes

```typescript
import { useErrorHandler, ValidationError } from '../utils/errorHandler';

function MyComponent() {
  const { error, handleError, clearError, hasError } = useErrorHandler();

  const handleSubmit = async () => {
    try {
      // Tu lógica aquí
      const result = await someAsyncOperation();
      
      if (!result) {
        throw new ValidationError('Operación falló');
      }
    } catch (err) {
      handleError(err); // Maneja cualquier tipo de error
    }
  };

  return (
    <div>
      {hasError && (
        <div className="error-message">
          {error?.message}
          <button onClick={clearError}>Cerrar</button>
        </div>
      )}
      <button onClick={handleSubmit}>Enviar</button>
    </div>
  );
}
```

### Manejo de Errores Asíncronos

```typescript
import { handleAsyncError, DatabaseError } from '../utils/errorHandler';

async function fetchUserData(userId: number) {
  const [error, data] = await handleAsyncError(
    fetch(`/api/users/${userId}`).then(r => r.json()),
    'Error al obtener datos del usuario'
  );

  if (error) {
    console.error('Error:', error.message);
    return null;
  }

  return data;
}
```

---

## 2. Sistema de Validación

### Validación de Formularios

```typescript
import {
  validateField,
  validateFields,
  sanitizeString,
  sanitizeEmail,
  isStrongPassword,
  getPasswordStrength
} from '../utils/validation';

function RegistrationForm() {
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: ''
  });
  const [errors, setErrors] = useState<string[]>([]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validar múltiples campos
    const result = validateFields([
      {
        value: formData.username,
        fieldName: 'Usuario',
        rules: ['required', 'username']
      },
      {
        value: formData.email,
        fieldName: 'Email',
        rules: ['required', 'email']
      },
      {
        value: formData.password,
        fieldName: 'Contraseña',
        rules: ['required', 'password']
      }
    ]);

    if (!result.isValid) {
      setErrors(result.errors);
      return;
    }

    // Sanitizar antes de enviar
    const cleanData = {
      username: sanitizeString(formData.username),
      email: sanitizeEmail(formData.email),
      password: formData.password // No sanitizar contraseñas
    };

    // Enviar datos limpios
    submitForm(cleanData);
  };

  return (
    <form onSubmit={handleSubmit}>
      {errors.length > 0 && (
        <div className="errors">
          {errors.map((error, i) => (
            <p key={i}>{error}</p>
          ))}
        </div>
      )}
      {/* Campos del formulario */}
    </form>
  );
}
```

### Indicador de Fortaleza de Contraseña

```typescript
import { getPasswordStrength } from '../utils/validation';

function PasswordInput() {
  const [password, setPassword] = useState('');
  const strength = getPasswordStrength(password);

  return (
    <div>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <div className="password-strength">
        <div className="strength-bar" style={{ width: `${(strength.score / 6) * 100}%` }} />
        <p>Fortaleza: {strength.score}/6</p>
        {strength.feedback.length > 0 && (
          <ul>
            {strength.feedback.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

---

## 3. Servicio de Lotes (Batch Service)

### Añadir un Nuevo Lote

```typescript
import { addBatch } from '../lib/batch-service';
import { useErrorHandler } from '../utils/errorHandler';

function AddBatchForm() {
  const { handleError } = useErrorHandler();

  const handleAddBatch = async () => {
    try {
      const batchId = await addBatch({
        productId: 1,
        batchCode: 'BATCH-001',
        quantity: 100,
        expiryDate: '2025-12-31',
        createdAt: new Date().toISOString()
      });

      console.log('Lote añadido con ID:', batchId);
    } catch (error) {
      handleError(error);
    }
  };

  return <button onClick={handleAddBatch}>Añadir Lote</button>;
}
```

### Mostrar Lotes Próximos a Vencer

```typescript
import { getExpiringBatches } from '../lib/batch-service';
import { useEffect, useState } from 'react';

function ExpiringBatchesAlert() {
  const [expiringBatches, setExpiringBatches] = useState([]);

  useEffect(() => {
    async function loadExpiringBatches() {
      const batches = await getExpiringBatches(7); // 7 días
      setExpiringBatches(batches);
    }
    loadExpiringBatches();
  }, []);

  if (expiringBatches.length === 0) return null;

  return (
    <div className="alert alert-warning">
      <h3>⚠️ Lotes próximos a vencer</h3>
      <ul>
        {expiringBatches.map(batch => (
          <li key={batch.id}>
            {batch.batchCode} - Vence: {batch.expiryDate}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

---

## 4. Servicio de Inventario

### Crear una Orden

```typescript
import { createOrder } from '../lib/inventory';
import { useErrorHandler } from '../utils/errorHandler';

function CheckoutButton({ cartItems }) {
  const { handleError } = useErrorHandler();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleCheckout = async () => {
    setIsProcessing(true);

    try {
      const orderId = await createOrder(cartItems);
      console.log('Orden creada:', orderId);
      alert('¡Orden procesada exitosamente!');
      // Limpiar carrito, redirigir, etc.
    } catch (error) {
      handleError(error);
      alert('Error al procesar la orden');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <button onClick={handleCheckout} disabled={isProcessing}>
      {isProcessing ? 'Procesando...' : 'Finalizar Compra'}
    </button>
  );
}
```

---

## 5. Gestor de LEDs (Hardware)

### Enviar Comandos al Hardware

```typescript
import { ledManager } from '../lib/hardware/led-manager';

function ProductActions({ productId }) {
  const handleAddStock = () => {
    // Enviar comando al LED (no bloqueante)
    ledManager.sendCommand({
      productId,
      quantity: 10,
      type: 'add'
    });
  };

  const handleRemoveStock = () => {
    ledManager.sendCommand({
      productId,
      quantity: 5,
      type: 'remove'
    });
  };

  const handleAlert = () => {
    ledManager.sendCommand({
      productId,
      quantity: 0,
      type: 'alert'
    });
  };

  return (
    <div>
      <button onClick={handleAddStock}>Añadir Stock</button>
      <button onClick={handleRemoveStock}>Quitar Stock</button>
      <button onClick={handleAlert}>Alerta</button>
    </div>
  );
}
```

---

## 6. Ejemplo Completo: Componente de Gestión de Productos

```typescript
import { useState, useEffect } from 'react';
import { useErrorHandler } from '../utils/errorHandler';
import { validateField, sanitizeString, sanitizeNumber } from '../utils/validation';
import { addBatch, getExpiringBatches } from '../lib/batch-service';
import { ledManager } from '../lib/hardware/led-manager';

function ProductManagement() {
  const { error, handleError, clearError } = useErrorHandler();
  const [products, setProducts] = useState([]);
  const [expiringBatches, setExpiringBatches] = useState([]);

  // Cargar datos
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const batches = await getExpiringBatches(7);
      setExpiringBatches(batches);
    } catch (err) {
      handleError(err);
    }
  };

  const handleAddBatch = async (productId: number, quantity: number) => {
    try {
      // Validar cantidad
      const validation = validateField(quantity, 'Cantidad', [
        'required',
        'positiveNumber',
        { min: 1 },
        { max: 10000 }
      ]);

      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
      }

      // Añadir lote
      await addBatch({
        productId,
        batchCode: `BATCH-${Date.now()}`,
        quantity: sanitizeNumber(quantity) || 0,
        expiryDate: '2025-12-31',
        createdAt: new Date().toISOString()
      });

      // Notificar al hardware
      ledManager.sendCommand({
        productId,
        quantity,
        type: 'add'
      });

      // Recargar datos
      await loadData();
    } catch (err) {
      handleError(err);
    }
  };

  return (
    <div>
      <h1>Gestión de Productos</h1>

      {error && (
        <div className="error-banner">
          <p>{error.message}</p>
          <button onClick={clearError}>Cerrar</button>
        </div>
      )}

      {expiringBatches.length > 0 && (
        <div className="warning-banner">
          <h3>⚠️ {expiringBatches.length} lotes próximos a vencer</h3>
        </div>
      )}

      {/* Resto del componente */}
    </div>
  );
}

export default ProductManagement;
```

---

## 📝 Mejores Prácticas

### 1. Siempre Sanitizar Inputs del Usuario
```typescript
// ❌ Malo
const username = formData.username;

// ✅ Bueno
const username = sanitizeString(formData.username);
```

### 2. Validar Antes de Procesar
```typescript
// ❌ Malo
await createOrder(items);

// ✅ Bueno
const validation = validateFields([...]);
if (!validation.isValid) {
  throw new ValidationError(validation.errors.join(', '));
}
await createOrder(items);
```

### 3. Usar el Hook de Errores
```typescript
// ❌ Malo
try {
  await operation();
} catch (err) {
  console.error(err);
  setError(err.message);
}

// ✅ Bueno
const { handleError } = useErrorHandler();
try {
  await operation();
} catch (err) {
  handleError(err); // Maneja logging, normalización, etc.
}
```

### 4. No Bloquear la UI con Hardware
```typescript
// ❌ Malo
await sendLEDCommand(data); // Bloquea la UI

// ✅ Bueno
ledManager.sendCommand(data); // No bloqueante
```

---

## 🔧 Troubleshooting

### Error: "Cannot find module"
- Verifica que las rutas de import sean correctas
- Asegúrate de que los archivos existan en `src/utils/` y `src/lib/`

### Error de TypeScript
- Ejecuta `npx tsc --noEmit` para ver errores de tipos
- Verifica que todos los tipos estén importados correctamente

### Validación no Funciona
- Revisa que estés usando las reglas correctas
- Verifica que el valor no sea `undefined` o `null`

---

**¡Listo para usar!** 🎉

Estos servicios están diseñados para ser fáciles de usar y mantener. Si tienes dudas, revisa los comentarios en el código fuente.
