# Membego Supply 2.0 · Slice 9 · Bloque 4

**Centro de Operaciones, health/readiness, banderas, interruptores, alertas y búsqueda operativa.**

| | |
|---|---|
| Base efectiva | `2c0ce6aa` (fusión del PR #548 en `main`) |
| Rama | `claude/jolly-brahmagupta-dmhml9` |
| Fecha | 2026-10-02 |
| Estado | Bloque 4 terminado y verificado. **No fusionado, no desplegado.** |

---

## 1. Sincronización

```
git log origin/main..rama   →  (vacío)
git diff rama origin/main   →  (vacío)
```

El bloque 3 ya estaba fusionado (PR #548) y los árboles eran idénticos, igual
que al empezar el bloque 3. Nada que integrar, ningún conflicto: la rama se
adelantó con `--ff-only` a **`2c0ce6aa`**, el SHA base del bloque 4.

**La base estaba verde**, y esta vez sí a la primera: `npm test` 3509/0 y
`npm run test:db` **275/0 en tres corridas** antes de escribir una línea. (En el
bloque 3 no lo estaba y hubo que arreglar la familia de contadores globales;
aquel arreglo aguantó.)

---

## 2. Arquitectura: qué se reutilizó y qué es nuevo

**No se duplicó nada de lo que ya existía:**

| Lo que hacía falta | Lo que ya estaba y se usó |
|---|---|
| Salud de la cola | `jobs/muertos.ts` → `saludDeLaCola()`, `trabajosMuertosPendientes()` |
| Reintentar/descartar un trabajo difunto | `jobs/panelActions.ts`, con su auditoría `COLA_REENCOLADA`. **Se enlaza, no se reimplementa.** |
| Reintentar un efecto del outbox | `operations/outbox.ts` → `reintentarEfecto` (bloque 1), que devuelve la escalera y audita |
| Incidentes y conciliaciones | Bloque 3 completo: modelos, servicios y read models |
| Investigar y resolver | Bloque 3: candado, actor humano, nota obligatoria, servicio financiero oficial |
| Inbox y outbox | Bloque 1 |
| Health | `/api/health` sigue intacto; `/live` y `/ready` son **hermanos**, no sustitutos |
| Cron | El `/api/cron/supply-v2` de siempre, con cuatro pasos más |
| Bitácora | `auditarEnTx`, con **tres** acciones nuevas y ninguna duplicada |
| Permisos | El catálogo de `contracts/gateways.ts`, con **dos** entradas nuevas |
| UI | `StatusChip`, `Card`, `PageHeader`, `Input`… del sistema de diseño |

**Lo nuevo son dos tablas pequeñas**, y antes de añadirlas se buscó dónde
meterlas (§8 del esquema lo deja escrito):

* `Notificacion` es un buzón **por persona** sin máquina de estados: no hay
  «reconocida» ni «resuelta», y una alerta operativa no es de nadie en
  particular.
* `SupplyV2FinanceIncident` es **dinero que no cuadra**. Un outbox atrasado no
  lo es, y meterlo ahí contaminaría la cola de finanzas con operaciones —lo
  mismo que el bloque 3 se negó a hacer con la basura de entrada—.
* `AuditLog` es **append-only**: registra que algo pasó, no el estado de algo
  que sigue pasando.

Y los interruptores no pueden vivir solo en el entorno: **un interruptor de
emergencia que tarda un despliegue no es un interruptor de emergencia.**

---

## 3. Centro de Operaciones

`/superadmin/supply-v2/operaciones`, con seis páginas más: `incidentes`,
`incidentes/[id]`, `conciliaciones`, `inbox`, `outbox`, `difuntos` y `buscar`.
Todas tras `requireRole('SUPERADMIN')`.

Contesta las nueve preguntas del encargo, cada una con un dato de la base:

| Pregunta | Dónde se contesta |
|---|---|
| ¿Hay integraciones caídas? | Estado del sistema · componente `pagos` |
| ¿Hay incidentes abiertos? | Cifra `incidentes` + sección Incidentes |
| ¿Hay outbox atrasado? | Cifras `outbox` y `más viejo` · componente `outbox` |
| ¿Hay dead letters? | Cifras `efectos sin salida` y `trabajos difuntos` · sección Sin salida |
| ¿Hay conciliaciones discrepantes? | Cifra `discrepancias` · sección Conciliaciones |
| ¿Hay jobs fallando? | Componente `trabajos` · tabla de la cola de siempre |
| ¿Falta configuración crítica? | Sección Configuración, por estados |
| ¿Se puede seguir aceptando pagos? | Componente `pagos` + capacidades |
| ¿Qué pasó con una compra? | Búsqueda + línea de tiempo |

**Ningún `HEALTHY` por existir.** Cada estado sale de una cifra comparada con un
umbral. Y si la base no responde, el panel lo dice en una tarjeta: no pinta
ceros, porque «todo en cero» se lee como «todo en orden» justo cuando nada lo
está.

### La UI, y lo que las guardias del proyecto corrigieron

Denso y legible: una fila por componente, cifras pequeñas con enlace a donde se
investiga, tablas con `overflow-x-auto` **en su caja** —no en la página—, y
`data-testid` en todo lo que el E2E necesita.

Escribí la primera versión con colores literales (`bg-emerald-50`,
`text-amber-700`) y textos de 10–11 px. **Tres guardias del repositorio la
rechazaron**, y tenían razón:

* `superadmin-coherencia` · «los estados se pintan con tokens, no con colores
  literales» → reescrito con `StatusChip` y tonos semánticos
  (`success`/`warning`/`danger`/`neutral`), que **cambian con el tema**; en modo
  oscuro mi versión se veía igual que en claro.
* `superadmin-coherencia` · «el panel no baja del suelo tipográfico» → fuera los
  `text-[11px]`: media plataforma se usa de pie.
* `deuda-diseno` → 88 clases de color fuera del vocabulario y 16 textos por
  debajo de 12 px, las dos deudas a cero.
* `accesibilidad-formularios` → un campo sin nombre accesible (la nota de
  reconocer una alerta, en una celda de tabla). Un `placeholder` no es un
  nombre: se borra al escribir y un lector de pantalla no lo anuncia. Ahora
  lleva `aria-label`.

---

## 4. Health y readiness

Tres endpoints, y **los tres hacen cosas distintas a propósito**:

| Endpoint | Pregunta | Toca la base | Llama afuera |
|---|---|---|---|
| `/api/health` (existía) | estado agregado + diagnóstico con secreto | sí | no |
| `/api/health/live` | ¿vive el proceso? | **no** | **no** |
| `/api/health/ready` | ¿puede Supply operar? | sí | **no** |

**Liveness no toca nada**, y es el punto: si dependiera de un tercero, un
proveedor caído haría que el orquestador reiniciara una aplicación sana —y
reiniciar no arregla el proveedor de otro—.

**Readiness** comprueba base, esquema (centinelas del Slice 9), configuración
crítica, cuenta de la integración, secreto de la pasarela cuando la capacidad
está encendida, y la cola. **No llama al proveedor externo**: se consulta muchas
veces por minuto y hacerlo convertiría cada sonda en tráfico hacia un tercero y
su latencia en nuestra indisponibilidad.

Y distingue lo que §26 pide:

```
externalPayments = false            → 200 · componente NOT_CONFIGURED
externalPayments = true, sin actor  → 503 · not_ready
degraded (cola acumulada)           → 200 · el servicio atiende
```

`degraded` responde **200** a propósito: un 503 ahí haría que el balanceador
sacara de rotación una instancia que funciona.

---

## 5. Configuración crítica

Un validador central que devuelve **estados, nunca valores**:

```
CONFIGURED · MISSING · INVALID · DISABLED
```

* `INVALID` comprueba la **forma**: longitud mínima y que no sea un marcador de
  ejemplo (`cambiame`, `changeme`, `xxx`…). Un secreto de cuatro letras copiado
  de un tutorial pasa cualquier «¿está puesto?» y no protege nada.
* `DISABLED` cuando la capacidad está apagada: que falte entonces es una
  consecuencia de la decisión, no un descuido, y marcarlo en rojo dejaría el
  panel en ámbar permanente en los entornos sin pasarela —y un panel siempre en
  ámbar no se lee—.
* De un secreto sale **que está**, ni los últimos cuatro caracteres: en un
  secreto corto eso es media clave, y un panel lo ve más gente que la base
  (soporte, un compañero por encima del hombro, una captura en un chat).
* Sentry es `DISABLED` cuando no está, no `MISSING`: no es crítico para operar.
* QStash ausente es `INVALID`, no `MISSING`: la cola **no se pierde**, ejecuta en
  línea. Es degradación honesta, y el panel lo explica.

---

## 6. Banderas y kill switches

**No son lo mismo, y confundirlos es el problema:**

```
BANDERA (entorno)      ¿existe la capacidad en este despliegue?  cambiarla pide un despliegue
INTERRUPTOR (base)     ¿está permitida AHORA?                    surte efecto en segundos
efectiva = bandera Y interruptor
```

Para funcionar hacen falta las dos; **para apagar basta una**. En una emergencia
apagar tiene que ser fácil y encender, deliberado.

Las cuatro capacidades: `SUPPLY_V2_EXTERNAL_PAYMENTS`,
`SUPPLY_V2_OUTBOX_DELIVERY`, `SUPPLY_V2_RECONCILIATION_SWEEP`,
`SUPPLY_V2_OPERATIONS_CENTER`. Nombres explícitos a propósito:
`SUPPLY_V2_PAGOS` no diría si se apaga el cobro al cliente, el pago al proveedor
o los avisos de la pasarela.

**La bandera por defecto está ENCENDIDA**, y conviene justificarlo porque el
encargo pide «default seguro»: la protección de este camino **no es la
bandera** —es la firma, la cuenta de integración configurada y la conciliación,
que fallan cerrado cada una por su cuenta—. Una bandera apagada por defecto
haría que un despliegue nuevo dejara de aceptar avisos de pago **en silencio**,
que es otra forma de perder dinero: el proveedor los daría por entregados.

**Lo que un interruptor NO apaga** está escrito capacidad por capacidad, y
probado: apagar los pagos externos corta el **procesamiento** y deja intactos el
Centro de Operaciones, la búsqueda, la investigación y la resolución manual. Si
apagar la integración apagara el panel, **nadie podría ver por qué la apagó** —y
ese es exactamente el momento en que hace falta verlo—.

Apagar **exige motivo** (servicio y `CHECK` de la base); encender no: lo que
necesita explicación es dejar de procesar, no volver a la normalidad. Las dos
direcciones quedan auditadas.

---

## 7. La política del webhook apagado

```
SUPPLY_V2_EXTERNAL_PAYMENTS = false   →   503 · FEATURE_DISABLED
```

Y la comprobación es **lo primero**, antes de verificar la firma y antes de
tocar la base.

**503 y no 200.** Un 200 sin procesar le diría al proveedor que el aviso quedó
entregado y no volvería a mandarlo: eso es perder un aviso de pago con todas las
letras. **Y no un 4xx**, porque el que llama no tiene nada mal. Un 503 es
exactamente «ahora no puedo, vuelve»: su reintento nos lo trae cuando la
integración se reactive.

Esto cambió una verdad del bloque 2 —entonces `INTERNAL_ERROR` era el único
código que invitaba a reintentar—, así que **actualicé esa prueba explicando por
qué** en vez de aflojarla: ahora son dos, 500 y 503, y la regla no cambió (4xx
es «tú tienes algo mal», 2xx es «nos hacemos cargo», el resto pide que vuelvan).

---

## 8. Alertas

Un motor simple, no un sistema de observabilidad. Siete condiciones:
`OUTBOX_BACKLOG`, `OUTBOX_DEAD`, `INBOX_DEAD`, `FINANCE_INCIDENTS_HIGH`,
`RECONCILIATION_MISMATCH`, `QUEUE_DEAD_JOBS`, `READINESS_DEGRADED`.

**UNA FILA POR CONDICIÓN. La clave primaria ES la condición.** No es una
optimización: es la única forma de que esto siga sirviendo cuando haya mucho
acumulado. Si cada efecto fallido abriera su alerta, veintitrés efectos fallidos
serían veintitrés avisos, y el aviso veinticuatro —el que importaba— llegaría a
una bandeja que ya nadie abre. Lo que se guarda es
`OUTBOX_BACKLOG count=23 oldest=17m`, y hay prueba de que tres evaluaciones no
crean tres alertas (y de que el `INSERT` duplicado lo rechaza la base).

**Una alerta se cierra porque el problema se fue**, no porque alguien la
cerrara. `ACKNOWLEDGED` significa «ya lo sé, estoy en ello» y se respeta
mientras la condición siga: volver a ponerla en ACTIVE en cada pasada del cron
sería discutir con quien ya la vio. Reconocer exige **nota** (servicio y
`CHECK`).

Una capacidad apagada **no genera la alerta de su propio atraso**: si la entrega
está apagada a propósito, que haya efectos esperando es lo esperado, no algo que
despierte a nadie.

---

## 9. Umbrales

Configurables, con defaults documentados:

| Variable | Default |
|---|---|
| `SUPPLY_V2_OUTBOX_PENDING_WARN_MINUTES` | 15 |
| `SUPPLY_V2_OUTBOX_PENDING_CRITICAL_MINUTES` | 60 |
| `SUPPLY_V2_DEAD_LETTER_THRESHOLD` | 1 |
| `SUPPLY_V2_OPEN_INCIDENTS_HIGH_THRESHOLD` | 1 |
| `SUPPLY_V2_MISMATCH_THRESHOLD` | 1 |
| `SUPPLY_V2_INBOX_DEAD_THRESHOLD` | 1 |

Dos decisiones con prueba: **un valor absurdo no apaga la vigilancia** (se
vuelve al de siempre; un umbral mal escrito no puede dejar el sistema ciego), y
**el crítico nunca queda por debajo del de aviso** (si alguien los invierte, lo
grave avisaría más tarde que lo leve).

---

## 10. Búsqueda y línea de tiempo

**El texto se interpreta ANTES de consultar**: `MBG-SO-…` es una compra,
`sv2-…` un hilo, `TX-…` una transacción, `evt_…` un evento, un cuid es un id. Y
cada caso se busca **por su campo indexado y por igualdad**.

Un `%texto%` sobre cuatro tablas sería cómodo de escribir y acabaría siendo la
consulta más lenta del sistema justo el día que hay un incidente: el panel se
abre cuando hay mucho acumulado, que es cuando un escaneo completo duele. Lo que
no tiene forma reconocible se dice `DESCONOCIDO` **y no se busca**.

El resultado viene **agrupado** —compra, eventos, comprobaciones, incidentes,
efectos y avisos—, porque la pregunta real nunca es «¿dónde aparece este
texto?», es «¿qué pasó con esto?».

**La línea de tiempo solo lleva lo persistido**, cada momento con su fuente
(`inbox`, `conciliacion`, `incidente`, `orden`, `outbox`, `aviso`, `bitacora`).
Y **dice lo que no puede reconstruir**: la verificación de firma, el rechazo por
replay y el corte por tamaño **no dejan fila** —a propósito: lo que no está
firmado no entra— y solo constan en los logs `sv2`. Poner «firma verificada» en
una línea construida desde la base sería inventarse un momento que nadie guardó.

---

## 11. Incidentes, difuntos, outbox y jobs

* **Ficha de incidente** (§17): severidad, motivo, pasarela, transacción,
  compra, hilo, estado interno y externo, esperado vs reportado, comprobaciones,
  historia y acciones. Las acciones son **las del bloque 3**.
* **Sin salida** (§18): efectos del outbox con intentos, primer y último
  intento, último error, compra y hilo, **con reintento** —que existe desde el
  bloque 1 y devuelve la escalera completa—. Los trabajos de la cola se
  muestran y se **enlaza** a su panel, donde sus acciones ya vivían.
* **Outbox** (§19): los cinco estados con edad, intento, `availableAt`,
  `claimedAt`, hilo y tipo de efecto. **Solo lectura**: lo que mueve una fila es
  el worker, el rescate del arriendo o un reintento, cada uno con su candado.
  Un `UPDATE` a mano desde un panel se saltaría los tres.
* **Jobs** (§20): se reutiliza `trabajos_muertos`. **Limitación declarada**: ese
  modelo guarda los **difuntos**, no un historial de cada ejecución, así que el
  panel no puede mostrar «el trabajo X falló tres veces y la cuarta funcionó».
  **No se creó otra tabla de historial** para rellenar ese hueco: sería duplicar
  infraestructura por una vista, y el encargo pedía documentarlo antes.

---

## 12. Cron

Al cron existente (`/api/cron/supply-v2`), en este orden deliberado:

1. **rescatar** arriendos abandonados → lo que un worker muerto dejó reclamado
   vuelve a estar disponible;
2. **despachar** el outbox → lo recién rescatado sale en la misma pasada;
3. **conciliar** lo reciente → detecta lo que el webhook no vio;
4. **evaluar** alertas **al final**, cuando las cifras ya reflejan lo que acaba
   de hacerse. Evaluarlas primero avisaría de un atraso que esa misma pasada
   estaba a punto de resolver.

Cada paso **respeta su interruptor** y los cuatro son **idempotentes**: el plan
puede ejecutar el cron una vez al día, así que procesan el acumulado, toleran
retraso y se pueden lanzar a mano. Hay prueba de que dos pasadas no duplican
derechos, efectos, incidentes, comprobaciones ni avisos.

---

## 13. Seguridad y aislamiento

**Nunca se muestra**: el secreto del webhook, firmas, cabeceras de autorización,
tokens, valores de entorno ni el payload completo. El cuerpo guardado ya viene
saneado del bloque 1 y el panel **no lo muestra**: lo que sirve para operar es
el estado, los intentos y el error. Hay prueba de que ni el secreto ni el id de
la cuenta aparecen en la respuesta del validador, y el E2E comprueba que **no
están en el HTML de la página**.

**Aislamiento** (§28): el Centro de Operaciones es **solo superadmin**
(`requireRole('SUPERADMIN')` en las siete páginas). Las consultas nuevas son
globales por diseño —cuentan lo de todo Membego— y **no se reutilizan en el
portal del proveedor**. En RLS Capa 2, las cuatro tablas del Slice 9
(`external_events`, `outbox_events`, `payment_reconciliations`,
`operational_switches`, `operational_alerts`) quedan **solo omniscientes**.

---

## 14. Permisos

**Dos, no cinco**: `SUPPLY_V2_OPERATIONS_VIEW` y
`SUPPLY_V2_OPERATIONS_MANAGE`. Tocar un interruptor, lanzar una conciliación y
reconocer una alerta son la misma responsabilidad —operar—, y crear cinco
permisos que va a tener siempre la misma persona es burocracia, no segregación.
Resolver un incidente sigue pidiendo su propio permiso del bloque 3
(`SUPPLY_V2_PAYMENT_INCIDENT_RESOLVE`), que **no se diluyó**.

**Se comprueba en el backend, no en el botón**: cada server action empieza por
`exigirPermisoSupplyV2`, y los servicios que mueven dinero vuelven a comprobar
por su cuenta. Una server action se despacha por su identificador desde
cualquier sitio: ocultar el botón no protege nada.

**Auditoría** (§24): tres acciones nuevas —interruptor cambiado, conciliación
lanzada, alerta reconocida—. Reintentar un difunto de la cola ya tenía
`COLA_REENCOLADA` y un efecto del outbox ya tenía `SUPPLY_V2_OUTBOX_RETRIED`:
**se reutilizan**. **No se audita la lectura**: un panel que registra cada mirada
llena la bitácora de ruido y esconde las decisiones, que es lo que alguien va a
buscar dentro de tres semanas.

---

## 15. Migraciones

Dos, **aditivas**, sin editar ninguna anterior:

* `20261029_..._bloque4` — las dos tablas, con sus `CHECK` de forma:
  apagar exige motivo de ≥3 caracteres; los estados y severidades de una alerta
  son los que el dominio sabe dar; una resuelta tiene fecha; y «visto» sin
  nombre ni nota no es un reconocimiento.
* `20261029_..._bloque4_enums` — las tres acciones de bitácora, aparte porque
  PostgreSQL no permite usar un valor de enum nuevo en la transacción que lo
  crea.

---

## 16. Pruebas

### Dominio — 28 pruebas (`tests/supply-v2-slice9-bloque4.test.ts`)

Los veinte puntos pedidos: los cuatro estados de componente y de dónde sale cada
uno · la deriva de esquema degrada y no tumba · la bandera por defecto y qué la
apaga · el interruptor gana sobre la bandera · lo que cada apagado conserva ·
readiness en los tres casos (encendido+configurado, encendido+sin configurar,
apagado) · umbrales configurables · un valor absurdo no ciega · el crítico no
baja del aviso · agregación de alertas con la cuenta dentro · orden por
severidad · crítico solo pasado el umbral crítico · una capacidad apagada no
alerta de su atraso · reconocer no reabre · se cierra porque la condición se fue
· el intérprete de búsqueda y lo que **no** busca · orden de severidad ·
enmascarado (ni los últimos caracteres) · la forma de un secreto · los permisos
y sus etiquetas · el 503 del apagado · el resumen completo · que si la base no
responde **no se dice «todo en cero»**.

### PostgreSQL — 16 pruebas nuevas, en el archivo del Slice 9

| Caso | Prueba | Resultado |
|---|---|---|
| **A** | `B4·A` | Un incidente HIGH aparece en el resumen y degrada la conciliación, sin tumbar el sistema |
| **B** | `B4·B` | Un efecto sin salida pone el outbox en DEGRADADO |
| **C** | `B4·C` | Un efecto esperando 2 h dispara `OUTBOX_BACKLOG` **CRITICAL**, con los minutos dentro |
| **D** | `B4·D` ×2 | Tres evaluaciones → **una** alerta (y el `INSERT` duplicado lo rechaza la base); reconocer la deja reconocida y el cron no la vuelve a gritar |
| **E** | `B4·E` | La condición desaparece → **RESOLVED** sola; una resuelta no se puede reconocer |
| **F** | `B4·F` | El kill switch: 503, **0 filas** en el inbox, compra intacta, y **el panel sigue funcionando**; apagar exige motivo; reactivar y el evento entra |
| **G** | `B4·G` | La conciliación manual queda auditada y exige criterio |
| **H** | `B4·H` | Sin permiso no se resuelve; sin actor no se toca un interruptor |
| **I** | `B4·I` ×2 | Buscar por hilo devuelve **solo** lo de esa operación; la línea de tiempo está ordenada, con fuentes, y **dice lo que no está persistido** |
| **J** | `B4·J` | Dos pasadas del cron: ni un derecho, efecto, incidente, comprobación ni aviso de más |
| Extra | readiness · liveness · paginación en servidor · configuración sin valores | |

### E2E — 6 recorridos (`tests/e2e/supply-v2-slice9.spec.ts`)

**El webhook se llama de verdad**, firmado con HMAC como lo firmaría la
pasarela: es la frontera del bloque 2 y la única forma honesta de provocar una
discrepancia desde fuera.

| Recorrido | Qué demuestra |
|---|---|
| **A** · sano | El panel dice el estado, los seis componentes, la configuración, y **el secreto no aparece en el HTML** |
| **B** · discrepancia | Webhook con importe equivocado → incidente HIGH → se encuentra por el hilo → la ficha trae compra, transacción e hilo → **la compra sigue PENDING** |
| **C** · resolver | OPEN → INVESTIGATING → `ACCEPT_EXTERNAL` → en PostgreSQL: **PAID, 1 derecho, 1 efecto**, resolución y actor guardados |
| **D** · sin salida | El efecto muerto se ve, se reintenta, y en base vuelve con **la escalera devuelta** |
| **E** · interruptor | Apagar desde el panel → webhook **503**, **0 filas**, compra intacta → **el panel y los incidentes siguen funcionando** → reactivar y el evento entra |
| **F** · móvil | Cinco páginas a 390 px **sin desbordamiento lateral**, con el estado, las cifras y el buscador visibles |

### Lo que el E2E encontró, y que ninguna prueba de servicio podía encontrar

Correr los seis recorridos en un navegador de verdad, contra el servidor de
producción, destapó **dos defectos propios del bloque 4** que las 28 pruebas de
dominio y las 16 de PostgreSQL daban por buenos. Los dos están corregidos y los
dos recorridos que los destaparon son ahora su regresión.

**1 · Un reintento que funcionaba y no avisaba (recorrido D).**
Los avisos de las acciones salían de un `useEffect` sobre el estado de
`useActionState`. Funciona mientras el componente siga montado —y hay acciones
cuyo **propio** `revalidatePath` lo desmonta—: al reintentar un efecto sin
salida, el efecto deja de ser difunto, desaparece de la tabla, y con él el
formulario que tenía que avisar. En base el reintento se hacía entero
(`PENDING`, intentos 0, `retriedById` puesto) y el operador no veía **nada**.
Pulsar un botón, ver desaparecer la fila y no recibir confirmación es, de
madrugada, indistinguible de un fallo silencioso: se vuelve a pulsar. Ahora la
acción se espera en el manejador y el aviso sale **desde el cierre**, que
sobrevive al desmontaje.

**2 · Un kill switch que no se podía volver a encender (recorrido E).**
`capacidadActiva` guardaba los interruptores en una caché de proceso de cinco
segundos, y quien cambiaba el interruptor la olvidaba «para que surtiera efecto
en la siguiente petición». No surtía: se apagaba, el webhook respondía 503
—correcto—, se volvía a encender, **el panel ya decía que estaba encendido** y el
webhook seguía respondiendo 503. Una caché de proceso no se puede invalidar
desde otro proceso: en Next el manejador de ruta del webhook y la server action
del panel no comparten necesariamente la misma instancia del módulo, y en
producción, con varias instancias, no se puede invalidar en absoluto. Un
interruptor de emergencia que puede quedarse atrás —en cualquiera de las dos
direcciones— no es un interruptor de emergencia. Ahora se lee de la base en cada
comprobación: un `SELECT` de una fila por clave primaria, dentro de una petición
que ya verifica un HMAC, abre una transacción y escribe en el inbox.

Las dos correcciones son del bloque 4; no tocan la semántica económica ni los
servicios de los bloques 1–3.

### La regresión de los Slices 1–8: 9 de 18 en rojo, y por qué no es de este bloque

Esto NO se presenta como verde. La suite E2E completa de los Slices 1–8 termina
**9 pasadas / 9 fallidas** en este entorno, y hace falta decir exactamente qué
se midió para saber de quién es.

**El control.** Se montó un *worktree* en el SHA base `2c0ce6aa` —sin una línea
del bloque 4—, se compiló aparte, se sirvió en el puerto 3211 y se corrieron
contra él los mismos archivos, con la máquina para él solo. Resultado: **7
fallidas**, y son **las mismas 7**:

| Prueba | Base limpia `2c0ce6aa` | Esta rama |
|---|---|---|
| slice4 · móvil · perfil financiero del proveedor | ROJO | ROJO |
| slice4 · escritorio · PREPAID + vencimiento | ROJO | ROJO |
| slice4 · escritorio · DEPÓSITO | ROJO | ROJO |
| slice5 · escritorio · COMISIÓN | ROJO | ROJO |
| slice7 · escritorio · CAMPAÑA | ROJO | ROJO |
| slice8 · escritorio · FIDELIZACIÓN | ROJO | ROJO |
| slice8 · móvil · plan gratuito y fidelización | ROJO | ROJO |
| slice5 · móvil · Ventas Membego en un teléfono | verde | ROJO en una corrida, **verde en la otra** |
| slice6 · escritorio · BENEFICIOS | verde | ROJO en la suite, **verde al correrla sola** (1,8 min) |
| slice3 · móvil · QR y escáner | — | ROJO en una corrida, **verde en la otra** |

Las dos que no coinciden se comprobaron una por una: `slice5 · móvil` cambia de
color entre dos corridas del MISMO código, y `slice6 · escritorio` pasa sola en
las dos ramas (1,8 min en esta, 2,4 min en la base) y solo cae cuando le toca
correr en el puesto 30 de una suite de 34 minutos.

**La causa es el entorno, no el código.** Siete de las nueve fallan por
agotar su tiempo —420 s, 480 s, 180 s— y el resto por «mi fila no está en la
primera página» o «la misma tarjeta sale dos veces» en pantallas que este bloque
no toca. La base de datos de desarrollo lleva acumulada la basura de toda la
historia del proyecto:

| Tabla | Filas |
|---|---|
| Ofertas ACTIVAS | 2 665 |
| Campañas | 1 303 |
| Redenciones | 920 |
| Compras de cliente | 6 365 |
| Beneficios | 3 251 |
| Bitácora | 367 885 |

Esas pruebas buscan SU fila en tablas que hoy tienen cientos, y renderizan
pantallas con 900 redenciones: fallan por volumen, en los dos lados. No es un
descubrimiento de este bloque —estaba así antes de empezar— pero sí es una
deuda real, y queda escrita aquí en vez de maquillada: **la suite E2E de los
Slices 1–8 necesita una base sembrada y limpia por corrida, o filtros propios en
las consultas que las pantallas usan**. Es trabajo aparte del bloque 4 y no se
mete aquí.

Lo que sí está verde y es de este bloque: **los 6 recorridos del bloque 4, en
escritorio y en móvil**, y **las 291 pruebas de PostgreSQL** del repositorio
completo, tres veces.

Una cosa que esta suite ya no deja atrás: las ofertas de sus compras se cierran
en el `afterAll` (no se borran —hay líneas de compra apuntando a ellas— se pasan
a `ENDED`). Dejar 15 ofertas ACTIVAS de un restaurante inventado por corrida es
sumar a ese mismo problema.

---

## 17. Controles ejecutados

| Control | Resultado |
|---|---|
| `npx tsc --noEmit` | **0 errores** |
| ESLint sobre lo nuevo y lo tocado | **0 avisos** |
| `npm test` | **3 543 pruebas · 3 537 pasadas · 0 fallos · 6 omitidas** (las 6 son anteriores y declaradas: 5 piden un servidor en `:3000` y 1 espera llaves de QA reales de CardNET) |
| `npm run build` | **Compiled successfully**, con las 8 rutas del centro y `/api/health/live` y `/ready` |
| `npm run test:db` ×3 | **291 / 291 · 0 fallos** las tres veces |
| E2E bloque 4 · escritorio | **6 / 6** |
| E2E bloque 4 · móvil | **6 / 6** |
| E2E Slices 1–8 | **9 / 18**, con control sobre la base limpia: ver el apartado anterior. No se presenta como verde |
| Base de datos nueva + `migrate deploy` ×2 | 1.ª: *All migrations have been successfully applied*; 2.ª: *No pending migrations to apply* |
| Deriva de esquema (base nueva y base de desarrollo) | **No difference detected** |
| Sello de migraciones | 184 selladas |
| Preflight de RLS Capa 2 | pasa, con las cinco tablas del Slice 9 decididas |
| Guardias de diseño (`deuda-diseno`, `superadmin-coherencia`, accesibilidad) | pasan, con la deuda **a cero** |
| Permisos | dos nuevos, con etiqueta, comprobados en backend |
| Transacciones anidadas (`scripts/transacciones-anidadas.mjs`) | ninguna |
| Núcleo sin verticales (`scripts/nucleo-sin-verticales.mjs`) | pasa |
| Acoplamiento vertical (`scripts/acoplamiento-vertical.mjs`) | pasa |
| Supply V1 | intacto (`git diff` sobre `src/modules/supply/**` y sus rutas: vacío) |

**`npm run lint` sigue roto en este entorno** por el plugin `react-hooks`, igual
que en los bloques 1–3 y **también sobre la base limpia** (el error es
«specifies rule "react-hooks/exhaustive-deps", but could not find plugin
"react-hooks"», antes de analizar un solo archivo). No se presenta como éxito:
el lint se ejecutó pasando las rutas, y así salió limpio.

---

## 18. Riesgos y limitaciones

1. **El historial de jobs no existe** (§20). `trabajos_muertos` guarda los
   difuntos, no cada ejecución: el panel no puede decir «falló tres veces y la
   cuarta funcionó». No se creó otra tabla para eso.
2. **La conciliación sigue siendo contra lo que la pasarela NOS DIJO**, no contra
   lo que cobró (limitación del bloque 3, sin cambios). Un cobro del que nunca
   nos avisaron no se detecta.
3. **El cron es diario** en el plan actual. Los cuatro pasos toleran retraso y se
   pueden lanzar a mano, pero una alerta puede tardar hasta un día en aparecer
   si nadie abre el panel ni pulsa «reevaluar».
4. **El interruptor se lee de la base en cada comprobación.** Estuvo con una
   caché de proceso de 5 segundos y el recorrido E del E2E la tumbó: el panel ya
   decía «encendido» y el webhook seguía respondiendo 503, porque una caché de
   proceso no se puede invalidar desde otro proceso —y en producción, con varias
   instancias, no se puede invalidar en absoluto—. Ahora es un `SELECT` de una
   fila por clave primaria por comprobación, y el apagado y el encendido surten
   efecto en la siguiente petición de verdad.
5. **Las alertas no notifican a nadie.** Están en la base y en el panel, pero no
   hay correo, WhatsApp ni push: eso es el bloque 5 explícitamente.
6. **No hay histórico de alertas resueltas más allá de la última.** La fila se
   reutiliza por condición (es lo que evita el ruido); si hace falta la serie
   temporal, habrá que escribirla.
7. **Sin rate limit propio en el panel.** Es solo-superadmin y detrás de sesión;
   el endpoint público (el webhook) sigue protegido por su firma.
8. **Readiness no comprueba QStash contra su API**, solo que esté configurado:
   llamar al proveedor en cada sonda es justo lo que §7 prohíbe.

---

## 19. CardNET, aparte otra vez

Sin cambios: **Supply 2.0 no cobra con CardNET.** El registro de proveedores no
lo conoce, el webhook le contesta 404, la integración de V1 no se tocó, no se
ejecutó ninguna prueba QA contra CardNET y **ninguna prueba suya se marca como
aprobada**. El proveedor de las pruebas es `TEST_GATEWAY`.

---

## 20. Criterio de cierre

> Un operador autorizado puede saber si Supply 2.0 está sano, encontrar una
> operación por compra, transacción o correlationId, ver incidentes,
> conciliaciones, outbox y dead letters, ejecutar las acciones operativas
> permitidas, y desactivar una integración crítica mediante kill switch sin
> abrir PostgreSQL ni exponer secretos.

Demostrado: E2E **A** (sano, y el secreto no está en el HTML) · **B**
(discrepancia encontrada por hilo, con su ficha) · **C** (resuelta por el
servicio oficial, comprobado en SQL) · **D** (difunto reintentado) · **E**
(interruptor: 503 sin procesar, panel en pie, reactivación) · **F** (móvil sin
desbordes). Más las 16 pruebas de PostgreSQL y las 28 de dominio.

**No se avanzó al bloque 5**: notificaciones externas, correo, WhatsApp,
automatizaciones, métricas, runbooks, smoke tests y el cierre del Slice 9.
