# Eventos v2, firma asimétrica e idempotencia

Fase 3 del *Membego Platform Integration Standard v1*.
Continúa `docs/platform/api-v1.md`. Ver `docs/PLATFORM_ARCHITECTURE_REPORT.md` §8, §12, §29, §74.

---

## El sobre

Antes el webhook salía como `{ id, tipo, companyId, payload, emitidoEn }`. Con
un satélite se aguanta; con diez faltan tres cosas.

```json
{
  "eventId": "clx…", "eventType": "visit.completed", "legacyType": "cliente.visita",
  "version": 1, "occurredAt": "2026-08-10T15:00:00.000Z",
  "companyId": "…", "customerId": "…",
  "source": "membego", "traceId": "…",
  "data": { "servicio": "Lavado", "clienteId": "…" },

  "id": "clx…", "tipo": "cliente.visita", "payload": { … }, "emitidoEn": "…"
}
```

| Campo | Por qué |
|---|---|
| `version` | El día que `data` cambie de forma, el satélite atiende las dos mientras despliega. Sin versión, Core y satélites tienen que desplegar el mismo minuto |
| `traceId` | Una visita genera hasta cuatro eventos hacia dos sistemas. Sin hilo común, reconstruir «qué pasó con la visita de las 3» es cruzar logs a ojo |
| `source` | Hoy parece sobrar. Deja de sobrar el primer día que un vertical reenvíe a otro: sin origen, un bucle no se distingue de tráfico legítimo |
| `occurredAt` | Cuándo **ocurrió**, no cuándo se envía. Un evento reintentado tres días después sigue diciendo su hora |

### Las cuatro claves de abajo son la compatibilidad

`id`, `tipo`, `payload` y `emitidoEn` son **duplicados exactos** de los campos
nuevos. Car Wash está en producción y los lee: si el cuerpo pasara a ser solo el
sobre v2, dejaría de reconocer sus eventos el minuto del despliegue. Eso no es
una regresión, es una parada.

Son duplicados y no datos distintos — un satélite no puede leer dos verdades. Se
retiran cuando no quede ninguno usándolos.

### Nombres

`cliente.visita` → `visit.completed`. `recurso.accion` en inglés, el mismo
criterio que las capabilities de la Fase 1a: un identificador de protocolo no se
traduce.

| Interno (no cambia) | v2 |
|---|---|
| `cliente.registrado` | `customer.created` |
| `cliente.primera_visita` | `visit.first_completed` |
| `cliente.visita` | `visit.completed` |
| `cliente.compro_servicio` | `purchase.completed` |
| `cliente.primera_compra` | `purchase.first_completed` |
| `membresia.activada` | `membership.activated` |
| `referido.convirtio` | `referral.converted` |

El nombre **interno** no se toca: lo usan las automatizaciones, y renombrarlo
obligaría a migrar reglas que ya están escritas.

`eventosDeProyeccionSinEmisor()` lista los eventos que el contrato de proyección
(Fase 1a) exige y el bus todavía **no** emite — `company.updated`,
`branch.deleted`… Que salgan en una lista es la manera de que sea una decisión
visible y no una sorpresa a los tres meses.

---

## Firma

Dos cabeceras a la vez.

```
X-Membego-Firma:      <HMAC-SHA256 del cuerpo con el secreto compartido>   ← la de siempre
X-Membego-Signature:  <Ed25519 base64>
X-Membego-Timestamp:  <epoch en segundos>
X-Membego-Event-Id:   <eventId>
```

Se firma `{timestamp}.{eventId}.{rawBody}`.

### Por qué no basta el HMAC

El HMAC usa el secreto **compartido**. Mientras hubo un satélite no importó; con
diez hay un problema que no se arregla rotando nada:

> **quien puede verificar, puede falsificar.**

El satélite guarda el mismo secreto con el que firmamos. Un volcado de su base
—o un empleado suyo— permite fabricar eventos que MembeGo parecería haber
emitido, y ningún receptor podría distinguirlos. Con cientos de sistemas, eso es
cientos de copias de nuestra capacidad de firmar.

Ed25519 parte las dos cosas: nosotros la privada, ellos la pública. Verificar
deja de dar la capacidad de firmar.

### Por qué las dos juntas

Cambiar de firma de golpe exige que Core y satélites desplieguen el mismo
minuto: si el Core cambia antes, todo se rechaza; si el satélite cambia antes,
no llega nada válido. Con las dos, cada satélite migra cuando puede y el HMAC se
retira cuando no quede ninguno usándolo.

### El timestamp va DENTRO de la firma

Si viajara fuera, cualquiera que capturara un webhook podría reenviarlo mañana
con una hora nueva: la firma seguiría siendo válida y la ventana anti-replay no
serviría de nada.

