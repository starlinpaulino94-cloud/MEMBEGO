/**
 * META · lo que TAMBIÉN corre en el navegador (F14.1).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE ARCHIVO EXISTE, Y NO ES UN CAPRICHO DE ORGANIZACIÓN
 *
 * `metaNucleo.ts` usa `node:crypto` —para firmar el webhook y generar el PIN—
 * y el componente del diálogo es de CLIENTE. Importar el núcleo entero desde
 * él arrastraba `node:crypto` al paquete del navegador, y el build de
 * producción se caía con «Reading from "node:crypto" is not handled by
 * plugins». Ninguna prueba lo habría visto: solo el build.
 *
 * Lo que el navegador necesita —los orígenes de Meta, la lectura de sus
 * mensajes y el recolector que resuelve la carrera— no necesita criptografía.
 * `metaNucleo.ts` lo reexporta, así que el servidor sigue importando de un
 * solo sitio.
 */

/**
 * CUÁNTO VIVE EL CÓDIGO CANJEABLE. No es un detalle: es lo que obliga a que el
 * canje salga hacia el servidor EN CUANTO llega, sin esperar a que nadie pulse
 * «siguiente». Por eso el paso de Meta tiene su propia acción.
 */
export const TTL_CODIGO_MS = 30_000

/** Margen para no intentar canjear un código que ya casi seguro caducó. */
export const MARGEN_CANJE_MS = 3_000

/**
 * ORÍGENES OFICIALES de las ventanas de Meta, EXACTOS.
 *
 * Nada de comodines ni de `endsWith('.facebook.com')`: un dominio como
 * `evil-facebook.com` o `facebook.com.atacante.net` pasaría una comprobación
 * por sufijo mal escrita, y el mensaje que llega por ahí decide qué cuenta de
 * WhatsApp conectamos.
 *
 * Esta lista y la de `frame-src` en la CSP se mantienen iguales a propósito:
 * si un día se abre un origen en una y no en la otra, el mensaje llegaría y se
 * descartaría sin explicación.
 */
export const ORIGENES_META = ['https://www.facebook.com', 'https://web.facebook.com'] as const

export function origenDeMeta(origen: string): boolean {
  return (ORIGENES_META as readonly string[]).includes(origen)
}

// ─── Lo que devuelve el diálogo ──────────────────────────────────────────────

export interface RespuestaAlta {
  code: string
  wabaId: string
  phoneNumberId: string
}

export type LecturaRespuesta =
  | { ok: true; datos: RespuestaAlta }
  | { ok: false; motivo: 'incompleta' | 'formato' }

/**
 * Lee lo que el diálogo de Meta manda al navegador. Viene de una ventana
 * ajena, así que NADA se da por bueno: ni que sea un objeto, ni que los
 * campos sean cadenas, ni que no vengan vacíos.
 *
 * No valida el CONTENIDO —eso solo lo puede decir Meta al canjear— sino la
 * forma. Un código inventado fallará en el canje, que es donde tiene que
 * fallar.
 */
export function leerRespuestaAlta(bruto: unknown): LecturaRespuesta {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return { ok: false, motivo: 'formato' }
  const o = bruto as Record<string, unknown>
  const code = typeof o.code === 'string' ? o.code.trim() : ''
  const wabaId = typeof o.wabaId === 'string' ? o.wabaId.trim() : ''
  const phoneNumberId = typeof o.phoneNumberId === 'string' ? o.phoneNumberId.trim() : ''
  if (!code || !wabaId || !phoneNumberId) return { ok: false, motivo: 'incompleta' }
  // Los identificadores de Meta son numéricos. Rechazarlos aquí evita que una
  // cadena arbitraria acabe formando parte de una URL de la Graph API.
  if (!/^\d{1,32}$/.test(wabaId) || !/^\d{1,32}$/.test(phoneNumberId)) {
    return { ok: false, motivo: 'formato' }
  }
  return { ok: true, datos: { code, wabaId, phoneNumberId } }
}

/** ¿Llegó tarde? Un código de hace más de 30 segundos ya no sirve. */
export function codigoCaducado(emitidoEnMs: number, ahoraMs = Date.now()): boolean {
  return ahoraMs - emitidoEnMs > TTL_CODIGO_MS - MARGEN_CANJE_MS
}


// ─── El recolector: la carrera de los dos canales ────────────────────────────

/**
 * Junta lo que llega por los DOS canales de Meta y decide cuándo hay bastante
 * para enviar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ES UNA FUNCIÓN PURA Y NO UNA MARAÑA DE `useRef`
 *
 * Meta entrega el resultado por dos vías SIN ORDEN GARANTIZADO: el evento
 * `message` trae la cuenta y el número; la respuesta de `FB.login` trae el
 * código. La primera versión leía una desde el callback de la otra, dando por
 * hecho un orden que no existe — y cuando llegaba al revés, el alta fallaba
 * sin motivo visible.
 *
 * Sacándolo aquí, los cuatro casos que importan (código primero, mensaje
 * primero, evento duplicado, reinicio tras error) se PRUEBAN EJECUTÁNDOLOS en
 * vez de leyendo el componente.
 *
 * `aportar` devuelve la respuesta completa EXACTAMENTE UNA VEZ: Meta puede
 * emitir el mismo evento dos veces, y la segunda recibe null.
 */
export interface Recolector {
  aportar: (parcial: Partial<RespuestaAlta>) => RespuestaAlta | null
  reiniciar: () => void
}

export function crearRecolector(): Recolector {
  let datos: Partial<RespuestaAlta> = {}
  let enviado = false

  return {
    aportar(parcial) {
      datos = { ...datos, ...parcial }
      // El pestillo se comprueba DESPUÉS de acumular: un evento tardío sigue
      // completando el estado aunque ya no dispare nada.
      if (enviado) return null
      const { code, wabaId, phoneNumberId } = datos
      if (!code || !wabaId || !phoneNumberId) return null
      enviado = true
      return { code, wabaId, phoneNumberId }
    },
    reiniciar() {
      datos = {}
      enviado = false
    },
  }
}

/** Lo que un mensaje de la ventana de Meta significa para nosotros. */
export type MensajeMeta =
  | { tipo: 'seleccion'; wabaId?: string; phoneNumberId?: string }
  | { tipo: 'cancelado' }
  | { tipo: 'ignorar' }

/**
 * Lee un mensaje de `postMessage`. El ORIGEN se comprueba PRIMERO y contra la
 * lista cerrada: este mensaje decide qué cuenta de WhatsApp conectamos.
 */
export function leerMensajeMeta(origen: string, datos: unknown): MensajeMeta {
  if (!origenDeMeta(origen)) return { tipo: 'ignorar' }
  let cuerpo: unknown = datos
  if (typeof datos === 'string') {
    try {
      cuerpo = JSON.parse(datos)
    } catch {
      return { tipo: 'ignorar' }
    }
  }
  if (!cuerpo || typeof cuerpo !== 'object') return { tipo: 'ignorar' }
  const o = cuerpo as Record<string, unknown>
  if (o.type !== 'WA_EMBEDDED_SIGNUP') return { tipo: 'ignorar' }
  if (o.event === 'CANCEL') return { tipo: 'cancelado' }
  if (o.event === 'FINISH' || o.event === 'FINISH_ONLY_WABA') {
    const d = (o.data ?? {}) as Record<string, unknown>
    return {
      tipo: 'seleccion',
      wabaId: typeof d.waba_id === 'string' ? d.waba_id : undefined,
      phoneNumberId: typeof d.phone_number_id === 'string' ? d.phone_number_id : undefined,
    }
  }
  return { tipo: 'ignorar' }
}
