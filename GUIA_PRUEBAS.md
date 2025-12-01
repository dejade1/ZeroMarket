# 🧪 GUÍA DE PRUEBAS - Sistema FIFO

## Test Plan Completo

### Requisitos Previos
- ✅ Base de datos inicializada
- ✅ Aplicación corriendo
- ✅ Panel admin accesible
- ✅ Base de datos con datos de prueba

---

## TEST 1: Verificar que BatchManager es Solo Lectura

### Procedimiento
```
1. Ir a Panel Admin → Lotes y Reportes
2. En sección "Información de Lotes"
3. Intentar hacer clic en los campos
```

### Resultado Esperado
```
✅ No hay campos de texto para editar
✅ Se muestra tabla con información
✅ No hay botones "Guardar" o "Eliminar"
✅ Solo lectura de información
```

### Lo que NO Deberías Ver
```
❌ Input para "Código de Lote"
❌ Input para "Cantidad"
❌ Input para "Fecha de Caducidad"
❌ Botón "Guardar Lote"
```

---

## TEST 2: Búsqueda de Lotes por Producto

### Procedimiento
```
1. Ir a Panel Admin → Lotes y Reportes
2. En "Búsqueda de Lotes por Producto"
3. Ingresa un ID de producto (ej: 1)
4. Presiona Enter o clic en "Buscar"
```

### Resultado Esperado
```
✅ Se muestra tabla con lotes del producto
✅ Se muestra nombre del producto
✅ Se cuenta cantidad de lotes
✅ Se calcula stock total en lotes
```

### Tabla Debe Mostrar
```
- Código Lote
- Cantidad
- Fecha Caducidad
- Días Restantes
- Estado (✓ Ok / ⚠️ Próximo / 🔴 Vencido)
```

---

## TEST 3: Visualización de Alertas de Caducidad

### Procedimiento
```
1. Ir a Panel Admin → Alertas de Caducidad
2. Observar lotes mostrados
3. Cambiar filtro de días (7/14/30/60/90)
```

### Resultado Esperado
```
✅ Se muestran lotes próximos a vencer
✅ Se clasifican por urgencia:
   - 🔴 0-7 días (Crítico)
   - 🟠 8-15 días (Urgente)  
   - 🟡 16-30 días (Precaución)
✅ Filtro cambia cantidad de lotes mostrados
✅ Información clara de cada lote
```

### Indicadores Visuales
```
✅ Color rojo para crítico
✅ Color naranja para urgente
✅ Color amarillo para precaución
✅ Número de lotes en esquina
```

---

## TEST 4: Funcionamiento del FIFO

### Escenario de Prueba

**Preparación:**
```
Crear 3 lotes de Arroz Premium (Producto ID: 1):
1. Lote ARPre-A: 50 unidades, Vence 2024-12-15
2. Lote ARPre-B: 30 unidades, Vence 2025-01-10
3. Lote ARPre-C: 20 unidades, Vence 2025-02-20
```

### Procedimiento 1: Venta que consume un lote completo
```
1. Cliente compra 50 unidades de Arroz
2. Se realiza el checkout
3. Ir a Búsqueda de Lotes → Producto 1
```

### Resultado Esperado
```
✅ ARPre-A: 0 unidades (consumido completamente)
✅ ARPre-B: 30 unidades (sin cambios)
✅ ARPre-C: 20 unidades (sin cambios)
✅ Stock general: bajo 50 unidades
```

### Procedimiento 2: Venta que consume múltiples lotes
```
1. Cliente compra 60 unidades de Arroz
2. Se realiza el checkout
3. Ir a Búsqueda de Lotes → Producto 1
```

### Resultado Esperado (FIFO en Acción)
```
✅ ARPre-B: 0 unidades (consumió 30, quedaban 30)
✅ ARPre-C: 0 unidades (consumió 20, quedaban 20)
                          (total 30+20=50, pedía 60, no hay más)
   
O si hay suficiente:
✅ Que se descuentan primero los más viejos
✅ Luego los siguientes si es necesario
```

### Procedimiento 3: Venta parcial de un lote
```
1. Cliente compra 35 unidades
2. Se realiza el checkout
3. Ir a Búsqueda de Lotes → Producto 1
```

### Resultado Esperado
```
✅ Primer lote vigente se reduce en 35
✅ Otros lotes sin cambios
✅ Stock general baja 35 unidades
```

---

## TEST 5: Sincronización Stock General + Lotes

### Procedimiento
```
1. Ir a Inventario → Ver stock de un producto
2. Anotar número actual
3. Realizar una venta de ese producto
4. Ir a Búsqueda de Lotes → Verificar descuento
5. Volver a Inventario → Verificar nuevo stock
```

### Resultado Esperado
```
✅ Stock general: bajó X unidades
✅ Lotes: descuentos sumados = X unidades
✅ Sincronización perfecta
```

### Validación
```
Stock General Anterior: 150
Lotes Anteriores: 150 (50+30+20+50)
Sale 50

Stock General Nuevo: 100
Lotes Nuevos: 100 (0+30+20+50)
Descuento Total: 50 ✓
```

---

## TEST 6: Orden Cronológico FIFO

