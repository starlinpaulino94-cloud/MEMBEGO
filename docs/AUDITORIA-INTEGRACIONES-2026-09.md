# Auditoría profunda del módulo de Integraciones

> Hecha el 15 de septiembre de 2026 sobre `main` (`c94a2e0`). Cada afirmación
> lleva su archivo y su línea: lo que no se pudo comprobar en el código no se
> afirma. La comparación con GoHighLevel se hace contra su superficie pública
> documentada (Marketplace, API v2, Workflows), no contra su código.

---

## 0. Resumen en una página

MembeGo no tiene «un módulo de integraciones»: tiene **tres capas distintas**
que hoy comparten apellido y están en estados de madurez muy diferentes.

| Capa | Qué es | Dónde vive | Madurez |
|---|---|---|---|
| **A · Satélites** | Sistemas verticales (car wash, restaurante) que MembeGo alimenta con SSO + webhooks firmados | `modules/integraciones`, `modules/plataforma`, `api/platform/v1` | **Alta** — contrato cerrado, SDK propio, firma Ed25519, idempotencia, uso único de token |
| **B · Connect** | Catálogo de integraciones que **la empresa** conecta (Google Calendar, WhatsApp, Meta, CardNET) | `modules/connect`, `api/connect` | **Media-alta** — framework excelente, 5 proveedores reales de 14 en catálogo |
| **C · Desarrolladores** | Claves de API y webhooks salientes para que **un tercero** (Zapier, un script) integre | `modules/connect/clavesApi`, `modules/connect/webhooks` | **Media-baja** — las piezas existen, la operación diaria no |

**La arquitectura es mejor que la de GoHighLevel. La cobertura, no.** El
framework de Connect (`modules/connect/catalogo.ts`) resuelve con una sola
función lo que en GHL son tres verdades distintas repartidas por la interfaz, y
el aislamiento multiempresa está razonado línea a línea en un sitio donde casi
nadie lo razona. Lo que falta no es diseño: son **proveedores, verbos de API,
cadencia operativa y un marketplace de terceros**.

**Distancia estimada a paridad con GoHighLevel:** el módulo está hoy en torno al
**35 %** de la superficie de integraciones de GHL. Cerrar los diez hallazgos
Altos de la §3 lo llevaría a ~55 % con unas 6–8 semanas de trabajo. La paridad
real (§5) es un programa de 6–9 meses, y buena parte de él no debería hacerse:
la §6 propone qué copiar y qué no.

---

## 1. Lo que está bien, y hay que proteger

No es cortesía: estas decisiones son las que hacen barato todo lo que viene
después, y las tres primeras son mejores que su equivalente en GHL.

1. **Una sola verdad sobre el estado de una integración.**
   `modules/connect/catalogo.ts:139` ensambla las cinco preguntas
   (implementado · publicado · desplegado · con plan · conectado) en un único
   sitio del que beben la rejilla, el detalle y los módulos contextuales. Es
   imposible que dos pantallas digan cosas distintas porque no hay dos códigos
   que puedan responder.

2. **Adaptadores que solo leen.** `proveedores/adaptadores.ts:13` — una
   integración cuya verdad vive en otro subsistema (CardNET, Instagram) se
   **lee**, no se replica. Es la regla que evita el problema clásico de dos
   tablas que discrepan.

3. **El `companyId` que llega por la red no se cree nunca.**
   `modules/plataforma/api.ts:23`. El token deliberadamente *no* lleva la
   empresa dentro para que saltarse la comprobación no parezca razonable. Es un
   nivel de cuidado que no se ve casi nunca.

4. **Uso único por INSERT, no por campo `usado`.** `TokenSSOUsado` usa el `jti`
   como clave primaria (`integraciones.prisma`), así que el segundo canje
   choca. No hay ventana entre comprobar y marcar.

5. **Secretos: hash o sellado, nunca claro.** `CredencialSistema.clientSecretHash`
   (scrypt), `clavesApiNucleo.ts` (prefijo público indexado + secreto hasheado,
   con marca `mbk_` reconocible por los escáneres de GitHub),
   `connect/cifrado.ts` (AES-256-GCM con AAD por fila y rotación de claves
   maestras).

6. **SSRF cortado al guardar, no al entregar.** `webhooksNucleo.ts:31` bloquea
   `169.254.169.254`, rangos privados y `.internal`. GHL tampoco lo documenta
   tan explícitamente.

7. **Patrón outbox en las dos direcciones** (`EventoSaliente`, `EntregaWebhook`):
   la fila se crea antes del intento, así que un receptor caído no pierde nada.

8. **Contratos versionados en un paquete instalable** (`@membego/contracts`) y
   un SDK propio (`@membego/platform-sdk`) que resuelve renovación de token,
   reintentos con jitter e idempotencia. GHL no da SDK oficial.

9. **35 archivos de prueba** tocan estas tres capas (de 182 en total), incluida
   una que compara el inventario de la API con las rutas del disco: una ruta
   nueva sin documentar rompe la CI (`packages/contracts/src/inventario.ts:15`).

---

## 2. Mapa real de cobertura

### 2.1 Proveedores del catálogo (Capa B)

| Proveedor | Estado en código | Qué hace de verdad |
|---|---|---|
| Google Calendar | **Nativo, OAuth 2.0 + PKCE** | Crea y borra eventos de citas; revoca al desconectar |
| WhatsApp (Cloud API) | **Nativo** | Entrantes, salientes, estados, plantillas sincronizadas, alta manual y alta incrustada |
| Facebook / Messenger | **Nativo** | Páginas, mensajes, webhook firmado |
| Instagram | **Adaptado** sobre la conexión de Meta | DM por la Página |
| CardNET | **Adaptado** sobre el subsistema de pagos | Cobro con tarjeta |
| Google · PayPal · Stripe · QuickBooks · HubSpot · Mailchimp · Brevo · Zapier · Make | **Solo metadatos** (`metadatos.ts:100-160`) | Nada. Tarjeta de «Próximamente» |

