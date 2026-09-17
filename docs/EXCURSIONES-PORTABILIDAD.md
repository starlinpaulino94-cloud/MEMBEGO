# Parques y Tours — Guía de portabilidad

**Qué es esto:** el mapa para llevarse funciones de este vertical a otro
proyecto. Qué se puede copiar tal cual, qué arrastra dependencias, cuáles son
y en qué orden conviene extraer cada pieza.

**Qué NO es:** la documentación de arquitectura. Esa ya existe en
[`docs/EXCURSIONES.md`](./EXCURSIONES.md) (cadena de valor, modelo de datos,
motores, rutas) y en [`docs/EXCURSIONES-QA.md`](./EXCURSIONES-QA.md). Este
documento asume aquella y responde a otra pregunta: *¿cuánto cuesta sacar esto
de aquí?*

El vertical se llama **Excursiones** en el código (`EXCURSIONES` como
capacidad, `src/modules/excursiones/`, tabla `excursiones`). «Parques y Tours»
es el nombre de producto.

---

## 1. Inventario

| | |
|---|---|
| Modelos Prisma | **22** (`prisma/schema/excursiones.prisma`, 681 líneas) |
| Código de módulo | **15.544 líneas** en 41 archivos |
| Server actions | **44** repartidas en 13 archivos |
| Rutas de aplicación | 4 paneles: admin, vendedor, cliente, público |
| Componentes React | **46** en `src/components/excursiones/` |
| Pruebas | **169 casos** en 18 archivos |
| Migraciones | **13** propias (`20260817` → `20260906`), más las de Connect aparte |

### Tamaño por subdominio

| Subdominio | Líneas | Qué resuelve |
|---|---:|---|
| `reservas` | 4.867 | Reservas, pagos parciales, itinerarios de combo, disponibilidad |
| `catalogo` | 2.894 | Excursiones, variantes, horarios, combos, precios dinámicos |
| `comisiones` | 1.338 | Motor de reglas con prioridad y snapshot |
| `liquidaciones` | 1.066 | Períodos, remuneración en especie, pagos a vendedores |
| `checkin` | 967 | QR transaccional, manifiesto, embarque |
| `vendedores` | 916 | Fichas, códigos, enlaces/QR, jerarquía, B2B |
| `metricas` | 852 | Metas, progreso, rangos, conversión |
| `demo` | 733 | Sembrado de datos de práctica |
| `ventas` | 512 | Numeración, base comisionable, confirmación |
| `reportes` | 475 | Exportación CSV de ventas, comisiones, liquidaciones |
| `atribucion` | 345 | Embudo, políticas primera/última/reserva |
| `panel` | 220 | Consultas del tablero |
| `cliente` | 48 | Contraseña por token |

---

## 2. El mapa de acoplamiento

El módulo está en **tres capas**, y solo una de ellas está pegada a este
proyecto.

```
┌─ nucleo.ts (×11)  ── 3.800 líneas ── CERO dependencias ──── se copia y ya
├─ queries.ts / actions.ts ── Prisma + conEmpresa + guards ── se adapta
└─ app/ + components/ ─────── Next.js App Router + @membego/ui ─ se reescribe
```

### Lo que se lleva tal cual: 3.800 líneas

Once archivos `nucleo.ts` sin **ninguna** importación de Prisma, de Next, de
Supabase ni de los envoltorios de inquilino. Son funciones puras: entran
datos, salen datos.

