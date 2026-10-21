# Correo a CardNET · tarjetas guardadas y renovación automática

> **Estado: BORRADOR para enviar.** Completa lo que va entre corchetes `[...]`.
> No lleva llaves, tokens ni ids de clientes: se puede enviar tal cual.
> **Las respuestas tienen que llegar por escrito** y quedar en la tabla del final.

Qué desbloquea: confirmar que el cobro con una tarjeta guardada y la renovación
automática funcionan contra CardNET de verdad. Hoy todo lo construido está probado
solo contra un CardNET **simulado**: ni un cobro con perfil guardado se ha
aprobado todavía contra su ambiente.

---

## El correo

**Asunto:** MembeGo · Tokenización: consultas para cobros con tarjeta guardada y renovación automática

Estimado/a [nombre del ejecutivo]:

Le escribimos de MembeGo, una plataforma de membresías que cobra con la
tokenización hospedada de CardNET (Manual Técnico de Tokenización v1.7). Hoy el
cliente registra su tarjeta en la ventana de CardNET, le cobramos con el token en
ese mismo momento y, si lo autoriza, guardamos el perfil de pago para que pague de
nuevo sin escribirla. Usamos el ambiente de laboratorio y, para producción, las
llaves **con autenticación** (código de activación de 6 caracteres).

Además de las compras que inicia el cliente, queremos habilitar la **renovación
automática** de su membresía: un cobro periódico que inicia nuestro sistema, sin
que el cliente esté presente, con su autorización previa. Antes de hacerlo,
necesitamos confirmación **por escrito** de varios puntos que el manual no cubre y
que no queremos asumir con dinero de por medio.

Entendimos de una conversación anterior que la lógica de recurrencia (cuándo y
cuánto cobrar) la maneja el comercio. Lo que necesitamos saber es qué exige
CardNET, técnica y comercialmente, para que esos cobros sean aceptados. Las
cuatro primeras preguntas son las que hoy nos bloquean.

**1. Cobro con un perfil ya guardado.** ¿Cuáles son los campos exactos del
`Purchase` para cobrar, desde nuestro servidor, un `PaymentProfile` activo? Hoy
enviamos el token del perfil, `CustomerId`, `PaymentProfileId` y
`Environment: "Ecommerce_COF"` a la vez (detalle en el anexo). Los nombres de
estos campos los tomamos de la especificación de transacciones, no del manual de
tokenización. ¿Es correcto, sobra algo o falta algo?

**2. Cobros iniciados por el comercio.** ¿La afiliación actual permite cobros sin
el cliente presente? ¿Hace falta una habilitación comercial, un contrato, otro
código de comercio o un indicador de recurrencia distinto? Además: en un cobro
así no hay IP de cliente, y hoy enviamos `CustomerIP: "0.0.0.0"`. ¿Es aceptable,
debemos enviar la IP de nuestro servidor, u omitir el campo?

**3. CVV y autenticación.** En un cobro con tarjeta guardada, ¿CardNET o el banco
emisor exigen el CVV o una nueva autenticación 3DS? Le pedimos la respuesta para
los dos casos: cuando el cliente está presente y cuando el cobro es recurrente.

**4. Cómo se ve el resultado de un cobro.**
 a) ¿Cómo distinguimos un **rechazo del emisor** de un **error técnico**? ¿Qué
 devuelve el `Purchase` en cada caso (estado HTTP, `ResponseCode`, `Errors`)?
 b) Si **no recibimos respuesta** (corte, tiempo de espera), usamos una consulta
 de compras por `UniqueID` para saber si el cobro salió. ¿Es el camino correcto y
 confiable para decidir si se repite un cobro? Si el resultado sigue dudoso,
 hoy lo concilia una persona en su panel y no repetimos el cobro.
 c) ¿Qué significa exactamente el código **94** del §9.2 y qué devuelve el
 `Purchase` si repetimos un `UniqueID`? ¿Evita el cobro duplicado?
 d) Para decidir cuándo reintentar, tratamos como **definitivos** los códigos
 14, 41, 43 y 54, y como **reintentables** 51, 05, 61, 91, 96 y 97. ¿Es correcta
 esa lectura?

**5. Vencimiento de la tarjeta.** ¿El perfil de pago entrega la fecha de
vencimiento? ¿En qué campo exacto? Hoy buscamos, sin confirmación, los nombres
`CardExpMonth`/`ExpirationMonth` y `CardExpYear`/`ExpirationYear` o una cadena
`Expiration` con formato `AAAAMM`. ¿Podemos guardar en nuestra base solo el mes y
el año (nunca el número), o hay alguna restricción de su parte?

**6. Borrado de perfiles.** ¿El borrado (`PaymentProfileDelete`) es inmediato y
confiable? ¿Qué devuelve si el perfil ya no existe? ¿Qué pasa con los perfiles que
quedan sin activar?

**7. Registrar una tarjeta sin comprar.** Con las llaves con autenticación, ¿es
obligatorio el cargo de RD$1.00 de verificación? ¿Se reversa o se devuelve? ¿Hay
una forma de registrar la tarjeta sin cargo?

**8. Límites.** ¿Existe un límite de perfiles por `Customer`? En una prueba
llegamos a 11.

