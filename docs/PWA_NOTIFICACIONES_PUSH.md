# MembeGo como app instalable (PWA) y notificaciones push en el navegador

MembeGo todavía no está en Google Play ni en la App Store. Mientras tanto, la
app se **instala desde el navegador** (PWA) y los avisos llegan **fuera de la
app** por Web Push: con el teléfono bloqueado, con MembeGo cerrado, igual que
una app de tienda. Este documento explica qué hay, cómo se configura y qué
límites tiene cada plataforma.

## 1. Instalar MembeGo en el dispositivo

### Qué ve la persona

- Al entrar en la landing o en la app aparece, a los pocos segundos, un aviso
  con un solo botón, **«Instalar MembeGo ahora»**, y sin más texto
  (`src/components/system/InstalarApp.tsx`, montado en el layout raíz).
  - **Android y escritorio** (Chrome, Edge, Samsung Internet): el botón abre
    el diálogo nativo del navegador.
  - **iPhone / iPad en Safari**: no existe diálogo. Al pulsar el botón se
    enseñan los dos pasos: Compartir → «Añadir a pantalla de inicio».
  - En navegadores de iOS que no pueden instalar (Instagram, Facebook, Chrome
    para iOS…) no se enseña nada: no hay forma de completarlo desde ahí.
- Cerrarlo con la X lo silencia 14 días. Instalada, no vuelve a salir.
- `/descargar` tiene el botón **«Instalar MembeGo ahora»** (`BotonInstalar`)
  y las instrucciones manuales por si el navegador no ofrece el diálogo.

### Cómo funciona por dentro

- `public/manifest.json` (nombre, iconos 192/512 + maskable, `display:
  standalone`) y `public/sw.js` (service worker) son los dos requisitos que
  Chrome exige para ofrecer la instalación.
- **Instalada, abre la app, no la landing.** `start_url` es `/cliente/inicio`:
  sin sesión el proxy lleva al login y, tras entrar, cada rol a su inicio (un
  administrador rebota a su panel). Los teléfonos que instalaron cuando
  arrancaba en `/` reciben el mismo trato: la portada, abierta en modo
  standalone, se sustituye por la app (`AbrirAppSiEstaInstalada`).
- Chrome dispara `beforeinstallprompt` **una sola vez** y puede hacerlo antes
  de que React hidrate. Un script inline en el `<head>` (`SCRIPT_INSTALACION`,
  en `src/lib/pwa/instalacion.ts`) lo captura y lo guarda; el resto de la app
  lo lee con `useInstalacion()`.
- El service worker se registra solo en producción (`RegistrarSW`), por las
  razones que explica ese componente. En `next dev` no hay instalación ni push.

## 2. Notificaciones fuera de la app (Web Push)

### Qué ve la persona

- Dentro de la app (cliente, panel y mostrador) aparece **«Entérate de todo,
  aunque no estés en la app»** con el botón «Activar notificaciones»
  (`src/components/system/NotificacionesPush.tsx`). El permiso del navegador se
  pide **solo desde ese botón**: pedirlo al cargar es la manera de que la gente
  lo bloquee, y un permiso bloqueado no se puede volver a pedir desde la web.
- Configuración del cliente → **«Notificaciones en este dispositivo»**: estado
  actual, activar o desactivar (`NotificacionesPushAjuste`).
- Cada aviso que ya llega a la campana (pago aprobado, comprobante nuevo,
  membresía por vencer, promoción…) sale también como notificación del
  sistema. Al tocarla se abre MembeGo en la ruta del aviso.

### Cómo funciona por dentro

| Pieza | Archivo |
| --- | --- |
| Claves VAPID y validación | `src/modules/notificaciones/web-push.ts` |
| Protocolo (JWT VAPID, cifrado RFC 8291 `aes128gcm`) sin dependencias | `src/modules/notificaciones/web-push/protocolo.ts` |
| Envío por los dos canales (Expo + Web Push) | `src/modules/notificaciones/push.ts` |
| Alta / baja del navegador | `src/app/api/v1/notificaciones/push-web/route.ts` |
| Suscripciones guardadas | tabla `web_push_suscripciones` (`WebPushSuscripcion`) |
| Pintado del aviso y clic | `public/sw.js` (`push`, `notificationclick`, `pushsubscriptionchange`) |
| Lado del navegador | `src/lib/pwa/push-cliente.ts`, `src/hooks/use-notificaciones-push.ts` |

