# Canje por API

Fase 3b del *Membego Platform Integration Standard v1*.
Continúa `docs/platform/eventos-v2.md`. Ver `docs/PLATFORM_ARCHITECTURE_REPORT.md` §10, §15.

---

## El flujo completo, por fin cerrado

```
Vertical: identifica al cliente     GET  /customers/resolve
   → ¿qué puede consumir?           POST /benefits/evaluate
   → presta el servicio
   → consume                        POST /redemptions   (Idempotency-Key)
   → registra su venta              POST /transactions  (Idempotency-Key)
```

Hasta ahora los dos últimos pasos ocurrían solo dentro de MembeGo.

---

## Lo primero fue extraer, no escribir

El canje vivía dentro de `confirmarVisita`: un Server Action de 937 líneas que
empezaba con `getUser()` y leía un `FormData`. Funcionaba —lleva meses en
producción— pero ataba la operación a **una** forma de pedirla: una sesión de
navegador con rol de escáner.

Un satélite no tiene sesión: tiene una credencial. Con la lógica dentro del
action, abrirle la puerta obligaba a reimplementar el canje.

> Dos implementaciones de la ruta del dinero divergen **siempre**, en el caso
> raro que nadie probó. Y aquí el caso raro es alguien consumiendo dos veces.

Así que primero salió `modules/visitas/canje.ts`, y después `/redemptions` se
escribió encima. El Server Action pasó de 937 líneas a **autenticar, parsear y
traducir el resultado**; el canje es el mismo código para los dos.

### Lo que la extracción tenía que preservar

Todo esto se conservó línea por línea, y hay pruebas que lo vigilan — son
defensas contra carreras y se rompen reescribiéndolas «más limpias»:

| | Por qué |
|---|---|
| QR de un solo uso con `updateMany where activo:true` | Un `findUnique` + `update` parece igual y deja de ser atómico |
| Estado, vencimiento y saldo **dentro del `where`** del update | Una cancelación entre la lectura y el commit hace `count=0` y aborta |
| Saldo **releído** tras el decremento | El valor leído antes es stale frente a escaneos simultáneos |
| Auditoría **dentro** de la transacción | Una visita no puede quedar registrada sin su rastro |
| Lecturas pesadas **fuera** de la transacción | pgBouncer retiene una conexión real durante todo el callback |
| Los mensajes, palabra por palabra | Quien usa el escáner no nota nada |

Lo único que cambia de forma: cada rechazo lleva ahora también un **código**. El
panel sigue enseñando el mensaje; la API necesita ramificar, y ramificar leyendo
texto se rompe el día que alguien corrige una tilde.

---

## El actor

El servicio no sabe quién lo llama. Recibe lo poco que necesita:

```ts
{ origen: 'PANEL' | 'SISTEMA',
  dbUserId: string | null,   // un satélite no es un usuario de MembeGo
  nombre: string | null,     // quién firma el documento comercial
  companyId: string | null,  // si viene, la membresía TIENE que ser de ella
  sistemaSlug?: string }
```

`dbUserId: null` para un satélite es deliberado: **inventar un usuario para que
el campo no quede vacío sería falsificar quién atendió al cliente**. El rastro
del sistema va en la auditoría (`origen`, `sistema`) y en el ticket.

`companyId: null` solo para el superadmin, que opera sobre cualquier empresa —
es literalmente la condición que había antes dentro del action.

---

## `POST /redemptions`

```jsonc
// scope: benefits:redeem · Idempotency-Key: obligatoria
{ "companyId": "…", "membershipId": "…", "servicio": "Almuerzo",
  "qrTokenId": "…", "sucursalId": "…", "vehiculoId": "…", "notas": "…" }
```

```jsonc
{ "redemptionId": "…", "visitId": "…", "codigo": "TX-…", "ticketNumero": "…",
  "customerId": "…", "usesLeft": 2, "unlimited": false, "redeemedAt": "…" }
```

| Rechazo | HTTP | Qué hacer |
|---|---|---|
| `MEMBRESIA_NO_ENCONTRADA`, `SUCURSAL_NO_ENCONTRADA`, `EMPRESA_AJENA` | 404 | Revisar los ids |
| `SIN_USOS`, `MEMBRESIA_VENCIDA`, `MEMBRESIA_NO_ACTIVA`, `VEHICULO_NO_AUTORIZADO`, `QR_INVALIDO` | **422** | El negocio dice que no; enseñárselo al camarero |
| `CONFLICTO` | **409** | Alguien se adelantó: re-evaluar y reintentar |

El motivo concreto viaja en `error.reason` **solo** en los 422. Ahí sí se
detalla, y no contradice la regla de no describir la configuración: es
información del cliente que el satélite ya tiene delante, y sin ella el camarero
no sabe qué decirle.

**`EMPRESA_AJENA` responde 404, no 403.** Distinguir «no existe» de «existe pero
no es tuya» confirmaría, membresía a membresía, de quién es cada una.

### La clave se reserva ANTES de canjear

Al revés —canjear y luego registrar— dos reintentos simultáneos consumirían los
dos antes de que ninguno guardara: exactamente el fallo que la clave viene a
impedir.

