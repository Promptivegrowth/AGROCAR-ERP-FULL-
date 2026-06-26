<div align="center">

# 📒 Guía del Módulo Contabilidad

**AGROCAR S.R.L.** · *Pasión hecha a mano*
RUC 20519883296 · Tacna, Perú

---

*Documento de pruebas y observaciones · Junio 2026*
*Cumplimiento: PCGE Modificado vigente · Resolución CNC N° 002-2019-EF/30*

</div>

---

## 🎯 Para qué sirve este documento

Esta guía está hecha para que el **contador externo de AGROCAR** pueda probar el módulo de contabilidad junto con Daniel y **dejar sus observaciones** antes del go-live oficial. No reemplaza la formación contable — asume que el lector sabe contabilidad peruana.

### Antes de empezar — estado del sistema (al 26/06/2026)

| Componente | Estado |
|---|---|
| Plan de cuentas precargado | **142 cuentas** (76 de movimiento) |
| Asientos contables | **0** (sistema limpio para pruebas) |
| Período abierto | **Junio 2026** |
| Transacciones operativas pendientes de contabilizar | **162** (133 ventas + 23 cobros + 6 compras) |

> 💡 **Importante**: Como hay 162 transacciones reales esperando, es la oportunidad perfecta para que el contador vea cómo el sistema genera asientos automáticamente desde la operación.

---

## 🗺️ Mapa rápido del módulo

| Pantalla | Ruta | Propósito |
|---|---|---|
| 🏠 **Hub** | `/contabilidad` | Tarjetas de acceso a todo |
| 📖 Plan de Cuentas | `/contabilidad/cuentas` | Catálogo PCGE + agregar subcuentas |
| 📝 Libro Diario | `/contabilidad/diario` | Asientos manuales + revisar/asentar/anular |
| ⚡ Asientos Automáticos | `/contabilidad/automaticos` | Generar asientos desde ventas/cobros/compras |
| 📊 Libro Mayor | `/contabilidad/mayor` | Movimientos y saldo por cuenta |
| 📈 Balance de Comprobación | `/contabilidad/balance` | Sumas y saldos · validación general |
| 💹 Estado de Resultados | `/contabilidad/estado-resultados` | Utilidad del período |
| 🔒 Períodos Contables | `/contabilidad/periodos` | Cierre mensual de libros |

**Acceso desde el ERP**: Sidebar izquierdo → **Contabilidad** (icono 📖)

> 🔐 Solo los roles **administrador**, **gerente** y **contador** ven este módulo.

---

## 🧪 Plan de pruebas sugerido para el contador

### Ronda 1 · Reconocer el plan de cuentas (5 min)

1. Entrar a **📖 Plan de Cuentas**
2. Verificar que estén las cuentas que el contador usa habitualmente:
   - **1011** — Caja MN
   - **1041** — Cuentas corrientes operativas (bancos)
   - **1212** — Facturas, boletas y otros — Emitidas en cartera (CxC)
   - **40111** — IGV cuenta propia
   - **40112** — IGV crédito fiscal
   - **40115** — IGV Detracciones cuenta del Banco de la Nación
   - **4212** — Facturas, boletas y otros — Emitidas (CxP)
   - **6011** — Mercaderías manufacturadas
   - **70111** — Ventas mercaderías terceros
3. **Buscar** una cuenta por código o nombre (input de búsqueda arriba)
4. **Filtrar** por clase (botones 1-9 con colores)

#### ✏️ Observación esperada

> ¿Faltan cuentas específicas que el contador usa? Si Daniel agrega un activo fijo, ¿necesita una subcuenta personalizada bajo 3361?
> Si falta alguna, click en "**+ Nueva subcuenta**" y agregar.

---

### Ronda 2 · Asiento manual de prueba (10 min)

**Objetivo**: hacer 1 asiento simple — el contador valida que el flujo sea claro.