### Procedimiento
```
1. Crear múltiples lotes con fechas próximas
2. Realizar varias ventas progresivas
3. Rastrear qué lotes se descuentan en orden
```

### Validación de Orden
```
Lote A: Vence 2024-12-15  ← Debería venderse primero
Lote B: Vence 2024-12-25  ← Después éste
Lote C: Vence 2025-01-15  ← Finalmente éste

Venta 1 (40 unidades):
  → Se descuenta de A (tiene 50) → A queda con 10

Venta 2 (20 unidades):
  → Se descuenta de A (quedan 10 y necesita 20)
  → Se descuenta de B (10 de B, quedaba 30) → B queda con 20

Venta 3 (50 unidades):
  → Se descuenta de B (quedan 20, necesita 50)
  → Se descuenta de C (30 de C, quedaba 70) → C queda con 40

✅ Orden FIFO respetado
```

---

## TEST 7: Alerta de Urgencia

### Procedimiento
```
1. Crear lote que vence en 5 días
2. Ir a Alertas de Caducidad
3. Verifica que aparezca en 🔴 Crítico
```

### Resultado Esperado
```
✅ Aparece con emoji 🔴
✅ Fondo rojo
✅ Texto clara de urgencia
✅ Contador correcta de días
```

### Prueba de Categorización
```
Lote 1: Vence en 3 días    → 🔴 Crítico (0-7)
Lote 2: Vence en 10 días   → 🟠 Urgente (8-15)
Lote 3: Vence en 25 días   → 🟡 Precaución (16-30)
Lote 4: Vence en 60 días   → No aparece (>30)
```

---

## TEST 8: Filtro de Días de Alerta

### Procedimiento
```
1. Ir a Alertas de Caducidad
2. Cambiar selector a "7 días"
3. Anotar lotes mostrados
4. Cambiar a "30 días"
5. Anotar nuevos lotes
6. Cambiar a "60 días"
```

### Resultado Esperado
```
7 días:  Muestra solo 🔴 Crítico
14 días: Muestra 🔴 y algunos 🟠
30 días: Muestra 🔴, 🟠, y 🟡
60 días: Muestra más lotes adicionales
90 días: Muestra aún más lotes
```

---

## TEST 9: Consistencia de Datos

### Procedimiento
```
1. Ir a Inventario → anotar stock
2. Ir a Búsqueda de Lotes → sumar lotes
3. Valores deben coincidir
4. Después de venta:
   - Ir a Inventario
   - Ir a Búsqueda
   - Valores deben coincidir de nuevo
```

### Validación
```
Antes:
  Inventario General: 150
  Suma de Lotes:      150 ✓

Venta 30 unidades:

Después:
  Inventario General: 120
  Suma de Lotes:      120 ✓
  
Sincronización: ✅ PERFECTA
```

---

## TEST 10: Error Handling

### Procedimiento
```
1. Intentar vender más unidades que las disponibles
2. Observar mensaje de error
```

### Resultado Esperado
```
✅ Mensaje claro de error
✅ Stock no se afecta
✅ Lotes no se descuentan
✅ Orden no se crea
```

---

## 📊 Tabla de Resultados

```
┌───────┬─────────────────────────────────┬────────┬─────────┐
│ TEST  │ DESCRIPCIÓN                      │ STATUS │ NOTAS   │
├───────┼─────────────────────────────────┼────────┼─────────┤
│   1   │ BatchManager solo lectura       │  ___   │         │
│   2   │ Búsqueda de lotes por ID       │  ___   │         │
│   3   │ Alertas de caducidad           │  ___   │         │
│   4   │ Funcionamiento FIFO            │  ___   │         │
│   5   │ Sincronización stock/lotes     │  ___   │         │
│   6   │ Orden cronológico FIFO         │  ___   │         │
│   7   │ Alertas de urgencia            │  ___   │         │
│   8   │ Filtro de días                 │  ___   │         │
│   9   │ Consistencia de datos          │  ___   │         │
│  10   │ Error handling                 │  ___   │         │
└───────┴─────────────────────────────────┴────────┴─────────┘

STATUS: ✅ Pasó | ❌ Falló | 🔄 En Revisión
```

---

## ✅ Checklist Final

- [ ] TEST 1 completado
- [ ] TEST 2 completado
- [ ] TEST 3 completado
- [ ] TEST 4 completado
- [ ] TEST 5 completado
- [ ] TEST 6 completado
- [ ] TEST 7 completado
- [ ] TEST 8 completado
- [ ] TEST 9 completado
- [ ] TEST 10 completado
- [ ] Todos los tests PASARON ✅
- [ ] Sistema LISTO PARA PRODUCCIÓN 🚀

---

## 🐛 Reporte de Problemas

Si encuentras algún problema durante las pruebas:

1. **Problema:** [Describe qué sucedió]
2. **Pasos para reproducir:** [Cómo repetir el problema]
3. **Resultado esperado:** [Qué debería pasar]
4. **Resultado actual:** [Qué pasó realmente]
5. **Screenshots:** [Si es posible]

---

**Pruebas completadas:** _____/_____  
**Fecha:** ___________  
**Evaluador:** _________________  
**Observaciones:** _______________  
**APROBADO:** ☐
