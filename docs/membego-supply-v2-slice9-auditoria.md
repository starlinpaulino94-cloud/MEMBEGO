# Membego Supply 2.0 · Slice 9 · auditoría de cierre

**Integraciones externas de pago, operación y notificaciones: qué quedó hecho, qué quedó dicho y qué no está.**

| | |
|---|---|
| Base del Slice | `4283786a` (fusión del PR #544, Slice 8 completo) |
| Rama | `claude/jolly-brahmagupta-dmhml9` |
| Bloques | 1 (`929ec900`) · 2 (`9fef954f`) · 3 (`bddbfb86`) · 4 (`3989cef0`) · 5 (este informe) |
| Fusionados | PR #545, #547, #548, #549, #553, #556 |
| Fecha | 2026-10-05 |
| Estado | Slice 9 terminado. **Bloque 5 no fusionado, no desplegado.** |

> **Este informe NO reemplaza los de los bloques.** Cada bloque tiene el suyo
> —[bloque 1](membego-supply-v2-slice9-bloque1.md),
> [2](membego-supply-v2-slice9-bloque2.md),
> [3](membego-supply-v2-slice9-bloque3.md),
> [4](membego-supply-v2-slice9-bloque4.md)— con el detalle de diseño, el
> razonamiento y las pruebas de su parte. Esto es la vista del Slice entero:
> qué promete, qué lo sostiene, y qué sigue sin estar.

---

## 1. Qué pedía el Slice 9 y qué es ahora

Supply 2.0 cobraba por transferencia, depósito, efectivo o confirmación manual
de finanzas. Lo que faltaba no era «meter CardNET»: era poder **recibir un
aviso de pago de cualquier pasarela** sin que el dominio supiera de cuál, sin
cobrar dos veces cuando el aviso llega cinco veces, y sin que un proveedor de
correo caído deshaga un pago hecho.

Lo que hay hoy:

```
POST /api/webhooks/supply-v2/<PASARELA>
  │  firma HMAC · ventana anti-replay · kill switch
  ├─ inbox      supply_v2_external_events   identidad (provider, id, tipo) ÚNICA
  ├─ dinero     confirmarPagoEnTx + derechos + economía   UNA transacción
  ├─ outbox     supply_v2_outbox_events     apuntado DENTRO, entregado FUERA
  └─ respuesta  un código, nunca un detalle interno
       ↓
  cola de trabajos (la de siempre) → worker → aviso in-app / correo
       ↓
  conciliación → incidente financiero → resolución humana auditada
       ↓
  Centro de Operaciones: salud, interruptores, alertas, búsqueda por hilo
```

## 2. Lo que NO se construyó, y por qué cuenta

Esta sección va antes que el inventario a propósito: en un Slice de
integraciones, la mayor parte del trabajo es decidir qué no escribir.

| No se hizo | Porque ya existía | Dónde |
|---|---|---|
| Una cola de trabajos | La de Membego, con QStash y degradación en línea | `modules/jobs/cola.ts` |
| Un `EmailGateway` | `lib/email.ts`, con guarda de empresa demo y `replyTo` firmado | `lib/email.ts` |
| Una escalera de reintentos | La compartida de integraciones: 8 intentos, 30 s → 24 h | `modules/integraciones/reintentos.ts` |
| Una tabla de entregas | Los estados viven en la fila del outbox | — |
| Una tabla de reglas | Cuatro disparadores en código y un interruptor en el panel | `notifications/automatizaciones.ts` |
| Un Prometheus propio | `registrarEvento` y `/api/metricas`, que ya existían | `observabilidad/` |
| Un formato de runbook | El de la casa, nueve runbooks antes de este Slice | `docs/runbooks/` |
| Un motor tipo Zapier | **Explícitamente descartado**: cuatro acciones, ninguna mueve dinero | § 12 |

A `lib/email.ts` se le añadió **una** cosa: devolver el código HTTP del
proveedor, porque un efecto necesita distinguir un fallo que vale reintentar de
uno que no.

## 3. Idempotencia: dónde vive de verdad

Tres mecanismos, y ninguno es una comprobación en código de aplicación:

1. **Entrada.** `@@unique([provider, externalEventId, eventType])`. Cinco
   entregas del mismo evento son UNA fila. Lo impone la base.
2. **Salida.** `dedupeKey String @unique` en el outbox. Dos intentos de apuntar
   el mismo efecto apuntan uno.
3. **Aviso in-app.** `@@unique([userId, dedupeKey])` en `notificaciones`. Una
   segunda entrega choca con `P2002`, y eso se lee como «ya estaba hecho».

El `idempotencyKey` que recibe el ejecutor de un efecto es **estable entre
intentos** a propósito: si cambiara por intento, un reintento tras un corte
sería un efecto nuevo para el destino y la deduplicación no serviría.

Esto se demuestra con cinco entregas **simultáneas** contra PostgreSQL de
verdad, no con mocks: con SQLite la carrera no existe.

## 4. Orden de candados

```
1. INBOX   advisory lock sobre `provider:idExterno:tipo`
2. INBOX   FOR UPDATE sobre la fila del evento
3. ORDEN   lo toma confirmarPagoEnTx (ordenBloqueada)
4. oferta / lote / beneficio — lo que ya hacía el checkout
5. OUTBOX  solo INSERT, nunca se bloquea
```

El candado del inbox es el más externo y **solo lo pide este camino**. Ningún
checkout lo toma, así que no puede haber abrazo mortal con una compra en curso.

## 5. El proveedor externo no es la fuente de la verdad

Dice que cobró 1 000. Lo que decide si eso corresponde a esta compra es el total
de la compra, que es nuestro. Si no cuadran —otro monto, otra moneda, una orden
que no existe, un estado imposible— **no se toca el dinero**: el evento queda
rechazado con su código, y queda un incidente financiero abierto para que una
persona lo mire.

Detectar no es corregir. Esa es la frase que separa el bloque 3 del bloque 1.

## 6. Resolución humana, con cuatro ojos donde los hay

Un incidente se resuelve `ACCEPT_INTERNAL`, `ACCEPT_EXTERNAL`,
`REFUND_PENDING` o `NO_ACTION`, siempre con nota obligatoria y nombre. Aceptar
la evidencia externa **confirma el pago por el servicio oficial** —no escribe
un estado a mano—, así que emite derechos, reconoce la economía y apunta el
aviso al cliente por el mismo camino que un pago normal.

La cuenta que procesa los avisos de la pasarela
(`SUPPLY_V2_WEBHOOK_ACTOR_ID`) es distinta de la persona que resuelve, y es una
decisión de diseño del bloque 3, no una casualidad del arnés de pruebas.

## 7. Outbox transaccional

El efecto se **apunta** dentro de la transacción que mueve el dinero y se
**entrega** después, fuera de ella.

```
PENDING → PROCESSING (arrendado 5 min) → DELIVERED
                   ↘ FAILED (8 intentos) → DEAD_LETTER
```

- El arriendo caduca a los 5 minutos: lo que un worker muerto dejó reclamado
  vuelve solo.
- El rescate trata la fila como un **fallo**, no como un reclamo nuevo:
  devolverla «limpia» a PENDING sería un bucle infinito perfecto.
- `DELIVERED` significa «se lo dimos al destino». Para un correo, que el
  proveedor lo **aceptó**. No se usa `DELIVERED` para decir que la persona lo
  recibió, porque eso no lo sabemos.

Y desde el bloque 5 hay un tercer resultado: **cerrado sin salir**. Un correo
que el proveedor rechazó con un 4xx termina —reintentarlo ocho veces no lo
arregla— pero no salió, y el motivo se **guarda en la fila**. Antes quedaba
`DELIVERED` con el error a null, idéntico a un envío que sí salió: en el panel
no había forma de distinguirlos.

## 8. El barrido del inbox (bloque 5)

`anotarFalloDeProceso` reprogramaba con la escalera, el índice
`(status, nextAttemptAt)` existía y el comentario del esquema decía «NULL = ya
vencido, lo barre el cron». **Nadie barría.** El inbox solo se procesaba dentro
de la petición del webhook, así que un evento que fallaba por algo transitorio
—la base saturada tres minutos, la cuenta de integración sin configurar— se
quedaba esperando para siempre, con el pago cobrado en la pasarela y los
derechos sin emitir.

Ahora es el **paso 0** del cron, antes del outbox, para que lo que entre apunte
su efecto y ese efecto salga en la misma pasada. No resucita `DEAD_LETTER` a
propósito: agotar ocho intentos tiene que seguir significando algo.

## 9. Notificaciones: el camino, nunca el atajo

```
evento interno → outbox → cola → worker → gateway
```

Nunca `transacción financiera → enviar correo directamente`. Es la regla que
hace que Resend caído no deshaga un pago.

Tres clases, y no se tratan igual:

| Clase | Respeta preferencias | Ejemplo |
|---|---|---|
| `TRANSACTIONAL` | Sí, las de su canal | «Tu compra está confirmada» |
| `OPERATIONAL` | **No**: va a quien opera, por su permiso | «Hay efectos sin salida» |
| `MARKETING` | Sí, y **apagado por defecto** | — |

El consentimiento de marketing **no** es permiso para todo: las preferencias
son cinco columnas separadas (`emailTransactional`, `emailMarketing`,
`whatsappTransactional`, `whatsappMarketing`, `inApp`) y no una casilla única.

La preferencia se mira **dos veces**: al apuntar, para no crear filas que solo
existen para ser descartadas; y al entregar, que es la que manda —entre una
cosa y otra pueden pasar horas, y lo que vale es lo último que dijo la persona—.

**Dónde los ve la persona:** en `/cliente/novedades`, arriba, antes del muro de
las empresas que sigue, con la cuenta de no leídos en la campana de la
cabecera. Hasta el bloque 5 no se veían en ninguna parte (§ 21.5).

## 10. WhatsApp: no está

`estadoDeWhatsapp()` devuelve `NOT_CONFIGURED`, siempre. No hay credenciales,
no hay plantillas aprobadas y no hay proveedor contratado. La pasarela queda
**preparada** —el canal existe en el dominio, las preferencias lo contemplan—
y `servicio.ts` **no apunta** sus efectos: apuntarlos para que mueran ocho
veces llenaría la cola de difuntos de algo que no puede funcionar y escondería
las averías de verdad.

No se mockeó para presentarlo como terminado. Cuando se configure, hay que
volver a mirar la tabla de privacidad del § 23.

## 11. El correo

Adaptador sobre `lib/email.ts`, no un gateway nuevo. Lo que decide si un fallo
se reintenta:

| Respuesta | Qué se hace |
|---|---|
| 5xx, 408, 429, sin respuesta | **Reintentar**: es del proveedor y se arregla solo |
| 4xx | **Cerrar con su razón**: es nuestro y ocho reintentos lo tapan una semana |
| Sin `RESEND_API_KEY` | No se intenta. Que falta ya lo dice la configuración crítica |
| Empresa de demostración | No se manda. Lo decide `lib/email.ts`, que ya lo sabía |

**Lo que no se puede prometer:** Resend no acepta clave de idempotencia. Si el
proceso muere después de que Resend aceptara y antes de marcar entregado, el
reintento manda un segundo correo. La ventana es de milisegundos, lo duplicado
es un correo —no un cobro— y la alternativa (marcar entregado antes de mandar)
cambiaría un correo repetido por un correo perdido, que es peor. Se dice en el
código, en este informe y en una prueba, en vez de afirmar una garantía que no
existe.

## 12. Automatizaciones: cuatro disparadores, ni uno más

| Disparador | Condición | Acción |
|---|---|---|
| `MEMBERSHIP_EXPIRING` | ACTIVE y vence dentro de N días (7) | avisar al cliente |
| `BENEFIT_EXPIRING` | AVAILABLE y vence dentro de N días (3) | avisar al cliente |
| `FINANCE_INCIDENT_HIGH` | incidentes HIGH sin resolver | avisar a operaciones, **agregado** |
| `OUTBOX_DEAD` | efectos sin salida | avisar a operaciones, **agregado** |

**Ninguna mueve dinero.** Las acciones posibles son avisar dentro de Membego,
por correo, por WhatsApp (no configurado) o abrir una alerta operativa. No hay
«cobrar», no hay «reembolsar», no hay «cancelar».

Los dos de operaciones van **agregados**: veinte incidentes son un aviso con
«incidentes: 20», no veinte correos iguales de madrugada. Y la deduplicación es
`regla + sujeto + periodo` con el día dentro de la clave, sostenida por una
columna única: correr el cron dos veces el mismo día deja **un** aviso porque lo
impide la base, no porque el código se acuerde.

A quién se avisa se decide **por permiso**, consultando la base, no por una
lista de correos en una variable de entorno. Una lista en el entorno envejece
sola y nadie se acuerda de actualizarla cuando alguien entra o sale.

No hay tabla de reglas. Es una capacidad del Centro de Operaciones
(`SUPPLY_V2_AUTOMATIONS`), apagable desde el panel con motivo y auditoría,
porque lo que hay que poder decidir es «avisa o no avisa».

## 13. Observabilidad

Se reutiliza `registrarEvento({dominio, accion, ok, ms, companyId, motivo,
extra})`. El `extra` **solo acepta números, booleanos y etiquetas cortas**: el
validador rechaza lo que parezca un identificador, un correo o un teléfono.
Eso no es cosmético — un id de orden como etiqueta de métrica es cardinalidad
infinita, y una métrica con cardinalidad infinita tumba al recolector.

Diez contadores operativos salen en cada pasada del cron. **No se guardan en la
base**: son eventos estructurados que cuenta el recolector.

El `correlationId` es el hilo: se propaga del evento externo al outbox, a la
bitácora, al aviso y a los logs, y la búsqueda del Centro de Operaciones
reconstruye la historia completa a partir de él.

## 14. Centro de Operaciones

`/superadmin/supply-v2/operaciones`, solo `SUPERADMIN`:

- **Salud** por componente: base, pagos, outbox, conciliación, trabajos,
  configuración. Con la diferencia explícita entre `APAGADO` (una decisión) y
  `DEGRADADO`/`NO DISPONIBLE` (una avería), que es la pregunta que más tiempo
  hace perder de madrugada.
- **Interruptores** de las cinco capacidades. Apagar exige motivo; encender, no.
- **Alertas** una por CONDICIÓN, no una por fila: `OUTBOX_BACKLOG count=23
  oldest=17m`, no veintitrés avisos. Se apagan porque la condición desapareció,
  no porque alguien las cerrara.
- **Búsqueda** por número de compra, transacción externa, id de evento o hilo,
  con línea de tiempo.
- **Inbox, outbox, difuntos, incidentes y conciliaciones** paginados en
  servidor, con reintento donde el dominio sabe reintentar.
- Lo que un operador NO ve: el cuerpo crudo de un webhook, una firma, un token,
  el correo o el teléfono de un cliente. La búsqueda devuelve `clienteId`.

Lo que el bloque 5 le añadió: el **reintento de un evento externo**. La alerta
`INBOX_DEAD` existía desde el bloque 4 y `reintentarEvento` desde el bloque 1,
y solo lo llamaban las pruebas: el panel sabía decir que había eventos sin
salida y no ofrecía nada que hacer con ellos, lo que obliga a abrir una consola
contra producción —justo lo que este panel existe para evitar—.

## 15. Health y readiness, separados

| Ruta | Pregunta | Público |
|---|---|---|
| `/api/health/live` | ¿el proceso está vivo? | Sí, y no toca nada externo |
| `/api/health/ready` | ¿puede OPERAR? | Sí, agregado; el detalle por componente |
| `/api/metricas` | ¿está BIEN? | **No**: fail-closed sin `METRICAS_SECRET` |

`live` no consulta la base a propósito: un liveness que depende de la base hace
que el orquestador reinicie la aplicación cuando lo que está caído es Postgres.

## 16. Cron: el orden importa

```
0. barrer el inbox       ← bloque 5: lo que entre apunta efecto para el paso 2
1. rescatar arriendos    ← lo abandonado vuelve a estar disponible
2. despachar el outbox   ← se lleva lo rescatado en la misma pasada
3. conciliar lo reciente
4. evaluar alertas       ← AL FINAL: las cifras ya reflejan esta pasada
5. evaluar automatizaciones
6. despachar otra vez    ← los avisos recién apuntados salen HOY, no mañana
```

Los siete pasos son idempotentes y toleran retraso: el plan puede ejecutar el
cron una vez al día, así que cada uno procesa el acumulado. Cada uno respeta su
interruptor.

Evaluar las alertas primero avisaría de un atraso que esa misma pasada estaba a
punto de resolver. Sin el segundo despacho, un aviso de vencimiento que avisa
con tres días tardaría un día en salir.

## 17. Seguridad

- **Firma HMAC-SHA256** sobre `${ts}.${rawBody}`, cabecera
  `x-sv2-signature: v1=<hex>`, comparación en tiempo constante. Varios secretos
  separados por coma para poder **rotar** sin ventana ciega.
- **Ventana anti-replay**: una firma vieja se rechaza con `REPLAY_REJECTED`.
- **Fail-closed**: sin secreto configurado, 401 a todo. Sin cuenta de
  integración, el evento se guarda y no se procesa. Una variable que falta no
  puede abrir una puerta.
- **El cuerpo crudo no se guarda.** Se guarda lo necesario, ya saneado. Un
  volcado del inbox no puede contener una firma ni datos de tarjeta.
- **La respuesta nunca lleva un detalle interno**: un código y el hilo.
- Ningún secreto en `NEXT_PUBLIC_*`, en la base, en un log o en un error de
  pantalla.

## 18. Permisos

Cada server action empieza por `exigirPermisoSupplyV2`, y lo que mueve dinero lo
vuelve a comprobar en el servicio de dominio: una server action se despacha por
su identificador desde cualquier sitio, así que **el botón oculto no protege
nada**. El gate `permisos:catalogo` comprueba que el catálogo y las guardias
coinciden en las dos direcciones (93 funciones).

## 19. Migraciones

Siete, todas aditivas, ninguna editada después de aplicarse:

```
20261025_supply_v2_slice9                        inbox + outbox
20261026_supply_v2_slice9_bloque2                frontera HTTP
20261027_supply_v2_slice9_bloque3_enums          conciliación e incidentes
20261028_supply_v2_slice9_bloque3
20261029_supply_v2_slice9_bloque4_enums          salud, banderas, alertas
20261029_supply_v2_slice9_bloque4
20261030_supply_v2_slice9_bloque5_preferencias   PreferenciasDeAviso
```

No se cambió la semántica económica de nada histórico. No se refactorizaron los
Slices 1–8 salvo los dos defectos demostrados del § 21.

## 20. Retención y privacidad

Tiene su documento: [`supply-v2-retencion-y-privacidad.md`](supply-v2-retencion-y-privacidad.md).
El resumen:

- Un registro financiero o de auditoría **no se borra nunca**. Se anula, se
  corrige con un asiento nuevo, se marca resuelto.
- Lo garantiza el **esquema**, no la política: 39 `Restrict`, 30 `SetNull` y un
  solo `Cascade` (un código de referido). Borrar un usuario con una compra de
  Supply 2.0 **falla en la base**.
- **No hay ninguna purga implementada**, y es deliberado. Tres candidatas
  quedan documentadas y apagadas.
- El payload del outbox lleva `userId`, **no la dirección**: se resuelve al
  entregar.
- `tests/supply-v2-retencion.test.ts` convierte esas afirmaciones en una
  puerta: si alguien añade un `Cascade` sobre una tabla financiera, falla y
  nombra el modelo.

## 21. Los defectos que este Slice encontró en código ajeno

Tres, y los tres con prueba antes del arreglo:

1. **`rls:cobertura` estaba rojo en `main` y el gate no lo veía.** Trabaja por
   ARCHIVO: un archivo con un solo `sinEmpresa` pasa aunque tenga otras
   consultas sueltas. `entrada.ts`, `busqueda.ts` y cuatro consultas de
   `worker.ts` estaban sin envolver. Con RLS encendida, una consulta sin
   contexto **no falla**: devuelve cero filas, y aquí cero filas se habría
   leído como «ese efecto no existe».
2. **Un barrido global con el reloj adelantado rompía otro archivo de pruebas.**
   `supply-v2-slice6.db.test.ts` corría `barridoSupplyV2(ahora + 1 día)`, que
   expiraba TODA orden PENDING de la base mientras otros archivos corrían en
   paralelo, con una aserción vacuamente cierta (`>= 0`). Era la causa de un
   fallo intermitente del Slice 2 que llevaba semanas atribuido al entorno.
3. **Un aviso que no llegaba al operador.** `useActionState` más un `useEffect`
   que avisaba al cambiar el estado: funciona mientras el componente siga
   montado, y hay acciones cuyo propio `revalidatePath` lo desmonta. Al
   reintentar un efecto sin salida, el reintento se hacía de verdad y el
   operador no veía NADA. Pulsar un botón, ver desaparecer la fila y no recibir
   confirmación es, de madrugada, indistinguible de un fallo silencioso.

4. **Un kill switch que se habría leído al revés.** `capacidadActiva` leía
   `supply_v2_operational_switches` con `prisma` a pelo. Esa tabla tiene
   política de capa 2 **omnisciente** —es un control de plataforma—, y con RLS
   encendida una consulta sin contexto devuelve cero filas. Cero filas allí es
   `undefined`, y `capacidadEfectiva(clave, undefined)` lo interpreta como
   «nadie lo apagó»: **un interruptor de emergencia APAGADO se habría leído
   como ENCENDIDO**, y los pagos externos habrían seguido procesándose después
   de que alguien los cortara. Lo mismo, con otra consecuencia, en `salud.ts`,
   `panel-queries.ts`, `alertas.ts` y `barrido-conciliacion.ts`: el panel
   habría mostrado cero incidentes, cero difuntos y nada atrasado —verde justo
   cuando hace falta que grite—, y el barrido de conciliación habría dicho
   «revisados: 0» sin quejarse.

   Es latente, no activo: RLS de capa 2 todavía no está encendida (su runbook
   la trata como operación planificada). Lo habría destapado el día en que
   alguien la encendiera, que es el peor día para descubrirlo.

   Los dos módulos del Slice 9 ya no importan `prisma`, y
   `tests/supply-v2-retencion.test.ts` lo mantiene así: la regla ahí es más
   estricta que la del gate —ninguna consulta directa, ni una—.

5. **Un aviso que nadie podía ver.** Lo encontró el recorrido G al buscar en
   PANTALLA un aviso que la base decía `DELIVERED`. El Slice 9 existía, entre
   otras cosas, para que confirmar un pago avisara al cliente —antes no avisaba
   a nadie—, y el aviso se escribía en `notificaciones` con su clave de
   deduplicación… pero **el área de cliente no lo mostraba en ninguna parte**:
   el desplegable que lee esa tabla vive en `AppHeader`, la cabecera de admin y
   superadmin, y la campana del cliente llevaba al muro social de las empresas
   que sigue, que es otra cosa.

   Era literalmente «marcar una funcionalidad como completada porque existe el
   código». Ahora los avisos propios salen **arriba** en el destino que la
   campana ya tenía, y la campana lleva la cuenta de los no leídos: sin número,
   un aviso es alcanzable pero no descubrible, y nadie entra a mirar una
   campana que nunca dice nada.

Y uno más en el propio Slice, encontrado al escribir un runbook: el § 8.

**Los cinco los encontró una prueba o un documento, no una revisión de
código.** Los tres primeros, repetir la suite hasta que el fallo intermitente
tuvo causa; el cuarto, leer la política de RLS para escribir el § 20; el
quinto, exigir que una prueba afirmara sobre la pantalla en vez de sobre un
`count()`. Una aserción en base habría pasado desde el primer día sin que
ningún cliente viera nunca nada.

## 22. La estabilización del arnés de pruebas (bloque 5 · §0)

El bloque 4 cerró con **9 de 18** pruebas E2E en verde y la culpa puesta en el
entorno. No era el entorno. Eran tres causas distintas:

1. **Una base de desarrollo compartida y saturada**, donde cada suite veía los
   datos de las demás. Se arregló con una base **desechable por corrida**
   (`npm run e2e:limpio`), que es la opción A del enunciado.
2. **Un servidor zombi** de una corrida anterior ocupando el puerto 3210 con el
   secreto viejo, que producía un 401 imposible de entender. El arnés mataba al
   envoltorio `npx` y dejaba vivo al nieto. Ahora hay guarda de puerto, grupo de
   procesos y verificación de que el puerto quedó libre.
3. **Carreras y aserciones sobre contadores globales** en las propias pruebas:
   `count()` sin filtro por sufijo, dependencias del orden y la aserción vacua
   del § 21.2.

Resultado: **67 pasadas, 0 fallos, 114 omitidas**, dos veces con el mismo
resultado. Y las reglas quedaron escritas en
[`PRUEBAS-E2E.md`](PRUEBAS-E2E.md): datos con sufijo propio, `toHaveCount(1)`
antes de usar un elemento filtrado, y **jamás subir un tiempo de espera para
tapar un problema de volumen**.

Ninguna prueba se maquilló subiendo timeouts, y ninguna lógica de producción se
cambió para que una prueba pasara, salvo los tres defectos demostrados del
§ 21.

## 23. Runbooks

Seis nuevos, en el formato de la casa, extendiendo los nueve que ya existían
(cola atascada y base caída ya tenían el suyo y no se duplican):

| Runbook | Síntoma |
|---|---|
| [`pagos-externos-caidos.md`](runbooks/pagos-externos-caidos.md) | el aviso NO llegó |
| [`webhooks-atrasados.md`](runbooks/webhooks-atrasados.md) | el aviso llegó y no se procesó |
| [`outbox-atrasado.md`](runbooks/outbox-atrasado.md) | el dinero está bien, el aviso no sale |
| [`incidente-financiero.md`](runbooks/incidente-financiero.md) | hay dinero que no cuadra |
| [`conciliacion-discrepante.md`](runbooks/conciliacion-discrepante.md) | la comprobación sale en desacuerdo |
| [`revertir-despliegue.md`](runbooks/revertir-despliegue.md) | se rompió justo después de desplegar |

Cada uno con síntoma, impacto, cómo funciona, cómo confirmar, cómo arreglar,
**qué NO hacer**, criterio de recuperación y escalamiento. Con rutas, estados,
nombres de interruptor y comandos reales, no teoría.

Los dos primeros se separan a propósito: la primera pregunta de madrugada es
«¿hay fila en el inbox?», y la respuesta manda a runbooks distintos.

## 24. Smoke y checklist de producción

`npm run smoke -- https://<dominio>`: doce comprobaciones de solo lectura
—vida, páginas públicas, puertas cerradas, cabeceras— ejecutables contra
producción **sin tocar una fila**. La única petición que no es GET es el POST
del webhook **sin firma**, que es la única forma honesta de verificar que la
puerta está cerrada: preguntarle a la puerta. Y por definición no puede entrar
—si entrara, el smoke habría encontrado exactamente el agujero que busca—.

[`supply-v2-production-checklist.md`](supply-v2-production-checklist.md) es la
lista larga: configuración, base, operación, pagos, despliegue y respaldo. No
repite `DEVOPS.md` ni `RECUPERACION.md`: los referencia. Y la sección de
respaldo dice **lo que no se puede afirmar desde el repositorio** —el plan de
Supabase, si PITR está activo, cuánto se retiene— en vez de marcarlo como
hecho.

## 25. Pruebas

| Suite | Qué demuestra | Resultado |
|---|---|---|
| `npm test` (unitarias) | dominio, firmas, saneado, escalera, etiquetas de métrica | **3592 / 0**, 6 omitidas |
| `npm run test:db` (PostgreSQL) | carreras, candados, idempotencia, barridos, inyección de fallo | **320 / 0** |
| `npm run e2e:limpio` | los recorridos en navegador sobre base desechable | ver § 26 |
| `tests/supply-v2-retencion.test.ts` | que nada financiero se borre, y que nada consulte sin contexto | **7 / 0** |

Lo que solo se puede demostrar contra PostgreSQL de verdad, y por eso está en
la suite de base: el índice único bajo carrera, el advisory lock, el `FOR
UPDATE`, y que una transacción que se va atrás no deja dinero movido.

**La inyección de fallo de correo (§24) no mockea el módulo**: sustituye
`globalThis.fetch`, que es la frontera real por donde `lib/email.ts` habla con
Resend, así que se ejercita el camino entero incluyendo la lectura del código
HTTP. Ninguna petición sale de la máquina y nunca se usa una credencial real.

Las omitidas se nombran y **no se cuentan como aprobadas**: las 6 unitarias y
las de E2E que se saltan por falta de configuración lo dicen en su mensaje de
`skip`, en vez de pasar por casualidad.

## 26. Recorridos de punta a punta

| | Recorrido |
|---|---|
| A | el panel dice si el sistema está sano, y de qué |
| B | un cobro con el importe equivocado abre un incidente de severidad alta |
| C | una persona autorizada investiga y resuelve; el pago pasa por el servicio oficial |
| D | un efecto sin salida se ve en el panel y se puede reintentar |
| E | el interruptor apaga el procesamiento y el panel sigue funcionando |
| F | el panel se lee en un móvil, sin desbordamiento lateral |
| G | de la pasarela al aviso que el cliente VE, y de vuelta por el hilo |
| H | un beneficio por vencer avisa UNA vez, aunque el cron corra dos |

**Medición, `npm run e2e:limpio` completo sobre base desechable, 2026-10-06:**

| Corrida | Pasadas | Omitidas | Fallos | Duración |
|---|---|---|---|---|
| A (máquina sin otra carga) | 69 | 114 | **0** | 13,5 min |
| B (máquina sin otra carga) | 69 | 114 | **0** | 13,9 min |

Mismo resultado dos veces seguidas, con los Slices 1–8 y los recorridos A–H del
Slice 9. Las 114 omitidas **no** son aprobadas: son los recorridos de un proyecto
(`movil` o `escritorio`) que el otro no ejecuta, más los que se saltan diciéndolo
cuando falta configuración del arnés.

**Lo que NO está explicado, y se dice:** en una corrida anterior —hecha mientras
yo ejecutaba `tsc`, `eslint` y compilaciones en la misma máquina— el recorrido de
fidelización del Slice 8 (escritorio) falló una vez con `puntos-disponibles`
= **45** donde esperaba **15**. No se repitió en ninguna de las tres corridas
posteriores. Es exactamente 3 veces lo esperado, lo que no parece un retraso de
pantalla sino un cálculo distinto, y se trata de puntos de fidelización, no de un
texto. No encontré la causa y **no la atribuyo a la carga**: es una hipótesis, no
un hallazgo. Queda como riesgo abierto (§ 28.9). No se "arregló" con un tiempo de
espera, porque el valor recibido no era un valor intermedio sino otro.

G y H son del bloque 5. G recorre la cadena completa en un solo caso —aviso
firmado → pago → efecto → aviso en la campana del cliente → la misma operación
encontrada por su hilo—: las piezas estaban probadas por separado y esto prueba
que están unidas. H lanza el **cron de verdad por su ruta HTTP**, no su
servicio, porque es lo que corre en producción.

## 27. CardNET sigue aparte

**NOT INTEGRATED WITH SUPPLY V2.**

CardNET es el cobro de membresías de Membego, con su propio flujo, su propio
runbook ([`runbooks/pagos-cardnet.md`](runbooks/pagos-cardnet.md)) y su propia
documentación ([`PAGOS-CARDNET.md`](PAGOS-CARDNET.md)). Supply 2.0 no lo usa.

Lo que este Slice construyó es la frontera **genérica**: `provider` es texto y
no un enum para que conectar una pasarela mañana no pida una migración, y el
dominio no importa nada de ningún proveedor. Si algún día CardNET cobra una
compra de Supply 2.0, lo que hará falta es un adaptador —verificar su firma,
traducir su vocabulario al nuestro—, no tocar el dominio. Mezclar los dos
caminos antes de que eso haga falta es el error que esta separación previene.

## 28. Riesgos y limitaciones, sin adornos

1. **No hay pasarela real conectada.** La frontera está probada con
   `TEST_GATEWAY`, que firma igual que firmaría una de verdad. Lo que no está
   probado es el vocabulario de una pasarela concreta, porque no hay ninguna
   contratada.
2. **WhatsApp no existe** (§ 10).
3. **El duplicado de correo es posible** en una ventana de milisegundos
   (§ 11). Se dice, no se finge.
4. **El cron diario del plan Hobby** limita la latencia de todo lo que no sea
   el camino de la petición: el barrido del inbox se lleva 100 eventos por
   pasada, y con un cron diario eso son 100 al día. El camino normal no es el
   barrido —es que el webhook procese su evento en segundos—, así que una cola
   grande en el inbox significa que el camino normal está fallando de forma
   sistemática, y eso es lo que hay que buscar antes de subir la frecuencia.
5. **Sin QStash**, la cola ejecuta en línea: más lento, no se pierde nada. Es
   degradación honesta y el panel la dice.
6. **El RPO real es desconocido** hasta que alguien rellene las cuatro casillas
   de `RECUPERACION.md` § 1 en el panel de Supabase. Desconocido, no 24 horas:
   es peor, porque no se puede planificar.
7. **Un borrado de cliente con compras de Supply 2.0 no se resuelve
   automáticamente** y necesita una decisión documentada (§ 20). Es incómodo a
   propósito: el camino automático tendría que elegir entre borrar dinero o
   incumplir, y eso no lo decide el código.
8. **Nada de esto está desplegado.** El bloque 5 no está fusionado.
9. **Un fallo intermitente sin causa encontrada** (§ 26): puntos de fidelización
   45 en vez de 15 en una corrida del Slice 8, no reproducido en tres corridas
   posteriores. Antes de dar por cerrada la fidelización conviene repetir ese
   recorrido muchas veces y, si vuelve, mirar `membresiasVivasEnTx` y el
   multiplicador en `acumularPorCompraEnTx`, que son lo único que puede dar un
   múltiplo exacto.

## 29. Criterio de cierre

Lo que se consideró cerrado:

- [x] Idempotencia externa sostenida por la base y demostrada bajo carrera
- [x] Frontera HTTP con firma, replay, kill switch y fail-closed
- [x] Outbox transaccional con escalera, rescate, dead letter y tercer estado
- [x] Barrido del inbox: la escalera de entrada la recorre alguien
- [x] Conciliación, incidentes y resolución humana auditada
- [x] Centro de Operaciones con salud, interruptores, alertas y búsqueda
- [x] Notificaciones por el camino largo, con clases separadas
- [x] Automatizaciones: cuatro disparadores, ninguno mueve dinero
- [x] Observabilidad reutilizada, con el hilo de punta a punta
- [x] Seis runbooks, smoke no destructivo y checklist de producción
- [x] Retención y privacidad documentadas **y con puerta ejecutable**
- [x] Arnés E2E estabilizado; Slices 1–8 en verde sobre base desechable
- [x] CardNET separado y dicho

Lo que **no** se hizo y no se va a hacer en este Slice: conectar una pasarela
real, configurar WhatsApp, implementar purgas de retención, y abrir un Slice 10.

**Aquí se detiene.**
