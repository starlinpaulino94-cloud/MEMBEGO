/**
 * NÚCLEO PURO de los webhooks ENTRANTES (hallazgo B-1).
 *
 * Sin Prisma, sin red y sin `server-only`: la forma del token, el nombre del
 * evento que se emite y qué cuerpos se aceptan. Las tres son decisiones de
 * contrato —viajan a la URL que alguien pega en su herramienta— y las tres se
 * prueban.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ES ESTO Y QUÉ NO ES
 *
 * Hasta ahora MembeGo solo sabía EMPUJAR: eventos hacia satélites y hacia los
 * webhooks que una empresa suscribe. No había ninguna forma de que algo de
 * fuera empujara hacia dentro, así que cualquier integración que MembeGo no
 * hubiera escrito a mano era imposible para el usuario final.
 *
 * Un webhook entrante es una URL secreta a la que una herramienta ajena hace
 * POST; lo que llega entra en el bus de eventos como `entrante.<slug>` y queda
 * guardado. A partir de ahí lo puede recoger una automatización suscrita a ese
 * evento — igual que recoge `cliente.visita`.
 *
 * NO convierte a quien llama en nadie: no crea clientes, no otorga beneficios y
 * no puede fingir un evento del negocio. Ver `nombreDeEvento`.
 */

/** Marca de agua de un token de webhook entrante. */
export const PREFIJO_ENTRANTE = 'whi_'

/** Caracteres del prefijo DESPUÉS de `whi_`. Largo fijo, como en las claves. */
const LARGO_PREFIJO = 12

/** Mínimo del secreto para que el token sea siquiera plausible. */
const LARGO_MINIMO_SECRETO = 32

/**
 * Tamaño máximo del cuerpo aceptado.
 *
 * Es una URL PÚBLICA: la conoce quien la pegue en su herramienta, y basta con
 * que se filtre en un log para que cualquiera pueda mandarnos lo que quiera.
 * Sin tope, un solo POST de cincuenta megas se guarda entero en `payload` y
 * viaja después por todo el bus de eventos. 64 KB caben de sobra en el aviso
 * más gordo que manda una herramienta real.
 */
export const MAX_CUERPO_BYTES = 64 * 1024

/** Prefijo de TODO evento que entra de fuera. Ver `nombreDeEvento`. */
export const ESPACIO_ENTRANTE = 'entrante.'

export interface TokenPartido {
  /** `whi_a1b2c3d4e5f6` — la mitad pública, la que localiza la fila. */
  prefijo: string
  /** La mitad que se compara contra el hash. Nunca se guarda ni se registra. */
  secreto: string
}

/**
 * Parte un token de la URL en sus dos mitades.
 *
 * Misma forma que las claves de API, y por el mismo motivo: el prefijo es
 * público e indexado —localiza la fila con un índice único, sin probar hashes
 * contra la tabla entera— y del secreto solo se guarda su hash. Un volcado de
 * la tabla no permite mandarle eventos a nadie.
 *
 * Que la URL sea el credencial es lo normal en un webhook entrante (es lo que
 * hacen las herramientas contra las que esto se va a integrar), pero que lo sea
 * NO obliga a guardarla en claro.
 */
export function partirToken(bruto: string | null | undefined): TokenPartido | null {
  const v = (bruto ?? '').trim()
  if (!v.startsWith(PREFIJO_ENTRANTE)) return null

  const punto = v.indexOf('.')
  if (punto <= 0) return null

  const prefijo = v.slice(0, punto)
  const secreto = v.slice(punto + 1)

  if (prefijo.length !== PREFIJO_ENTRANTE.length + LARGO_PREFIJO) return null
  if (!/^[a-z0-9]+$/.test(prefijo.slice(PREFIJO_ENTRANTE.length))) return null
  if (secreto.length < LARGO_MINIMO_SECRETO) return null

  return { prefijo, secreto }
}

/** Las dos mitades juntas, para enseñar la URL una sola vez. */
export function componerToken(prefijo: string, secreto: string): string {
  return `${prefijo}.${secreto}`
}

/**
 * Identificador estable derivado del nombre que le puso la empresa.
 *
 * Se calcula UNA vez, al crear, y no vuelve a tocarse aunque el nombre cambie:
 * el slug viaja dentro del nombre del evento, y renombrar el webhook no puede
 * dejar mudas a las automatizaciones que ya lo escuchaban.
 */
export function slugDeNombre(nombre: string): string {
  const s = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return s || 'entrada'
}

/**
 * El evento que se emite al bus.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL ESPACIO `entrante.` NO ES COSMÉTICO
 *
 * Es lo que impide que un POST de fuera se haga pasar por un hecho del negocio.
 * Si esta función pudiera devolver `cliente.visita`, cualquiera con la URL
 * —que es un secreto, pero un secreto que viaja en texto por la configuración
 * de una herramienta de terceros— podría inventar visitas, disparar
 * beneficios y meter datos falsos en los satélites de otras empresas.
 *
 * Con el prefijo, lo que entra de fuera está SIEMPRE marcado como tal, y una
 * automatización que lo escuche lo hace a sabiendas.
 */
export function nombreDeEvento(slug: string): string {
  return `${ESPACIO_ENTRANTE}${slug}`
}

/** ¿Este evento entró de fuera? Lo pregunta el reparto a webhooks salientes. */
export function esEventoEntrante(tipo: string): boolean {
  return tipo.startsWith(ESPACIO_ENTRANTE)
}

export type MotivoRechazo = 'cuerpo_vacio' | 'json_invalido' | 'no_es_objeto' | 'demasiado_grande'

export type CuerpoAceptado =
  | { ok: true; datos: Record<string, unknown> }
  | { ok: false; motivo: MotivoRechazo }

/**
 * ¿Se acepta este cuerpo?
 *
 * Se exige un OBJETO JSON, no un array ni un número suelto. No es rigidez: el
 * payload se reparte por el bus y el despachador lo esparce en la raíz del
 * contexto de la automatización (`{ ...payload }`), así que un array llegaría
 * como una lista de índices numerados y una cadena como un montón de letras
 * sueltas. Mejor decir que no con una frase clara que aceptar algo que va a
 * comportarse raro tres pasos más allá.
 */
export function aceptarCuerpo(crudo: string): CuerpoAceptado {
  if (Buffer.byteLength(crudo, 'utf8') > MAX_CUERPO_BYTES) {
    return { ok: false, motivo: 'demasiado_grande' }
  }
  const v = crudo.trim()
  if (!v) return { ok: false, motivo: 'cuerpo_vacio' }

  let datos: unknown
  try {
    datos = JSON.parse(v)
  } catch {
    return { ok: false, motivo: 'json_invalido' }
  }
  if (datos === null || typeof datos !== 'object' || Array.isArray(datos)) {
    return { ok: false, motivo: 'no_es_objeto' }
  }
  return { ok: true, datos: datos as Record<string, unknown> }
}

/** Qué se le contesta a la herramienta que llama. En inglés: es una API. */
export const MENSAJE_RECHAZO: Record<MotivoRechazo, string> = {
  cuerpo_vacio: 'Request body is empty. Send a JSON object.',
  json_invalido: 'Request body is not valid JSON.',
  no_es_objeto: 'Request body must be a JSON object, not an array or a scalar.',
  demasiado_grande: `Request body exceeds ${MAX_CUERPO_BYTES} bytes.`,
}
