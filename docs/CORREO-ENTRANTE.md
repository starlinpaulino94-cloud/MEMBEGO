# Correo entrante — respuestas a tickets

Hasta el 17-08-2026 el soporte era de **ida**. Salía el correo de «nuevo
ticket» hacia el buzón de la empresa y, si alguien pulsaba Responder, esa
respuesta no llegaba a ninguna parte. Esto lo cierra: la respuesta vuelve y
entra en el ticket como un mensaje más.

## Cómo funciona

```
Alguien responde al correo
        ↓  (Reply-To: t-<ticketId>-<firma>@respuestas.membego.com)
    MX del subdominio → Resend
        ↓  POST firmado (svix)
POST /api/webhooks/resend
        ↓  1. verifica la firma del webhook       ← si falla: 401
        ↓  2. resuelve el ticket del destinatario ← si falla: 200 «descartado»
        ↓  3. pide el cuerpo a la API de Resend
    TicketMensaje (autorTipo: CLIENTE)
```

## Las dos puertas, y por qué hacen falta las dos

**La firma del webhook** (`src/lib/webhooks/svix.ts`) responde a *«¿esto lo
manda Resend?»*. El endpoint es público por necesidad —Resend no puede llevar
credenciales nuestras—, así que la firma es lo único que separa un correo real
de un `POST` que alguien nos mandó a mano.

**La firma de la dirección** (`src/lib/email/respuestas.ts`) responde a *«¿a qué
ticket pertenece?»*. La respuesta ingenua sería mirar el remitente y buscar su
ticket abierto, pero **cualquiera puede enviar un correo poniendo el `From` que
quiera**: eso dejaría a un desconocido escribiendo en el ticket de otra persona.
Por eso el ticket viaja dentro de la dirección, firmado con HMAC.

Son preguntas distintas y ninguna cubre a la otra. Un atacante con la URL del
webhook no pasa la primera; uno que consiguiera reenviar un correo legítimo
tampoco puede redirigirlo a otro ticket sin el secreto.

`tests/correo-entrante.test.ts` prueba las dos cerrando, no solo abriéndose.
Ambas guardias se verificaron por mutación: al desactivar la comparación de
firma, las pruebas fallan.

## El bucle, cerrado por los dos lados (25-09-2026)

Hasta hoy el soporte era de ida y media vuelta: al negocio le llegaba el correo
del ticket nuevo y, desde agosto, también la respuesta del cliente. Pero cuando
el negocio respondía, el cliente solo se enteraba si volvía a entrar a la app.
Un soporte al que hay que ir a mirar no es soporte.

Ahora `responderTicket` también le manda un correo al cliente, con el mismo
`Reply-To` firmado: puede contestar desde su gestor y su respuesta vuelve al
ticket. Nada para empresas de demostración —sus clientes son inventados y los
rebotes ensucian la reputación del dominio—, el cuerpo va escapado y el asunto
no (va en `subject`, que es texto plano). Fail-open: si el correo no sale, la
respuesta ya está guardada y la notificación de la app también.

### Y por eso `entrante.ts` ya no da por hecho quién escribe

Con las dos partes usando la misma dirección de respuesta, archivar todo como
`CLIENTE` —que era correcto cuando solo escribía el negocio— haría que la
respuesta del negocio apareciera en el hilo como si la hubiera escrito el
cliente. Un hilo de soporte con los papeles cambiados es peor que uno
incompleto.

`quienEscribe` compara el remitente con el correo de soporte de la empresa y
**solo entonces** marca `ADMIN`. Todo lo demás —el cliente, un reenvío, una
dirección desconocida— sigue entrando como `CLIENTE`, que es lo que ya hacía:
el cambio no puede empeorar ningún caso que hoy funcione.

Esto **no autentica** nada. El `From` se falsifica en diez segundos; lo que
autentica el mensaje es el token firmado de la dirección de destino, y eso se
comprueba antes. Esto solo elige una etiqueta para que el hilo se lea bien.

## Configuración

### 1. DNS — subdominio, nunca la raíz

Recibir correo exige un registro **MX**, que es distinto del SPF/DKIM del envío.

