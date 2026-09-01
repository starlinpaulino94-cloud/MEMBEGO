# WhatsApp · Alta Incrustada de Meta (Embedded Signup)

> **Investigación de la Fase 14**, hecha el 1 de septiembre de 2026 contra la
> documentación pública vigente de Meta.
>
> **Cómo leer la confianza de cada dato.** El proxy de red de este entorno
> bloquea el acceso directo a `developers.facebook.com`, así que lo de abajo
> sale de los **resúmenes indexados de sus páginas oficiales**, no de haber
> leído las páginas enteras. Es material de Meta, no de terceros ni de
> memoria — pero antes de comprometer una fecha con un cliente, confirme en el
> panel real las tres líneas marcadas con ⚠.
>
> Sustituye a la versión anterior de este documento, que estaba escrita de
> memoria y **contenía un error de fondo**: daba la Verificación de Negocio y
> la Revisión de la App por bloqueantes absolutas. No lo son.

---

## 1. La conclusión que cambia el plan

**No hace falta Verificación de Negocio ni Revisión de la App para empezar.**

Meta permite dar de alta **hasta 10 clientes nuevos cada 7 días** sin nada de
eso. Completando Verificación de Negocio + Revisión de la App + Verificación
de Acceso, el límite sube a **200 cada 7 días**.

Esto invalida la recomendación que le di en la Fase 10, donde presenté el
trámite como un muro de semanas antes de poder probar una línea. No lo es: es
un límite de escala, no una puerta cerrada. Con 10 altas por semana, Membego
puede lanzar la experiencia buena desde el principio y hacer el trámite en
paralelo, según crezca.

**Y además:** la Verificación de Acceso ya **no** es necesaria para ser
Proveedor Técnico (Tech Provider). Meta la retiró de ese requisito.

---

## 2. Fecha límite que sí aprieta ⚠

**La versión 2 del Alta Incrustada se retira el 15 de octubre de 2026.**

Hoy es 1 de septiembre de 2026: quedan unas seis semanas. La versión vigente
es la **v4**, que además unifica el alta de varios productos (Cloud API,
Marketing Messages Lite, anuncios que abren WhatsApp, Conversions API).

Consecuencia práctica: **cualquier cosa que construyamos tiene que ser v4
desde el primer día**. Construir contra v2 sería trabajo con fecha de
caducidad conocida.

---

## 3. Requisitos, uno a uno

| Requisito | ¿Obligatorio para empezar? | Quién lo hace |
|---|---|---|
| Ser **Proveedor Técnico** (Tech Provider) o Solution Partner | **Sí** | MembeGo |
| Verificación de Negocio con Meta | No para empezar; sí para pasar de 10 altas/7 días | MembeGo |
| Revisión de la App (acceso avanzado) | No para empezar; sí para pasar de 10 altas/7 días | Meta aprueba |
| Verificación de Acceso | **Ya no se exige** para ser Proveedor Técnico | — |
| App de tipo Business | Sí | MembeGo |
| Configuración de **Inicio de Sesión de Facebook para Empresas** | Sí — de ahí sale el `Configuration ID` que invoca el diálogo | MembeGo |
| Endpoint de webhooks funcionando | Sí | MembeGo (ya lo tenemos) |
| Suscripción al webhook **`account_update`** | **Sí** — es el que avisa de que un cliente completó el alta | MembeGo |
| Certificado SSL válido en el dominio que lanza el alta | Sí (ya lo tenemos) | — |
| Dominio en **«Allowed domains»** y **«Valid OAuth redirect URIs»** | Sí | MembeGo |
| Método de pago del **cliente** en su cuenta de WhatsApp Business | Sí, tras el alta | Cada empresa |
| Cuenta de WhatsApp Business y número | Sí | Cada empresa |

### Permisos que hay que pedir

- `whatsapp_business_management` — para leer y administrar la cuenta de
  WhatsApp Business del cliente y sus plantillas.
- `whatsapp_business_messaging` — para la configuración del número y para
  enviar y recibir mensajes.

Meta avisa de que **pedir permisos de más es una causa habitual de rechazo**
en la revisión. Pedimos exactamente esos dos.

Las apps de tipo Business tienen **acceso estándar** aprobado automáticamente;
el **acceso avanzado** —el que hace falta para que la usen otras empresas a
escala— es lo que se pide en la Revisión de la App.

---