| Archivo | Líneas | Lo que te da |
|---|---:|---|
| `reservas/nucleo.ts` | 1.480 | Totales, saldo, estado por pagos, política de reembolso, validación de disponibilidad, **motor de itinerarios de combo** (auto-resolución, optimización, combinaciones, multi-fecha) |
| `comisiones/nucleo.ts` | 589 | **Motor de comisiones**: 6 ámbitos con prioridad, 6 tipos de cálculo, escalones, máquina de estados, neto con ajustes |
| `liquidaciones/nucleo.ts` | 348 | Períodos, totales, remuneración en especie, validación de pago |
| `catalogo/nucleo.ts` | 319 | Validación de excursión/variante/horario, slug, duración, días de semana |
| `metricas/nucleo.ts` | 290 | Rangos por período, progreso de meta, ticket promedio, conversión |
| `reportes/nucleo.ts` | 185 | Encabezados y filas de los tres CSV |
| `vendedores/nucleo.ts` | 153 | Estados, códigos comerciales, validación, URLs de enlace y QR |
| `checkin/nucleo.ts` | 138 | Evaluación de check-in, días de gracia, manifiesto, codificación del token |
| `atribucion/nucleo.ts` | 107 | Etapas, canales, ventana, **resolución del vendedor atribuido** |
| `ventas/nucleo.ts` | 39 | Numeración y base comisionable |
| `demo/guion.ts` | 152 | Guion de datos de práctica |

Estos archivos se copian a cualquier proyecto TypeScript y funcionan. No
necesitan Prisma ni Next.

### Lo que hay que adaptar

`queries.ts` y `actions.ts` hablan con la base y con la sesión. Sus
dependencias externas, medidas sobre el módulo entero:

| Dependencia | Usos | Qué habría que resolver |
|---|---:|---|
| `@/lib/tenant` | 28 | `conEmpresa` / `sinEmpresa`: abren transacción + `SET LOCAL` para RLS |
| `@/lib/prisma-errors` | 13 | Clasificación de errores de Prisma |
| `@/lib/auth/guards` | 11 | `requireAdminUser`, `requireSection` |
| `@/lib/server-utils` | 10 | Metadatos del request (IP, user-agent) |
| `@/lib/auth/company-context` | 9 | Empresa activa de la sesión |
| `@/lib/codes` | 7 | Generación de códigos/tokens |
| `@/lib/supabase/admin` | 5 | Alta de cuentas de vendedor |
| `@/lib/email` + plantillas | 8 | Correos de reserva y acceso |

Nada de esto es exótico: son un envoltorio de transacción, un guardia de
sesión y un emisor de correo. En un proyecto nuevo se sustituyen por los
equivalentes de ese proyecto sin tocar la lógica.

### Lo que se reescribe

Las 46 componentes y las rutas de `src/app/` son Next.js App Router con
Server Components y `useActionState`, sobre `@membego/ui`. Si el otro proyecto
no comparte ese stack, es reescritura — pero es la capa más barata, porque toda
la decisión está debajo.

---

## 3. La superficie de integración

Convención deliberada del vertical, escrita en la cabecera del esquema:

> Dentro del módulo hay relaciones Prisma reales; **hacia el núcleo se guarda
> el id PLANO sin `@relation`**.

Eso es lo que hace el módulo portable: no obliga a tocar los modelos del
proyecto anfitrión. Los puntos de contacto son:

| Campo | Apariciones | A qué apunta |
|---|---:|---|
| `companyId` | 22 | La empresa (multi-inquilino) |
| `clienteId` | 3 | La ficha del cliente |
| `liquidacionId` | 3 | Interno del módulo |
| `sucursalId` | 2 | Sucursal |
| `responsableId` | 2 | Usuario que ejecutó |
| `campanaId` | 2 | Campaña de marketing |
| `userId` | 1 | Cuenta del vendedor (opcional) |
| `transactionId` | 1 | Puente al motor financiero |
| `providerId` | 1 | Operador tercero (preparado, sin uso) |

**Solo hacen falta dos cosas del anfitrión: una empresa y un cliente.** Todo lo
demás es opcional o interno. `userId` es nulo a propósito — un hotel o un
taxista que vende no necesita cuenta.

---

## 4. Recetas de extracción

Ordenadas de menor a mayor coste. Cada una es independiente de las demás.

### A · Motor de comisiones — el más valioso y el más aislado

**Se lleva:** `comisiones/nucleo.ts` (589 líneas) + `ventas/nucleo.ts` (39).
**Coste:** copiar y pegar. Cero dependencias.
**Pruebas que vienen con él:** 33 casos.

Resuelve un problema que casi nadie resuelve bien:

