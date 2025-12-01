# Guía de Uso - Sistema de Gestión de Lotes

## Para Administradores

### 1. Ver Lotes Próximos a Caducarse

1. Accede al **Panel de Administración**
2. Haz clic en la pestaña **"Alertas de Caducidad"**
3. Verás todos los lotes próximos a vencer organizados por urgencia:
   - 🔴 **Rojo (0-7 días):** Crítico, vender primero
   - 🟠 **Naranja (8-15 días):** Urgente
   - 🟡 **Amarillo (16-30 días):** Precaución

Puedes cambiar el rango de días con el selector dropdown.

### 2. Buscar Lotes de un Producto Específico

1. Accede a **Panel de Administración**
2. Ve a **"Lotes y Reportes"**
3. En la sección **"Búsqueda de Lotes por Producto"**:
   - Ingresa el ID del producto
   - Presiona Enter o haz clic en "Buscar"
4. Se mostrará una tabla con:
   - Código del lote
   - Cantidad disponible
   - Fecha de caducidad
   - Días restantes
   - Estado del lote

### 3. Ver Información de Lotes de un Producto

En la misma sección de **"Lotes y Reportes"**, en **"Información de Lotes"**:
- Muestra todos los lotes del producto seleccionado
- Ordenados por fecha de caducidad (más próximos primero)
- Incluye indicadores visuales de estado
- Muestra stock total en lotes

## Cómo Funciona la Metodología FIFO

### ¿Qué es FIFO?
**FIFO (First In First Out)** = "Primero entra, primero sale"

Significa que los productos más antiguos se venden primero, asegurando que no se queden almacenados hasta vencer.

### Proceso Automático

Cuando un cliente compra un producto:

```
1. Se revisan todos los lotes del producto
2. El sistema ordena por fecha de caducidad (más próximos primero)
3. Se descuenta la cantidad del lote más antiguo
4. Si el lote no tiene suficiente cantidad, se usa el siguiente
5. El stock general del producto se reduce
6. La orden se completa
```

**Ejemplo:**
- Tienes 3 lotes de Arroz:
  - Lote A: 10 unidades, vence 2024-12-15
  - Lote B: 20 unidades, vence 2025-01-10
  - Lote C: 15 unidades, vence 2025-02-20

- Cliente compra 25 unidades
- Sistema descuenta:
  - 10 del Lote A (agotado)
  - 15 del Lote B (quedan 5)
  - Lotes B y C mantienen su cantidad

## Estados de los Lotes

### ✓ Vigente (Verde)
- Quedan más de 30 días para vencer
- Situación normal

### ⚠️ Próximo a Vencer (Amarillo)
- Vence en 30 días o menos
- Prioridad en venta

### 🔴 Vencido (Rojo)
- Ya pasó la fecha de caducidad
- No debe venderse

## Tips Importantes

💡 **Mantener stock balanceado:** Realiza compras regulares para no acumular lotes antiguos

💡 **Revisar alertas diariamente:** Especialmente en días críticos

💡 **Usar búsqueda para auditar:** Verifica regularmente los lotes de productos que se venden lentamente

💡 **Comunicar con vendedores:** Asegurate que el equipo de ventas priorice productos próximos a vencer

## Problemas Comunes

### P: ¿Por qué no se vende el Lote A si es el más antiguo?
**R:** El Lote A se venderá cuando haya demanda. El sistema FIFO automáticamente descuenta del más antiguo cuando hay ventas. Si nota que acumula inventario, considere promociones.

### P: ¿Qué pasa si se vence un lote?
**R:** El sistema lo marcará como vencido. No aparecerá como disponible para venta. Debe desecharlo según regulaciones.

### P: ¿Puedo ver el historial de ventas por lote?
**R:** Sí, en la pestaña **"Órdenes y Transacciones"** puedes ver toda el historial de ventas.

### P: ¿Los nuevos lotes reemplazan los antiguos?
**R:** No. Los lotes coexisten. El sistema FIFO automáticamente elige los más antiguos para vender.