**5 implementados de 14 publicados.** Los 9 restantes son honestos —el
framework impide que se puedan conectar (`indice.ts:97`)— pero son 9 tarjetas
que prometen.

### 2.2 API pública (Capa A/C)

- **24 rutas**, todas `GET` o `POST`. **No existe `PUT`, `PATCH` ni `DELETE`**
  en el tipo del inventario (`packages/contracts/src/inventario.ts:35`).
- **Sin paginación por cursor** en ninguna: límites fijos (búsqueda acotada,
  citas `take: 500` en `appointments/route.ts:71`).
- Recursos cubiertos: clientes, vehículos, membresías, beneficios,
  promociones, transacciones, citas (solo lectura), sucursales, empresa,
  entitlements, SSO.
- Recursos **ausentes**: conversaciones y mensajes, oportunidades y embudos,
  etiquetas, notas y tareas, campos personalizados, usuarios y permisos,
  productos, facturas, pagos, formularios, enlaces, medios.

### 2.3 Eventos

- **7 eventos se reenvían** (`integraciones/nucleo.ts:10`): registro, primera
  visita, visita, compra, primera compra, membresía activada, referido
  convertido.
- El mapa v2 conoce 10 (`packages/contracts/src/eventos.ts:46`) — `reserva.creada`,
  `reserva.pagada` y `venta.generada` **existen como nombre y no se emiten**.
- El propio código ya lo reconoce: `eventosDeProyeccionSinEmisor()`
  (`modules/plataforma/eventos.ts:131`) lista los eventos que el contrato exige
  y el bus no emite.
- GoHighLevel expone del orden de **30–40 tipos** de webhook.

---

## 3. Hallazgos

Ordenados por lo que cuesta si no se arregla, no por lo que cuesta arreglarlo.

### ✅ A-1 · Los reintentos tardaban un día entero — RESUELTO (20/09/2026)

> Cerrado en `20260920_reintentos_programados`. La escalera vive en
> `modules/integraciones/reintentos.ts` (núcleo puro, 19 pruebas) y la comparten
> las dos colas: 30 s → 2 m → 10 m → 30 m → 2 h → 6 h → 24 h, con jitter
> determinista de ±20 %. El cron pasa a ser la red de seguridad y solo toma lo
> vencido. Detalle y las tres trampas del diseño, en `docs/COLAS.md`.
>
> Se deja el hallazgo escrito porque el porqué sigue valiendo: es el ejemplo de
> que el outbox garantizaba que no se perdía nada y no que llegara a tiempo, que
> son dos promesas distintas.

<details>
<summary>El hallazgo original</summary>

### 🔴 A-1 · Los reintentos tardan un día entero

`vercel.json:15` programa `/api/cron/integraciones` a las **13:00 UTC, una vez
al día**. Ese cron es el único que reintenta las dos colas
(`cron/integraciones/route.ts:18-26`).

Consecuencia: un webhook que falla en su intento inmediato **no se vuelve a
intentar hasta 24 horas después**. Con `MAX_INTENTOS = 8`
(`connect/webhooks.ts:28`), agotar la cola tarda **ocho días**. Un satélite que
se reinicia durante treinta segundos deja al cliente sin su evento hasta mañana.

GoHighLevel reintenta con backoff en el orden de segundos y minutos.

**Arreglo:** la cola ya existe. `modules/jobs/cola.ts:19` publica en QStash
cuando `QSTASH_TOKEN` está configurado. Al fallar una entrega, programar el
reintento en QStash con backoff exponencial (30 s · 2 m · 10 m · 1 h · 6 h)
en vez de esperar al cron. El cron se queda como barrido de resiliencia.
**Esfuerzo: 2–3 días. Es el hallazgo con mejor relación coste/beneficio del
informe.**

</details>

### ✅ A-2 · La firma no cubría el timestamp — RESUELTO (20/09/2026)

> Cerrado. Sale `X-Membego-Signature-V2` = HMAC de
> `materialFirmado(timestamp, entregaId, cuerpo)` —el mismo material que firman
> los satélites— junto a la v1 de siempre, para que nadie deje de aceptar sus
> avisos el día del despliegue. La guía del panel enseña el verificador
> completo, con la ventana anti-replay y la deduplicación por id de entrega.
>
> La prueba que vale es `tests/connect-firma-webhook.test.ts`: implementa el
> receptor **tal como lo documenta la guía** y comprueba que acepta lo que
> mandamos y que rechaza un replay con el timestamp refrescado — el ataque
> exacto que la v1 permitía.

<details>
<summary>El hallazgo original</summary>

### 🔴 A-2 · La firma de los webhooks de empresa no cubre el timestamp

`connect/webhooks.ts:205-213` envía `X-Membego-Timestamp` pero firma
**solo el cuerpo**: `firmarHmac(secreto, cuerpo)`.

El timestamp viaja sin autenticar, así que quien capture una entrega puede
reenviarla mañana con el timestamp que quiera y la firma seguirá siendo válida.
No hay ventana anti-replay que valga.

Y es doblemente llamativo porque **el mismo repositorio ya lo hace bien** en la
otra dirección: `packages/contracts/src/eventos.ts:89` define
`materialFirmado(timestamp, eventId, cuerpo)` precisamente para esto, y los
satélites lo usan (`integraciones/despacho.ts:112`).

**Arreglo:** firmar `timestamp.deliveryId.cuerpo` con el mismo helper, enviar
las dos cabeceras durante una ventana de migración (igual que se hizo con
Ed25519 en los satélites) y documentar la verificación. **Esfuerzo: 1 día.**

</details>

### 🔴 A-3 · No existe marketplace de aplicaciones de terceros

Hay exactamente **dos** principales (`modules/plataforma/api.ts:75-89`):

