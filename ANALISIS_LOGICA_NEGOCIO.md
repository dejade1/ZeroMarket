# Análisis de Lógica de Negocio y Gestión de Inventario

## 1. Gestión de Inventario FIFO (First-In, First-Out)

### Situación Actual
El sistema implementa una lógica FIFO para el consumo de lotes en `batch-service.ts`. Sin embargo, existen riesgos críticos de consistencia de datos.

### Problemas Identificados

#### 1.1 Falta de Atomicidad en Transacciones
**Riesgo:** Alto
**Descripción:** La función `consumeBatchesFIFO` realiza múltiples operaciones de escritura (actualizar varios lotes) de forma secuencial y separada.
**Escenario de Fallo:** Si un usuario compra 10 unidades que requieren consumir 3 lotes diferentes, y el sistema falla al actualizar el tercer lote, los dos primeros quedarán marcados como consumidos pero la orden podría fallar, resultando en pérdida de inventario.

#### 1.2 Condiciones de Carrera (Race Conditions)
**Riesgo:** Crítico
**Descripción:** En un entorno web, si dos usuarios intentan comprar el mismo producto simultáneamente:
1. Usuario A lee los lotes disponibles.
2. Usuario B lee los mismos lotes disponibles.
3. Usuario A consume el Lote 1.
4. Usuario B intenta consumir el Lote 1 (que ya no tiene stock), causando error o stock negativo.

#### 1.3 Desincronización entre Stock Total y Lotes
**Riesgo:** Medio
**Descripción:** El stock total del producto se almacena en la tabla `products`, mientras que el detalle está en `batches`. Es posible que `product.stock` no coincida con `sum(batches.quantity)`.

---

## 2. Gestión del Carrito de Compras

### Problemas Identificados

#### 2.1 Validación de Stock en Tiempo Real
**Descripción:** El carrito valida el stock al momento de añadir el producto, pero no vuelve a validar al momento del checkout final.
**Impacto:** Un usuario puede tener un producto en su carrito por horas. Si otro usuario compra el último item, el primer usuario recibirá un error al intentar pagar, o peor, el sistema permitirá la venta sin stock.

#### 2.2 Bloqueo de Inventario
**Descripción:** No existe mecanismo de "reserva" temporal de stock.
**Recomendación:** Implementar una reserva temporal (ej. 15 minutos) al iniciar el checkout.

---

## 3. Integración con Hardware (LEDs)

### Problemas Identificados

#### 3.1 Manejo de Errores de Conexión
**Descripción:** Si el controlador LED no está disponible, el sistema podría bloquearse o lanzar errores no manejados en el frontend.
**Solución:** Implementar un patrón "Fire and Forget" con degradación elegante. Si los LEDs fallan, la venta debe proceder y solo registrar un warning.

---

## 4. Propuesta de Solución Robusta

### 4.1 Transacciones ACID
Implementar una función `executeTransaction` en `db.ts` que permita agrupar operaciones.

```typescript
// Ejemplo conceptual
await db.transaction('rw', [db.products, db.batches, db.orders], async () => {
  const batches = await db.batches.where('productId').equals(id).toArray();
  // Lógica FIFO dentro de la transacción
  // Si algo falla, todo se revierte automáticamente
});
```

### 4.2 Verificación de Integridad
Crear una tarea programada (o al inicio) que verifique:
`Product.stock == Sum(Batch.quantity)`
Si hay discrepancia, corregir automáticamente o alertar al admin.

### 4.3 Optimización de Consultas
Indexar `expiryDate` en la base de datos para recuperar rápidamente los lotes próximos a vencer sin recorrer toda la tabla.

---

## 5. Plan de Acción

1. **Refactorizar `batch-service.ts`**: Implementar transacciones reales.
2. **Mejorar `inventory.ts`**: Asegurar que `updateStock` use la lógica de lotes correctamente.
3. **Actualizar `Cart.tsx`**: Re-validar stock antes de finalizar compra.
4. **Crear Tests de Lógica**: Simular compras concurrentes para validar robustez.
