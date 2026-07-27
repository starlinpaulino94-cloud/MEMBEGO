# El vertical Car Wash: diagnóstico y plan

Análisis del módulo `/admin/app/carwash` frente a lo que es un sistema de car
wash real, cruzando la investigación de mercado con **lo que ya existe en este
repositorio** (95 modelos en `schema.prisma`).

---

# Parte 1 · Por qué se siente anticuado

No es el color ni la tipografía. Son tres problemas de fondo.

## 1.1 Es un menú, no un puesto de trabajo

La pantalla actual es un **launchpad de 9 tarjetas iguales**: mismo tamaño,
mismo peso visual, mismo icono cuadrado. "Escanear QR" —que se usa 40 veces al
día— ocupa exactamente el mismo espacio que "Inventario", que se abre una vez
por semana.

Un sistema de pista no es un portal a módulos. Es una **cabina**: lo que está
pasando ahora mismo ocupa la pantalla, y lo demás está a un toque.

## 1.2 Los KPIs no dicen nada accionable

Los cuatro contadores de arriba —`CITAS DE HOY 0`, `CANJES DE HOY 2`,
`CAJA DE HOY RD$2,800`, `REGALOS SIN USAR 14`— son **cifras de cierre de día
mostradas a mitad de jornada**. Ninguna responde la pregunta que un encargado
se hace a las 12:47 de un lunes:

> ¿Cuántos carros tengo en pista ahora? ¿Cuál bahía está libre? ¿Quién lleva
> más de 40 minutos esperando? ¿Qué le falta al carro de la placa A123456?

"Citas de hoy: 0" es peor que no mostrar nada: ocupa una cuarta parte de la
cabecera para informar de una ausencia.

## 1.3 "Últimas operaciones" es un log, no una vista de operación

Muestra `MEMBERSHIP_REDEMPTION · Bolivar Isea` — el nombre interno del enum,
en inglés, filtrado hacia la cara del usuario. Y mezcla ventas con canjes en
orden cronológico plano, que es cómo lo guarda la base de datos, no cómo lo
piensa el negocio.

## 1.4 El síntoma que lo delata todo

Mira los nombres de tus planes:

```
PLAN SILVER (SUV PEQ)
PLAN SILVER (SEDAN Y HATCH BACK)
```

**El tipo de vehículo está metido dentro del nombre del plan.** Eso no es un
descuido de quien los creó: es que el sistema **no tiene la dimensión
"tipo de vehículo"**, así que la única forma de expresar "esto cuesta distinto
según el carro" es duplicar el plan y escribirlo en el título.

Ese es el hueco número uno del vertical, y explica más de la mitad de lo que
se siente "genérico": el sistema todavía piensa en *membresías*, no en
*lavados de un vehículo*.

---

# Parte 2 · Inventario real: qué hay, qué falta

La investigación que trajiste lista ~20 módulos. Antes de construir nada, esto
es lo que **ya está** en el repositorio. Es bastante más de lo que parece.

## 2.1 Ya existe y funciona

| Módulo del informe | Qué lo cubre aquí |
|---|---|
| Clientes y vehículos | `Cliente`, `Vehiculo` |
| Visitas y check-in | `Visit`, `QrToken`, escáner |
| POS y caja | `CajaSesion`, `MovimientoCaja`, `/empleado/caja` |
| Ticket comercial | `Transaction`, `TransactionTransicion`, `TransactionCounter` |
| Facturación básica | `Comprobante`, `ReceiptTemplate`, `ReceiptImpresion` (58/80/Carta/A4) |
| Suscripciones y planes | `Plan`, `Membership`, + motor universal `MembershipPlan/Instance/Usage` |
| Gift cards | `GiftCard` |
| Reservas y agenda | `AgendaConfig`, `Cita` (con cupo por turno y por día) |
| Cola de vehículos | `ColaVehiculo` |
| Inventario de químicos | `ProductoInventario`, `MovimientoInventario` |
| Fotos antes/después | `EvidenciaFoto` |
| Multi-sede (base) | `Sucursal`, `UserCompanyAccess` |
| CRM y loyalty | `ClienteNota`, `Benefit`, `BenefitGrant`, `GrowthWallet` |
| Marketing y automatización | `Automation`, `MarketingCampaign`, `Campana`, `RuletaPremio` |
| Referidos | `Referido`, `ReferralProgram`, `ReferralParticipant` (motor completo) |
| Soporte y reputación | `SupportTicket`, `TicketMensaje`, `CompanyRating` |
| Auditoría | `AuditLog` |
| Reglas y promociones | Rule Engine + Promotion Engine completos |

