# MEMBEGO SUPPLY 2.0 — Auditoría del Vertical Slice 8

Fecha: **2026-10-02** · Rama: `claude/jolly-brahmagupta-dmhml9` · Base:
`c5cdce0e` (`main`, con el motor del Slice 8 ya fusionado).

**Dos partes, hechas en momentos distintos y por sesiones distintas.** La
primera auditoría (§1–§5) revisó el Slice 8 tal como llegó a `main`: motor
completo, interfaz inexistente. Después, en esta misma sesión, se escribió la
interfaz que faltaba y su recorrido de navegador (§6–§9). Las dos partes se
conservan: la primera explica por qué hacía falta la segunda.

Alcance del Slice 8: **FIDELIZACIÓN** — programas, planes de membresía,
referidos, puntos y recompensas.

> **Aviso de método.** Esta auditoría la hace una sesión que **no escribió el
> Slice 8**. No tengo el prompt maestro original, así que no puedo contrastar
> criterio por criterio contra lo que se pidió. Lo que sí hice: ejecutar todas
> las puertas, correr las cuatro suites, leer el código de los cinco servicios,
> y comprobar los invariantes por SQL sobre los datos que las pruebas dejaron.
> Donde el código cita un «§» lo cito igual, pero **la numeración viene del
> código, no de un prompt que yo haya leído.** Si el prompt pedía algo que no
> dejó rastro, esta auditoría no lo vería.
>
> Nada se marca ✅ por existencia de código. Cada fila tiene una fuente
> primaria: salida de prueba, consulta SQL o lectura del archivo.

Leyenda: ✅ verificado con evidencia · ⚠️ observación o riesgo · ❌ no está ·
⛔ fuera de alcance declarado.

---

## VEREDICTO

**Primera auditoría (motor en `main`):** el motor estaba terminado y bien
probado; la interfaz no existía. 4 116 líneas de dominio y servicios, 102
pruebas en verde, todos los invariantes cuadrados — y ni una página, ni una
acción, ni un recorrido de navegador. Ningún ser humano podía contratar una
membresía, ver sus puntos ni canjear una recompensa.

**Después de completarlo:** la interfaz existe, los once permisos por fin se
exigen, y **el recorrido completo de 14 pasos pasa en escritorio y en móvil**,
con sus consecuencias comprobadas en PostgreSQL.

El recorrido destapó **dos fallos reales del producto que las 102 pruebas del
motor no veían** (§7). Es la razón de ser de este filtro, y la razón por la que
«hay código y las pruebas pasan» no equivale a «la persona puede hacerlo».

## 1 · QUÉ ENTRÓ, COMMIT POR COMMIT

Ocho commits, del `dfd3a80` al `dc43fee9`, fusionados por los PR #539 y #540:

| Commit | Qué trae | Líneas |
| --- | --- | --- |
| `dfd3a80a` | Modelo de datos de fidelización | 2 052 |
| `d99aa505` | Dominio puro | 936 |
| `f9f4a9e7` | Programas y planes de membresía | 573 |
| `8e085a24` | Motor de membresías sobre el checkout existente | 511 |
| `1fee7e86` | Ledger de puntos, acumulación y vencimiento | 601 |
| `e7a369f4` | Recompensas, reclamación atómica y reversas | 434 |
| `6a3935c2` | Programa de referidos con antifraude | 500 |
| `dc43fee9` | Economía de fidelización y lecturas por público | 561 |

Total: **8 861 inserciones en 25 archivos.** Cero archivos en `src/app/` y cero
en `src/components/`.

## 2 · LO QUE ESTÁ BIEN HECHO

### 2.1 · No duplica nada (✅ verificado leyendo los enganches)

El encabezado del esquema promete no construir motores paralelos, y el código
lo cumple:

| Promesa | Cómo se cumple | Dónde |
| --- | --- | --- |
| Ningún motor de descuentos | El beneficio de un plan o de una recompensa **es** un `SupplyV2Benefit` del Slice 6, con su presupuesto y su ledger | `memberships.ts`, `rewards.ts` |
| Ninguna pasarela de pago | La membresía de pago se cobra por el checkout de siempre: `kind = MEMBERSHIP`, sin líneas, sin lote, sin derecho | `checkout.ts` + `memberships.ts:211` |
| Ningún sistema de redención | La recompensa que entrega algo lo hace por `SupplyV2Entitlement` → voucher → QR → escáner | `rewards.ts` |
| Ninguna contabilidad nueva | `reconocerVentaDeMembresiaEnTx` emite un `SupplyV2EconomicEvent`, idempotente por pedido | `economics/service.ts` |
| Ningún segundo contador de presupuesto | La economía del programa **se lee** de sus recompensas | prueba de dominio 21 |