- `sistema` — satélite dado de alta **por el superadmin**, `client_credentials`.
- `empresa` — clave `mbk_…` que **el dueño genera para sí mismo**.

**No existe el tercero**, que es el que define a GoHighLevel: una app publicada
por un desarrollador externo que **una empresa instala dándole permiso**. Eso
exige, y no hay nada de ello:

- flujo `authorization_code` + PKCE **de salida** (hoy `oauthNucleo.ts` es solo
  de entrada: MembeGo como cliente de Google, no como servidor de autorización),
- pantalla de consentimiento con scopes legibles,
- modelo de app (nombre, logo, redirect URIs, scopes solicitados, estado de
  revisión),
- instalación/desinstalación por empresa, con revocación en cascada,
- webhooks por app, no por empresa.

**Esfuerzo: 6–10 semanas.** Es la pieza más cara del informe y la §6 discute si
merece la pena hoy.

### ✅ A-4 · La empresa no podía ver, probar ni reenviar una entrega — RESUELTO (20/09/2026)

> Cerrado. `/admin/integraciones/desarrolladores/webhooks/[id]` enseña el
> registro de entregas con su estado, su código HTTP, el error del servidor, el
> cuerpo exacto que se envió y cuándo toca el siguiente intento; y trae los dos
> botones que faltaban: **mandar un evento de prueba** (con diagnóstico en
> lenguaje de negocio) y **reenviar** una entrega.
>
> El diagnóstico NO se escribió de nuevo: `diagnostico.ts` pasa a tener un solo
> árbol de decisión (`clasificarSonda`) y dos redacciones — la del superadmin,
> que habla con el equipo del satélite, y la de la empresa, que habla con quien
> programó su servidor. Duplicar el árbol habría dado dos verdades sobre el
> mismo 404.
>
> Dos permisos nuevos y cableados, `webhook_probar` y `webhook_reenviar`, para
> no pintar botones que la acción va a rechazar.

<details>
<summary>El hallazgo original</summary>

### 🟠 A-4 · La empresa no puede ver, probar ni reenviar una entrega

`EntregaWebhook` guarda estado, intentos, código HTTP y último error. Esa tabla
**no se enseña en ninguna pantalla de empresa**: el único lector es un `count()`
del panel del superadmin (`connect/superadmin.ts:100`).

Concretamente, el dueño de un negocio no puede:

- ver qué entregas hubo y cómo fueron,
- **mandar un evento de prueba** al crear el webhook (el formulario de
  `WebhooksPanel.tsx:118-140` solo tiene nombre y URL),
- **reenviar** una entrega fallida,
- ver el cuerpo que se envió.

En GHL todo eso es la pantalla principal de webhooks. Sin ello, «no me llegan
los eventos» es un ticket de soporte, y el panel del superadmin
(`modules/integraciones/panel.ts:24-33`) existe precisamente porque alguien ya
aprendió esa lección del lado de los satélites — pero no se trasladó al lado de
las empresas. **Esfuerzo: 1 semana.**

</details>

### ✅ A-5 · No se podían elegir los eventos — RESUELTO (20/09/2026)

> Cerrado. Casillas al crear **y** al editar (lo segundo es lo que de verdad
> hacía falta: todas las suscripciones existentes tienen la lista vacía porque
> no había forma de decir otra cosa). El catálogo se deriva de lo que el bus
> emite, no de una lista a mano.
>
> Lo que no estaba en el hallazgo y apareció al hacerlo: el selector, tal cual,
> habría sido una **trampa**. Los avisos de automatización se llaman
> `automation.<lo que la regla decida>` y no se pueden enumerar; en cuanto
> alguien marcara «compras», habrían dejado de llegar en silencio. Se resolvió
> dando a `suscripcionQuiere` la noción de familia (`automation.*`).

<details>
<summary>El hallazgo original</summary>

### 🟠 A-5 · No se pueden elegir los eventos desde la interfaz

El modelo lo soporta (`SuscripcionWebhook.eventos`, y `suscripcionQuiere()` en
`webhooksNucleo.ts:92` trata la lista vacía como «todos»), pero el formulario de
creación **no ofrece ningún selector**. Toda suscripción nace recibiendo todo.

Para una empresa con un endpoint que solo le interesa la conversión de
referidos, eso es ruido, coste y superficie de datos innecesaria.
**Esfuerzo: 1 día** (el backend ya está).

</details>

### ✅ A-6 · El fan-out se hacía en serie — RESUELTO (20/09/2026)

> Cerrado, y el hallazgo se quedaba corto. El fan-out en serie era una molestia;
> el **barrido** en serie era un fallo: cien filas a diez segundos de timeout
> dentro de un `maxDuration` de sesenta significaba procesar unas seis y que la
> plataforma matara la función — sin error y sin traza, repitiendo con las
> mismas seis al día siguiente.
>
> Las cuatro rutas recorren ahora con `enParalelo` y concurrencia 6 (baja a
> propósito: en un barrido muchas filas apuntan al mismo servidor caído). Los
> dos barridos además se cortan por presupuesto y devuelven `sinTiempo`, que el
> panel dice en voz alta.
>
> De paso, un fallo que solo existe en paralelo: el memo de destinos por empresa
> guardaba el valor, así que seis trabajadores simultáneos habrían lanzado seis
> veces la misma consulta. Ahora guarda la promesa.

<details>
<summary>El hallazgo original</summary>

### 🟠 A-6 · El fan-out se hace dentro del request, en serie

`connect/webhooks.ts:181-186` recorre las suscripciones **secuencialmente**, con
`TIMEOUT_MS = 10_000` por cada una. Con cinco suscripciones lentas, el worker
del bus de eventos se queda cincuenta segundos en una sola operación de negocio.
Lo mismo en `integraciones/despacho.ts:161` con los satélites.

Es best-effort y no rompe nada, pero consume el presupuesto de ejecución de
Vercel (`maxDuration = 60`) y retrasa todo lo que venga detrás.