**Conclusión incómoda pero útil:** el problema del vertical **no es falta de
motor**. Es que el motor está construido para "membresías y promociones" y le
faltan cinco piezas específicas del oficio.

## 2.2 Lo que falta de verdad

Ordenado por cuánto duele hoy en CARTOWN, no por cuánto aparece en el informe.

### Hueco 1 — Catálogo de servicios y tipo de vehículo `CRÍTICO`

No existe el concepto de **servicio vendible suelto**. Hay `Plan` (membresía
recurrente) y `Promocion` (oferta), pero no "Lavado básico · SUV · RD$800".

Falta:
- `TipoVehiculo` (sedán, SUV pequeña, SUV grande, camioneta, motor…)
- `Servicio` con duración estimada y categoría
- `ServicioPrecio` — precio por servicio **× tipo de vehículo** (× sucursal)
- `ServicioAdicional` (add-ons: cera, motor, tapicería, pulido)

Esto es lo que elimina los `(SUV PEQ)` de los nombres, permite cobrar bien en
caja, y sin ello no hay margen real por servicio.

### Hueco 2 — Ejecución del servicio y calidad `ALTO`

Hay `ColaVehiculo` (dónde está el carro) y `EvidenciaFoto` (cómo llegó), pero
**no hay registro de qué se le hizo**:

- `OrdenServicio` — qué servicios y add-ons lleva ese vehículo, quién lo
  atendió, hora de inicio y fin, tiempo real vs. estimado
- `Incidencia` — daño reportado, reclamo, objeto olvidado
- `Rewash` — repetición por mala calidad, con motivo y costo asumido

Sin esto no puedes responder "¿por qué este carro tardó 2 horas?" ni medir
quién trabaja bien. Es el módulo que convierte la pista en datos.

### Hueco 3 — Bahías / puestos de trabajo `ALTO`

Existe `Sucursal` pero no hay nada **dentro** de la sucursal. Un car wash
tiene 3, 5, 8 puestos, y la pregunta operativa central es *cuál está libre*.

- `Bahia` (nombre, tipo, sucursal, activa)
- `ColaVehiculo.bahiaId` — asignación

Es poco código y cambia la pantalla principal por completo.

### Hueco 4 — Cuentas corporativas / flotillas `ALTO en RD`

No existe. Y en República Dominicana es de los negocios más rentables de un
car wash: empresas con 10-40 vehículos que lavan mensual y **pagan a crédito
con una factura al cierre**.

- `CuentaCorporativa` (empresa, RNC, límite de crédito, contacto)
- `CuentaCorporativaVehiculo` — qué placas cubre
- Consumo → factura consolidada mensual

El informe lo llama "fleet accounts" y lo pone en prioridad alta. Coincido, y
en tu mercado pesa más que en el americano.

### Hueco 5 — Personal, turnos y comisiones `MEDIO-ALTO`

Hay `User` con roles, pero no hay:
- `Turno` / `AsistenciaEntrada` (fichar entrada y salida)
- `ComisionRegla` — cuánto gana el lavador por servicio

En un car wash el personal cobra por producción. Hoy eso vive en un cuaderno.

### Hueco 6 — Compras y proveedores `MEDIO`

Hay inventario pero no cómo se repone:
- `Proveedor`, `OrdenCompra`, `RecepcionMercancia`

Sin esto el inventario se desincroniza en semanas y deja de usarse.

### Hueco 7 — Mantenimiento de equipos `MEDIO`

- `Activo` (hidrolavadora, compresor, aspiradora, pulidora)
- `MantenimientoOrden` — preventivo y correctivo

Una hidrolavadora parada es la pista parada.

### Hueco 8 — Consentimientos `BAJO ahora, obligatorio después`

No hay modelo de `Consentimiento`. Hoy hay `notifPromos`/`notifRecordatorios`
en `Cliente`, que sirve, pero no guarda **cuándo y cómo** se dio el permiso.

---

## 2.3 Lo que el informe pide y NO deberías construir

Aquí discrepo del informe, y es la parte más importante de este documento.

