# Tarjetas guardadas · textos para revisión legal

> **Estado: BORRADOR. Pendiente de revisión legal.** Lo que aquí se describe es
> lo que el código registra hoy. `renovacion-v1` se muestra en el detalle de la
> membresía (panel «Renovación automática»); **mientras esa pantalla no se
> despliegue, nadie la ha aceptado y se puede ajustar libremente**, y esta es la
> ventana para que legal la revise. Desde el primer despliegue es una versión
> publicada y cualquier cambio es `renovacion-v2`. Los textos de «guardar la
> tarjeta» ya se muestran hoy.

Este documento junta lo que un abogado necesita leer en un solo sitio: los textos
que el cliente acepta, qué se registra cuando acepta, lo que el sistema hace de
verdad (para que el texto no prometa más ni menos) y lo que hay que decidir. No
es asesoría legal: las preguntas de la sección 5 son justamente lo que no sé y no
debo suponer.

## 1. Dos consentimientos, y por qué son dos

| | Guardar la tarjeta | Renovar la membresía automáticamente |
|---|---|---|
| Qué permite | Pagar de nuevo sin escribir la tarjeta | Cobrar **sin que el cliente esté presente** |
| Quién inicia cada cobro | El cliente, con un clic | El sistema, a diario, cuando la membresía está por vencer |
| `tipo` registrado | `GUARDAR_TARJETA` | `RENOVACION_AUTOMATICA` |
| Dónde se acepta | Casilla de la pantalla de pago (web) y de la app móvil | Casilla del panel «Renovación automática» del detalle de la membresía (**solo web**) |

El permiso de guardar dice, a propósito, que **«no activa renovaciones
automáticas»**: guardar no autoriza cobros futuros sin el cliente, y el cobro
automático exige un consentimiento de renovar vigente.

## 2. Los textos (tal como están en el código)

Fuente única: `src/modules/pagos/consentimientosCore.ts` (`TEXTOS_PUBLICADOS`). El
servidor registra la **versión** del texto, no el texto: una pantalla que cambie
sin versión nueva rompe una prueba.

**Cada superficie registra su propio texto**, porque no dicen exactamente lo
mismo, y una versión publicada no se edita. Las pantallas viven en
`src/components/membresia/PagoTokenCardnet.tsx` (web) y
`apps/client/src/components/pagos/cardnet/primitives.tsx` (móvil); las pruebas
(`tests/consentimientos-pago.test.ts`) comparan lo que muestra cada una con lo
registrado.

### `guardar-tarjeta-web-v1` (web)

> **Guardar esta tarjeta para futuras compras.** CardNET conserva el perfil de
> pago de forma segura. Este permiso no activa renovaciones automáticas.

### `guardar-tarjeta-movil-v1` (app móvil)

> **Guardar esta tarjeta para futuras compras.** Tu tarjeta se guardará de forma
> segura en CardNET. Este permiso no activa renovaciones automáticas.

### `renovacion-v1` (borrador; se acepta en el panel «Renovación automática»)

> **Renovar mi membresía automáticamente.** Autorizo a {empresa} a cobrar a esta
> tarjeta el precio vigente del plan (hoy {monto}) {periodo}, sin confirmar cada
> cobro, según las condiciones de renovación automática de la Política de pagos.
> Puedo desactivarlo cuando quiera.

Es corto a propósito (decisión del dueño, 21-10-2026): **las condiciones completas
están en la Política de Privacidad, sección 5.3 «Renovación automática»**
(`/privacy#renovacion-automatica`), enlazada desde la propia casilla, y es esa
sección la que hay que revisar junto con este texto. Lo que la política promete lo
cumple el código:

- **El aviso.** La política dice «si no podemos avisarte, no cobramos»: quien
  acepte `renovacion-v1` **no se cobra sin que conste el aviso del ciclo**
  (`exigeAvisoPrevio`). Los consentimientos heredados no lo prometieron y no se
  les exige.
- **Las cifras** (7 días de aviso, cobro desde 3 días antes, hasta 3 intentos) son
  las de `POLITICA_RENOVACION`, y `tests/politicas-pagos.test.ts` obliga a que la
  política publicada y la del sistema coincidan.

`{monto}` sería el precio del **plan** («RD$1,600»), no el del primer pago (que
puede llevar un descuento de bienvenida que las renovaciones no tienen).
`{periodo}` es «cada N días» según la vigencia del plan; si no se conoce, «en cada
período».

