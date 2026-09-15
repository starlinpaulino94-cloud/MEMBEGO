import { validarUrlWebhook, type MotivoUrl } from '@/modules/connect/webhooksNucleo'

/**
 * NÚCLEO PURO de la ACCIÓN HTTP A MEDIDA (hallazgo B-1, segunda mitad).
 *
 * Sin red y sin Prisma: valida y normaliza lo que una automatización pide
 * llamar. Es la pieza con más superficie de abuso de todo el módulo, porque su
 * razón de ser es que NUESTRO servidor haga una petición a una dirección que
 * escribe otra persona. Todo lo que hay aquí existe para acotar eso.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ARREGLA
 *
 * `send_webhook` solo sabía repartir por las suscripciones ya creadas: el mismo
 * sobre, el mismo formato, a las direcciones de siempre. No había forma de
 * decir «cuando pase esto, llama a ESTA URL con ESTE cuerpo» — y sin eso,
 * cualquier herramienta que MembeGo no hubiera integrado a mano quedaba fuera
 * del alcance del usuario final.
 */

/** Verbos permitidos. `GET` y `DELETE` no llevan cuerpo; el resto sí. */
export const METODOS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export type Metodo = (typeof METODOS)[number]

/** Tope del cuerpo que se envía. Lo compone una plantilla, no un humano. */
export const MAX_CUERPO_BYTES = 32 * 1024

/** Cuántas cabeceras a medida caben. Más que esto es configurar un proxy. */
export const MAX_CABECERAS = 15

/** Cuánto se espera. El mismo que las entregas de webhook, y por lo mismo. */
export const TIMEOUT_MS = 10_000

/** Cuánto de la respuesta se guarda para que quien configuró pueda depurar. */
export const MAX_RESPUESTA = 500

/**
 * Cabeceras que la automatización NO puede poner.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS DOS FAMILIAS, Y LA SEGUNDA ES LA QUE IMPORTA
 *
 * Las de transporte (`host`, `content-length`, `connection`…) las gestiona el
 * cliente HTTP: dejarlas pasar produce peticiones malformadas o permite
 * confundir a un proxy intermedio sobre dónde acaba una petición y empieza la
 * siguiente.
 *
 * Y las NUESTRAS. Sin bloquear el prefijo `x-membego-`, una empresa podría
 * llamar a un tercero poniéndole `X-Membego-Signature` a mano y hacerle creer
 * que ese POST es un evento oficial firmado por MembeGo. No podría falsificar
 * la firma —no tiene el secreto—, pero sí un receptor que mire la cabecera sin
 * verificarla, que son más de los que a uno le gustaría.
 */
const CABECERAS_PROHIBIDAS = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'keep-alive',
  'upgrade',
  'te',
  'trailer',
  'expect',
])

const PREFIJO_PROPIO = 'x-membego-'

export function cabeceraProhibida(nombre: string): boolean {
  const n = nombre.trim().toLowerCase()
  return CABECERAS_PROHIBIDAS.has(n) || n.startsWith(PREFIJO_PROPIO)
}

export type MotivoLlamada =
  | 'sin_url'
  | 'metodo_invalido'
  | 'cabecera_prohibida'
  | 'demasiadas_cabeceras'
  | 'cuerpo_demasiado_grande'
  | `url_${MotivoUrl}`

export interface LlamadaValida {
  metodo: Metodo
  url: string
  cabeceras: Record<string, string>
  /** Ya serializado. `null` cuando el método no lleva cuerpo. */
  cuerpo: string | null
}

export type ResultadoValidacion =
  | { ok: true; llamada: LlamadaValida }
  | { ok: false; motivo: MotivoLlamada }

function normalizarMetodo(v: unknown): Metodo | null {
  const m = String(v ?? 'POST').trim().toUpperCase()
  return (METODOS as readonly string[]).includes(m) ? (m as Metodo) : null
}