La investigación está construida sobre **DRB, Sonny's y WashTec**: operadores
de *túnel express* en Estados Unidos, con 800-1200 carros/día, barrera
automática y cinta transportadora. CARTOWN es un **car wash de detallado** en
Santo Domingo, con lavado a mano y decenas de carros al día.

| Lo que pide el informe | Por qué NO |
|---|---|
| **LPR** (lectura de matrícula por cámara) | Cámara + software + integración: miles de dólares para reconocer placas de una fila de 6 carros que el empleado ya ve. El QR que ya tienes hace el mismo trabajo por cero. |
| **RFID / tags en el parabrisas** | Tiene sentido con barrera automática y membresías ilimitadas de alto volumen. Sin barrera, no resuelve nada. |
| **Control de barrera / gate** | No hay barrera. |
| **PLC / control de máquina de túnel** | No hay túnel. |
| **Telemetría IoT y device fleet management** | No hay dispositivos que reporten. |
| **Kioscos de autoservicio** | Modelo de negocio distinto (self-service bays). |
| **Franquicia, royalties, benchmark corporativo** | Una sucursal. Construirlo ahora es diseñar para una empresa que no existe todavía. |
| **Nómina completa** | Turnos y comisiones sí; nómina con TSS y liquidaciones no — eso es un producto aparte. |

**Regla que propongo:** el vertical se construye para el car wash de
**lavado y detallado atendido**, que es el 95% del mercado dominicano. El
túnel express con barrera queda documentado como extensión futura, no como
requisito.

Esto no es recortar ambición. Es no gastar seis meses en hardware que tu
cliente no tiene ni va a comprar.

---

# Parte 3 · Que se sienta otro sistema

Tu pedido literal: *"cuando entre a ese sistema debe sentir que entró a uno
diferente de MembeGo"*. Hoy no pasa porque el shell **hereda todo**: el mismo
layout, los mismos tokens, las mismas tarjetas.

## 3.1 Identidad propia, no otra piel

Tres capas de separación, de más barata a más profunda:

**Capa 1 · Marco visual propio.** La app tiene su propio color de acento
(definido en el catálogo por app, no hardcodeado), su propia densidad —más
compacta, pensada para pantalla de mostrador— y su propia tipografía de
números (grandes, tabulares, legibles a un metro).

**Capa 2 · Navegación propia.** Fuera el sidebar de MembeGo. Dentro de la app,
una barra superior con las 4-5 zonas del oficio:

```
PISTA · MOSTRADOR · CLIENTES · INVENTARIO · REPORTES
```

No 9 tarjetas iguales. Cinco zonas, y dentro de cada una lo que corresponda.

**Capa 3 · Vocabulario del oficio.** No "Transacciones" sino "Órdenes". No
"Canje" sino "Lavado". No `MEMBERSHIP_REDEMPTION` sino "Usó su membresía".
El catálogo de apps ya soporta esto (`navOculta` por categoría); falta un
diccionario de términos por app.

## 3.2 La pantalla principal: de menú a cabina

Propuesta concreta para reemplazar el launchpad actual:

```
┌─────────────────────────────────────────────────────────┐
│  CARTOWN · Pista            lunes 12:47   [Recibir auto]│
├─────────────────────────────────────────────────────────┤
│  EN PISTA AHORA                                          │
│  ┌────────┬────────┬────────┬────────┐                  │
│  │ BAHÍA 1│ BAHÍA 2│ BAHÍA 3│ ESPERA │                  │
│  │A123456 │ libre  │B789012 │  2     │                  │
│  │Lavado  │        │Detalle │        │                  │
│  │ 25 min │        │ 1h 10m │        │                  │
│  └────────┴────────┴────────┴────────┘                  │
├─────────────────────────────────────────────────────────┤
│  ESPERANDO (2)                    HOY                    │
│  · C345678 · Jeepeta · 12 min     18 lavados             │
│  · D901234 · Sedán   ·  4 min     RD$14,200              │
│                                    3 membresías nuevas   │
└─────────────────────────────────────────────────────────┘
```

Lo que cambia respecto de hoy:
- **El estado ahora ocupa la pantalla**, no cuatro contadores de cierre.
- **Una acción principal** ("Recibir auto"), no nueve iguales.
- **El tiempo es el KPI**, porque en un car wash el tiempo es el costo.
- Los módulos secundarios viven en la barra superior, no compitiendo por
  atención en la portada.