### Versiones: una publicada no se edita

Los dos textos de guardar ya se muestran: cualquier cambio es una versión nueva
(`…-v2`) y el registro de quienes aceptaron la anterior sigue diciendo la
anterior. `renovacion-v1` se puede editar directamente mientras la pantalla no se haya
desplegado; desde el primer despliegue es una versión publicada.

## 3. Qué se registra cuando el cliente acepta

Una fila en `consentimientos_pago` por cada consentimiento:

| Campo | Qué guarda |
|---|---|
| `tipo` | `GUARDAR_TARJETA` o `RENOVACION_AUTOMATICA` |
| `textoVersion` | La versión del texto mostrado |
| `otorgadoAt` | Cuándo |
| `ipAddress`, `userAgent` | Desde dónde (solo web: la sesión móvil no conserva la IP ni el agente, y se registran vacíos en vez de inventarlos) |
| `tarjetaId`, `membershipId` | A qué tarjeta y, si es renovar, a qué membresía |
| `origen` | `CLIENTE` (lo aceptó en pantalla) o `HEREDADO` (ver abajo) |
| `revocadoAt` | Cuándo lo retiró, si lo retiró |

**Solo se inserta.** Lo único que cambia de una fila es `revocadoAt`, una vez.
Retirar un consentimiento no borra que existió. El consentimiento de guardar se
registra **en la misma transacción** que la tarjeta: o quedan los dos o ninguno.

**Lo que el servidor puede y no puede probar.** Registra que el formulario llegó
con la aceptación marcada y la versión del texto que la pantalla mostraba. No
puede probar que la persona leyó el texto.

### Consentimientos heredados

Las tarjetas guardadas antes de este registro y las membresías que ya renovaban
solas heredaron, por migración (`20261077_consentimientos_pago`), un consentimiento
marcado `origen = 'HEREDADO'` y `textoVersion = 'previo-a-registro'`, con la fecha
en que se guardó la tarjeta como `otorgadoAt`. No hay texto ni fecha exactos y no
se finge lo contrario. La renovación con esas tarjetas sigue funcionando.

## 4. Lo que el sistema hace hoy (para que el texto no prometa de más)

- El cobro automático corre **una vez al día** (12:00 UTC). Empieza **3 días
  antes** del vencimiento (antes era 1) y cobra el **precio vigente del plan** en
  ese momento. Cobrar antes no le quita días al cliente: la renovación extiende
  desde el vencimiento actual. **La primera cifra la confirmó el dueño el
  21-10-2026.**
- **Aviso previo:** 7 días antes del vencimiento el cliente recibe un correo y una
  notificación («se renovará automáticamente… cobraremos RD$X a tu tarjeta en
  los días previos»). Solo si la empresa puede cobrar con tarjeta.
- Si el cobro es **rechazado por el banco**, el cliente recibe un aviso («no se
  hizo ningún cargo») y se reintenta al día siguiente: **hasta 3 intentos y
  siempre antes del vencimiento**. Al agotarse —o ante un rechazo que no se
  arregla reintentando (tarjeta vencida, reportada, número inválido)— la
  renovación automática **se desactiva sola**, el consentimiento queda retirado y
  **la tarjeta sigue guardada**. El cliente recibe un aviso que lo dice.
- Un cobro que se cae **sin respuesta** (o que el banco dice que «ya se
  procesó») **no se trata como rechazado**: no se sabe si se cobró. No se le
  avisa al cliente de nada (no hay nada cierto que decirle) y **no se vuelve a
  cobrar** hasta saber qué pasó: al día siguiente el sistema se lo pregunta a
  CardNET y, si no hay respuesta clara, lo concilia una persona. Si CardNET
  confirma que sí se cobró, la membresía se extiende sin volver a cobrar; si
  confirma el rechazo, cuenta como un intento más. Es la protección contra cobrar dos
  veces.
- Una tarjeta con vencimiento conocido y ya vencido no genera ningún intento: se
  apaga la renovación, se retira el consentimiento y se avisa.
- Desactivar la renovación o quitar la tarjeta detiene los cobros de inmediato y
  retira el consentimiento.
- La tarjeta se escribe siempre en la ventana segura del procesador (CardNET);
  Membego guarda una referencia (cifrada en reposo), la marca, los últimos 4
  dígitos y, **cuando CardNET lo entrega**, el mes y el año de vencimiento (ver la
  pregunta 6).