### 2.2 · Los puntos no son dinero (✅ verificado en el esquema)

`points`, `available`, `pending`, `reserved`, `redeemed`, `expired`: todos
`Int`, no `Decimal`. No hay saldo retirable ni cuenta monetaria. El costo
económico se reconoce **cuando la recompensa se entrega**, no cuando se emiten
los puntos; lo anterior se presenta como estimación y la prueba `21c` falla si
se presentara como dinero adeudado.

### 2.3 · El ledger es la verdad (✅ verificado por SQL)

Sobre los datos que dejaron las 55 pruebas de PostgreSQL —**770 cuentas de
puntos y 1 576 movimientos**— el saldo cacheado cuadra con la suma de los
deltas del ledger en **las cinco cubetas, en las 770 cuentas**:

```
INV_saldo_no_cuadra_con_ledger    → 0
INV_puntos_negativos              → 0
INV_lote_consumido_de_mas         → 0
INV_ajustes_sin_motivo            → 0
```

### 2.4 · Concurrencia y antifraude (✅ verificado leyendo + pruebas)

- **10 candados `FOR UPDATE`** repartidos por los cinco servicios.
- **4 índices únicos parciales** que son la red por debajo del candado:
  `supply_v2_membresia_activa_por_plan`, `supply_v2_membresia_sin_pagar_por_plan`,
  `supply_v2_reclamacion_viva_por_cliente`, `supply_v2_referral_codes_code_upper`.
- Antifraude de referidos documentado y probado punto por punto: autorreferido
  (CHECK + dominio), códigos duplicados, recompensa repetida, varias cuentas por
  el mismo referido, compra cancelada, manipulación del enlace, reintentos de la
  confirmación de pago.
- **Decisión que vale señalar y es la correcta:** «no se trata compartir
  dispositivo, IP o red como prueba de fraude. No se guarda ni se mira nada de
  eso». Los controles son sobre hechos de la operación, no sobre señales que
  castigarían a una familia que comparte wifi.

### 2.5 · Segregación de funciones (✅ verificado)

`programs.ts` y `rewards.ts` usan `revisarSegregacion` + `personasAutorizadasEnTx`:
quien crea no aprueba, y con una sola persona autorizada pasa dejando el rastro
`MOTIVO_AUTOAPROBACION`. Es el mismo mecanismo de los Slices 6 y 7, reutilizado.

### 2.6 · Un invariante endurecido como se debe (✅ ejemplar)

La migración `20261023_supply_v2_slice8_recompensa_entrega` **no edita la
migración sellada anterior**: la sustituye por una más estricta en su propia
migración. El CHECK original solo exigía oferta a las recompensas de producto;
ahora exige `benefitId IS NOT NULL` siempre, porque «el beneficio es lo que
PAGA la entrega, y sin él la persona habría gastado sus puntos a cambio de
aire». Así se corrige un invariante sin romper el sello.

### 2.7 · El barrido cubre lo que caduca (✅ verificado)

`ResultadoBarrido` creció con seis campos y el orden importa: **se vence
primero y se activa después**, porque solo puede haber una membresía `ACTIVE`
por plan y persona y activar el período nuevo antes de cerrar el viejo choca
contra el índice único. Está comentado en el código y probado (`A6`, `H1`).

## 3 · PUERTAS DEL MOTOR — ejecutadas sobre `c5cdce0e`

| Puerta | Resultado | Estado |
| --- | --- | --- |
| `tsc --noEmit` | exit 0 | ✅ |
| `eslint src tests` | **0 errores** (15 avisos preexistentes) | ✅ |
| `next build` (producción) | compila | ✅ |
| `npm test` | **3 438 tests · 3 432 pass · 0 fail · 6 skip** | ✅ con nota ⚠️ |
| Dominio Slice 8 | **47 pass · 0 fail** | ✅ |
| `npm run test:db` | **218 pass · 0 fail · 0 skip** | ✅ |
| PostgreSQL Slice 8 | **55 pass · 0 fail** | ✅ |
| **E2E Slice 8** | no existía el archivo entonces; ver §7 | ❌→✅ |
| Migraciones | 3 nuevas (enums aparte + una correctiva), aplican limpio | ✅ |
| Drift | «No difference detected» (exit 0) | ✅ |
| Sello de migraciones | `tests/migraciones-inmutables.test.ts` **2 pass** | ✅ |
| `nucleo-sin-verticales` · `acoplamiento-vertical` · `permisos-catalogo` · `campos-sin-etiqueta` · `transacciones-anidadas` · `rls-cobertura` · `rls-capa2-preflight` | **7 de 7 OK** | ✅ |