/**
 * Valida los parámetros de la acción y devuelve la petición lista para salir.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA URL PASA POR LA MISMA GUARDIA QUE UN WEBHOOK SALIENTE
 *
 * `validarUrlWebhook` ya exige https y bloquea `localhost`, los rangos privados
 * y el servicio de metadatos de la nube. Escribir aquí una segunda validación
 * «parecida» sería la forma cómoda de que una de las dos se quedara corta — y
 * la que se quedara corta sería siempre la que menos se mira.
 *
 * Lo que esta guardia NO puede ver es a dónde REDIRIGE una URL pública. Eso se
 * corta al llamar, no al validar: ver `SIN_REDIRECCIONES` en el ejecutor.
 */
export function validarLlamada(params: Record<string, unknown>): ResultadoValidacion {
  const metodo = normalizarMetodo(params.method ?? params.metodo)
  if (!metodo) return { ok: false, motivo: 'metodo_invalido' }

  const bruto = params.url ?? params.direccion
  if (typeof bruto !== 'string' || !bruto.trim()) return { ok: false, motivo: 'sin_url' }

  const url = validarUrlWebhook(bruto)
  if (!url.ok) return { ok: false, motivo: `url_${url.motivo}` }

  const cabeceras: Record<string, string> = {}
  const pedidas = params.headers ?? params.cabeceras
  if (pedidas && typeof pedidas === 'object' && !Array.isArray(pedidas)) {
    const entradas = Object.entries(pedidas as Record<string, unknown>)
    if (entradas.length > MAX_CABECERAS) return { ok: false, motivo: 'demasiadas_cabeceras' }
    for (const [k, v] of entradas) {
      if (cabeceraProhibida(k)) return { ok: false, motivo: 'cabecera_prohibida' }
      // Se ignoran las vacías en vez de rechazar: una plantilla que interpola
      // `{{token}}` y no tiene valor produce una cadena vacía, y fallar la
      // llamada entera por una cabecera que no aporta sería desproporcionado.
      const valor = String(v ?? '').trim()
      if (valor) cabeceras[k.trim()] = valor
    }
  }

  // GET y DELETE sin cuerpo: mandarlo es legal en el estándar pero muchos
  // servidores lo descartan en silencio, y una llamada que «funciona» sin
  // hacer nada es peor que una que falla.
  let cuerpo: string | null = null
  if (metodo !== 'GET' && metodo !== 'DELETE') {
    const datos = params.body ?? params.cuerpo
    if (datos !== undefined && datos !== null) {
      cuerpo = typeof datos === 'string' ? datos : JSON.stringify(datos)
      if (Buffer.byteLength(cuerpo, 'utf8') > MAX_CUERPO_BYTES) {
        return { ok: false, motivo: 'cuerpo_demasiado_grande' }
      }
    }
  }

  return { ok: true, llamada: { metodo, url: url.url, cabeceras, cuerpo } }
}

/**
 * Por qué no se pudo llamar, en lenguaje de quien configuró la automatización.
 *
 * Acaba en la auditoría de la ejecución, que es donde alguien mira cuando su
 * regla «no hace nada». Un código de motivo a secas obligaría a buscarlo en el
 * código para saber qué arreglar.
 */
export function explicarMotivo(motivo: MotivoLlamada): string {
  switch (motivo) {
    case 'sin_url':
      return 'Falta la dirección a la que llamar.'
    case 'metodo_invalido':
      return `El método no es válido. Usa uno de: ${METODOS.join(', ')}.`
    case 'cabecera_prohibida':
      return 'Hay una cabecera que no se puede enviar: la gestiona el sistema o está reservada para MembeGo.'
    case 'demasiadas_cabeceras':
      return `No se pueden enviar más de ${MAX_CABECERAS} cabeceras.`
    case 'cuerpo_demasiado_grande':
      return `El cuerpo supera los ${MAX_CUERPO_BYTES} bytes.`
    case 'url_no_https':
      return 'La dirección debe empezar por https:// — por http los datos viajarían sin cifrar.'
    case 'url_host_interno':
      return 'No podemos llamar a direcciones internas o locales. Usa un dominio público.'
    case 'url_malformada':
      return 'Esa dirección no es válida.'
    case 'url_vacia':
      return 'Falta la dirección a la que llamar.'
    case 'url_demasiado_larga':
      return 'La dirección es demasiado larga.'
  }
}