La ventana son **300 segundos**, y por sí sola no impide repetir dentro de esos
cinco minutos: eso lo impide el inbox del receptor, que descarta un `eventId` ya
visto. Son dos defensas y hacen falta las dos — la ventana acota el tiempo, el
inbox acota las veces.

### La clave pública

```
GET /api/platform/v1/.well-known/keys
```

Público a propósito, y el único endpoint que lo es. Una clave pública es
pública; y pedir un token para obtenerla sería un círculo — el satélite
necesitaría credenciales antes de verificar el primer webhook, que es justo el
que llega antes de que nadie configure nada.

Un satélite que la lea de aquí se entera de una rotación sin que nadie le mande
un correo. Uno que la copie a su `.env`, no.

### Verificar (lo que implementa el satélite)

```ts
const material = `${timestamp}.${eventId}.${rawBody}`
const ok = crypto.verify(null, Buffer.from(material), publicKey, Buffer.from(sig, 'base64'))
```

Sobre el **cuerpo crudo**, no sobre el objeto reserializado: volver a serializar
produce, tarde o temprano, otra cadena (orden de claves, espaciado) y una firma
que se rechaza sin poder explicar por qué.

---

## Cola de descarte

`FALLIDO` pasa a llamarse **`DEAD_LETTER`**.

No es un cambio de palabra: un *fallo* es un intento que salió mal y se repite;
esto es un evento que ya no se va a entregar solo y necesita que alguien decida.
Antes eran la misma palabra, y por eso nadie miraba la cola.

- Ocho intentos y a `DEAD_LETTER`, con el payload intacto.
- **Replay** desde el panel del superadmin: vuelven a `PENDIENTE`.
- Reencolar de más es seguro —conservan su `eventId` y el inbox del satélite los
  descarta—; perder un evento no lo es.
- El panel cuenta **los dos nombres** mientras queden filas anteriores a la
  migración. Contar solo el nuevo haría desaparecer media cola de la vista justo
  cuando alguien está mirando por qué no salen los eventos.

---

## Idempotencia

Cabecera `Idempotency-Key` en toda escritura.

> Un reintento de red sobre un canje consume el beneficio **dos veces**, y el
> satélite no puede distinguir «no llegó» de «llegó y se perdió la respuesta».
> Desde su lado las dos cosas se ven igual: un timeout.

Sin idempotencia solo hay dos opciones y las dos son malas: reintentar —y a
veces regalar el beneficio dos veces— o no reintentar —y a veces perder la
operación—.

| Situación | Respuesta |
|---|---|
| Clave nueva | Se ejecuta y se guarda la respuesta |
| Misma clave, mismo cuerpo | **La misma respuesta**, sin ejecutar nada |
| Misma clave, otro cuerpo | `400 IDEMPOTENCY_KEY_REUSED` |
| Misma clave, la primera sigue en curso | `409 IDEMPOTENCY_IN_PROGRESS` |

**La tercera fila es la que importa.** Casi siempre viene de una clave derivada
de algo que no identifica la operación (la fecha, el id de mesa). Aceptarla en
silencio devolvería la respuesta de **otra** operación como si fuera la de esta:
un canje que nunca ocurrió, contestado con un «hecho». Un fallo que se lee como
un acierto, en el peor sitio posible.

### Dos llamadas a la vez

La reserva es un `INSERT` sobre el índice único `(sistemaId, clave)`: si dos
peticiones idénticas entran en el mismo milisegundo, una gana y la otra choca.
La que pierde **no ejecuta**. Comprobar primero y escribir después dejaría una
ventana en la que las dos leen «no existe» y las dos canjean.

Unicidad **por sistema**, no global: dos satélites pueden usar la clave `1` sin
pisarse, y ninguno puede leer la respuesta guardada del otro — que contiene
datos de otra empresa.

Las claves caducan a las 24 horas. Guardarlas para siempre convertiría una tabla
operativa en un archivo histórico de todas las operaciones de todos los
satélites, con sus respuestas dentro.

---

## `POST /benefits/evaluate`

«¿Qué puede consumir este cliente **ahora mismo**, en esta empresa?»

Es la llamada que la Fase 1a apartó a propósito: la elegibilidad es la única
entidad del contrato que **no se proyecta**, porque decide dinero y una copia
desfasada regala un beneficio ya consumido.