### Un rechazo también se guarda

Si no, el reintento de un satélite que ya recibió «sin usos» volvería a ejecutar
el canje y podría encontrarlo recargado: dos respuestas distintas para la misma
petición.

> **Y la respuesta repetida conserva su código HTTP.** Este fallo existió: la
> repetición salía por el envoltorio de éxito, que siempre responde 200, así que
> el reintento de un canje **rechazado** devolvía 200 con un cuerpo de error
> dentro. Un satélite que mira el código habría concluido que funcionó y le
> habría dado al cliente un beneficio que MembeGo acababa de negarle.
>
> Lo encontró la prueba contra base real, no el análisis estático. Las
> repeticiones llevan ahora `X-Idempotent-Replay: true`.

---

## `POST /transactions`

El restaurante cobra la cuenta en **su** sistema; MembeGo no gestiona su menú ni
sus mesas (§14: el Core no replica operación). Pero el dueño quiere ver en un
solo sitio lo que facturó.

```jsonc
// scope: transactions:write · Idempotency-Key: obligatoria
{ "companyId": "…", "customerId": "…", "branchId": "…",
  "amount": 1250.5, "description": "Mesa 4", "externalId": "T-8891" }
```

**No es un cobro** — el vertical ya cobró; esto es el registro, y no toca la caja
de MembeGo. **No es un canje** — no descuenta nada.

Un `customerId` de otra empresa **no** produce error: la venta se registra sin
cliente. Rechazarla perdería el importe del informe por un dato accesorio;
atribuirla a ciegas metería la venta en la ficha de un cliente ajeno.

---

## `POST /visits` no existe, y no es un olvido

En el modelo de datos de MembeGo **una visita ES un canje**: `Visit.membershipId`
es obligatorio, y la visita nace dentro del mismo núcleo atómico que descuenta el
saldo. No hay forma de registrar «vino pero no consumió» sin inventar un concepto
nuevo y cambiar el significado de un modelo que sostiene los informes.

`/redemptions` devuelve el `visitId`. Ese es el endpoint que el estándar llamaba
`/visits`.

---

## El eco

Un satélite que canja por la API **no recibe** por webhook el evento de su propia
acción.

No es un ahorro: ya tiene la respuesta síncrona, y devolverle la noticia de lo
que acaba de hacer es un eco. Una implementación ingenua lo trata como un evento
nuevo, actúa otra vez y vuelve a llamarnos — un bucle que solo se nota cuando ya
se ha multiplicado.

El slug del satélite viaja en el payload (`sistemaOrigen`) y el despacho lo
excluye del reparto. Va en el payload y no en una columna porque el evento cruza
el bus de automatizaciones, y añadirle una columna de integración a `AutomationEvent`
sería meter la plataforma dentro del motor de reglas.

Un canje del **mostrador** no marca ningún origen, así que llega a todos los
satélites habilitados. Hay una prueba para eso: marcarlo por error dejaría a un
satélite sin enterarse de las visitas de su propia empresa.

---

## Guardias

| Prueba | Qué impide |
|---|---|
| **El endpoint usa el MISMO servicio que el mostrador** | Dos implementaciones de la ruta del dinero |
| Ni el endpoint ni el action descuentan por su cuenta | Una segunda puerta al saldo |
| El núcleo conserva sus tres guardas contra carreras | Reescribirlas «más limpias» y perder la atomicidad |
| La auditoría va dentro de la transacción | Un descuento sin rastro |
| Las lecturas pesadas siguen fuera | Deshacer una optimización de pgBouncer ya pagada |
| El Server Action no pasa de 100 líneas | Que la lógica vuelva a colarse donde solo la usa un navegador |
| Un satélite no se hace pasar por un empleado | Falsificar quién atendió |
| La empresa se comprueba dos veces | Un cierre único que alguien pueda quitar |
| La clave se reserva antes de canjear | Dos reintentos simultáneos consumiendo los dos |
| También se guarda la respuesta de un rechazo | Dos respuestas distintas para la misma petición |
| **La respuesta repetida conserva su código HTTP** | Repetir un rechazo como si fuera un éxito |
| `/transactions` no toca membresías ni QR | Que el puente de informes se vuelva un canje sin guardas |
| El evento no vuelve al sistema que lo provocó | Un bucle de eco |

Verificado además contra PostgreSQL real, 21 comprobaciones: un canje descuenta
exactamente uno; el reintento con la misma clave **no** descuenta otra vez y
devuelve la misma visita; una clave nueva sí; sin usos da 422 con motivo y su
reintento repite el 422; un plan ilimitado canjea sin descontar; una membresía de
otra empresa da 404; el QR queda invalidado y volver a usarlo da 409 **sin
descontar de más**; el canje del panel funciona igual; un actor de otra empresa
es rechazado; la auditoría registra el origen; y una venta con cliente ajeno se
registra sin cliente.

---

## Siguiente

Fase 4: `@membego/contracts` y `@membego/platform-sdk` — los tipos y el cliente
que hoy cada satélite tendría que escribir a mano.
