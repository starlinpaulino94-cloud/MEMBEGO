'use client'

/**
 * NOTIFICACIONES PUSH · lo que hace el navegador.
 *
 * Tres pasos y todos tienen que salir bien para que un aviso llegue con la
 * app cerrada: permiso de la persona → suscripción en el servicio push del
 * navegador (con NUESTRA clave pública VAPID) → esa suscripción guardada en el
 * servidor (`POST /api/v1/notificaciones/push-web`). El envío lo hace el
 * servidor; el pintado, `public/sw.js`.
 *
 * iPhone: Safari solo expone `PushManager` cuando MembeGo está instalado en la
 * pantalla de inicio (iOS 16.4+). En una pestaña normal `soportado()` da
 * `false` y la UI enseña primero la guía de instalación.
 */

const RUTA = '/api/v1/notificaciones/push-web'

export type EstadoPush =
  | 'no-soportado'
  | 'no-configurado'
  | 'bloqueado'
  | 'activo'
  | 'inactivo'

export function pushSoportado(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

let clavePublicaCacheada: string | null | undefined

/** La clave pública VAPID del servidor; `null` si no hay push configurado. */
export async function clavePublicaServidor(): Promise<string | null> {
  if (clavePublicaCacheada !== undefined) return clavePublicaCacheada
  // Inlinada en el build cuando existe: evita un viaje a la red. Si no, se pregunta.
  const inlinada = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim()
  if (inlinada) {
    clavePublicaCacheada = inlinada
    return inlinada
  }
  try {
    const r = await fetch(RUTA, { credentials: 'same-origin' })
    const datos = (await r.json()) as { configurado?: boolean; clavePublica?: string | null }
    clavePublicaCacheada = datos.configurado && datos.clavePublica ? datos.clavePublica : null
  } catch {
    clavePublicaCacheada = null
  }
  return clavePublicaCacheada
}

/**
 * El service worker con el que suscribirse. En producción lo registra (la
 * llamada es idempotente: si `RegistrarSW` ya lo hizo, devuelve el mismo). En
 * desarrollo NO se registra —ver el porqué en `RegistrarSW`— y solo se usa si
 * ya existía.
 */
async function registroDelWorker(): Promise<ServiceWorkerRegistration | null> {
  if (process.env.NODE_ENV === 'production') {
    await navigator.serviceWorker.register('/sw.js')
    return navigator.serviceWorker.ready
  }
  return (await navigator.serviceWorker.getRegistration()) ?? null
}

function claveAUint8Array(base64url: string): Uint8Array {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const binario = atob(base64)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i)
  return bytes
}

export async function estadoPush(): Promise<EstadoPush> {
  if (!pushSoportado()) return 'no-soportado'
  if ((await clavePublicaServidor()) === null) return 'no-configurado'
  if (Notification.permission === 'denied') return 'bloqueado'
  if (Notification.permission !== 'granted') return 'inactivo'
  try {
    const registro = await navigator.serviceWorker.getRegistration()
    const suscripcion = await registro?.pushManager.getSubscription()
    return suscripcion ? 'activo' : 'inactivo'
  } catch {
    return 'inactivo'
  }
}

async function guardarEnServidor(suscripcion: PushSubscription): Promise<number> {
  const r = await fetch(RUTA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(suscripcion.toJSON()),
  })
  return r.status
}

export type ResultadoActivacion =
  | { ok: true }
  | { ok: false; motivo: 'no-soportado' | 'no-configurado' | 'bloqueado' | 'sin-worker' | 'sin-sesion' | 'error' }

/**
 * Pide el permiso (tiene que llamarse desde un clic), se suscribe y lo guarda.
 * Si ya había suscripción, la reutiliza y solo la vuelve a guardar: así un
 * navegador compartido queda a nombre de quien tiene la sesión ahora.
 */
export async function activarPush(): Promise<ResultadoActivacion> {
  if (!pushSoportado()) return { ok: false, motivo: 'no-soportado' }
  const clave = await clavePublicaServidor()
  if (!clave) return { ok: false, motivo: 'no-configurado' }

  const permiso = await Notification.requestPermission()
  if (permiso !== 'granted') return { ok: false, motivo: 'bloqueado' }

  try {
    const registro = await registroDelWorker()
    if (!registro) return { ok: false, motivo: 'sin-worker' }
    const suscripcion =
      (await registro.pushManager.getSubscription()) ??
      (await registro.pushManager.subscribe({
        userVisibleOnly: true,
        // Copia tipada: `BufferSource` en lib.dom no admite el `Uint8Array<ArrayBufferLike>` de TS 5.7+.
        applicationServerKey: claveAUint8Array(clave).buffer as ArrayBuffer,
      }))
    const status = await guardarEnServidor(suscripcion)
    if (status === 401) return { ok: false, motivo: 'sin-sesion' }
    if (status < 200 || status >= 300) return { ok: false, motivo: 'error' }
    return { ok: true }
  } catch (e) {
    console.warn('[push] no se pudo activar:', e)
    return { ok: false, motivo: 'error' }
  }
}

/**
 * Si el navegador ya está suscrito, vuelve a guardarlo a nombre de la sesión
 * actual. Barato y silencioso: se llama al entrar en la app, una vez por
 * sesión del navegador, para que cambiar de cuenta en el mismo teléfono no
 * deje los avisos a nombre de la cuenta anterior.
 */
export async function sincronizarPush(): Promise<void> {
  if (!pushSoportado() || Notification.permission !== 'granted') return
  try {
    const registro = await navigator.serviceWorker.getRegistration()
    const suscripcion = await registro?.pushManager.getSubscription()
    if (suscripcion) await guardarEnServidor(suscripcion)
  } catch {
    // Sin red o sin worker: se reintentará en la próxima visita.
  }
}

/** Retira la suscripción del navegador y del servidor. */
export async function desactivarPush(): Promise<boolean> {
  if (!pushSoportado()) return true
  try {
    const registro = await navigator.serviceWorker.getRegistration()
    const suscripcion = await registro?.pushManager.getSubscription()
    if (!suscripcion) return true
    await fetch(RUTA, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ endpoint: suscripcion.endpoint }),
    })
    await suscripcion.unsubscribe()
    return true
  } catch (e) {
    console.warn('[push] no se pudo desactivar:', e)
    return false
  }
}

/**
 * Sin sesión (pantalla de entrada): que este navegador deje de recibir los
 * avisos de la cuenta que se fue. Se llama desde el layout de autenticación,
 * que es adonde llega TODO cierre de sesión (y toda sesión caducada), así no
 * hay que tocar cada botón de «Cerrar sesión». La suscripción del navegador se
 * conserva: cuando alguien entre (la misma persona u otra), `sincronizarPush`
 * la pone a su nombre sin volver a pedir permiso.
 */
export async function olvidarPushDeEsteNavegador(): Promise<void> {
  if (!pushSoportado() || Notification.permission !== 'granted') return
  try {
    const registro = await navigator.serviceWorker.getRegistration()
    const suscripcion = await registro?.pushManager.getSubscription()
    if (!suscripcion) return
    await fetch(RUTA, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      keepalive: true,
      body: JSON.stringify({ endpoint: suscripcion.endpoint }),
    })
  } catch {
    // Sin red: el servidor retira el endpoint en cuanto deje de responder.
  }
}