1. Entrar a **📝 Libro Diario**
2. Click "**+ Nuevo asiento**"
3. Llenar el formulario con este ejemplo (provisión de servicio):
   - **Fecha**: 25/06/2026
   - **Glosa**: "Provisión recibo luz mes junio"
   - **Partida 1**: Cuenta `6363 — Energía y otros` · **Debe: 250.00**
   - **Partida 2**: Cuenta `40111 — IGV cuenta propia` · **Debe: 45.00**
   - **Partida 3**: Cuenta `4212 — Facturas emitidas (CxP)` · **Haber: 295.00**
4. **Observar el indicador** debajo: debe decir `✓ Cuadrado` en verde (S/295.00 = S/295.00)
5. Click "**Crear asiento**"
6. Verá el asiento en la lista con estado **BORRADOR** (amarillo)
7. Hacer click en el número para **expandir** y ver las partidas

#### ✅ Validaciones que hace el sistema (no hay que probarlas, ya están)

- ❌ No deja crear si está descuadrado (S/Debe ≠ S/Haber)
- ❌ No deja usar cuentas agrupadoras (ej: cuenta 60 no recibe asientos, solo 6011, 6021, etc.)
- ❌ No deja crear con menos de 2 partidas
- ✅ Numeración automática `A-YYYYMM-NNNNNN` con bloqueo (no se duplica)
- ✅ Audita quién creó, cuándo, y registra IP

#### ✏️ Observación esperada

> ¿La glosa permite suficiente detalle? ¿La numeración mensual le parece correcta? ¿Quiere ver un campo para el documento origen (n° factura proveedor) en cada partida?

---

### Ronda 3 · Asentar el borrador (2 min)

Los asientos nacen en **BORRADOR** para que el contador los revise antes de hacerlos oficiales.

1. En **📝 Libro Diario**, sobre el asiento creado, click en **✓** (verde)
2. Confirmar el aviso
3. El estado cambia de `BORRADOR` (amarillo) a `ASENTADO` (verde)
4. A partir de ahí **el asiento es inmutable** — no se puede editar
5. Para corregir un asiento asentado, usar la opción **✗ Anular** (con motivo obligatorio mínimo 5 chars)

#### ✏️ Observación esperada

> ¿El contador prefiere asentar uno por uno o en lote? Si quiere lote, ¿desde qué pantalla?

---

### Ronda 4 · Asientos automáticos masivos (10 min)

Aquí es donde el sistema brilla — genera asientos de las 162 operaciones reales del mes.

1. Entrar a **⚡ Asientos Automáticos**
2. Ver el aviso azul explicativo: **PCGE Modificado · qué cuentas usa cada tipo de asiento**
3. Verificar los **KPIs**: ventas, cobros, compras pendientes
4. **Filtrar por fecha** (default últimos 30 días) y por tipo (botones de colores)
5. Click "**⚡ Generar 162 asientos**"
6. Confirmar
7. Esperar ~10 segundos
8. Toast verde: "162 asientos generados en borrador"
9. Volver al **📝 Libro Diario** — ahí están los 162 asientos en borrador

#### 🧾 Esquema contable que aplica (relevante para validar)

##### Cada VENTA genera:

```
Debe  1212 (CxC cartera)        S/ TOTAL
        Haber 70111 (Ventas mercaderías)    S/ SUBTOTAL
        Haber 40111 (IGV cuenta propia)     S/ IGV
```

##### Cada COBRO mixto genera (según los métodos):

```
Debe  1011 (Caja MN)          S/ efectivo
Debe  1012 (Yape/Plin)        S/ yape + plin
Debe  1041 (Bancos)           S/ transferencia
        Haber 1212 (CxC cartera)            S/ aplicado a facturas
        Haber 759 (Otros ingresos)          S/ a cuenta (si hay)
```

##### Cada COMPRA genera:

```
Debe  6011 (Compras mercaderías)  S/ SUBTOTAL
Debe  40112 (IGV crédito fiscal)  S/ IGV
        Haber 4212 (CxP Emitidas)           S/ TOTAL
```