**Arreglo:** encolar el fan-out en QStash (mismo trabajo que A-1) o al menos
paralelizar con `Promise.allSettled` y un tope de concurrencia.
**Esfuerzo: 2 días, compartidos con A-1.**

</details>

### ◐ A-7 · Rotación de secretos — RESUELTO PARA WEBHOOKS (20/09/2026)

> **Hecho:** el secreto de una suscripción de webhook se rota con solape de 7
> días. Se firma con el viejo y el nuevo a la vez, y el receptor valida con el
> que tenga — para lo cual la cabecera v2 pasó a llevar una **lista** de firmas.
> Ese cambio de formato se hizo ahora a propósito: la v2 es de esta misma semana
> y su ventana de adopción sigue abierta; dentro de seis meses habría costado
> una segunda migración con receptores ya escritos.
>
> **Corrección al hallazgo original.** Decía que `CredencialSistema.expiresAt`
> «existe y nadie lo hace cumplir». Es falso: se comprueba en las dos rutas que
> resuelven la credencial (`plataforma/api.ts` y `/oauth/token`). Lo que sí
> falta es un aviso ANTES de que venza — hoy caduca sin que nadie se entere
> hasta que deja de funcionar.
>
> **Corrección sobre las claves de API.** Ya eran rotables de hecho: se pueden
> tener varias activas, así que crear la nueva, mover la integración y revocar
> la vieja es un solape real. Solo se bloquea si `api_keys.max` vale
> exactamente 1, y eso se arregla subiendo el límite, no con código.
>
> **Pendiente:** `SistemaConectado.secreto`. Se deja aparte y no por tiempo: lo
> usan cinco caminos, y dos son de VERIFICACIÓN de SSO (`/sso/entrar` y
> `/sso/redeem`), donde el solape significa «aceptar cualquiera de los dos».
> Tocar la verificación de identidad en el mismo cambio que la firma de
> webhooks daría un diff que nadie puede revisar con la atención que merece.
>
> **Descubierto al hacerlo:** el secreto de webhook nunca se pudo volver a ver,
> pese a que tres comentarios lo afirmaban — y el del esquema usaba esa
> afirmación para justificar guardarlo en claro. Sellarlo queda como migración
> pendiente; los comentarios ya están corregidos.

<details>
<summary>El hallazgo original</summary>

### 🟠 A-7 · No hay rotación de secretos, solo revocación

- Claves de API: `revocarClaveApi` (`clavesApi.ts:89`). No hay rotar.
- Secreto de webhook: se genera al crear y no se puede cambiar sin borrar la
  suscripción.
- `SistemaConectado.secreto`: se copia una vez al `.env` del satélite y no hay
  camino de rotación en el panel.

`CredencialSistema` sí tiene `expiresAt` con un comentario que dice lo correcto
(«una fecha convierte la rotación en algo que ocurre aunque nadie se acuerde»),
pero no hay nada que actúe sobre esa fecha ni que avise.

Una rotación que obliga a un corte de servicio es una rotación que no se hace.
**Arreglo:** permitir dos secretos vivos a la vez con solapamiento (el receptor
acepta cualquiera de los dos durante N días). **Esfuerzo: 3–4 días.**

</details>

### 🟠 A-8 · Sin canal SMS

`action-catalog.ts:77` declara `SEND_SMS: 'send_sms'` y `actionSink.ts:29` dice
que los canales no integrados degradan a `simulated: true`. O sea: una
automatización puede decir que manda un SMS, marcarse como correcta, y no
mandarlo nunca. `canales.ts` ni siquiera lo lista, lo que es la decisión
honesta, pero la acción sigue existiendo en el catálogo del motor.

SMS es un canal de primera clase en GoHighLevel (Twilio nativo, con LC Phone
como reventa). **Esfuerzo: 1–2 semanas** con un proveedor.

### 🟠 A-9 · El correo no es de la empresa

`sendEmail` (`lib/email.ts`) usa Resend **de la plataforma**. Una empresa no
conecta su propio proveedor ni su propio dominio: los correos salen del dominio
de MembeGo. `canales.ts:60` lo dice explícitamente («el correo depende de la
plataforma, no de la empresa»).

Consecuencias reales: la entregabilidad de una empresa se contamina con la de
las demás, no hay DKIM/SPF del dominio del cliente, y el remitente no es el
negocio. GHL resuelve esto con Mailgun/LC Email por subcuenta y dominio
verificado. **Esfuerzo: 2–3 semanas.**

### 🟠 A-10 · El calendario es de ida, no de vuelta

`connect/googleCalendar.ts` crea (`crearEventoCalendario:349`) y borra
(`eliminarEventoCalendario:433`) eventos. **No hay `watch`/canal push, ni lectura
de `freeBusy`, ni sincronización incremental.**

Consecuencia concreta: si el dueño se bloquea dos horas en su Google Calendar,
MembeGo sigue ofreciendo esas horas y le crea una doble reserva. Ese es el fallo
que un negocio de citas nota el primer día.

Tampoco hay Outlook/Microsoft 365 ni iCal. GHL tiene los tres, bidireccionales.
**Esfuerzo: 2–3 semanas para Google bidireccional; +2 para Outlook.**

### ✅ B-1 · Webhook entrante + acción HTTP + regla — RESUELTO (20/09/2026)