- **Seis ámbitos con prioridad explícita**: `VENDEDOR_EXCURSION` > `VENDEDOR` >
  `EXCURSION` > `CATEGORIA` > `TIPO_VENDEDOR` > `GENERAL`.
- **Seis tipos de cálculo**: porcentaje, fijo por venta, por pasajero, por
  adulto, por niño, y **escalones** (`[{desde:1, hasta:10, pct:10}, …]`).
- **Snapshot obligatorio**: cada comisión guarda `reglaSnapshot` (la regla
  congelada) y `desglose` (la explicación en lenguaje humano: «3 adultos ×
  US$10 = US$30»). Cambiar las reglas después **no** toca las comisiones ya
  calculadas.
- **Ajustes con signo en vez de edición**: una comisión pagada nunca se anula,
  se ajusta. La trazabilidad contable queda entera.

Si en el otro proyecto hay que pagar comisiones a alguien, esto se lleva
íntegro.

### B · Atribución por QR / enlace

**Se lleva:** `atribucion/nucleo.ts` (107 líneas).
**Coste:** copiar + una tabla de eventos + una cookie.
**Pruebas:** 6 casos.

El patrón que merece la pena copiar es **el histórico inmutable**:
`VendedorAtribucion` guarda **cada** evento de captación (`VISITA`, `REGISTRO`,
`RESERVA`, `COMPRA`) con su canal y su enlace. La política de la empresa
(primera / última / por reserva) se aplica **al vender**, leyendo ese
histórico.

Consecuencia: cambiar la política no reescribe el pasado, y la pregunta
«¿cuántos clientes captó el QR de cada vendedor?» se responde agrupando por
etapa en vez de reconstruyéndola.

### C · Check-in con QR

**Se lleva:** `checkin/nucleo.ts` (138 líneas).
**Coste:** copiar + un campo token en tu entidad + el componente de escáner.
**Pruebas:** 12 casos.

Lo importante es la distinción que hace el esquema, y que se salta mucha gente:

> El QR de check-in es **transaccional** —marca quién se subió— y no tiene nada
> que ver con el QR de adquisición del vendedor. Nace con la reserva y no se
> reutiliza jamás en otra: por eso es único global.

Incluye días de gracia configurables, prefijo de código personalizable
(`EXC:`, `TOUR:`, `PASE:`) y manifiesto de embarque con pasajeros presentes y
ausentes.

### D · Metas y progreso

**Se lleva:** `metricas/nucleo.ts` (290 líneas).
**Coste:** copiar.
**Pruebas:** 13 casos.

Metas por período (diaria, semanal, mensual, rango) sobre cinco dimensiones
—ventas, pasajeros, ingresos, registros, reservas— con cálculo de progreso,
ticket promedio y tasas de conversión. Aplicable a cualquier equipo comercial.

### E · Reservas, pagos parciales y disponibilidad

**Se lleva:** `reservas/nucleo.ts` (1.480 líneas).
**Coste:** copiar; es el archivo más grande, pero sigue siendo puro.
**Pruebas:** 48 casos.

Trae tres cosas separables:

1. **Dinero**: totales, saldo, estado por pagos (`PARCIALMENTE_PAGADA` →
   `PAGADA`, nunca al revés), política de reembolso con penalización y
   anticipación.
2. **Precios dinámicos**: reglas por día de semana y hora de salida, más
   tarifa diferenciada residente/turista y adulto/niño.
3. **Motor de itinerarios de combo** (el trozo más sofisticado): dado un
   paquete de actividades con horarios y duraciones, resuelve automáticamente
   un itinerario sin solapamientos, lo optimiza, genera combinaciones
   alternativas y valida disponibilidad multi-fecha.

Si el otro proyecto vende paquetes de cualquier tipo, el punto 3 es difícil de
reescribir y fácil de copiar.

### F · El vertical entero

**Coste:** las 15.544 líneas, las 22 tablas, más adaptar la capa de datos y
reescribir la UI. Solo tiene sentido si el otro proyecto es también de tours.

---

## 5. Decisiones de diseño que conviene copiar