> ⚠️ **Detracciones SPOT 4% (giro carnes)**: el sistema genera el cobro por el monto BRUTO. Cuando el cliente empresarial detrae al pagar, el contador debe **editar el asiento** agregando una partida en cuenta `40115` (IGV Detracciones cuenta del Banco de la Nación) por el 4% retenido, y reducir la cuenta de caja/bancos correspondiente.

#### ✏️ Observación esperada (clave)

> Revisar **5 asientos al azar de cada tipo** (venta, cobro, compra). ¿Las cuentas usadas son las correctas? ¿Algún caso especial requiere cuenta distinta?
> Si la mayoría está bien, los asentar masivamente. Si hay un patrón a corregir, **decirle al desarrollador qué cuenta cambiar y para qué caso**.

---

### Ronda 5 · Libro Mayor por cuenta (5 min)

1. Entrar a **📊 Libro Mayor**
2. Seleccionar cuenta `70111 — Ventas mercaderías terceros`
3. Fechas: del **01/06/2026 al 30/06/2026**
4. Verá:
   - **Saldo inicial** (de movimientos previos al 01/06)
   - Lista cronológica de cada partida
   - **Saldo acumulado** que se actualiza fila por fila
   - **Totales del período** abajo + saldo final destacado en amarillo
5. Click "**🖨 Imprimir / PDF**" — vista print-ready con header de empresa

#### ✏️ Observación esperada

> ¿El formato sirve para presentar a SUNAT? ¿Faltan columnas (ej: documento de origen)? ¿La numeración del asiento es suficiente o quiere ver también el comprobante origen?

---

### Ronda 6 · Balance de Comprobación (3 min)

1. Entrar a **📈 Balance de Comprobación**
2. Período: **01/06/2026 al 30/06/2026**
3. Ver el indicador en la parte superior:
   - 🟢 `✓ Cuadrado` (Total Debe = Total Haber)
   - 🔴 `⚠ Descuadrado` con la diferencia
4. Tabla con todas las cuentas movimentadas:
   - Saldo inicial · Debe · Haber · Saldo final
5. Imprimir → vista limpia para revisión y archivo

#### ✏️ Observación esperada

> Si está descuadrado, **algo está mal y hay que reportarlo**. Cuando los 162 asientos automáticos se asienten, este balance debe cuadrar perfectamente.

---

### Ronda 7 · Estado de Resultados (3 min)

1. Entrar a **💹 Estado de Resultados**
2. Período: **01/06/2026 al 30/06/2026**
3. Verá:
   - 🟢 KPI Ingresos (verde)
   - 🔴 KPI Gastos + Costos (rojo)
   - ⭐ KPI Utilidad (amarillo AGROCAR) con margen %
   - Detalle de cada cuenta clase 7 (ingresos)
   - Detalle de cada cuenta clase 6/9 (gastos/costos)
   - Recuadro grande: **UTILIDAD/PÉRDIDA DEL PERÍODO**
4. Imprimir → vista limpia para entregar al cliente

#### ✏️ Observación esperada

> ¿Necesita una versión más detallada (con subtotales por agrupador)? ¿Quiere ver utilidad bruta separada de utilidad operativa?

---

### Ronda 8 · Cierre de período (2 min)

> ⚠️ **NO hacer esto en pruebas**. Solo leer cómo funciona — el cierre se hace cuando todo el mes esté correcto.

1. Entrar a **🔒 Períodos Contables**
2. Encontrar **Junio 2026** (estado `🟢 ABIERTO`)
3. Botón "**Cerrar**" (no hacer click en pruebas)
4. Si se clickea: el sistema valida que **no haya borradores pendientes** y calcula utilidad
5. Una vez cerrado, los asientos del mes **no se pueden modificar** (trigger de DB lo bloquea)
6. Para corregir algo en período cerrado: generar **asiento de ajuste** en el próximo período abierto
7. Solo el **administrador** puede reabrir (con motivo mínimo 10 chars, queda registrado)

#### ✏️ Observación esperada

> ¿El flujo de cierre/reapertura es coherente con cómo trabaja el contador?

---

## 📋 Plantilla de observaciones del contador