> **Hecho:** los webhooks entrantes. Una URL secreta por webhook, lo que llega
> entra al bus como `entrante.<slug>`, y una pantalla enseña el cuerpo exacto de
> lo último recibido — que es la mitad del valor: sin ver el payload no se puede
> construir nada encima.
>
> **La decisión que lo sostiene:** el evento va SIEMPRE prefijado. Un POST de
> fuera no puede fingir `cliente.visita`, así que una URL filtrada en la
> configuración de una herramienta ajena no otorga beneficios ni ensucia los
> satélites de nadie.
>
> **Lo que hay que saber antes de venderlo.** El evento entra y queda guardado,
> pero para ACTUAR sobre él hace falta una automatización suscrita a ese nombre
> — y hoy las automatizaciones solo se instalan desde plantillas
> (`lib/automation/templates`), no hay pantalla para escribir una que escuche un
> evento arbitrario. O sea: el webhook entrante es hoy una superficie de
> **captura** completa y utilizable, y su consumo depende de la otra mitad.
>
> **Y la segunda mitad, hecha:** la acción `call_http` («llama a esta URL con
> este método, estas cabeceras y este cuerpo»), más la regla mínima que une las
> dos — un evento, una llamada. Con eso el circuito se cierra: una herramienta
> ajena avisa, una regla lo escucha, y llamamos a otra herramienta. El motor ya
> interpolaba `{{...}}`, así que las variables salieron gratis.
>
> **Lo que no se puede poner:** cabeceras `x-membego-*`. Sin ese bloqueo, una
> empresa podría llamar a un tercero con `X-Membego-Signature` a mano y hacerle
> creer que ese POST es un evento oficial firmado por nosotros.
>
> **Y un agujero que esto destapó, anterior a todo:** `fetch` sigue
> redirecciones por defecto, así que una URL pública que responda 302 hacia
> `http://169.254.169.254/` saltaba toda la validación y convertía nuestro
> servidor en un lector del servicio de metadatos de la nube. Estaba en las
> entregas de webhook, en el despacho a satélites y en las dos sondas. Los cinco
> caminos llevan ya `redirect: 'manual'`, con una prueba que cuenta los `fetch`
> de cada archivo y exige que ninguno quede sin cubrir.
>
> **Sigue faltando** un constructor de reglas de verdad (condiciones, pasos,
> horarios). El motor lo soporta; la pantalla de aquí es deliberadamente lo más
> pequeño que cierra el circuito.

<details>
<summary>El hallazgo original</summary>

### 🟡 B-1 · Sin trigger de webhook entrante ni acción HTTP a medida

El motor tiene `send_webhook`, pero **solo reparte por las suscripciones ya
creadas** (`actionSink.ts:194-215`). No existe:

- **trigger** «me llega un POST a esta URL» (el *Inbound Webhook* de GHL, que es
  cómo la mayoría de la gente conecta cualquier cosa sin programar),
- **acción** «llama a esta URL con este método, estas cabeceras y este cuerpo, y
  guarda la respuesta» (el *Custom Webhook* de GHL).

Sin esas dos piezas, cualquier integración que MembeGo no haya escrito a mano es
imposible para el usuario final. Es, con diferencia, **la funcionalidad de GHL
con mejor relación valor/esfuerzo que aquí no existe**. **Esfuerzo: 2 semanas
las dos.**

</details>

### ✅ B-2 · App de Zapier — RESUELTO (16/09/2026)

> Cerrado. La app vive en `integrations/zapier/`: proyecto aparte, corre en la
> infraestructura de Zapier y llama a nuestra API pública. Está en este
> repositorio porque su contrato es el nuestro, y una prueba compara sus eventos
> y sus rutas con el catálogo real — así un cambio de nombre rompe la CI en vez
> del Zap de un cliente tres semanas después.
>
> **Cinco disparadores por REST Hook**, no por sondeo: Zapier crea la
> suscripción al encender el Zap y la retira al apagarlo, así que el aviso llega
> en el momento y hereda la firma, la escalera de reintentos y el registro de
> entregas que ya existían. Era la apuesta del hallazgo («la base ya está») y se
> cumplió.
>
> **Lo que faltaba del lado MembeGo:** `GET/POST /webhooks` y
> `DELETE /webhooks/{id}`, con un principal nuevo —`empresa`, solo claves de
> empresa— y el scope `webhooks:manage`. Un satélite no entra: atiende a muchas
> empresas y no le corresponde decidir a quién avisan ellas, ni apuntar sus
> avisos a una dirección suya.
>
> **La política de escrituras NO se tocó.** La API v1 reserva las escrituras de
> negocio a la credencial de un satélite, así que la app trae disparadores y una
> búsqueda, y ninguna acción `create`. La otra mitad —«cuando pase algo fuera,
> avisa a MembeGo»— ya la cubre el webhook entrante de B-1, sin que Zapier
> necesite saber nada de nuestra API.
>
> **Sin `performList`:** no existe «dame los últimos clientes», solo una
> búsqueda que exige término. Llamarla con una letra cualquiera y presentar eso
> como datos reales funcionaría en una demo y fallaría para el primer negocio
> cuyos clientes no la lleven en el nombre. Se declara una muestra, que Zapier
> marca como tal. Cuando exista el listado paginado (B-6) son tres líneas.
>
> **Make queda fuera a propósito:** el OpenAPI público ya se importa en Make, así
> que el retorno de una segunda app es mucho menor que el de la primera.

<details>
<summary>El hallazgo original</summary>

### 🟡 B-2 · Sin app de Zapier ni de Make

Las tarjetas existen (`metadatos.ts:147,154`) y no hay nada detrás. Y sin embargo
**la base ya está**: hay OpenAPI público (`api/platform/v1/openapi/route.ts`),
claves de API por empresa y webhooks salientes. Una app de Zapier con 3 triggers
y 3 actions es cuestión de días, no de meses, y es el atajo barato a «miles de
integraciones» sin escribir ninguna. **Esfuerzo: 1 semana.**

</details>

### 🟡 B-3 · Sin salud activa de las conexiones

`modules/connect/meta/salud.ts` existe, pero **ningún cron lo llama** (los tres
crons de `vercel.json` son automatizaciones, renovaciones de tarjeta e
integraciones). El estado de una conexión solo cambia cuando un envío falla —
salud pasiva.

Con Meta esto es concreto y está documentado en `docs/connect/meta-arquitectura.md`:
el token de usuario de larga duración caduca a los 60 días y `data_access_expires_at`
a los 90. Hoy eso se descubre cuando un mensaje no sale.

