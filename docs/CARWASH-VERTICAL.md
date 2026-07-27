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

## Fase 2 · Lo que da dinero — ENTREGADA

| Entregable | Estado |
|---|---|
| Cuentas corporativas / flotillas | ✅ `CuentaCorporativa` + `CuentaVehiculo` + `CargoCuenta`, con estado de cuenta y corte |
| Comisiones por lavador | ✅ `Comision`, congelada al entregar; tarifa por servicio |
| Incidencias y rewash | ✅ `Incidencia` con tasa de rewash y repetición enlazada a la cola |

Migración `20260764_carwash_fase2`. Capacidades nuevas —`CUENTAS_CORPORATIVAS`,
`COMISIONES`, `INCIDENCIAS`— todas nacen apagadas.

### Cómo funciona, en una línea cada una

**Flotillas.** La empresa cliente registra sus placas. Cuando una de esas placas
se ENTREGA en pista, el servicio se carga a su cuenta en vez de esperar un cobro
en caja. El ciclo del dinero son tres estados: *por facturar* → *facturado* (se
cierra el corte con una referencia) → *pagado*.

**Comisiones.** Se asigna el lavador desde la propia tarjeta de la cola, y al
entregar se devenga la comisión de los servicios de esa orden.

**Incidencias.** Daños, quejas, faltantes y rewash. "Mandar a repetir" crea una
entrada NUEVA en la cola enlazada a la incidencia.

### Decisiones tomadas al construir

1. **La flota NO es un `Cliente`.** Un cliente es una persona con membresía, QR
   y beneficios; una flota no acumula puntos ni canjea promociones — necesita
   que sus 40 camionetas se facturen juntas contra un RNC. Meterla en `Cliente`
   habría llenado de excepciones el módulo de membresías.

2. **La llave de la flota es la PLACA, no el vehículo registrado.** El chofer
   que llega no siempre está en el sistema; lo que el encargado tiene delante es
   una placa. `normalizarPlaca()` se aplica al guardar Y al buscar, siempre por
   el mismo camino: si solo se aplicara en uno, `A123456` no encontraría a
   `a-123 456` y el camión de la flota se cobraría en caja.

3. **El límite de crédito AVISA, no bloquea.** Dejar un camión sin lavar por un
   tope administrativo es peor negocio que cobrarlo después. Lo decide quien
   está en la pista, no el sistema.

4. **La comisión se CONGELA al entregar.** Si se recalculara al consultar,
   subir mañana la comisión del detallado reescribiría lo que ya se le debía a
   la gente por trabajos de la semana pasada. Eso no se ve en un log: se ve en
   la nómina. El `@@unique([colaId, userId])` es el seguro contra el doble pago.

5. **Encender COMISIONES no mueve dinero.** Un servicio sin tarifa paga cero, y
   la pantalla lo dice en grande. Nadie se encuentra una nómina inventada por
   haber probado una capacidad.

6. **Si están el porcentaje y el monto fijo, manda el porcentaje.** Tener los
   dos activos en la misma línea sería ambiguo, y la ambigüedad en nómina se
   paga cara. Cada línea se redondea ANTES de sumar, para que el total coincida
   con el desglose que se le enseña al lavador.

7. **El rewash crea una entrada NUEVA en la cola.** Reabrir la original
   escondería el costo: una repetición consume bahía, minutos y químicos como
   cualquier otro trabajo. La tasa de rewash se calcula sobre los vehículos
   *entregados* del período.

8. **Cerrar un corte y pagar comisiones son `updateMany` filtrados por estado.**
   Repetir el clic no vuelve a facturar ni a pagar lo ya procesado.

**El cierre de la entrega no puede tumbar la entrega.** La comisión y el cargo a
la flota corren DESPUÉS de cambiar el estado y a prueba de fallos: el cliente ya
tiene su llave y no se puede "des-entregar" un carro. Si algo falla se registra
y se avisa, pero el vehículo queda entregado.

**Aditivo y tolerante**, igual que la Fase 1: sin la migración corrida, las
pantallas nuevas dicen exactamente qué falta —en vez de fingir que están
vacías— y el resto de la app no se entera.

## Fase 3 · Que la operación no se caiga — ENTREGADA

| Entregable | Estado |
|---|---|
| Proveedores y órdenes de compra | ✅ `Proveedor` + `OrdenCompra` + `OrdenCompraLinea`, recibir alimenta el inventario |
| Activos y mantenimiento | ✅ `Activo` + `Mantenimiento`, con aviso antes de que toque |
| Turnos y asistencia | ✅ `Turno`, con costo laboral por lavado |