---

# Parte 4 · Plan de construcción

Ordenado por lo que desbloquea más con menos.

## Fase 1 · La base que falta — ENTREGADA

| Entregable | Estado |
|---|---|
| `TipoVehiculo` + `Servicio` + `ServicioPrecio` | ✅ Migración `20260762_carwash_fase1` |
| `Bahia` + asignación en la cola | ✅ `asignarBahia()` con guarda de bahía ocupada |
| Orden de servicio | ✅ `ColaServicio` — se extendió `ColaVehiculo` en vez de crear un modelo paralelo: la entrada en cola YA era la orden (tiene estados y tiempos), duplicarla habría partido el historial en dos |
| Portada tipo cabina | ✅ `src/components/carwash/Pista.tsx` |
| Configuración del catálogo | ✅ `/admin/app/carwash/catalogo` |

**Decisiones tomadas al construir** (eran las preguntas abiertas de la Parte 5):

1. **Servicio y Promoción conviven.** `Servicio` es lo que se vende; `Promocion`
   sigue siendo el descuento sobre eso. No se tocó nada de promociones.
2. **Los planes existentes NO se migraron.** Renombrar "PLAN SILVER (SUV PEQ)"
   tocaría membresías vivas con clientes pagando. El precio por tipo se estrena
   en los servicios; unificar los planes es una migración de datos aparte, que
   debe decidirse con el negocio delante.
3. **Precio vacío = no aplica.** Si un servicio no tiene tarifa para un tipo de
   vehículo, no se ofrece para ese tipo. Evita tener que marcar exclusiones.
4. **El precio se congela en la línea** (`ColaServicio.precio` y `.nombre`): un
   cambio de tarifa mañana no reescribe lo que se cobró ayer.
5. **Una bahía atiende un vehículo a la vez.** Asignar a una bahía ocupada
   devuelve error con el nombre del ocupante, en vez de pisarlo en silencio.

**Todo es aditivo y tolerante:** si la migración no está aplicada, la cabina
devuelve `null` y la portada cae al tablero genérico de siempre. Una empresa
sin catálogo configurado sigue operando exactamente como antes.

## Fase 2 · Lo que da dinero

| Entregable | Por qué |
|---|---|
| Cuentas corporativas / flotillas | Ingreso recurrente alto, y hoy no existe. |
| Comisiones por lavador | Alinea al personal y saca el cuaderno de la operación. |
| Incidencias y rewash | Reduce reclamos y mide calidad real. |

## Fase 3 · Que la operación no se caiga

| Entregable | Por qué |
|---|---|
| Proveedores y órdenes de compra | Mantiene vivo el inventario. |
| Activos y mantenimiento | Uptime de los equipos. |
| Turnos y asistencia | Costo laboral por lavado. |

## Fase 4 · Escala (solo cuando exista la segunda sucursal)

Multi-sede real, comparativo entre sucursales, consolidado. **No antes.**

## Documentado como futuro, no como plan

LPR, RFID, barrera, PLC, kioscos, telemetría IoT, franquicia y royalties.
Se retoman si aparece un cliente con túnel express.

---

# Parte 5 · Decisiones que hay que tomar antes de escribir código

1. **¿El catálogo de servicios reemplaza o convive con las promociones?**
   Recomiendo convivir: `Servicio` es lo que vendes; `Promocion` es un
   descuento sobre eso. Hoy están fundidos.

2. **¿El precio por tipo de vehículo aplica también a las membresías?**
   Sí, y eso permite un solo "PLAN SILVER" con precios por tipo, en vez de
   cuatro planes duplicados.

3. **¿Las flotillas pagan a crédito?** Si sí, hace falta estado de cuenta y
   corte mensual, no solo facturación al momento.

4. **¿Las comisiones son por servicio, por vehículo o porcentaje de venta?**
   Cambia el modelo de datos. Hay que preguntárselo al negocio, no asumirlo.

---

**Nota de método.** Las Partes 1 y 2 están verificadas contra el código:
los 95 modelos de `schema.prisma`, el catálogo en `src/modules/apps/catalogo.ts`
y el shell en `src/app/(admin)/admin/app/[app]/page.tsx`. La Parte 3 en
adelante es propuesta de diseño y está sujeta a las decisiones de la Parte 5.