El estado `REAUTORIZAR` ya existe en el vocabulario (`catalogo.ts:detalleDe`) y
no hay nada que lo encienda a tiempo. **Esfuerzo: 3–4 días.**

### 🟡 B-4 · Faltan eventos que ya tienen nombre

`reserva.creada`, `reserva.pagada` y `venta.generada` están en el mapa v2 y no se
emiten. Y de los eventos que un integrador espera, no existen: cita
creada/movida/cancelada, pago recibido/fallido, mensaje entrante/saliente,
cliente actualizado, membresía cancelada/vencida.

`eventosDeProyeccionSinEmisor()` ya convierte esto en una lista visible en vez de
una sorpresa a los tres meses — buena decisión, pero la lista sigue sin vaciarse.
**Esfuerzo: 1–2 semanas.**

### ◐ B-5 · Editar clientes HECHO; cancelar citas y borrar, pendientes (17/09/2026)

> **Hecho, con una decisión de producto detrás.** La API ya no es solo lectura y
> alta: `PATCH /customers/{id}` edita la ficha de contacto de un cliente, y
> `GET /customers` la lista entera (paginada, B-6). El listado completa la R de
> CRUD y es lo que una sincronización con un CRM necesita.
>
> **El fork que se preguntó y cómo se resolvió:** ¿quién puede escribir
> clientes? La escritura de negocio estaba reservada a los satélites (necesitan
> saber qué sistema la respalda; un canje sin sistema no se audita). Se eligió
> «las dos, con scopes distintos»: el satélite conserva su **creación** auditada
> (`customers:write`, con idempotencia y canal de origen), y una clave de
> empresa —un Zapier— puede **editar** la ficha con un scope nuevo y separado,
> `customers:manage`. Editar no mueve valor, así que no necesita un sistema
> detrás; y ser un scope distinto impide que se confunda con la creación.
>
> **Detalles que costaban si se hacían mal:** ausente y vacío no son lo mismo
> (no mandar `phone` es «déjalo», mandar `phone:""` es «bórralo»); un teléfono o
> correo que ya es de otro cliente se rechaza con 409 para no partir un
> historial; y el `nombreBusqueda` no se toca —un trigger de la base lo
> recalcula, y escribirlo también aquí sería una segunda verdad que se olvida y
> rompe la búsqueda.
>
> **Sigue pendiente:** cancelar una cita (una máquina de estados propia, no un
> simple PATCH) y borrar un cliente (cascada + cumplimiento). Se dejaron fuera a
> propósito: cada una es su propio riesgo y merece su propia conversación.

<details>
<summary>El hallazgo original</summary>

### 🟡 B-5 · La API pública no puede modificar ni borrar

Solo `GET` y `POST`. Un integrador no puede actualizar un cliente, cancelar una
cita ni borrar nada. Para una API que se ofrece a terceros, eso obliga a
soluciones raras (crear duplicados) o simplemente cierra el caso de uso.
**Esfuerzo: 2–3 semanas** para los recursos principales.

</details>

### ✅ B-6 · Paginación por cursor — RESUELTO (17/09/2026)

> Cerrado. Los tres listados de colección que crecen sin techo —`appointments`,
> `memberships`, `promotions`— aceptan `?limit=` (defecto 50, máx 200) y
> `?cursor=`, y devuelven `page.nextCursor`. El tope silencioso de 500 citas se
> retiró: ahora un integrador con 3.000 citas las recorre todas, y «no hay más»
> deja de confundirse con «no cabe más».
>
> **Cursor y no `offset`:** una inserción entre página y página no descoloca lo
> ya leído. La condición para que eso funcione es un orden determinista, así que
> cada listado termina su `orderBy` en `id` — sin ese desempate, un cursor salta
> o repite una fila cuando dos citas caen a la misma hora. La lógica vive en un
> núcleo puro con pruebas, incluida una que pagina una lista entera de tres en
> tres y verifica que sale completa, en orden y sin dobles.
>
> **Lo que NO se paginó, a propósito:** `/vehicles` (exige `customerId`, es la
> lista de un cliente, no de la empresa) y los catálogos pequeños y acotados
> (`/branches`, `/vehicle-types`). Marcarlos paginados invitaría a recorrer una
> lista que nunca tendrá segunda página. El inventario lleva un flag `paginado`
> que dice cuáles sí, y el OpenAPI documenta los dos parámetros solo en ésos.
>
> **Riesgo controlado:** el SDK no consume estos tres como volcado completo
> (usa `/memberships/active?customerId` y `/vehicles?customerId`, ambos
> acotados), así que bajar el tope de 500 a 50 por defecto no rompe a ningún
> consumidor existente — solo hace explícito, con `nextCursor`, lo que antes se
> perdía en silencio.

<details>
<summary>El hallazgo original</summary>

### 🟡 B-6 · Sin paginación por cursor

Límites fijos y silenciosos: la búsqueda de clientes devuelve `MAX_BUSQUEDA`, las
citas `take: 500` sin decir que hay más. Un integrador con 3.000 citas en el mes
se lleva 500 y no se entera. **Esfuerzo: 1 semana.**

</details>

### 🟡 B-7 · Sin métricas de uso por credencial

`CredencialSistema.lastUsedAt` y `anotarUsoClave` son todo lo que hay. No hay
peticiones por día, por endpoint, ni tasa de error; ni para el integrador ni para
el superadmin. El propio hub de desarrolladores lo dice con honestidad
(«MembeGo no mide hoy esa señal», `desarrolladores/page.tsx:27`), que es la
actitud correcta y a la vez la confirmación del hueco. **Esfuerzo: 1 semana.**

### 🟡 B-8 · Deuda declarada de la migración expansiva