Migración `20260765_carwash_fase3`. Capacidades `COMPRAS`, `ACTIVOS` y `TURNOS`,
todas apagadas al nacer.

### Decisiones tomadas al construir

1. **Recibir una orden es la ÚNICA puerta nueva al stock**, y usa el camino de
   siempre (`MovimientoInventario` de ENTRADA). No se creó un segundo mecanismo
   para mover existencias: el rastro de auditoría del inventario sigue siendo
   una sola línea.

2. **El estado `PEDIDA` es el punto del módulo.** Entre pedir y recibir pasan
   días, y en ese hueco nadie sabe si el shampoo viene en camino o si no se
   pidió. Sin ese estado, la única forma de averiguarlo es preguntar.

3. **`cantidadRecibida` va aparte de `cantidad`.** El proveedor entrega
   incompleto más a menudo de lo que uno quisiera; con una sola columna,
   recibir 8 de 10 obligaría a mentir en el pedido o a inventar un ajuste.
   Recibir cero es un valor legítimo y NO cae al fallback de lo pedido —
   confundirlos inflaría el inventario.

4. **"Por pedir" ≠ "bajo mínimo".** Inventario ya dice qué está bajo mínimo.
   Lo que agrega compras es el *y nadie lo ha pedido todavía*: sin ese filtro,
   se compra dos veces.

5. **El correlativo sale del máximo, no de un conteo.** Si alguna vez se borra
   una orden, contar repetiría un número y el unique lo rechazaría con un error
   sin explicación.

6. **Recibir es idempotente por transacción.** El cambio de estado va
   condicionado a que la orden siga en `PEDIDA`; si dos personas dan a "recibir"
   a la vez, la segunda no encuentra nada y el stock no se suma dos veces.

7. **Un equipo mide pista parada, no patrimonio.** Por eso `horasParado` en cada
   mantenimiento: el costo real de una avería no es la factura del técnico, son
   las horas de bahía perdidas. Registrar un mantenimiento devuelve el equipo a
   OPERATIVO — quien acaba de arreglarlo no debería necesitar un segundo clic.

8. **Un empleado no puede tener dos turnos abiertos.** Lo garantiza un índice
   único PARCIAL en la base (`WHERE salidaAt IS NULL`), no solo el código: dos
   pestañas marcando entrada a la vez no pueden duplicarlo. Verificado contra
   PostgreSQL 16, incluyendo que los turnos ya cerrados no estorban.

9. **Horas negativas dan cero.** Un turno con salida anterior a la entrada
   restaría en el costo total y abarataría el lavado por arte de magia.

10. **El costo por lavado es `null` sin vehículos, no infinito.** Un panel que
    muestra "∞ por lavado" es peor que uno que muestra un guión. Y si ningún
    turno lleva costo por hora, la pantalla lo dice en vez de mostrar cero y
    dejar creer que la mano de obra es gratis.

**Aditivo y tolerante**, como las fases anteriores: sin la migración corrida las
pantallas nuevas dicen qué falta, y el inventario existente no se entera.

## Fase 4 · Escala — NO EMPEZADA, A PROPÓSITO

Multi-sede real, comparativo entre sucursales, consolidado.

**La condición sigue sin cumplirse: hay una sola sucursal.** Construir el
comparativo entre sedes hoy sería mantener código que compara una sucursal
consigo misma. Se retoma cuando exista la segunda, no antes — y esa decisión
está tomada desde la Parte 4 de este documento, no se cambia por tener tiempo
libre.

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

3. **¿Las flotillas pagan a crédito?** RESUELTO en la Fase 2: sí, con estado
   de cuenta y corte. El corte no es mensual por calendario sino manual — se
   cierra cuando el negocio quiere facturar, que es como funciona de verdad
   cuando el cliente pide la factura a mitad de mes.

4. **¿Las comisiones son por servicio, por vehículo o porcentaje de venta?**
   Cambia el modelo de datos. Hay que preguntárselo al negocio, no asumirlo.

---

**Nota de método.** Las Partes 1 y 2 están verificadas contra el código:
los 95 modelos de `schema.prisma`, el catálogo en `src/modules/apps/catalogo.ts`
y el shell en `src/app/(admin)/admin/app/[app]/page.tsx`. La Parte 3 en
adelante es propuesta de diseño y está sujeta a las decisiones de la Parte 5.