Independientemente de qué te lleves, estos patrones son la razón de que el
módulo aguante:

**Estados como `String` con dominio documentado, no como enum.** Precedente
declarado: `carwash.Comision`. Evolucionan sin migración. El dominio va escrito
en un comentario `///` encima del campo.

**Máquinas de estado explícitas.** `puedeTransicionar(desde, hacia)` con su
tabla, y `motivoTransicionInvalida()` que devuelve el porqué en lenguaje humano.
Un estado que puede saltar a cualquier otro no es un estado, es un string.

**Congelar lo que se decidió en el momento.** Tres ejemplos en el mismo
módulo: `reglaSnapshot` en la comisión, `vendedorId` congelado en la venta al
confirmar, `tasaCambio` que «jamás se recalcula». Todos responden a lo mismo:
el pasado no se reinterpreta con las reglas de hoy.

**Nunca borrar, siempre anotar.** Un vendedor inactivo conserva sus ventas,
clientes y comisiones. Un pago anulado es un movimiento nuevo, no un borrado.
Una comisión se ajusta con signo.

**Numeración legible y única por empresa.** `EXC-2026-000184`, `SAL-000184`,
`PAY-2026-0014`, con prefijos configurables. Buscable por una persona al
teléfono.

**Separar bonificación de comisión.** `VendedorBono` es un concepto distinto
por diseño, con su propia condición (`{pasajeros: 50} → +US$100`) guardada para
el expediente.

---

## 6. Trampas

**La columna `nombreBusqueda` la escribe un disparador de la base, no la
aplicación.** Está en el esquema con el motivo escrito: «la aplicación nunca la
escribe, así que no puede quedarse desfasada porque alguien olvidara
actualizarla». Si te llevas `Vendedor`, llévate el disparador — y el índice GIN
`gin_trgm_ops` que lo acompaña, que necesita la extensión `pg_trgm`.

**Hay una transacción anidada conocida** en
`src/modules/excursiones/catalogo/actions.ts:953`: `sincronizarTodasAgotadas`
abre `conEmpresa` y dentro del bucle llama a `sincronizarEstadoAgotada`, que
abre otro. `scripts/transacciones-anidadas.mjs` lo detecta, pero ese script no
está conectado al CI. No lo copies.

**`horarioFijo` cambió de `TEXT` a `JSONB`** en migraciones consecutivas
(`20260827_combo_horario_fijo` y `_array`). Si replicas el historial, replica el
tipo final, no la pareja.

**Prisma pide todas las columnas escalares** en un `find*` o `create` sin
`select`. Una columna declarada en el esquema y ausente en la base tumba
consultas que no la usan. Este vertical ya lo sufrió: `vendedor_metas.beneficio`
y dos columnas de `users` se declararon sin escribir la migración.

---

## 7. Estado actual

- Capacidad `EXCURSIONES`, encendida de serie solo en empresas de categoría
  `EXCURSIONES`; cualquier otra la activa a mano. Convive con
  `PAGO_TRANSFERENCIA`, `SEGUIMIENTO`, `RULETA`, `GIFT_CARDS`, `POS_CAJA`, `CRM`.
- Rol `VENDEDOR` con su propio portal (`/vendedor`), separado de los roles de
  administración.
- **169 casos de prueba**, todos sobre la lógica pura — por eso corren sin base
  de datos.
- **Connect** (`src/modules/connect/`, 11.782 líneas, 58 archivos) es un módulo
  **aparte**: la plataforma de conexiones B2B y API. Se relaciona con el
  vertical por los operadores terceros, pero no es parte de él y se porta por
  separado.

---

## 8. Recomendación

Si lo que quieres es llevarte *funciones*, el camino más corto es el bloque de
**3.800 líneas puras**. No arrastran nada, vienen con 169 pruebas que corren
sin base de datos, y contienen lo que de verdad costó pensar: el motor de
comisiones, el de itinerarios y el de atribución.

Empieza por la receta **A** (comisiones). Es la más autónoma, la mejor probada
y la que más difícil sería reescribir bien.