Imprimir esta sección (o copiar/pegar en email) y entregar a Luigi:

```
┌─────────────────────────────────────────────────────────┐
│  OBSERVACIONES DEL CONTADOR · MÓDULO CONTABILIDAD       │
│  AGROCAR S.R.L. · Junio 2026                            │
└─────────────────────────────────────────────────────────┘

Contador (nombre y CPC): ____________________________________

Fecha de la revisión: _________________________________________

═══════════════════════════════════════════════════════════════

1. PLAN DE CUENTAS
   ✅ Conformidad con PCGE Modificado: [ ] SÍ  [ ] NO
   Cuentas faltantes que se necesitan:
   _______________________________________________________
   _______________________________________________________

2. ASIENTOS AUTOMÁTICOS — VENTAS
   ¿Cuentas usadas correctas? [ ] SÍ  [ ] NO
   Comentarios:
   _______________________________________________________

3. ASIENTOS AUTOMÁTICOS — COBROS
   ¿Manejo de Yape/Plin/Efectivo/Transfer correcto? [ ] SÍ [ ] NO
   ¿Detracciones se ven bien? [ ] SÍ  [ ] NO  [ ] N/A
   Comentarios:
   _______________________________________________________

4. ASIENTOS AUTOMÁTICOS — COMPRAS
   ¿Crédito fiscal correctamente reflejado? [ ] SÍ  [ ] NO
   Comentarios:
   _______________________________________________________

5. LIBRO MAYOR
   ¿Formato sirve para presentar a SUNAT? [ ] SÍ  [ ] NO
   Faltantes: ____________________________________________

6. BALANCE DE COMPROBACIÓN
   ¿Cuadra? [ ] SÍ  [ ] NO
   Si NO cuadra, diferencia: S/ ________________________

7. ESTADO DE RESULTADOS
   ¿Formato adecuado para entrega? [ ] SÍ  [ ] NO
   Cambios pedidos: ______________________________________

8. PLE (Programa de Libros Electrónicos)
   ¿La estructura sirve para generar el PLE mensual? [ ] SÍ [ ] NO
   Observaciones: _______________________________________

9. CRITERIO GLOBAL
   ¿El módulo se puede usar para llevar la contabilidad
   oficial de AGROCAR? [ ] SÍ  [ ] CON AJUSTES  [ ] NO

   Cambios prioritarios antes del go-live:
   1. ________________________________________________
   2. ________________________________________________
   3. ________________________________________________

═══════════════════════════════════════════════════════════════

Firma del Contador: __________________________________________
```

---

## 🆘 Si algo falla durante la prueba

| Síntoma | Qué hacer |
|---|---|
| No veo el menú "Contabilidad" | Cerrar sesión y volver a entrar |
| Error "Solo admin/gerente/contador pueden..." | Confirmar el rol del usuario en `/configuracion` |
| Asiento descuadrado al guardar | Revisar columna Debe vs Haber — deben sumar lo mismo |
| "Período cerrado" al editar | El período ya se cerró — generar asiento de ajuste en el período abierto |
| No aparecen transacciones pendientes | Cambiar el rango de fechas a uno más amplio |
| Cuenta requerida no existe | En Plan de Cuentas → "+ Nueva subcuenta" |

**Contacto rápido**: Luigi Bravo · Promptive · `bravo.a.camus@gmail.com`

---

<div align="center">

## 🚀 Próximas funcionalidades planificadas

- **Detracciones automáticas**: detección automática del 4% en clientes empresariales
- **PLE export**: generación del Programa de Libros Electrónicos para subir directo a SUNAT
- **Asientos de ajuste asistidos**: para corregir períodos cerrados
- **Balance General** (Estado de Situación Financiera)
- **Ratios financieros** (liquidez, endeudamiento, rentabilidad)

---

*Documento generado por el equipo Promptive para AGROCAR S.R.L.*
*Cualquier observación es bienvenida — Luigi atenderá en máximo 24 horas hábiles.*

**AGROCAR S.R.L.** · *Pasión hecha a mano* 🟡

</div>