- Registrar una tarjeta nueva puede generar un **cargo de verificación de
  RD$1.00** que el banco muestra con un código; la política de privacidad ya lo
  dice.

## 5. Lo que necesito que decida legal

1. **Cobros recurrentes.** ¿Qué exige la normativa dominicana para cobrar de forma
   recurrente a un consumidor (consentimiento previo, información previa,
   constancia, forma de cancelar)? ¿Basta con el texto `renovacion-v1` o falta
   algo —p. ej. aviso de cambio de precio, o decir la fecha exacta del próximo
   cobro (hoy el aviso dice «en los días previos al vencimiento»)—? (Referencia a
   verificar por legal: Ley 358-05 de protección al consumidor.)
2. **Datos de pago como datos personales.** ¿Qué obligaciones hay sobre el
   tratamiento de la referencia de tarjeta, la marca y los últimos 4 dígitos, y
   sobre el registro de IP y user agent del consentimiento? (Referencia a
   verificar: Ley 172-13.)
3. **Retención.** Las filas de consentimiento sobreviven a que se quite la
   tarjeta. ¿Por cuánto tiempo hay que conservarlas, y cuándo deben borrarse si
   la persona pide eliminar sus datos? Hoy se borran en cascada si se borra al
   cliente.
4. **Quién es el responsable.** El texto dice «autorizo a {empresa}»: cada empresa
   es la que cobra. ¿Debe decir también que Membego opera la plataforma y
   CardNET procesa el pago?
5. **El texto heredado.** Las renovaciones que ya existen siguen cobrando bajo un
   consentimiento `HEREDADO`. ¿Es suficiente, o hay que pedir una reconfirmación?
   (El aviso previo les añade un párrafo que invita a revisar la renovación y a
   desactivarla si no la recuerdan, **pero no hay un botón de «confirmar»**: solo
   pueden desactivarla. Si legal exige una reconfirmación explícita, hay que
   construirla.)
6. **Vencimiento de la tarjeta.** La política decía que Membego «nunca almacena
   […] su fecha de vencimiento», pero el código guarda el mes y el año en
   `tarjetas_tokenizadas` cuando CardNET los devuelve. **Se corrigió la política**
   (5.2): dice que se guardan, cuando el procesador los entrega, para avisar
   antes de que venza y no intentar cobros con una tarjeta vencida. ¿Es
   aceptable guardarlos con ese fin?
7. **Reintentos y desactivación automática.** El texto fija «hasta 3 intentos» y
   que, si no se logra, la renovación se desactiva. ¿Es suficiente información?
   ¿Es aceptable que el sistema **retire solo** el consentimiento del cliente
   cuando se agotan los intentos (queda con `revocadoAt` y el asiento de
   auditoría dice por qué)?
8. **El canal del aviso.** El aviso va por **correo y notificación en la app**. Un
   cliente sin cuenta (que no puede recibir la notificación) no se cobra
   automáticamente bajo `renovacion-v1`. ¿Es aceptable el correo como canal del
   aviso previo, o debe haber otro (SMS)?

## 6. Política de privacidad y términos

**La sección 5 de la Política de Privacidad se reescribió** (`src/app/(public)/privacy/page.tsx`,
21-10-2026) y es la que debe revisar legal junto con los textos de arriba:

- 5.1 Cómo se procesa la tarjeta (CardNET; quién cobra, quién opera, quién procesa; el
  cargo de verificación de RD$1.00).
- 5.2 Guardar la tarjeta (opcional): qué se guarda —incluido el mes y año de
  vencimiento cuando el procesador lo entrega—, que no activa la renovación, cómo
  se quita.
- 5.3 Renovación automática: autorización aparte; precio vigente del plan; aviso 7
  días antes (sin aviso no se cobra); cobro desde 3 días antes; rechazos (aviso,
  reintento al día siguiente, hasta 3, siempre antes del vencimiento, desactivación,
  tarjeta conservada); nunca dos veces; recibo; cómo desactivar; renovaciones
  anteriores al registro.
- 5.4 Constancia de las autorizaciones: qué se registra y cuánto se conserva.

Los Términos (§ 4) remiten a esa sección. Falta decidir el plazo de retención
(pregunta 3): hoy la constancia se elimina con la cuenta.
