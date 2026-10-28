/* eslint-disable no-console */
/**
 * SERVICE WORKER DE MEMBEGO (auditoría · Fase 7, punto 28 · y Web Push).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PARA QUÉ EXISTE, EXACTAMENTE
 *
 * Para dos cosas:
 *
 *  1. Que el escáner de pista ABRA cuando no hay red. La cola sin conexión
 *     (`src/modules/scanner/colaOffline.ts`) guarda los lavados y los reenvía
 *     sola, pero eso solo sirve si la página llegó a cargar. Si el empleado
 *     abre el móvil sin cobertura y ve el dinosaurio del navegador, no hay
 *     cola que valga.
 *
 *  2. Que los avisos lleguen FUERA de la app (Web Push, sección del final).
 *     MembeGo no está en las tiendas: se instala desde el navegador (PWA) y
 *     el navegador despierta a este worker cuando el servidor envía un aviso,
 *     aunque la app esté cerrada o el teléfono bloqueado. Sin service worker
 *     no hay notificaciones push en la web, así que su registro también es
 *     la condición de esa función.
 *
 * No existe para "hacer la app más rápida" ni para cachear datos. Los datos de
 * MembeGo cambian cada minuto y servir una versión vieja de la lista de
 * clientes o del saldo de una membresía sería peor que no servir nada.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UN SERVICE WORKER MAL HECHO ES LA FORMA MÁS RÁPIDA DE ROMPER UN SITIO
 *
 * Y de romperlo de la peor manera: para los usuarios que ya lo visitaron, sin
 * que se arregle desplegando. Por eso aquí todo está inclinado hacia la
 * prudencia:
 *
 *  1. **RED PRIMERO para todo lo navegable.** La caché solo se usa si la red
 *     falló. Nunca se sirve un HTML viejo mientras haya conexión, así que un
 *     despliegue nuevo se ve al instante.
 *
 *  2. **Solo se interceptan peticiones GET del mismo origen.** Las server
 *     actions son POST y no pasan por aquí ni de lejos: interceptarlas sería
 *     la manera de perder un canje.
 *
 *  3. **`/api/` nunca se cachea.** Ni la salud, ni las métricas, ni nada.
 *
 *  4. **La versión está en el nombre de la caché.** Al activarse borra todas
 *     las que no sean la suya, así que subir `VERSION` limpia lo anterior.
 *
 *  5. **Interruptor de emergencia.** Si algún día este archivo hace daño, se
 *     sustituye su contenido por el de la sección "MATARSE" del final y con un
 *     despliegue se desregistra solo en todos los dispositivos.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const VERSION = 'v2'
const CACHE_ESTATICOS = `membego-estaticos-${VERSION}`
const CACHE_PAGINAS = `membego-paginas-${VERSION}`

/** Lo mínimo para que algo se pinte sin red. */
const PRECARGA = ['/offline', '/manifest.json', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE_ESTATICOS)
      // `addAll` falla entero si UNO de los recursos falla, y eso dejaría el
      // service worker sin instalar para siempre. Se piden de uno en uno y se
      // ignoran los que no estén.
      .then((cache) => Promise.all(PRECARGA.map((url) => cache.add(url).catch(() => {}))))
      // Toma el control sin esperar a que se cierren las pestañas abiertas. Es
      // lo que permite que una versión rota se reemplace rápido.
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nombres) =>
        Promise.all(
          nombres
            .filter((n) => n.startsWith('membego-') && !n.endsWith(VERSION))
            .map((n) => caches.delete(n))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request

  // Regla 2: solo GET del mismo origen. Todo lo demás pasa de largo.
  if (peticion.method !== 'GET') return

  let url
  try {
    url = new URL(peticion.url)
  } catch {
    return
  }
  if (url.origin !== self.location.origin) return

  // Regla 3: la API nunca se cachea.
  if (url.pathname.startsWith('/api/')) return

  // Los estáticos con huella (`/_next/static/...`) llevan el hash del
  // contenido en la ruta: si la ruta es la misma, el contenido es el mismo, así
  // que la caché no puede quedarse vieja. Aquí sí conviene caché primero.
  if (url.pathname.startsWith('/_next/static/') || /\.(png|svg|ico|webp|woff2?)$/.test(url.pathname)) {
    evento.respondWith(cachePrimero(peticion))
    return
  }

  // Navegaciones: red primero, caché como red de seguridad.
  if (peticion.mode === 'navigate') {
    evento.respondWith(redPrimero(peticion))
  }
})

async function cachePrimero(peticion) {
  const cache = await caches.open(CACHE_ESTATICOS)
  const guardado = await cache.match(peticion)
  if (guardado) return guardado
  try {
    const respuesta = await fetch(peticion)
    if (respuesta.ok) cache.put(peticion, respuesta.clone())
    return respuesta
  } catch (e) {
    // Un icono que falta no puede romper la página.
    return new Response('', { status: 504, statusText: 'sin conexión' })
  }
}