⚠️ **Las 6 omitidas, nombradas:** son las de CardNET —cinco por falta de
Supabase local para firmar sesión de cliente, una marcada `BLOCKED` esperando
claves de CardNET QA—. Ajenas a fidelización y presentes desde antes del
Slice 7. **No se cuentan como aprobadas.**

### Invariantes por SQL sobre los datos de las pruebas

118 programas, 36 membresías, 14 reclamaciones, 16 referidos, 770 cuentas de
puntos, 1 576 movimientos. Todos los invariantes en cero:

| Consulta | Resultado |
| --- | --- |
| Saldo cacheado que no cuadra con el ledger | 0 |
| Puntos negativos (disponible, pendiente o reservado) | 0 |
| Recompensas sin beneficio que pague la entrega | 0 |
| Dos membresías ACTIVE del mismo plan y persona | 0 |
| Recompensas con reclamaciones por encima de su tope | 0 |
| Ajustes manuales sin motivo escrito | 0 |
| Lotes de puntos consumidos de más | 0 |
| Pedidos de membresía sin plan (o al revés) | 0 |

## 4 · LO QUE FALTABA CUANDO LLEGÓ A `main`

### 4.1 · ❌ No había interfaz. Ninguna.

Esto era lo que impedía dar el slice por terminado. **Resuelto en §6.**

| Pieza | Estado |
| --- | --- |
| Server actions | **No existe** `actions-fidelizacion.ts`. Ninguna acción importa `loyalty/` |
| Páginas de superadmin | Ninguna |
| Páginas del cliente («Mis membresías», «Mis puntos», «Recompensas») | Ninguna |
| Portal del proveedor | Ninguna |
| Páginas públicas (escaparate de planes) | Ninguna |
| Componentes | Ninguno |
| Pestaña en el nav de Supply 2.0 | No se tocó `nav.tsx` |
| Rutas, etiquetas de estado y chips en `core/catalogo.ts` | **0 entradas**: el archivo no se modificó |

Verificado por dos caminos: `grep` de quién importa `supply-v2/loyalty` da
**solo `barrido.ts`, `checkout.ts` y las propias pruebas**; y el `next build`
no añade ninguna ruta de fidelización bajo `supply-v2` (las 14 rutas de
membresías/referidos/recompensas que salen son las de **Supply V1**, que ya
estaban).

**El síntoma más claro:** `loyalty/queries.ts` son 561 líneas de DTO por
público —cliente, negocio, proveedor, tablero— y su **único consumidor es la
prueba de PostgreSQL**. La capa de lectura está escrita para pantallas que no
existen.

### 4.2 · ⚠️ Los 11 permisos estaban declarados y no se exigían en ninguna parte

**Resuelto en §6.2.**

`contracts/gateways.ts` declara once permisos nuevos con sus etiquetas
(`SUPPLY_V2_LOYALTY_VIEW`, `_PROGRAM_CREATE`, `_PROGRAM_APPROVE`,
`MEMBERSHIP_MANAGE`, `MEMBERSHIP_GRANT`, `REFERRAL_MANAGE`,
`POINTS_RULES_MANAGE`, `POINTS_ADJUST`, `REWARD_APPROVE`,
`LOYALTY_FINANCE_VIEW`, `LOYALTY_REPORT_VIEW`).

**Ninguno se comprueba en ningún sitio**, porque `exigirPermisoSupplyV2` se
llama desde las server actions y no hay ninguna. No es una vulnerabilidad —sin
puerta de entrada no hay exposición— pero sí significa que **el diseño de
permisos está sin estrenar**: nadie ha comprobado que la separación entre ver,
crear, aprobar, otorgar y ajustar puntos funcione de verdad. En el Slice 7 ese
reparto solo se validó al escribir las acciones.

### 4.3 · ❌ No había recorrido de navegador

**Resuelto en §7.**

