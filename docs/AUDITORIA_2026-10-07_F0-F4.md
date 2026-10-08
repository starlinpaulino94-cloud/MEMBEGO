# Auditoría de las fases F0–F4 (2026-10-07)

> Auditoría independiente del trabajo de la rama `claude/wizardly-hypatia-x2l9av` (commit `053af7b`, PR #570) contra el **Plan Maestro** (`docs/PLAN_MAESTRO.md` §10 y §19) y contra lo que afirma `docs/IMPLEMENTATION_STATUS.md`. **El código manda**: cada afirmación se contrastó leyendo el archivo citado, y toda la verificación automática se repitió desde cero. Lo que no se pudo comprobar está dicho en §7.

## 1. Método

- **Verificación automática desde cero** (BD local `membego_pg`, PostgreSQL 16, con las 200 migraciones aplicadas y la Capa 2 de RLS reaplicada): tsc, eslint, unit, PostgreSQL, bundle, permisos, preflight y cobertura de RLS, deriva, sellos, `migrate status`, `prisma validate`, `npm audit`, `probar-rls` (BD migrada y BD `db push`), build y la **suite E2E completa**.
- **Siete revisiones de código independientes** (una por fase F0, F1, F2, F2.5, F3, F4 y una transversal de seguridad), de solo lectura, con la instrucción de citar `archivo:línea` y de no dar por bueno nada que no vieran en el código. Los hallazgos altos y críticos los volví a comprobar yo en el código antes de incluirlos aquí.
- Severidades: **CRÍTICO** (credenciales o pérdida de datos), **ALTO** (acceso cruzado entre empresas, dinero mal contado, bloqueo permanente), **MEDIO** (comportamiento incorrecto en un caso real pero acotado, o promesa de la doc que el código no cumple), **BAJO** (calidad, código muerto, cosmético, doc).

## 2. Resultado de la verificación (2026-10-07, repetida entera)

```text
TypeScript:          PASS   0 errores
Lint:                PASS   0 errores · 15 avisos, TODOS en archivos ajenos a F0–F4 (home/lectura, supply V1, inicio del cliente, e2e legacy)
Unit:                PASS   3 845 / 3 851 · 0 fallos · 6 omitidos (5 piden servidor dev, 1 claves QA de CardNET)
PostgreSQL:          PASS   522 / 522 (20 archivos, en serie, 3,5 min)
Bundle:              PASS   dentro del presupuesto (techo del total 8 400 KB)
Permisos:            PASS   103 funciones, guardia en las dos direcciones
RLS preflight:       PASS   302 tablas · 156 con companyId propio · 124 por FK · 281 cubiertas · 12 decididas a mano · 0 sin decidir
RLS cobertura-app:   PASS   569 archivos con contexto · 25 con llamadas directas a prisma (82 sitios), todos justificados
probar-rls:          PASS   43 / 43 sobre la BD migrada · 39 / 39 sobre `db push` (3 comprobaciones de inmutabilidad omitidas y dichas)
Esquema:             PASS   prisma validate · migrate diff = migración vacía (0 deriva) · migrate status «up to date» · 200 sellos
npm audit (prod):    PASS   0 vulnerabilidades  ← la doc todavía dice FAIL (lo arregló `1e36861`, llegado desde main)
Build:               PASS
E2E completa:        PASS   122 pasan · 0 fallan · 151 omitidas (15,2 min)
```

### 2.1 Suite E2E completa (ambos proyectos, réplica de `e2e.yml`)

**122 pasan · 0 fallan · 151 omitidas** (15,2 min; build con las variables de relleno de CI, `npm run e2e:limpio`). Las 151 omitidas son las de siempre: 114 sin Supabase de pruebas y las que corren solo en escritorio.

## 3. Veredicto por fase contra el Plan Maestro

| Fase | Criterio del plan (§19) | Veredicto | Qué falta o se desvió |
|---|---|---|---|
| **F0** | RLS en todas las tablas con `companyId`; primitives funcionales; Supply V2 pasa; módulos ocultos; CRM/Mensajería apagados para nuevos | 🟡 **4 de 6** | **Supply V1 no está oculto** (rutas, cron diario, `/cliente/beneficios` con menú siempre visible); Capa 2 **apagada en producción** (decisión del usuario); los shims de `supply-v2/core` no se eliminaron (a propósito). Nuevo: el alta de proveedor externo de Supply V1 crea empresas sin el override de tenant nuevo (M1) |
| **F1** | Empresa crea ítems; default invisible; selector con variantes; marketplace (vitrina + feed); API | ✅ **Cumple** (con reservas) | No hechos del plan: importación masiva, eventos de dominio, `VariantAttribute` (es JSON), integración en `/cliente/explorar`. Sin probar con Storage real. La ficha pública no se invalida al mutar (M3) |
| **F2** | Inventario por variante/sucursal; ledger append-only; reservas con TTL | ✅ **Cumple** | No hechos: `incoming`, `orderId` en el movimiento (hay referencia genérica), alertas en el dashboard (solo en la lista). Dominio y CHECK de traslados **idénticos** (13/13). Un bloqueo de 45 s puede quedarse corto en el barrido de reservas (M6) |
| **F2.5** | Supply en marketplace; búsqueda y categorías; patrocinado; compra por Supply; `MembegoOrder` de atribución | 🟡 **4 de 5** | **Categorías transversales y «cerca de mí» no existen**; la sincronización no es por outbox (es `after()` + cron + botón, con cruce en vivo). El criterio 5 (`MembegoOrder` al comprar) **sí está hecho desde F3.2** —la tabla de §2 del status aún dice «NO»—. Cambiar de casa desde el panel no funciona como dice el mensaje (M8) |
| **F3** | claim → visita → QR → completado → atribución; Supply Bridge genera `MembegoOrder` | ✅ **Cumple** | Máquina de estados del dominio y del disparador **idénticas** (7 estados, 49 combinaciones probadas). Desviaciones documentadas (código `MBG-PED-año-seq`, QR por token, eventos en bitácora). Sin avisos al cliente. Escáner fail-open si la sesión no trae empresa (M11, patrón heredado) |
| **F4** | CPA o 8 % por nivel; ledger inmutable separado de Supply; cortes; límite de crédito | ✅ **Cumple** (con 2 altos) | Las 15 combinaciones modelo × nivel son idénticas entre dominio y CHECK. Separación de Supply verificada (imports, tablas, escrituras). **Pero**: monedas sin comprobar en el libro (A3) y `createdAt` no monótono respecto a `seq` (A4). Fuera del plan a propósito: `PENDING`, `commerce-primitives/ledger`, «suspender campañas» (F5), config por tipo de operación |

**Separaciones que el plan exige y que se sostienen** (0 violaciones directas): `catalog|inventory|orders|billing` no importan de `supply-v2`/`supply-bridge`; `supply-v2` solo toca el puente en `actions-ofertas.ts:13` dentro de `after()`; `catalog` no importa de `inventory`; `billing` no importa de `orders`; ninguna tabla `merchant_*` referencia `supply_v2_*` ni al revés; nadie fuera de `billing/service.ts` escribe el libro; 0 `prisma.` fuera de `conEmpresa`/`sinEmpresa` en los cinco módulos y sus páginas; 0 `CREATE POLICY` en las 10 migraciones de la rama; 17/17 tablas nuevas con `companyId` propio; 0 `TODO/FIXME`. Hay **una violación transitiva** (M9).

## 4. Hallazgos

Cada uno lleva su origen: **[rama]** = introducido en F0–F4; **[previo]** = ya existía antes de la rama. Los altos y críticos los comprobé yo en el código.

### CRÍTICO

- **C1 · Credenciales de Supabase en git — y además la contraseña de Postgres.** `scripts/run-e2e-verify.mjs:11-19` y `scripts/run-auth-e2e.mjs:13-21` llevan embebidos los JWT `anon` y `service_role` (ref `ybzhvfmybyyomwpjpaud`, exp. 2036) **y la contraseña del pooler** en las cuatro cadenas de conexión (`DATABASE_URL`, `DIRECT_URL`, `E2E_TEST_*`). En git desde `506a350` (2026-09-18). §14 del status conocía los JWT; **la contraseña de la base no estaba registrada**. [previo] → Rotar la clave `service_role` **y** la contraseña de la base (ambas), confirmar si el proyecto es producción, sacar los valores a variables de entorno y añadir `gitleaks` a CI.

### ALTO

- **A1 · Venta y comisión de excursiones sin guardia.** `procesarVentaYComisionInterna(companyId, reservaId, userId)` está exportada desde un archivo `'use server'` (`src/modules/excursiones/ventas/actions.ts:77`) sin ninguna comprobación de sesión: Next la expone como endpoint, así que cualquier navegador puede crear una venta y su comisión en **cualquier empresa** y con el `userId` que quiera. Se usa como helper interno (`reservas/actions.ts:759`, `cliente-actions.ts:444,780`, `checkin/actions.ts:423,584`). [previo] → Moverla a un archivo sin la directiva (patrón de `notificaciones/service.ts`).
- **A2 · Invitaciones pendientes de cualquier empresa.** `listInvitacionesPendientes(companyId)` (`src/modules/admin/invitacionActions.ts:50`) no tiene guardia y devuelve email, rol y vencimiento de las invitaciones de la empresa que se le pida. La página sí pasa la empresa de la sesión, pero el endpoint acepta cualquiera. [previo] → Guardia + empresa de la sesión, o sacarla del archivo `'use server'`.
- **A3 · Monedas mezcladas en un mismo saldo corrido (Merchant Billing).** La comisión se asienta en la moneda del **pedido** (`src/modules/billing/service.ts:201`), que hereda la del ítem de catálogo (`orders/service.ts:256-258`; el catálogo admite cualquier código de 3 letras, `catalog/domain.ts:313-314`); los asientos manuales van en la de la **config** (`:311`); el corte se etiqueta con la de la config (`:471`). Ni el servicio ni el disparador `merchant_ledger_saldo` ni ningún CHECK comparan la moneda de un asiento con la del anterior o la de la cuenta: un pedido en USD suma dólares a un saldo en DOP. [rama, F4] → Rechazar en `registrarComisionDePedidoEnTx` si `pedido.currency !== config.currency` (el cierre del pedido falla con un error claro) y exigir en el disparador `NEW.currency = moneda del asiento anterior`.
- **A4 · `createdAt` del libro no es monótono respecto a `seq` → un periodo que nunca se podrá cortar.** `ahora` se captura **antes** de esperar el candado (`orders/service.ts:641`, `billing/barrido.ts:51`) y se escribe tal cual como `createdAt` (`billing/service.ts:135`); el `seq` se asigna al obtener el candado. Dos escritores que se crucen con una medianoche de Santo Domingo en medio (o un «Revisar ahora» largo) dejan `seq n` con fecha posterior a `seq n+1`. `generarCorteEnTx` delimita el periodo por `createdAt` (`:451,455`) pero cuadra contra el `balance` del último asiento por `seq` (`domain.ts:385-387`): el cuadre falla, la transacción entera se deshace, el barrido cuenta un error **cada día** y ningún corte posterior de esa empresa sale (van en orden). Probabilidad baja; consecuencia permanente. [rama, F4] → `createdAt = max(ahora, createdAt del anterior)` bajo el candado (o `clock_timestamp()`), y en el disparador `NEW.createdAt >= createdAt del anterior`.
- **A5 · (sigue abierto, ya en §14) El menú esconde Supply V1 **y V2** a todas las empresas.** `CAPACIDADES_DEL_MENU` (`src/modules/navegacion/contexto.ts:37-48`) no incluye `MEMBEGO_SUPPLIER`, y `capacidadVisible` (`nav-config.ts:1515-1521`) exige inclusión: las dos entradas con esa capacidad (`/admin/supply` y `/admin/supply-v2` «Entregas Membego», `nav-config.ts:683,693`) nunca se muestran. El status lo atribuye solo a V1; también afecta al módulo vivo. [previo]

### MEDIO

- **M1 · Alta de empresa sin el override de tenant nuevo.** `registrarProveedorExterno` (`src/modules/supply/proveedores.ts:84-96`) crea una `Company` con solo `MEMBEGO_SUPPLIER: true`; al no llevar `CAPACIDADES_OVERRIDE_TENANT_NUEVO` nace con CRM y Mensajería encendidas (su `type` `'otro'` cae a `CAR_WASH`). El status dice «4 sitios»: son 5. [previo]
- **M2 · Dos acciones más sin guardia en excursiones.** `sincronizarEstadoAgotada(companyId, excursionId)` y `sincronizarTodasAgotadas(companyId)` (`src/modules/excursiones/catalogo/actions.ts:786,963`): escritura de estado entre empresas y una transacción por excursión que cualquiera puede disparar. [previo]
- **M3 · La ficha pública del producto no se invalida al mutar.** `src/app/(public)/empresas/[companySlug]/catalogo/[itemSlug]/page.tsx:19,23,40` usa `revalidate = 120` y llama a `itemCatalogoPublico` directamente, sin `unstable_cache` ni el tag `marketplace`; el `revalidateTag` de las acciones (`catalog/actions.ts:64`) no la toca. Tras pausar un ítem o cambiar un precio, la ficha sigue sirviendo lo viejo hasta 2 minutos (pedir sí valida en vivo). El status dice «invalidado al mutar» y el E2E no mira la ficha. [rama, F1]
- **M4 · `CATALOG_MANAGE` ofrecido a satélites que nunca podrán usarlo.** `packages/contracts/src/scopes.ts:99,143` lo declara en el catálogo de capabilities de satélites; los `POST` lo rechazan siempre (`catalog-items/route.ts:72`). Es el «interruptor pintado» que `connect-panel.test.ts:63-66` dice evitar. [rama, F1]
- **M5 · El cierre externo no vende ni consume reservas.** `cerrarPedidoExternoEnTx` (`src/modules/orders/service.ts:695-750`) pasa a COMPLETED sin `venderLinea` ni comprobar que ninguna línea lleve `inventoryReservationId`; también admite POS/EXCURSION/API, no solo SUPPLY (`:704`). Hoy inalcanzable (los ítems puente nacen `trackInventory: false`), pero `supply-bridge/pedido.ts:138` lo asume sin guarda. [rama, F3]
- **M6 · Barrido de reservas sin presupuesto de tiempo.** `vencerReservasEnTx` procesa hasta 500 reservas en una transacción de 45 s (`inventory/service.ts:673-687`, `tenant.ts:63`) y el cron recorre 200 empresas con `maxDuration = 60`: un atraso grande deja empresas sin barrer con solo un `console.error`. Cada operación vence lo suyo, así que la corrección no sufre; `reserved` y las alertas sí. [rama, F2]
- **M7 · Cron del puente sin presupuesto de tiempo.** Una pasada hace una transacción por oferta + hasta 2 000 envoltorios + 200 reembolsos con `maxDuration = 60` (`api/cron/supply-bridge/route.ts:6`, `supply-bridge/barrido.ts:45-148`); lo último de la lista (reembolsos) sería lo primero sacrificado. [rama, F2.5]
- **M8 · Cambiar de casa es imposible desde el panel y el mensaje engaña.** `designarCasaEnTx` (`supply-bridge/service.ts:233-236`) cuenta también los ítems puente ARCHIVED de otra empresa; retirar la casa no reduce ese conteo, así que «retira esa empresa primero y vuelve a designar» nunca desbloquea otra empresa. Coherente con la intención («es una migración»), pero el mensaje promete un camino que no funciona. [rama, F2.5]
- **M9 · Acoplamiento transitivo Supply → Orders/Inventory/Billing.** `supply-v2/actions-ofertas.ts:13` importa `supply-bridge/barrido`, que importa `./pedido` (`barrido.ts:7`), que importa `orders/service` (`pedido.ts:3`) y de ahí inventario y billing. La regla «Supply no importa del Core» se cumple solo de forma directa y el test (`tests/supply-bridge.test.ts:83-99`) no vigila la cadena. [rama, F3.2] → Mover `sincronizarOfertaMejorEsfuerzo` a un archivo sin dependencia de `pedido.ts`.
- **M10 · El envoltorio crea fichas `Cliente` del comprador en la casa.** `supply-bridge/pedido.ts:44-53`: cada comprador de Supply aparece como cliente de la empresa de la casa (nombre + email) sin afiliación ni consentimiento explícito. Es un flujo de datos personales entre inquilinos que el status no señala como límite. [rama, F3.2] → Decidir y documentar (o crear la ficha sin datos de contacto).
- **M11 · El escáner es fail-open si la sesión no trae empresa.** `orders/escaner-actions.ts:36` y `visitas/actions.ts:240`: `role !== 'SUPERADMIN' && user.metadata.companyId && p.companyId !== …`. Un usuario con rol de escáner cuya `app_metadata` no lleve `companyId` (es `null` si falta, `auth-service.ts:57`) pasaría el filtro y podría cerrar pedidos de cualquier empresa. Es el **patrón heredado** del escáner de membresías (el mismo `metadata.companyId &&` aparece en 8 sitios más: `visitas/actions.ts:278,350,404`, `admin/actions.ts:714`, `ofertas/canjeActions.ts:80`, `promociones/canjeActions.ts:129`…). No comprobé si en producción puede existir un empleado sin `companyId`. [previo; F3 lo copió] → Fail-closed en los 10 sitios (`!companyId → denegar`).
- **M12 · «Borrar la confirmación» no borra la fila.** `ajustarMontoEnTx` solo anula `customerConfirmedAt` (`orders/service.ts:423`); la fila `CustomerConfirmation` queda y la vigencia se decide por `confirmedTotal == total` (`domain.ts:299-301`). Ajustar A→B→A deja la fila «vigente», el cliente no puede reconfirmar (`:511` devuelve repetido) y el pedido cierra como CUSTOMER_VERIFIED con `customerConfirmedAt = null`. Defendible (el cliente sí vio ese monto), pero la columna miente. [rama, F3]
- **M13 · Cortes solapados si el ciclo cambia entre dos barridos concurrentes.** `periodosPendientesEnTx` lee la config **sin candado** (`billing/service.ts:491`) y el candado se toma por periodo: cron + «Revisar ahora» con un cambio de ciclo en medio pueden emitir `09-01/10-01` y `09-01/09-16` + `09-16/10-01` (claves distintas; el único `(companyId, period)` no lo impide). [rama, F4] → `cuentaBloqueada` al inicio de `generarCortesPendientesEnTx` y/o `EXCLUDE USING gist` sobre el rango.
- **M14 · Claves de idempotencia manuales sin prefijo.** `asentarManualEnTx` acepta cualquier `idempotencyKey` (`billing/service.ts:282-285,315`). Un asiento manual con la clave `commission:<orderId>` hace que el cierre de ese pedido falle siempre con `CLAVE_REUTILIZADA` (`:114-116`) y, como el libro es inmutable, no hay forma de desbloquearlo. [rama, F4] → Prefijar las manuales (`manual:`) y rechazar las que empiecen por `commission:`.
- **M15 · La antigüedad de la deuda cuenta comisiones ya revertidas como cargos vivos.** `listarCuentasEnTx` toma todos los `REDEMPTION_FEE/ORDER_FEE` (`billing/queries.ts:248`) sin descontar los `REFUND`; `envejecerDeuda` asigna el saldo a los más nuevos. Un cargo viejo + un cargo nuevo revertido hoy se reporta como deuda de 0-30 días cuando tiene 60. Solo reporte, pero es la cifra con la que el superadmin decide cobrar. [rama, F4]
- **M16 · El barrido cobra con el nivel de verificación actual, no con el del cierre.** `billing/barrido.ts:70-75` pasa el `verificationLevel` leído hoy y el disparador exige el actual (`migration.sql:412`): un pedido con pago registrado después del cierre paga CPA si lo cobró el cierre y 8 % si lo cobró la red de seguridad. Contradice la decisión documentada en §3 («la evidencia que decide es la del pedido al completarse»). [rama, F4] → Decidir y documentar (propuesta: «la evidencia vigente al cobrar», que es lo que el disparador puede comprobar).
- **M17 · Inanición de la red de seguridad.** Los pedidos COMPLETED/MARKETPLACE que devuelven `SIN_COMISION` (base 0 o comisión que redondea a 0) siguen con `commission: null` y se reprocesan cada día (`barrido.ts:58-63`, `take: 200`, orden ascendente); con 200 de ellos en 45 días, los huérfanos reales nunca entran. [rama, F4] → Excluir base 0 en la consulta o dejar marca de «sin comisión».
- **M18 · Pagos duplicados con la misma referencia bancaria.** La idempotencia es por UUID del formulario (`CuentaAcciones.tsx:41,92`); asentar dos veces el mismo depósito crea dos `PAYMENT` con el mismo `referenceId` sin aviso. [rama, F4] → Índice único parcial `(companyId, 'PAYMENT', referenceId)` o aviso en la acción.
- **M19 · Sin secret scanning en CI y sin test de «`'use server'` sin guardia».** Los `*-permisos.test.ts` lo hacen solo para catálogo/inventario/pedidos/facturación; A1, A2 y M2 lo prueban. Pendiente desde §17-A del status. [previo]
- **M20 · `IMPLEMENTATION_STATUS.md` desactualizado** en varios puntos (ver §5).

### BAJO

- **F0:** las páginas de módulos ocultos usan `requireRole(ADMIN_ROLES)` y el cierre por capacidad depende solo del `layout.tsx` (`admin/{gamificacion,publicaciones,comunicacion,personalizacion}/page.tsx`); SUPERADMIN salta la capa de capacidades (`guards.ts:223`, diseño no dicho en §12); `tieneCapacidad(null, …)` devuelve `true` (`resolver.ts:83`); Supply V1 conserva copias propias de `dinero/fefo/ledger/estados`; el test de sincronía del menú es una copia manual unidireccional y `CAPACIDADES_DEL_MENU` no se exporta ni se vigila (`tests/navegacion-espacios.test.ts:63-75`).
- **F1:** el disparador no cubre `UPDATE OF catalogItemId` (mover la única variante a otro ítem deja al primero sin variantes; ninguna ruta lo hace) (`20261036:229-235`); entradas no-string dan `TypeError`/500 en vez de validación (`catalog/service.ts:226,236,321`; `plataforma/catalogo.ts:137-149`); cupo de 10 imágenes sin cerrojo y `remove` ignorado al borrar (`medios.ts:31-38`, `actions.ts:250`); borrar una variante con pedidos da mensaje genérico (`service.ts:453-459`); `TarjetaCatalogoPublica.tsx:6` y la ficha pública importan una constante de `supply-v2/core/catalogo`; la ficha consulta dos veces y mira la capacidad después de la BD (`publico.ts:103-110`).
- **F2:** la idempotencia de la transferencia no compara el destino (`inventory/service.ts:500`); espacio de claves compartido entre `K:out` y `K`; `eliminarVarianteEnTx` borra saldos «sin movimientos», no «en cero» (`catalog/service.ts:453-457`); `INVENTORY_TRANSFERRED` audita solo el origen; `service.ts:654` inalcanzable.
- **F2.5:** la caché de 120 s diluye el «en vivo» para vencimientos por fecha (`marketplace/cached.ts:195-201`); atribución solo de la primera línea (`pedido.ts:111`); barridos en paralelo acaban en `P2002` contado como error (sin candado global); carrera designar/sincronizar que puede dejar un ítem en `CONFLICTO` permanente (`designarCasaEnTx` no toma el advisory lock).
- **F3:** `renovarQrEnTx` no audita ni exige actor CLIENTE (`orders/service.ts:455-470`); carrera de idempotencia al crear (`:201-207`, acaba en `P2002` genérico, sin duplicar); `nuevaClaveDePedido` sin uso (`:845-847`); `completarPedidoPorQr` no comprueba la capacidad `PEDIDOS_MEMBEGO` (decisión a documentar); TTL de reserva = plazo del barrido (7 días) sin aviso a la empresa cuando el stock deja de estar apartado.
- **F4:** aritmética en coma flotante solo para presentación (`queries.ts:259-261`, `LibroDeCuenta.tsx:80-91`); `referenceType = 'STATEMENT'` admitido y nunca producido; liberar una cuenta suspendida que sigue pasada la deja `SUSPENDED` sin gracia (no documentado); el CPA puede superar el valor del pedido; la base solo rechaza SUPPLY (la regla «solo MARKETPLACE» vive en el dominio); `billing/service.ts:5` importa un tipo de `inventory/auditoria`; `revisarFacturacionAhora` corre el barrido entero dentro de una Server Action sin `maxDuration`; `redondear2(base)` antes del % es un no-op (la base ya es `DECIMAL(12,2)`), el doc lo describe al revés.
- **Transversal:** `establecerContrasenaCliente/Vendedor` sin rate limit ni longitud mínima propia; `recordPromotionView/Share` con «rate limit» por cookie manipulable; comentarios obsoletos (`cron-auth.ts:10` «tres rutas», hay 9; `e2e.yml:5` «164 pruebas»).

## 5. Discrepancias de `IMPLEMENTATION_STATUS.md` con el código (el código manda)

| Dice | Realidad |
|---|---|
| `npm audit`: **FAIL** 1 high (§1, §8, §14, §17-A.5) | **0 vulnerabilidades** (`1e36861` de main actualizó `source-map-js` y `sharp`) |
| §7 «196 directorios», «195 + genesis» | **200** migraciones (el propio §7 lo dice más abajo) |
| §2 F2.5 criterio 5 «MembegoOrder de atribución generado: **NO** — depende de F3» | **Hecho en F3.2** (envoltorio por el barrido del puente) |
| §1 «Commit actual: F2 = el commit posterior a f3c2360…» · handoff «Rama … **sin PR**» | Commit `053af7b`; **PR #570** abierto por el usuario |
| Capacidades: «25» (F0), «26» (§4) | **27** (`CATALOGO_UNIFICADO`, `PEDIDOS_MEMBEGO`) |
| `CAPACIDADES_OVERRIDE_TENANT_NUEVO` «en 4 sitios» | 4 lo usan; hay un **5.º alta** sin él (M1) |
| Tests: `catalogo-publico` 13 · `supply-bridge.db` 20 · `inventory.db` 35 · E2E inventario 3 · `orders.db` 46 | **23 · 28 · 37 · 4 · 47** (`pedidos-permisos` 20; el resto coincide: billing 22/7/9/35/6, orders-domain 26, catalog 19/14/9/4/31/10/14) |
| F2 §3: «nadie llama aún a `vender`/`reservar`/`consumir`» | F3 los llama (`orders/service.ts:313,605,613,783,815`) |
| F1 §3: «sin FK hacia `supply_v2_*`» / «`supplyV2CatalogItemId` no está» | Desde F2.5 existe `catalog_items.supplyV2OfferId` (FK RESTRICT) |
| §14: «Aplicar el patrón del disparador a `AuditLog` **antes de F4**» | No se hizo; `audit_logs` sigue inmutable solo por convención |
| §9: «~37 sitios `prisma.*` fuera de wrappers» | Hoy el gate cuenta 25 archivos / 82 sitios, todos justificados |
| §3 F4: «base **no** redondeada antes del %» | `domain.ts:110` sí la redondea (no-op) |
| §3 F4: «la evidencia que decide es la del cierre» | Cierto en el cierre; el barrido usa la actual (M16) |
| §3 F2.5: «3 líneas en `actions-ofertas.ts`» | 1 import + 1 llamada + comentarios |
| §12: el menú esconde Supply V1 «por accidente» | También esconde Supply **V2** (A5) |

## 6. Lo que el plan pedía y no se hizo (consolidado, todo documentado como desviación salvo donde se indica)

- **F0:** ocultar Supply V1 (criterio **FAIL**); Capa 2 en producción (decisión del usuario); eliminar los originales de `supply-v2/core` (a propósito).
- **F1:** importación masiva; eventos de dominio (`CatalogItemCreated`…); entidad `VariantAttribute` (es JSON); función `eliminar` (hay `archivar`); catálogo en `/cliente/explorar`.
- **F2:** `incoming`; `orderId` en el movimiento; alertas de stock bajo en el dashboard.
- **F2.5:** sincronización por el outbox de Supply; categorías transversales; «cerca de mí»; imágenes; eventos `SupplyCatalogSynced`….
- **F3:** código `MBG-YYYYMMDD-NNNNNN`; scanner tipo `MEMBEGO_ORDER`; eventos de dominio (son bitácora); avisos al cliente (no estaban en el plan pero faltan para usarlo).
- **F4:** `Commission.status = PENDING`; `MerchantLedgerEntry` sobre `commerce-primitives/ledger`; «si excede: suspender campañas» (F5); config por tipo de operación; y, fuera del plan pero necesario para operar: cobro real, avisos, PDF del corte, comprobante fiscal.

## 7. Lo que esta auditoría NO verificó

- **Producción:** estado de migraciones, Capa 1/Capa 2, Upstash, Sentry, si el proyecto `ybzhvfmybyyomwpjpaud` es producción y si sus credenciales siguen vivas (sin acceso).
- Que los specs E2E nuevos pasen en un **runner real de GitHub** (aquí corren en una réplica local de `e2e.yml`).
- Subida real de imágenes a Supabase Storage; recorrido con una persona en móvil real y modo oscuro (F1–F4).
- Que cada comprobación de rol de los ~100 archivos `'use server'` ajenos a la rama sea la correcta (se comprobó **presencia** de guardia, no su corrección, salvo en `visitas`, `cliente`, `transacciones`, `caja` y los de la rama).
- Que en producción no pueda existir un usuario de escáner sin `companyId` (condiciona M11).
- Las «mutaciones comprobadas» del status no son reproducibles desde el código (se ejecutaron a mano al implementar).
- Que `revalidateTag` dentro de `after()` surta efecto en Next 16 (si no, el puente se apoya en el cruce en vivo + TTL de 120 s).

## 8. Recomendación

Antes de empezar F5, un lote corto de correcciones, en este orden:

1. **(Usuario, hoy)** Rotar la clave `service_role` **y la contraseña de la base** del proyecto `ybzhvfmybyyomwpjpaud` (C1). Después: sacar los valores de los dos scripts a variables de entorno y añadir `gitleaks` a CI.
2. **Cerrar los cuatro endpoints sin guardia** (A1, A2, M2): mover los helpers a archivos sin `'use server'` y añadir el test que enumera `'use server'` sin guardia con la lista blanca de las 26 públicas (M19).
3. **Merchant Billing:** moneda única por cuenta (A3), `createdAt` monótono + regla en el disparador (A4), candado al listar periodos (M13), prefijo `manual:` (M14), antigüedad neta de reversos (M15), índice único por referencia de pago (M18), excluir base 0 del barrido (M17), y decidir/documentar M16.
4. **Escáner fail-closed** en los 10 sitios (M11), previa confirmación de que todo usuario de escáner tiene empresa.
5. **Ficha pública** con `unstable_cache` + tag (M3); `sincronizarOfertaMejorEsfuerzo` fuera de `pedido.ts` (M9); cambiar el mensaje de «cambiar de casa» (M8).
6. **Documentación:** corregir las discrepancias de §5 y registrar las decisiones (M10, M12, M16, SUPERADMIN salta capacidades).

Nada de lo anterior bloquea el desarrollo de F5, pero **C1, A1 y A2 están vivos en producción hoy** (si ese proyecto es producción) y A3/A4 deben cerrarse **antes de encender `PEDIDOS_MEMBEGO` en una empresa real**.

## 9. Correcciones aplicadas (lote del 2026-10-07, commits `ffe4e48` y `188dcba`)

Lo recomendado en §8 se aplicó, salvo lo que es decisión o acción de una persona. **Cada corrección lleva su prueba; las de reglas de la base y las de código se comprobaron además con una mutación** (se estropeó la corrección y la prueba falló).

| Hallazgo | Estado | Qué se hizo | Prueba |
|---|---|---|---|
| **C1** credenciales en git | 🟡 **código hecho; falta rotar (es tuyo)** | Los dos scripts E2E ya no llevan nada: leen todo del entorno (`scripts/e2e-entorno-remoto.mjs`; sin variables, se bloquean y dicen cuáles faltan). Job `secretos` de CI (gitleaks sobre los commits nuevos). **Las claves y la contraseña siguen en el historial de git: hay que rotarlas** | `tests/sin-credenciales.test.ts` (recorre todos los archivos versionados) |
| **A1, A2, M2** acciones sin guardia | ✅ | Los cuatro ayudantes salen de los archivos `'use server'`: `excursiones/ventas/procesar.ts`, `admin/invitaciones-consulta.ts`, `excursiones/catalogo/agotadas.ts` | `tests/acciones-sin-guardia.test.ts`: enumera todo `'use server'` con el compilador de TypeScript; 25 públicas por diseño en una lista con su razón; falla en las dos direcciones (mutación: añadir un export sin guardia lo rompe) |
| **M19** test de «`'use server'` sin guardia» y secret scanning | ✅ | Lo anterior + `secretos.yml` | idem |
| **A3** monedas mezcladas | ✅ | `registrarComisionDePedidoEnTx` rechaza `MONEDA_DISTINTA` (el cierre del pedido falla con un mensaje claro para quien escanea y el pedido sigue LISTO); el disparador `merchant_ledger_saldo` exige que el asiento sea de la moneda de la cuenta | PG 35 (servicio, cierre completo y base) |
| **A4** `createdAt` no monótono | ✅ | `instanteDelAsiento`: nunca anterior al último asiento; la base lo exige (`merchant_ledger_orden`) | PG 36 + unit |
| **M13** cortes solapados | ✅ | `generarCortesPendientesEnTx` toma el candado de la cuenta antes de calcular los periodos | PG 40 (concurrente) + unit de orden |
| **M14** claves manuales | ✅ | Prefijo `commission:` reservado al sistema (servicio) y CHECK `merchant_ledger_entries_clave_comision` (base) | PG 37 |
| **M15** antigüedad con comisiones revertidas | ✅ | `cargosVigentes` descuenta la comisión revertida y su reverso | PG 39 + unit |
| **M17** inanición del barrido | ✅ parcial | El barrido ignora los pedidos con base 0. Queda: una configuración con CPA 0 o % 0 sigue haciendo volver a sus pedidos cada día | unit |
| **M18** pago duplicado | ✅ | `PAGO_DUPLICADO` (servicio) + índice único parcial `(cuenta, referencia)` de los pagos (base) | PG 38 |
| **M16** evidencia del barrido | ✅ decidido y documentado | Se cobra con la evidencia **vigente al cobrar**: la del cierre en el camino normal, la de ese día en la red de seguridad (la base ya lo exigía) | comentario del servicio |
| **M11** escáner fail-open | ✅ | `puedeOperarEnEmpresa` (falla cerrado) en los **8** sitios (escáner de pedidos, de visitas ×4, canjes de ofertas y de promociones, ficha de cliente) | `tests/empresa-de-la-sesion.test.ts` (también prohíbe el patrón viejo en todo `src/`) |
| **M1** alta de proveedor sin override | ✅ | `registrarProveedorExterno` lleva `CAPACIDADES_OVERRIDE_TENANT_NUEVO` | `capacidades-fase0`: **toda** alta de empresa de `src/` debe llevarlo (falla sin el arreglo) |
| **M3** ficha pública sin tag | ✅ | `getItemCatalogoPublico` (caché con el tag del marketplace) | unit + E2E `catalogo-admin`: tras pausar, la ficha da 404 |
| **M9** acoplamiento transitivo Supply → Core | ✅ | `sincronizarOfertaMejorEsfuerzo` vive en `supply-bridge/mejor-esfuerzo.ts`, que no alcanza pedidos, inventario ni billing | `supply-bridge.test.ts`: cierre transitivo de imports |
| **M8** mensaje de «cambiar de casa» | ✅ | Ahora dice la verdad: es una migración de datos | — |
| F1 bajo: `TarjetaCatalogoPublica` y la ficha importaban de Supply | ✅ | `RUTA_OFERTAS_MEMBEGO` en el catálogo (una prueba la compara con la de Supply) | unit |

**No se tocó** (decisión tuya o fuera del lote): **A5** (el menú esconde Supply V1 y V2: decide qué se muestra); **M4** (`CATALOG_MANAGE` ofrecido a satélites que no lo pueden usar); **M5** (`cerrarPedidoExternoEnTx` no vende reservas: hoy inalcanzable); **M6/M7** (presupuesto de tiempo de los barridos de reservas y del puente); **M10** (fichas de clientes de Supply en la casa) y **M12** (`CustomerConfirmation` al ajustar): decisiones de producto; y los **bajos**. Siguen en §4.

**Verificación del lote** (BD local, desde cero): tsc 0 · eslint 0 errores · unit 3 880 (2 pruebas viejas ajustadas al código corregido) · **PostgreSQL 528/528** (+6, billing 41) · permisos 103 · preflight 281/302 · cobertura RLS · **0 deriva · 201 sellos** · `migrate status` al día · `npm audit` 0 · `probar-rls` 43/43 y 39/39 · build · bundle. E2E completa: ver el commit que cierra este documento.

## 10. Re-verificación del 2026-10-08 (tras dos fusiones de `main`)

Una revisión independiente de solo lectura recorrió cada fila de §9 en el commit `51273c4`: **las 20 correcciones siguen en el código y ningún test que las vigila fue debilitado, saltado ni borrado** (los únicos cambios en esos tests son la lista `PUBLICAS` de `acciones-sin-guardia`, hoy 27 entradas y no 25 —+`solicitarRecuperacion`, +`resumirCarrito`, −`puedeAdministrarSupply` al retirarse Supply V1—, y el piso de altas de empresa de `capacidades-fase0`, 5 → 4, por el mismo retiro). Lo que cambió es la documentación, no el código: **M1** describe un arreglo en `registrarProveedorExterno`, función que desapareció con Supply V1 (#574); la regla «toda alta lleva el override» sigue vigilada. **M3**: el E2E comprueba que la ficha pausada deja de mostrar su encabezado (la respuesta va en streaming con 200), no «da 404». **M5** quedó cerrado por el commit de la caja conectada (`13cdf01`): `cerrarPedidoExternoEnTx` ya vende las reservas (`orders/service.ts:772-773`) y es alcanzable (la venta de mostrador lo usa). **A5** afecta hoy a una sola entrada del menú (`/admin/supply`), porque `/admin/supply-v2` desapareció con el renombrado. `docs/DEVOPS.md` no lista el job `Secretos` entre los checks obligatorios (el propio workflow pide marcarlo). Sin verificar: que `Secretos` sea un check obligatorio en la protección de `main` (la API responde 403) y que las credenciales de `506a350` se hayan rotado.
