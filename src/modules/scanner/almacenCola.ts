import type { Pendiente } from '@/modules/scanner/colaOffline'

/**
 * PERSISTENCIA DE LA COLA SIN CONEXIÓN (Fase 7, punto 28).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ `localStorage` Y NO IndexedDB
 *
 * IndexedDB es la respuesta "correcta" de manual y aquí sería peor. La cola
 * son unas pocas decenas de entradas de texto en el peor día imaginable —una
 * caída de red de una hora en un car wash lleno— y eso son unos pocos KB
 * contra el límite de 5 MB. A cambio, IndexedDB traería una API asíncrona con
 * transacciones, versiones de esquema y migraciones para guardar un array.
 *
 * Además, `localStorage` es síncrono, y en este caso concreto eso es una
 * VENTAJA y no un defecto: la escritura ocurre en el mismo instante en que el
 * empleado pulsa "confirmar", antes de que la pantalla cambie. Con una API
 * asíncrona existe una ventana —pequeña, real— en la que el móvil se bloquea o
 * la pestaña muere entre el "confirmar" y el guardado. Perder ahí una entrada
 * es perder el registro de un lavado.
 *
 * DÓNDE DEJA DE SERVIR, escrito por adelantado para que nadie lo descubra
 * tarde: si algún día el escáner tiene que guardar FOTOS sin conexión (las
 * evidencias antes/después), esto se queda corto —los blobs no caben y no se
 * serializan a texto— y hay que pasar a IndexedDB. Ese día, lo único que
 * cambia es este archivo: la política vive en `colaOffline.ts` y no sabe dónde
 * se guarda nada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TODO LO DE AQUÍ FALLA EN SILENCIO
 *
 * `localStorage` lanza en navegación privada de iOS, con la cuota llena y con
 * las cookies de terceros bloqueadas en algunos WebView. Un escáner que
 * revienta porque no pudo guardar su cola es peor que un escáner sin cola: se
 * degrada al comportamiento anterior —el envío directo— y sigue funcionando.
 * ────────────────────────────────────────────────────────────────────────────
 */

const CLAVE = 'membego.scanner.cola'

/** ¿Se puede usar el almacenamiento en este navegador? */
export function almacenDisponible(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false
    const sonda = '__membego_sonda__'
    window.localStorage.setItem(sonda, '1')
    window.localStorage.removeItem(sonda)
    return true
  } catch {
    return false
  }
}

/**
 * Lee la cola guardada.
 *
 * Descarta las entradas con forma inesperada en vez de fallar entera: una
 * versión anterior del formato, o un valor a medio escribir, no puede impedir
 * que se reenvíen las demás.
 */
export function leerCola(): Pendiente[] {
  try {
    const crudo = window.localStorage.getItem(CLAVE)
    if (!crudo) return []
    const datos: unknown = JSON.parse(crudo)
    if (!Array.isArray(datos)) return []
    return datos.filter(esPendiente)
  } catch {
    return []
  }
}

export function guardarCola(cola: Pendiente[]): void {
  try {
    window.localStorage.setItem(CLAVE, JSON.stringify(cola))
  } catch {
    /* cuota llena o almacenamiento bloqueado: se sigue sin persistir */
  }
}

export function borrarCola(): void {
  try {
    window.localStorage.removeItem(CLAVE)
  } catch {
    /* nada que hacer */
  }
}

function esPendiente(x: unknown): x is Pendiente {
  if (typeof x !== 'object' || x === null) return false
  const p = x as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    (p.tipo === 'visita' || p.tipo === 'canje') &&
    typeof p.creadoEn === 'number' &&
    typeof p.intentos === 'number' &&
    typeof p.proximoIntento === 'number' &&
    typeof p.datos === 'object' &&
    p.datos !== null &&
    (p.estado === 'pendiente' ||
      p.estado === 'enviando' ||
      p.estado === 'enviada' ||
      p.estado === 'descartada')
  )
}