No existe `tests/e2e/supply-v2-slice8.spec.ts`. En los Slices 6 y 7 el E2E fue
justamente lo que destapó los defectos que las pruebas de base no veían: el
asistente que perdía las ofertas marcadas, el portal que sumaba mal el aporte
del proveedor, la pantalla que escondía un bono del cliente. **Aquí ese filtro
no se ha pasado**, y es el que convierte «el servicio funciona» en «la persona
puede hacerlo».

### 4.4 · ❌ No había informe de auditoría

Los Slices 3 a 7 tienen el suyo en `docs/`. El Slice 8 no tenía ninguno. **Este
documento lo cubre**, con la limitación del aviso de método para la parte del
motor.

## 5 · RIESGOS Y OBSERVACIONES

| # | Riesgo | Detalle | Gravedad |
| --- | --- | --- | --- |
| 1 | **El esquema se congeló antes de tener interfaz** | Las migraciones están aplicadas y selladas; si al escribir las pantallas falta una columna, habrá que añadir migración nueva. Ya pasó una vez (`20261023`, el CHECK de la recompensa) y se resolvió bien. Conviene presupuestar una o dos más. | ⚠️ |
| 2 | **Dos sistemas de fidelización en paralelo** | Supply V1 ya tiene `/admin/membresias`, `/admin/referidos`, `/admin/crecimiento/recompensas`, `/cliente/referidos` y `/mis-membresias` **en producción**. **Resuelto en §6.1:** todo el Slice 8 vive bajo «Fidelización», palabra que V1 no usa en ninguna pantalla. | ✅ resuelto |
| 3 | **Permisos sin estrenar** | **Resuelto en §6.2:** las 26 server actions los exigen, y el recorrido comprueba el rechazo por segregación. | ✅ resuelto |
| 4 | **El multiplicador de membresía siempre trunca** | Decisión explícita y probada (dominio 14). Conservadora a favor de Membego: el cliente recibe el entero inferior. El formulario del plan ya lo dice en pantalla («siempre se redondean hacia abajo»). | ⚠️ baja |
| 5 | **El costo potencial es una estimación** | Puntos emitidos y no canjeados son un pasivo probable, no dinero adeudado. El tablero y la ficha lo separan, lo pintan en color de aviso y llevan la advertencia al lado; el recorrido comprueba que la palabra «ESTIMACIÓN» está en pantalla. | ⚠️ baja |
| 6 | **No audité el prompt original** | Ver el aviso de método. Si el Slice 8 pedía algo que no dejó rastro en código, esquema ni pruebas, esta auditoría no lo detecta. | ⚠️ |

## 6 · LA INTERFAZ QUE FALTABA (añadida en esta sesión)

Commits `260cbc7b`, `76b24852`, `e80c788f`, `5128b08f`. **3 494 líneas** en 21
archivos: 11 nuevos y 10 modificados.

### 6.1 · El nombre, que era la decisión bloqueante (✅)

Supply V1 tiene **en producción** `/admin/membresias`, `/admin/referidos`,
`/admin/crecimiento/recompensas`, `/cliente/referidos` y `/mis-membresias`. Dos
menús con el mismo nombre confunden a quien opera, y eso no se arregla después.

Todo el Slice 8 vive bajo **«Fidelización»**, palabra que V1 no usa en ninguna
pantalla. Es la misma solución que ya se aplicó en el Slice 6 (`/cliente/bonos`,
porque V1 tenía `/cliente/beneficios`) y en el 7 (`/cliente/cupones`).

| Ruta | Para quién |
| --- | --- |
| `/superadmin/supply-v2/fidelizacion` | tablero de Membego |
| `…/fidelizacion/nuevo` | alta del programa |
| `…/fidelizacion/[id]` | ficha: planes, recompensas, referidos, puntos, presupuesto, bitácora |
| `/admin/supply-v2/fidelizacion` | portal del negocio, **solo lectura** |
| `/cliente/fidelizacion` | su membresía, sus puntos, sus canjes y su código |
| `/promociones/membresias` | escaparate, **dentro** del marketplace que ya existe |

Más la pestaña «Fidelización» en el nav de Supply 2.0, la entrada «Mi
fidelización» en el menú del cliente, una sección de membresías en
`/promociones` y el enlace en el portal del proveedor.

### 6.2 · Los once permisos, por fin exigidos (✅)

`actions-fidelizacion.ts` (670 líneas, **26 server actions**). Cada una empieza
por su `exigirPermisoSupplyV2`, y las tres del cliente por `exigirCliente`:

| Permiso | Qué abre |
| --- | --- |
| `_LOYALTY_VIEW` · `_LOYALTY_REPORT_VIEW` | ver programas · ver el tablero |
| `_LOYALTY_PROGRAM_CREATE` | crear, editar y pausar |
| `_LOYALTY_PROGRAM_APPROVE` | aprobar, rechazar y cancelar |
| `_MEMBERSHIP_MANAGE` | crear, publicar, pausar y archivar planes |
| `_MEMBERSHIP_GRANT` | otorgar, suspender y cancelar la membresía de alguien |
| `_REFERRAL_MANAGE` | configurar referidos y conceder sus premios |
| `_POINTS_ADJUST` | **ajustar puntos a mano** (el suyo propio: es lo que más se puede abusar) |
| `_REWARD_APPROVE` | crear, aprobar, pausar y reversar recompensas |
| `_LOYALTY_FINANCE_VIEW` | presupuesto, costos y estimación |

Ver un programa **no** es ver lo que cuesta: el presupuesto y la economía solo
se renderizan con `_LOYALTY_FINANCE_VIEW`.

### 6.3 · Lo que la interfaz no deja hacer (✅)

* El importe de una membresía **no viaja en el formulario**: lo pone el
  servidor desde el plan.
* El botón de canje **no decide** si alcanza; lo decide el servidor dentro del
  candado de la cuenta de puntos.
* Las claves de idempotencia se crean **al enviar** y viven en una ref, así que
  el doble clic manda la misma clave y el servidor devuelve lo que ya hizo.
  (Generarlas en el render es impuro y la guardia de React del proyecto lo
  rechaza; guardarlas con estado en un efecto, también.)
* El portal del negocio es de **lectura**: no hay ninguna acción de escritura
  sobre presupuestos ni condiciones financieras, y lo que se le muestra se
  filtra por el `supplierId` de su sesión.
* Otorgar una membresía y ajustar puntos **exigen motivo escrito**, y la
  pantalla dice que queda en la bitácora con el nombre de quien lo hizo.

## 7 · EL RECORRIDO DE NAVEGADOR, Y LOS DOS FALLOS QUE DESTAPÓ

`tests/e2e/supply-v2-slice8.spec.ts` (534 líneas). **Escritorio: 1 passed
(8,2 min). Móvil: 1 passed (37 s).**

Los 14 pasos, en este orden y desde la interfaz: programa con sus cuatro
modalidades y regla de 1 punto por cada RD$100 → plan de pago de RD$500 con un
beneficio del catálogo → **lo aprueba otra persona** (quien lo creó recibe el
rechazo por segregación) → publicado → escaparate → contratado → pedido de
membresía por el checkout de siempre → pagado → confirmado por finanzas →
**membresía activa con su beneficio en la cuenta** → 5 puntos por la membresía y
10 por una oferta de RD$1 000 → recompensa aprobada por otra persona → canje de
10 puntos → código de invitación estable → portal del negocio → tablero.

Comprobado después en PostgreSQL: el pedido es `kind = MEMBERSHIP` con **0
líneas y 0 derechos**, hay **un solo** evento económico `SALE_REVENUE`, el
movimiento de puntos lleva su `ruleSnapshot` congelado, el saldo cuadra con la
suma de los deltas del ledger, la reclamación cuelga de su `customerBenefitId`
y quien aprobó el programa **no** es quien lo creó.

### Los dos fallos reales del producto que las 102 pruebas del motor no veían

| # | Fallo | Por qué importaba |
| --- | --- | --- |
| 1 | **La página de compra del cliente no sabía renderizar un pedido de membresía.** `kind = MEMBERSHIP` existía en la base desde el modelo de datos, pero `CompraCliente` no lo exponía: el checkout mapeaba `lineas` —vacío en una membresía— y además componía un enlace roto a `/promociones/membego/`. | Quien contratara una membresía habría llegado a un checkout **vacío**, sin saber qué estaba pagando. Es el camino con dinero del slice. |
| 2 | **El formulario dejaba crear un programa de membresías sin negocio.** El servidor exige que un plan pertenezca al programa de un negocio concreto, así que el programa nacía inservible: ningún plan se podía crear. | Se perdía el trabajo de configurar un programa entero para descubrirlo al final, con un error que no explicaba qué hacer. |

Ninguno de los dos aparece en las 47 pruebas de dominio ni en las 55 de
PostgreSQL, **y las dos suites estaban en verde**. Eso es exactamente lo que
este filtro añade.

### Cinco errores míos en el test, y el patrón que los une