Flujo: `crearNotificacion` / `notificarAdmins` / lotes del cron → `enviarPushNotificaciones` →
busca las suscripciones de los destinatarios → cifra `{ id, titulo, mensaje, href }` →
POST al servicio push del navegador (FCM, Mozilla, Apple) → el navegador despierta
`sw.js` → `showNotification`.

Reglas:

- **Fail-open.** Un aviso que no se puede entregar se anota en el log y quien
  llamó sigue. Nunca tumba un cobro ni un cron.
- **404 / 410** del servicio push = la persona revocó el permiso o desinstaló:
  la fila se borra. Insistir con endpoints muertos lleva a cuarentena en FCM.
- **Un navegador, un dueño.** La fila se guarda por `endpoint` (upsert). Al
  cerrar sesión la pantalla de entrada retira el endpoint del servidor
  (`OlvidarPushDeEsteNavegador`); al entrar de nuevo, `sincronizarPush` lo
  pone a nombre de la sesión actual sin volver a pedir permiso.
- **Solo desde nuestro origen.** La ruta no lleva CORS y rechaza `Origin` o
  `Sec-Fetch-Site` ajenos: si no, otra web podría registrar su endpoint bajo
  la cuenta de quien la visite y leer sus avisos.
- **Nada sensible en el aviso.** Va título, mensaje y ruta; igual que la
  campana. Nunca un número de tarjeta ni un token.

### Configuración (una vez)

```bash
node scripts/vapid-generar.mjs
```

Pega las tres líneas que imprime en el entorno (Vercel → Environment
Variables, y `.env.local` para probar):

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=…
VAPID_PRIVATE_KEY=…
VAPID_SUBJECT=mailto:soporte@membego.com
```

Y aplica la migración `20261091_web_push_suscripciones` antes del despliegue
(`bun run db:migrate:deploy`, ver `prisma/MIGRATIONS.md`).

**No regeneres las claves** salvo que se hayan filtrado: cambiarlas invalida
todas las suscripciones guardadas y cada persona tendrá que volver a activar
las notificaciones. Sin claves, la app funciona igual: no se ofrece activar
nada y los avisos siguen llegando a la campana y a la app nativa (Expo).

### Límites por plataforma

| Plataforma | Instalar | Push con la app cerrada |
| --- | --- | --- |
| Android · Chrome / Edge / Samsung | Diálogo nativo | Sí, también desde la pestaña del navegador |
| Escritorio · Chrome / Edge | Diálogo nativo | Sí |
| iPhone / iPad · Safari (iOS 16.4+) | Manual (Compartir → Añadir a inicio) | **Solo con MembeGo instalado en la pantalla de inicio**; en una pestaña de Safari no existe `PushManager` |
| iOS · Chrome / Instagram / Facebook… | No | No |
| Firefox | Sin diálogo en móvil | Sí |

En iPhone el aviso de notificaciones lo sabe: si no está instalada, en vez de
un botón que no puede funcionar enseña «Ver cómo instalar».

### Probar en producción

1. Entra con una cuenta, pulsa «Activar notificaciones», acepta el permiso.
2. Cierra la app (o bloquea el teléfono).
3. Provoca un aviso (un administrador aprueba un pago, o una promoción nueva
   para los seguidores) o usa Chrome DevTools → Application → Service Workers
   → «Push» con un JSON `{"titulo":"Hola","mensaje":"Prueba","href":"/cliente/inicio"}`.
4. Debe aparecer la notificación del sistema y, al tocarla, abrir la ruta.

Las pruebas automáticas (`bun run test`): `tests/web-push-protocolo.test.ts`
descifra lo que el servidor cifra haciendo de navegador;
`tests/push-web-api.test.ts` cubre la ruta, el service worker y el manifest.