`SistemaConectado.categoria` y `SistemaConectado.activo` son legado vivo, con un
CHECK que impide que `activo` y `estado` se separen. Está bien gestionado y
documentado — pero la fase de contracción no está programada, y el
`leerCatalogo()` de `panel.ts:104` mantiene **dos rutas de lectura** (la nueva y
el `catch` con el esquema viejo) que habrá que recordar borrar.
**Esfuerzo: 2 días cuando toque.**

---

## 4. Seguridad: lo que sí y lo que no

| Control | Estado |
|---|---|
| Secretos hasheados/sellados | ✅ scrypt, AES-256-GCM con AAD y rotación de claves maestras |
| SSRF en webhooks salientes | ✅ `webhooksNucleo.ts:31` por nombre y rango, y `redirect: 'manual'` en los cinco caminos de salida |
| Aislamiento multiempresa | ✅ `conEmpresa`/`sinEmpresa` con motivo obligatorio, RLS con pruebas de cobertura |
| Uso único de token SSO | ✅ por clave primaria, sin ventana de carrera |
| Idempotencia de escrituras | ✅ `ClaveIdempotencia` con huella SHA-256 del cuerpo |
| Rate limit de la API | ✅ distribuido con Upstash, fail-open al local (`lib/rate-limit.ts:4`) |
| Firma Ed25519 a satélites | ✅ sobre `timestamp.eventId.cuerpo` |
| `appsecret_proof` a Meta | ✅ `meta/graph.ts:97` |
| Firma de webhooks de empresa | ✅ v2 sobre `timestamp.entregaId.cuerpo`, con la v1 en migración |
| Rotación de secretos | ◐ webhooks con solape de 7 días; el secreto de satélite, pendiente |
| **Rate limit de salida** | ❌ sin tope de concurrencia por empresa (A-6) |
| Caducidad de credenciales | ✅ se hace cumplir en las dos rutas; falta AVISAR antes de que venza |
| **Alerta de fuga de clave** | ❌ el prefijo `mbk_` es detectable por escáneres; no hay endpoint de revocación automática |

---

## 5. Comparación con GoHighLevel, capacidad por capacidad

Puntuación de 0 a 5 sobre lo que GHL ofrece hoy.

| Capacidad | MembeGo | GHL | Nota |
|---|:-:|:-:|---|
| Framework de catálogo de integraciones | **5** | 3 | MembeGo es mejor: una sola verdad, adaptadores de solo lectura |
| Aislamiento multiempresa | **5** | 4 | Razonado y probado; GHL lo tiene pero no lo documenta así |
| Contrato con verticales (SSO + eventos) | **5** | 1 | GHL no tiene este concepto. Es diferenciador de MembeGo |
| SDK oficial para integradores | **4** | 0 | `@membego/platform-sdk`; GHL no da SDK |
| Idempotencia y firma de eventos | **5** | 3 | Ed25519 + inbox a satélites, HMAC sobre material firmado a empresas (A-2 resuelto) |
| Documentación de la API | **3** | 4 | OpenAPI generado del inventario (no se queda viejo) vs. portal completo de GHL |
| **Número de integraciones nativas** | **1** | 5 | 5 reales vs. decenas |
| **Marketplace de apps de terceros** | **0** | 5 | No existe el concepto (A-3) |
| **Superficie de la API** | **4** | 5 | 29 rutas con GET/POST/PATCH/DELETE, listados paginados y un editar cliente; falta cancelar cita y borrar |
| **Catálogo de eventos** | **2** | 5 | 7 vs. ~35 |
| **Operación de webhooks (log, prueba, reenvío)** | **4** | 5 | Log, cuerpo, prueba con diagnóstico y reenvío (A-4 resuelto) |
| **Cadencia de reintentos** | **4** | 5 | 30 s → 24 h con jitter (A-1 resuelto) |
| Webhook entrante / acción HTTP en flujos | **4** | 5 | Circuito completo; falta el constructor de reglas con condiciones (B-1) |
| **SMS / telefonía** | **0** | 5 | No existe (A-8) |
| **Correo con dominio propio** | **0** | 5 | Resend de plataforma (A-9) |
| **Calendario bidireccional** | **1** | 5 | Solo escritura, solo Google (A-10) |
| **Pasarelas de pago** | **2** | 5 | CardNET + Azul (buen encaje local) vs. Stripe/PayPal/Square/NMI/Authorize |
| **Zapier / Make** | **4** | 5 | App de Zapier con REST Hooks; Make por OpenAPI (B-2) |
| **Métricas de uso de la API** | **1** | 4 | `lastUsedAt` (B-7) |
| **Salud activa de conexiones** | **1** | 4 | Pasiva (B-3) |

**Media ponderada ≈ 35 % de la superficie de GHL**, con una distribución muy
marcada: MembeGo **gana** en los cimientos y **pierde** en todo lo que es
volumen de conectores y operación diaria.

Dicho de otro modo: MembeGo ha construido bien los cimientos de un edificio de
veinte plantas y tiene levantadas siete. GHL tiene las veinte plantas con unos
cimientos que él mismo ha tenido que apuntalar sobre la marcha.

---

## 6. Qué hacer, en qué orden, y qué NO copiar

### Fase 1 · Operación (3–4 semanas) — cerrar los 🔴 y los 🟠 baratos

Sin esto, cada integración nueva multiplica los tickets de soporte.

| # | Trabajo | Días | Hallazgo |
|---|---|:-:|---|
| ~~1~~ | ~~Reintentos por QStash con backoff exponencial~~ ✅ hecho | 3 | A-1 |
| ~~2~~ | ~~Firmar `timestamp.deliveryId.cuerpo`, dos cabeceras en migración~~ ✅ hecho | 1 | A-2 |
| ~~3~~ | ~~Pantalla de entregas: log, cuerpo, reenviar, evento de prueba~~ ✅ hecho | 5 | A-4 |
| ~~4~~ | ~~Selector de eventos en el formulario~~ ✅ hecho | 1 | A-5 |
| ~~5~~ | ~~Fan-out encolado y en paralelo con tope~~ ✅ hecho | 2 | A-6 |
| ◐ 6 | Rotación con solapamiento — hecha para webhooks; queda el secreto de satélite | 4 | A-7 |
| 7 | Cron de salud: Meta, OAuth, caducidades → `REAUTORIZAR` | 3 | B-3 |