## 4. Lo que Meta exige de la revisión, cuando toque

No es papeleo trivial y conviene saberlo antes:

- Una **explicación escrita y un vídeo por CADA permiso**, por separado. No se
  admite un vídeo que cubra varios permisos.
- El vídeo tiene que grabar **la interfaz que ve la empresa**, no la del
  consumidor final.
- Hace falta un **prototipo funcionando** para poder grabarlo.
- Una entrega en borrador **no se revisa**.

Traducido: la Revisión de la App se hace **después** de que F14 esté
construida y funcionando, no antes. Otro motivo para no tratarla como un
bloqueo previo.

---

## 5. Cómo funciona el flujo, y qué nos obliga a hacer

1. La empresa pulsa el botón en Membego.
2. Se abre el diálogo de Meta (SDK de JavaScript, con el `Configuration ID`).
3. Al terminar, Meta devuelve **a la ventana que lo abrió**: el `WABA ID`, el
   `phone number ID` y un **código canjeable**.
   · Solo si el dominio de esa página está en «Allowed domains» y «Valid OAuth
   redirect URIs».
4. **El código vive 30 SEGUNDOS.** ⚠
5. El servidor canjea el código por un **token de negocio** del cliente
   (Business Integration System User access token).
6. Y en la misma ida y vuelta hay que: **registrar el número** del cliente para
   Cloud API, y **suscribir nuestra app a los webhooks** de su cuenta.

### Lo que esos 30 segundos significan para nuestra arquitectura

Es el dato técnico más importante de toda la investigación, y encaja bien con
lo que ya construimos:

- El canje **no puede** esperar a que la persona pulse «siguiente». Tiene que
  salir del navegador hacia nuestro servidor **en cuanto llega el código**.
- El paso de Meta, por tanto, **no puede ser un paso de formulario** del
  asistente: tiene que ser el paso de tipo `COMPONENTE` que ya existe, con su
  propia acción de servidor que canjea de inmediato.
- Y encaja con la regla que ya sostiene el alta: el paso se da por cumplido
  **porque la credencial existe** (`cumpleCon: 'autorizado'`), no porque
  alguien apuntara que pasó por ahí. Si el canje falla, el paso simplemente
  sigue sin cumplirse y la persona reintenta.

También hay **anulaciones de webhook** por cuenta o por número, por si un día
hace falta separar destinos.

---

## 6. Lo que esto le cuesta al cliente, y hay que decírselo

**Cada empresa que se dé de alta tendrá que poner su propio método de pago** en
su cuenta de WhatsApp Business. Meta le factura a ella el uso de la API;
Membego factura lo suyo aparte.

No es un detalle técnico: es una conversación comercial que hay que tener
**antes** de enseñarle el botón a un cliente, y probablemente una frase en la
pantalla de requisitos del asistente.

---

## 7. Qué cambia en nuestro código cuando se apruebe

Poco, y está diseñado así desde la Fase 10.

En `src/modules/connect/proveedores/whatsapp.ts`, el paso `credencial`
—hoy `COMPONENTE` con `AltaWhatsapp`— pasa a apuntar al componente del alta
incrustada, y `autorizacion` pasa de `{ tipo: 'API_KEY', patron: 'CREDENCIAL' }`
a `{ tipo: 'OAUTH2', patron: 'POPUP' }`.

El patrón es **POPUP** y no REDIRECCIÓN porque el alta incrustada no es una
redirección OAuth normal: es un diálogo del SDK que devuelve el resultado a la
ventana que lo abrió.

**No cambia nada más.** El token acaba en la misma credencial sellada
(`credenciales_conexion`, AES-256-GCM con AAD por fila), así que el envío, la
salud, las automatizaciones, los webhooks y la bitácora no se enteran de que
el origen del secreto cambió. Es exactamente la costura que la Fase 12 dejó
preparada.

Lo que sí es **nuevo código**: el canje servidor-a-servidor en 30 segundos, el
registro del número, la suscripción a los webhooks de la cuenta del cliente, y
una ruta que reciba `account_update`.

---

## Fuentes

- [Embedded Signup · Overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/)
- [Embedded Signup · Implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation)
- [Embedded Signup · Version 4](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4)
- [Become a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers)
- [Onboarding business customers as a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider)
- [App Review](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review)
- [Managing webhooks](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/manage-webhooks)
- [Access Tokens Guide](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/)
- [Changelog](https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog)