> ⚠️ **`membego.com` tiene el MX apuntando a Zoho**, que es el correo de la
> empresa. Cambiar el MX de la raíz dejaría a la empresa sin recibir su propio
> correo. Por eso se usa un subdominio: `respuestas.membego.com` recibe sin
> tocar nada de Zoho, y se puede quitar sin consecuencias.

En Resend → *Domains* → añadir `respuestas.membego.com` para **recepción**, y
copiar el MX que dé al DNS del dominio.

### 2. Webhook

Resend → *Webhooks* → `https://app.membego.com/api/webhooks/resend`, evento
`email.received`. El secreto que devuelve (`whsec_…`) va a
`RESEND_WEBHOOK_SECRET`.

La ruta está excluida del `matcher` del proxy en `src/proxy.ts`. Sin esa
exclusión, el middleware de sesión la mandaría a `/login` y Resend vería un 307.

### 3. Variables

| Variable | Qué es |
|---|---|
| `EMAIL_REPLY_DOMAIN` | El subdominio: `respuestas.membego.com` |
| `EMAIL_REPLY_SECRET` | Firma las direcciones. `openssl rand -hex 32` |
| `RESEND_WEBHOOK_SECRET` | El `whsec_…` de Resend |
| `RESEND_RECEIVING_URL` | Opcional. Solo si cambia la ruta de la API |

**Las tres primeras van juntas.** Si falta cualquiera, el entrante queda apagado
y el envío sigue exactamente igual que antes: `crearDireccionRespuesta` devuelve
`null` y el correo sale sin `Reply-To`. Mismo criterio que `sendEmail` sin
`RESEND_API_KEY` — degradar, no reventar.

## Lo que NO está verificado

`descargarCuerpo`, en `src/modules/soporte/entrante.ts`, pide el cuerpo del
correo a la API de Resend. **Esa URL viene de la documentación, no de una
llamada comprobada**: el entorno donde se escribió tiene bloqueado el acceso a
`resend.com`. Antes de dar el módulo por bueno hay que confirmarla en
`https://resend.com/docs/api-reference/emails/retrieve-received-email`.

Está aislada en una sola función y se puede corregir sin desplegar, poniendo
`RESEND_RECEIVING_URL` con `{id}` como marcador. Todo lo demás —las dos firmas,
el recorte de citas, la escritura en el ticket— es independiente de ella.

## Decisiones

**Siempre 200 cuando la firma es válida.** Un correo que no podemos encajar
—sin token, ticket borrado, empresa de práctica— no es un fallo de Resend, y
devolver 4xx/5xx haría que reintentara durante horas algo que nunca vamos a
aceptar. Se responde 200 con el motivo, visible en el panel de webhooks. El 500
se reserva para el fallo transitorio, donde el reintento sí sirve.

**El remitente se guarda pero no autentica.** `autorNombre` lleva el `From` real
para que quien atiende vea de quién vino. Lo que autentica el mensaje es el
token, no ese campo.

**Un ticket `CERRADO` que recibe respuesta vuelve a `NUEVO`.** Si no, el mensaje
entra y nadie lo ve nunca.

**El recorte de citas se queda corto a propósito.** `quitarCita` corta los
separadores de Gmail, Outlook, Apple Mail y Zoho, y las líneas con `>`. Ante la
duda conserva texto: arrastrar una cita de más es molesto, perder el mensaje de
alguien no tiene arreglo. Si el recorte se lo come todo, devuelve el original.

**Empresas de demostración excluidas**, igual que en el envío.

## Lo que todavía no hace

El cliente **no recibe** correo cuando el admin responde a su ticket:
`responderTicket` solo crea una notificación en la app. Eso significa que hoy el
bucle está cerrado para **quien atiende** (responde desde Zoho y entra en el
ticket), pero no para el cliente, que no tiene ningún correo al que responder.

Añadirlo es pequeño —`encolarEmail` con el mismo `Reply-To`— pero es un cambio
de comportamiento de cara al cliente: pasarían a recibir correos que hoy no
reciben. Se deja fuera a propósito, para decidirlo aparte.
