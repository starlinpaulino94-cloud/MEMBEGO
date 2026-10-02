# MEMBEGO SUPPLY 2.0 — Auditoría del Vertical Slice 8

Fecha: **2026-10-02** · Rama auditada: `main` = **`c5cdce0e`** · Auditoría hecha
desde `claude/jolly-brahmagupta-dmhml9`, reiniciada sobre ese commit.

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

## VEREDICTO EN UNA FRASE

**El motor está terminado y bien probado; la interfaz no existe.** El Slice 8
tiene 4 116 líneas de dominio y servicios, 102 pruebas en verde y todos los
invariantes de dinero y de puntos cuadrados en PostgreSQL — pero **ni una
página, ni un componente, ni una server action, ni una prueba de navegador.**
Hoy ningún ser humano puede contratar una membresía, ver sus puntos ni canjear
una recompensa desde Membego.

Por el criterio que esta misma serie de slices viene aplicando —«si el
recorrido no funciona desde la interfaz, el slice no está terminado»— el
**Slice 8 está a medias: la mitad que está, está muy bien.**

---

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

## 3 · PUERTAS OBLIGATORIAS — ejecutadas hoy sobre `c5cdce0e`

| Puerta | Resultado | Estado |
| --- | --- | --- |
| `tsc --noEmit` | exit 0 | ✅ |
| `eslint src tests` | **0 errores** (15 avisos preexistentes) | ✅ |
| `next build` (producción) | compila | ✅ |
| `npm test` | **3 438 tests · 3 432 pass · 0 fail · 6 skip** | ✅ con nota ⚠️ |
| Dominio Slice 8 | **47 pass · 0 fail** | ✅ |
| `npm run test:db` | **218 pass · 0 fail · 0 skip** | ✅ |
| PostgreSQL Slice 8 | **55 pass · 0 fail** | ✅ |
| **E2E Slice 8** | **no existe el archivo** | ❌ |
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

## 4 · LO QUE FALTA

### 4.1 · ❌ No hay interfaz. Ninguna.

Esto es lo que impide dar el slice por terminado:

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

### 4.2 · ⚠️ Los 11 permisos están declarados pero no se exigen en ninguna parte

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

### 4.3 · ❌ No hay recorrido de navegador

No existe `tests/e2e/supply-v2-slice8.spec.ts`. En los Slices 6 y 7 el E2E fue
justamente lo que destapó los defectos que las pruebas de base no veían: el
asistente que perdía las ofertas marcadas, el portal que sumaba mal el aporte
del proveedor, la pantalla que escondía un bono del cliente. **Aquí ese filtro
no se ha pasado**, y es el que convierte «el servicio funciona» en «la persona
puede hacerlo».

### 4.4 · ❌ No había informe de auditoría

Los Slices 3 a 7 tienen el suyo en `docs/`. El Slice 8 no tenía ninguno; este
documento lo cubre en parte, con la limitación del aviso de método.

## 5 · RIESGOS Y OBSERVACIONES

| # | Riesgo | Detalle | Gravedad |
| --- | --- | --- | --- |
| 1 | **El esquema se congeló antes de tener interfaz** | Las migraciones están aplicadas y selladas; si al escribir las pantallas falta una columna, habrá que añadir migración nueva. Ya pasó una vez (`20261023`, el CHECK de la recompensa) y se resolvió bien. Conviene presupuestar una o dos más. | ⚠️ |
| 2 | **Dos sistemas de fidelización en paralelo** | Supply V1 ya tiene `/admin/membresias`, `/admin/referidos`, `/admin/crecimiento/recompensas`, `/cliente/referidos` y `/mis-membresias` **en producción**. El Slice 8 construye otro al lado, igual que Supply V2 convive con V1. Cuando llegue la interfaz, **dos menús llamados «Membresías» van a confundir a quien opera**. Hay que decidir el nombre y la ruta antes de escribir la primera página, no después. | ⚠️ alta para la operación |
| 3 | **Permisos sin estrenar** | §4.2. | ⚠️ |
| 4 | **El multiplicador de membresía siempre trunca** | Decisión explícita y probada (dominio 14). Es conservadora a favor de Membego: el cliente recibe el entero inferior. Correcta, pero conviene que esté dicha en la letra pequeña del programa cuando haya interfaz. | ⚠️ baja |
| 5 | **El costo potencial es una estimación** | Puntos emitidos y no canjeados son un pasivo probable, no dinero adeudado. El tablero lo separa y lo etiqueta (§37, probado). Bien resuelto; el riesgo es que alguien lo lea como deuda en un reporte. | ⚠️ baja |
| 6 | **No audité el prompt original** | Ver el aviso de método. Si el Slice 8 pedía algo que no dejó rastro en código, esquema ni pruebas, esta auditoría no lo detecta. | ⚠️ |

## 6 · RECOMENDACIÓN

El motor no necesita retoques: está probado donde importa y los invariantes
cuadran. Lo que falta es la mitad visible, y conviene hacerla en este orden:

1. **Decidir el nombre y la ruta** frente a la fidelización V1 que ya está en
   producción (riesgo 2). Es una decisión de producto, no técnica, y bloquea
   todo lo demás.
2. **Rutas, etiquetas y chips** en `core/catalogo.ts` — hoy vacío para
   fidelización.
3. **Server actions** detrás de los once permisos ya declarados, que es lo que
   por fin los pone a prueba.
4. **Pantallas**: superadmin (programa, planes, recompensas, tablero), cliente
   (membresía, puntos, recompensas, invitaciones), proveedor (lo suyo y solo lo
   suyo).
5. **E2E de escritorio y móvil** con el recorrido completo: contratar una
   membresía pagando → ver los beneficios en la cuenta → acumular puntos con una
   compra → canjear una recompensa → entregarla por QR → invitar a alguien → que
   su primera compra pague al que invitó. Y comprobarlo después en PostgreSQL.
6. **Cerrar el informe** con la evidencia de ese recorrido.

---

### Resumen

| | |
| --- | --- |
| Backend | ✅ 4 116 líneas, cinco servicios, dominio puro separado |
| Pruebas automáticas | ✅ **102** propias (47 dominio + 55 PostgreSQL), 0 fallos |
| Invariantes en PostgreSQL | ✅ 8 de 8 en cero, sobre 1 576 movimientos reales |
| Puertas estáticas y de migración | ✅ 14 de 14 |
| Interfaz | ❌ no existe |
| Recorrido de navegador | ❌ no existe |
| **Estado del slice** | **a medias — motor terminado, producto no entregable** |

Lo que está hecho está hecho con el mismo cuidado que los Slices 6 y 7: sin
motores duplicados, con el ledger como verdad, con los puntos fuera del dinero
y con el antifraude apoyado en hechos de la operación y no en señales de
dispositivo. Falta que alguien pueda usarlo.