Las siete corridas que costó cerrar el recorrido dejaron una lección que vale
más que el test: **el arnés de E2E usa usuarios compartidos entre corridas.**
Tres aserciones distintas —el total de puntos de la persona, la tarjeta de
invitación con `.first()`, el saldo global— daban por supuesto un usuario
limpio, y las tres fallaron por lo mismo. La regla, ahora escrita en los
comentarios del spec: *toda aserción sobre datos del cliente se acota al
programa, cupón u oferta de ESTA corrida, nunca a un agregado de la persona.*

Los otros dos: el orden del recorrido (un plan no se publica hasta que su
programa está activo — el equivocado era el test, no el servicio) y una carrera
por no esperar a que el segundo pago saliera de la bandeja de finanzas.

Y un cambio de margen que **no** es tapar una prueba inestable: el móvil pasó
de 420 s a 600 s porque monta por interfaz todo lo que un plan necesita
—proveedor, producto, acuerdo, oferta y beneficio— antes de llegar a lo suyo, y
el escritorio tardaba 492 s haciendo más pasos. Queda dicho al lado del número
para que nadie lo lea como flakiness.

## 8 · PUERTAS, CON LA INTERFAZ DENTRO

| Puerta | Resultado | Estado |
| --- | --- | --- |
| `tsc --noEmit` | exit 0 | ✅ |
| `eslint src tests` | **0 errores** (15 avisos preexistentes) | ✅ |
| `next build` | compila; **las 6 rutas nuevas presentes** | ✅ |
| E2E Slice 8 escritorio | **1 passed** (8,2 min), 14 pasos | ✅ |
| E2E Slice 8 móvil | **1 passed** (37 s), sin desbordamiento lateral | ✅ |
| `scripts/auditar-diseno.mjs` | **0 radios fuera del vocabulario** | ✅ |
| `scripts/campos-sin-etiqueta.mjs` | 94, el techo: la interfaz nueva **no añadió ninguno** | ✅ |

## 9 · LO QUE SIGUE FUERA DE ALCANCE

La interfaz cubre el recorrido completo del slice, pero no todo lo que el motor
sabe hacer. Queda sin pantalla, a propósito y anotado:

* **Reversar una reclamación** y **anular un referido** tienen su formulario,
  pero no hay una bandeja que los liste: hoy se llega a ellos desde la ficha
  del programa.
* **Suspender y reactivar** una membresía existen como acción, sin pantalla
  propia de gestión de miembros uno por uno.
* **Fijar sucursales participantes** (`fijarSucursalesEnTx`) no tiene interfaz.
* El **historial de puntos de un cliente** se ve desde su propia cuenta, no
  desde una ficha de cliente en superadmin.

Nada de eso bloquea el recorrido ni mueve dinero sin control; son pantallas de
operación que conviene añadir cuando haya volumen que las justifique.

---

### Resumen

| | |
| --- | --- |
| Motor (dominio y servicios) | ✅ 4 116 líneas, cinco servicios, dominio puro separado |
| Interfaz | ✅ 3 494 líneas: 6 rutas, 26 server actions, 5 componentes |
| Pruebas del motor | ✅ **102** (47 dominio + 55 PostgreSQL), 0 fallos |
| Recorrido de navegador | ✅ **escritorio 1 passed · móvil 1 passed**, 14 pasos |
| Invariantes en PostgreSQL | ✅ 8 de 8 en cero, sobre 1 576 movimientos reales |
| Puertas estáticas y de migración | ✅ 14 de 14 |
| Los once permisos | ✅ exigidos en las 26 acciones |
| Regresión E2E Slices 1–7 | ⏳ **en curso** al escribir este informe; se anota aquí su resultado en cuanto cierre |
| **Estado del slice** | **motor probado y producto usable; a falta de la regresión de los slices anteriores** |

Lo que el motor traía ya estaba hecho con el mismo cuidado que los Slices 6 y
7: sin motores duplicados, con el ledger como verdad, con los puntos fuera del
dinero y con el antifraude apoyado en hechos de la operación y no en señales de
dispositivo. Lo que faltaba era que alguien pudiera usarlo, y eso es lo que
añade esta parte.

**La conclusión que me llevo de este slice:** un motor con 102 pruebas en verde
y todos los invariantes cuadrados seguía teniendo **dos fallos en el camino del
dinero** que solo aparecieron al hacer clic. «Las pruebas pasan» no es «la
persona puede hacerlo».