```jsonc
// POST { "companyId": "…", "customerId": "…" }   scope: benefits:read
{
  "eligible": true,
  "benefits": [
    { "type": "MEMBERSHIP", "id": "…", "nombre": "Plan Oro",
      "eligible": true, "usesLeft": 3, "expiresAt": "…", "reason": null },
    { "type": "PROMOTION", "id": "…", "nombre": "Postre gratis",
      "eligible": false, "usesLeft": 1, "reason": "DAY_NOT_ALLOWED" }
  ],
  "evaluatedAt": "…",
  "reserved": false
}
```

- **Es un POST que no escribe.** POST porque lleva contexto en el cuerpo y su
  respuesta no se puede cachear jamás; un GET invita a que un intermediario lo
  intente. Llamarlo diez veces da diez respuestas y cero efectos, así que no
  necesita `Idempotency-Key`.
- **Usa el mismo motor que el mostrador** (`validarConsumoCompra`).
  Reimplementar las reglas aquí garantizaría que el satélite y la caja den
  respuestas distintas sobre el mismo cliente, y que nadie sepa cuál vale.
- **Los días y horas se evalúan en la zona horaria del negocio.** Con la del
  servidor, una promoción de «lunes» dejaría de valer a las 8 de la noche del
  domingo en Santo Domingo.
- **`reserved: false` y `evaluatedAt`** están en la respuesta para el satélite
  que la guarde: entre evaluar y canjear el beneficio puede consumirse en otra
  sucursal, así que el canje vuelve a decidir y no se fía de esto.

---

## Lo que sigue faltando, y por qué

`POST /redemptions`, `POST /visits` y `POST /transactions` **no están**, aunque
su idempotencia sí.

El motivo es concreto y se comprobó leyendo el código, no suponiéndolo: el canje
vive hoy en `confirmarVisita`, un Server Action de 937 líneas que exige una
sesión de navegador con rol de escáner y que hace todo el flujo —consumir,
transaccionar, emitir ticket, preparar la impresión— en un solo bloque. Una
credencial de API no tiene sesión ni rol de navegador.

Exponerlo requiere **extraer antes un servicio de canje** de ese Server Action,
sin cambiar su comportamiento. Es la ruta del dinero y es lo que hoy sostiene
Car Wash en producción; hacerlo en la misma pasada que el sistema de eventos
significaría entregar las dos cosas a medio verificar.

Esa extracción es la Fase 3b, y los tres endpoints van encima de ella. La
infraestructura que necesitan —claves, huella, reserva por índice único,
respuesta guardada— ya está construida y probada aquí.

---

## Despliegue

`PLATFORM_EVENT_PRIVATE_KEY` (Ed25519, PKCS8) y la migración
`20260805_eventos_v2_idempotencia`.

```bash
openssl genpkey -algorithm ed25519 | base64 -w0
```

Se acepta PEM directo o en base64: un PEM tiene saltos de línea y muchos paneles
de despliegue los convierten en literales `\n`, con lo que la clave «está
puesta» y no funciona.

**Sin la variable no se rompe nada** — a diferencia de `PLATFORM_TOKEN_SECRET`,
esta no falla cerrada. Los eventos siguen saliendo con el HMAC de siempre.
Fallar aquí dejaría de entregar webhooks a satélites que nunca pidieron la firma
nueva.

---

## Guardias

| Prueba | Qué impide |
|---|---|
| **El cuerpo conserva las claves del formato anterior** | Parar Car Wash el día del despliegue |
| Las claves de legado son duplicados exactos | Que dos integraciones del mismo evento hagan cosas distintas |
| El mapa de nombres es biyectivo | Dos eventos indistinguibles en el satélite |
| Con la clave pública NO se puede firmar | Que el cambio de algoritmo no sirva de nada |
| El timestamp está dentro de la firma | Reenviar un webhook capturado con hora nueva |
| Fuera de la ventana no vale ni con firma correcta | Replay tardío |
| Una clave que no es Ed25519 se rechaza | Firmar con algo que no protege |
| **Misma clave con otro cuerpo NO es un reintento** | Contestar sobre una operación distinta de la pedida |
| La clave es única por sistema, no global | Que un satélite lea la respuesta de otro |
| El backfill va antes del CHECK | Una migración que se bloquea a sí misma |
| `evaluate` no llama a ningún método de escritura | Que la evaluación empiece a consumir |
| Una ruta pública no puede leer datos | Que la exención de `.well-known` se ensanche |

Además del análisis estático, el camino completo se probó contra una base real:
emisión de token, evaluación con una membresía activa y una promoción restringida
a otro día, evaluación sobre una empresa ajena, y las cuatro situaciones de la
tabla de idempotencia — incluidas **dos peticiones simultáneas con la misma
clave, de las que solo una ejecuta**.

---

## Siguiente

Fase 3b: extraer el servicio de canje del Server Action y montar encima
`redemptions`, `visits` y `transactions`.