**Resultado: el módulo pasa de ~35 % a ~45 %** y —más importante— deja de
generar trabajo manual por cada cliente conectado.

### Fase 2 · Alcance (6–8 semanas) — que un tercero pueda integrar sin nosotros

| # | Trabajo | Semanas | Hallazgo |
|---|---|:-:|---|
| ~~8~~ | ~~Trigger de webhook entrante + acción HTTP a medida en flujos~~ ✅ hecho | 2 | B-1 |
| ~~9~~ | ~~App de Zapier sobre lo que ya existe~~ ✅ hecho (5 disparadores, 1 búsqueda) | 1 | B-2 |
| 10 | Catálogo de eventos hasta ~20 tipos (citas, pagos, mensajes) | 2 | B-4 |
| ◐ 11 | `PATCH` cliente + `GET` listado ✅ hecho · cancelar cita y borrar, pendientes | 2 | B-5 |
| ~~12~~ | ~~Paginación por cursor en las listas de colección~~ ✅ hecho | 1 | B-6 |
| 13 | Métricas de uso por credencial | 1 | B-7 |

**Resultado: ~58 %.** Aquí es donde la curva de valor por semana es más alta:
los puntos 8 y 9 juntos cuestan tres semanas y abren, en la práctica, la
conexión con cualquier herramienta que el cliente ya use.

### Fase 3 · Canales (8–10 semanas) — donde GHL cobra de verdad

| # | Trabajo | Semanas | Hallazgo |
|---|---|:-:|---|
| 14 | Calendario bidireccional (Google `watch` + `freeBusy`) | 3 | A-10 |
| 15 | SMS con proveedor y control de coste por empresa | 2 | A-8 |
| 16 | Correo con dominio propio por empresa | 3 | A-9 |
| 17 | Outlook / Microsoft 365 | 2 | A-10 |

**Resultado: ~72 %.**

### Fase 4 · Marketplace (10–14 semanas) — solo cuando haya demanda

El punto 18 es A-3: servidor OAuth propio, modelo de app, consentimiento,
instalación por empresa, revisión, webhooks por app. **Recomendación explícita:
no hacerlo todavía.** Un marketplace sin desarrolladores externos es un coste de
mantenimiento permanente a cambio de nada. La señal para empezarlo es tener
**tres terceros pidiendo integrar**, no una fecha.

### Lo que NO conviene copiar de GoHighLevel

1. **Su modelo de «snapshots» y subcuentas anidadas.** MembeGo tiene un modelo
   de empresa/sucursal más limpio; importarlo traería la complejidad sin el
   caso de uso de agencia.
2. **Su multiplicación de integraciones marginales.** GHL tiene conectores que
   nadie usa y que envejecen mal. Cinco integraciones que funcionan de verdad
   valen más que treinta tarjetas — y el framework actual ya lo tiene resuelto
   con la separación implementado/previsto.
3. **Su reventa de telefonía y correo (LC Phone, LC Email).** Es un negocio,
   no una integración, y trae con él soporte de portabilidad, cumplimiento y
   fraude. Conviene empezar con el proveedor a nombre del cliente.
4. **Traducir los identificadores de protocolo.** Ya está bien resuelto
   (`scopes.ts:10` en inglés, comentarios en español); no ceder en eso.

---

## 7. La respuesta corta a «¿qué tan lejos estamos?»

- **En arquitectura: no estamos lejos, estamos por delante.** Las decisiones de
  aislamiento, contrato y una-sola-verdad son mejores que las de GHL, y son
  justamente las que no se pueden añadir después.
- **En operación: estamos a media semana.** De los siete trabajos de la Fase 1,
  **A-1, A-2, A-4, A-5 y A-6 están cerrados** — entre ellos los que más caros salían
  por cliente conectado y el único con consecuencia de seguridad. Los
  reintentos pasaron de una vez al día a una escalera de 30 s a 24 h; «no me
  llegan los eventos» dejó de ser un ticket para ser una pantalla; la firma dejó
  de admitir un replay con el timestamp refrescado; una empresa puede por fin
  recibir solo lo que le interesa; rotar un secreto de webhook dejó de exigir un
  corte; y el barrido dejó de drenar su primer 6 % y parecer que funcionaba.
  Queda **B-3** (salud activa de las conexiones, 3 días) y la mitad de A-7 que
  falta: el secreto compartido con los satélites, que se separó porque toca la
  verificación de SSO en dos sitios y merece su propia revisión (2–3 días).

  Y dos cosas nuevas, pequeñas, que salieron al hacer el trabajo: avisar antes
  de que caduque una credencial de satélite, y sellar el secreto de webhook
  —hoy en claro por una razón que resultó ser falsa—.
- **En alcance de integraciones: el atajo ya está andado.** El webhook
  entrante, la acción HTTP y la app de Zapier (puntos 8 y 9) están hechos, y con
  ellos conectar MembeGo con algo que no hemos integrado a mano dejó de exigir
  que lo integremos a mano. Lo que queda de la Fase 2 son piezas de superficie
  de API que quedan: métricas de uso por credencial (B-7), el catálogo de
  eventos (B-4), y las dos piezas de B-5 que se dejaron fuera a propósito
  (cancelar cita, borrar cliente). La edición de clientes y la paginación ya
  están.

  La frase original decía que eran tres semanas de trabajo que hacen por la
  cobertura lo que treinta conectores harían en un año.
- **En marketplace de terceros: estamos lejos, y está bien estarlo** mientras no
  haya desarrolladores externos esperando.