**9. Pruebas.** ¿Pueden darnos tarjetas de laboratorio que simulen rechazo por
fondos insuficientes, tarjeta vencida y tarjeta reportada, para probar estos
flujos de punta a punta?

Le agradeceremos que las respuestas nos lleguen por escrito, por este mismo
medio, para dejarlas en nuestro registro técnico. Si alguna requiere una
reunión, con gusto la coordinamos; y si hay un contacto técnico con quien
podamos aclarar detalles, nos ayudaría mucho que nos lo indique.

Quedamos atentos y agradecemos su apoyo.

Saludos cordiales,

[Nombre y cargo] · MembeGo
[Teléfono] · [Número de afiliación / comercio]

---

## Anexo técnico (pegar en el correo o adjuntar)

El `Purchase` con tarjeta guardada que enviamos hoy, **sin ningún dato sensible**
(no hay PAN ni CVV en nuestro sistema; solo referencias de CardNET). No se ha
aprobado ni una sola vez contra su ambiente: está implementado pero sin confirmar.

```
POST {base}/api/Purchase        Authorization: Basic {llave privada}
{
  "TrxToken":         "<token del perfil>",          // se envía si lo tenemos
  "CustomerId":       "<CustomerId>",
  "PaymentProfileId": "<PaymentProfileId>",
  "Order":            "<referencia corta, 12 caracteres>",
  "Amount":           160000,                         // centavos: RD$1,600.00
  "Tip":              0,
  "Currency":         "DOP",
  "Capture":          true,
  "UniqueID":         "<la misma referencia corta>",
  "CustomerIP":       "<IP del cliente; en el cobro automático, hoy \"0.0.0.0\">",
  "Environment":      "Ecommerce_COF",
  "DataDo":           { "Tax": "0", "Invoice": "<la misma referencia>" }
}
```

Observaciones que ya tenemos de su servicio, por si ayudan:

- Con un `UniqueID` largo, el registro de la transacción lo archivó como cadena
  vacía; por eso enviamos una referencia corta (12 caracteres). No hemos
  comprobado que esa referencia evite un cobro duplicado.
- Con llaves con autenticación, un perfil recién capturado nace `Enabled: false`
  y se activa con el código de 6 caracteres del banco (`/Customer/{id}/activate`).
  Es el flujo que ya usamos.
- Cuando la respuesta trae el estado final de la transacción (§10.6: 1 aprobada,
  2 pendiente, 3 preautorizada, 4 rechazada), manda sobre todo lo demás y solo el
  1 se toma como cobro. Con errores del proveedor en la respuesta, nunca se aprueba.

---

## Registro de respuestas

Se llena cuando CardNET conteste. Una fila por pregunta; la última columna dice
qué hay que tocar en el código si la respuesta no es la que se supuso.

| # | Pregunta | Respuesta de CardNET (con fecha y quién) | Qué cambia en el código |
|---|---|---|---|
| 1 | Campos del `Purchase` con perfil guardado | | `cobrarConCredencialGuardada` en `src/lib/payments/cardnet-tokens.ts` (solo ese cuerpo) |
| 2 | ¿Cobros sin el cliente presente? ¿Qué `CustomerIP` enviar? | | Si requiere habilitación: no encender renovación automática en producción hasta tenerla. `CustomerIP`: hoy el cron manda `0.0.0.0` (parámetro por defecto de `renovarMembresiaPorTarjeta`) |
| 3 | CVV / 3DS con tarjeta guardada | | Si exige CVV o 3DS al cliente presente: el pago con tarjeta guardada necesita un paso extra en la pantalla |
| 4a | Rechazo vs error técnico | | `clasificarCobro` en `src/modules/pagos/renovacionPolitica.ts` |
| 4b | Consulta de un cobro sin respuesta | | Hoy la renovación dudosa se concilia a mano (runbook § 7); si `consultarComprasCardnet` es fiable, la renovación puede usarla y resolver sola esos casos |
| 4c | Código 94 y `UniqueID` repetido | | `CODIGOS_DE_RESULTADO_INCIERTO`; confirmar si `UniqueID` evita el doble cobro |
| 4d | Códigos definitivos vs reintentables | | `CODIGOS_DEFINITIVOS`. Si cambia el número de intentos o los códigos, hay que revisar `renovacion-v1` |
| 5 | Campo del vencimiento y permiso para guardarlo | | `extraerPerfiles` en `src/lib/payments/cardnet-tokens-core.ts` (hoy adivina los nombres); si se guarda, corregir la frase de la política de privacidad |
| 6 | Borrado de perfiles | | `eliminarTarjeta` y `borrarPerfilCardnet` (hoy, si el borrado remoto falla, la tarjeta queda con `eliminacionPendiente` y `eliminarTarjeta` contesta `pendiente`) |
| 7 | Registrar sin comprar | | Si hay una vía sin cargo: «agregar tarjeta» sin pagar (hoy no se ofrece) |
| 8 | Límite de perfiles por Customer | | Tope de tarjetas por cliente |
| 9 | Tarjetas de laboratorio | | Pruebas de punta a punta con rechazo por fondos, tarjeta vencida y reportada |