async function redPrimero(peticion) {
  const cache = await caches.open(CACHE_PAGINAS)
  try {
    const respuesta = await fetch(peticion)
    // Solo se guardan respuestas correctas: cachear un 500 lo perpetuaría.
    if (respuesta.ok) cache.put(peticion, respuesta.clone())
    return respuesta
  } catch {
    const guardado = await cache.match(peticion)
    if (guardado) return guardado
    const respaldo = await caches.match('/offline')
    if (respaldo) return respaldo
    return new Response('Sin conexión.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WEB PUSH — los avisos fuera de la app
 *
 * El servidor (`src/modules/notificaciones/web-push.ts`) cifra un JSON con
 * `{ id, titulo, mensaje, href }` y lo manda al servicio push del navegador;
 * este lo descifra y despierta al worker con el evento `push`. Aquí solo hay
 * que PINTARLO. Si llegara algo que no es JSON (una prueba desde DevTools), se
 * enseña igual con un texto genérico: un `push` que no muestra nada hace que
 * Chrome enseñe «Este sitio se actualizó en segundo plano» y retire el permiso
 * a la tercera vez.
 */
self.addEventListener('push', (evento) => {
  let datos = null
  try {
    datos = evento.data ? evento.data.json() : null
  } catch {
    datos = { titulo: 'MembeGo', mensaje: evento.data ? evento.data.text() : '' }
  }
  const titulo = (datos && datos.titulo) || 'MembeGo'
  const opciones = {
    body: (datos && datos.mensaje) || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // El mismo aviso dos veces (reintento del servidor) sustituye al anterior
    // en vez de apilarse.
    tag: datos && datos.id ? `membego-${datos.id}` : undefined,
    renotify: false,
    data: { href: (datos && datos.href) || '/', id: datos && datos.id },
  }
  evento.waitUntil(self.registration.showNotification(titulo, opciones))
})

/**
 * Al tocar el aviso: si MembeGo ya está abierto (pestaña o app instalada) se
 * trae al frente y se navega a la ruta del aviso; si no, se abre. `href` es
 * siempre una ruta RELATIVA de la propia app: aunque el servidor mandara otra
 * cosa, se recorta al mismo origen para que un aviso nunca saque a nadie de
 * MembeGo.
 */
self.addEventListener('notificationclick', (evento) => {
  evento.notification.close()
  const destino = new URL(
    typeof evento.notification.data?.href === 'string' && evento.notification.data.href.startsWith('/')
      ? evento.notification.data.href
      : '/',
    self.location.origin
  ).href
  evento.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (ventanas) => {
      const abierta = ventanas.find((v) => 'focus' in v)
      if (abierta) {
        await abierta.focus()
        if ('navigate' in abierta) return abierta.navigate(destino).catch(() => self.clients.openWindow(destino))
        return undefined
      }
      return self.clients.openWindow(destino)
    })
  )
})

/**
 * El servicio push puede caducar una suscripción y dar otra. Si no se avisa al
 * servidor, la persona deja de recibir avisos sin saber por qué. Se vuelve a
 * suscribir con la misma clave y se registra la nueva; la sesión viaja en la
 * cookie, así que no hace falta nada más.
 */
self.addEventListener('pushsubscriptionchange', (evento) => {
  const anterior = evento.oldSubscription
  const clave = (evento.newSubscription && evento.newSubscription.options.applicationServerKey) ||
    (anterior && anterior.options.applicationServerKey)
  if (!clave) return
  evento.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: clave })
      .then((nueva) =>
        fetch('/api/v1/notificaciones/push-web', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(nueva.toJSON()),
        })
      )
      .catch((e) => console.warn('[sw] no se pudo renovar la suscripción push:', e))
  )
})

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * MATARSE — interruptor de emergencia
 *
 * Si este service worker hace daño en producción, SUSTITUYE todo el contenido
 * de este archivo por lo siguiente y despliega. Cada dispositivo que abra la
 * app se limpiará y se desregistrará solo:
 *
 *   self.addEventListener('install', () => self.skipWaiting())
 *   self.addEventListener('activate', (e) => {
 *     e.waitUntil((async () => {
 *       for (const n of await caches.keys()) await caches.delete(n)
 *       await self.registration.unregister()
 *       for (const c of await self.clients.matchAll()) c.navigate(c.url)
 *     })())
 *   })
 *
 * Borrar el archivo NO sirve: los navegadores que ya lo tienen registrado
 * seguirían usando su copia.
 * ─────────────────────────────────────────────────────────────────────────────
 */
