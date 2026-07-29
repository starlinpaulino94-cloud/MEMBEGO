import { createHmac, timingSafeEqual, createHash } from 'crypto'

/**
 * CLIENTE DE QSTASH POR REST — sin SDK, igual que el limitador de peticiones.
 *
 * QStash es la cola de Upstash. Se publica un mensaje HTTP y QStash lo entrega
 * a nuestro endpoint de trabajos, con reintentos y espera exponencial. Nos sirve
 * porque no hay proceso persistente donde correr un worker: en serverless, la
 * "cola" tiene que ser alguien de fuera que nos vuelva a llamar.
 *
 * Sin SDK a propósito: una dependencia más es una superficie más que auditar y
 * actualizar, y aquí solo hacen falta `fetch` y `crypto`.
 */

export function qstashConfigurado(): boolean {
  return !!process.env.QSTASH_TOKEN
}

/** Base pública de la aplicación, para que QStash sepa a dónde devolver. */
function destino(ruta: string): string {
  const base =
    process.env.QSTASH_TARGET_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : '')
  return `${base.replace(/\/$/, '')}${ruta}`
}

export interface OpcionesPublicar {
  /** Segundos de espera antes de la primera entrega. */
  retrasoS?: number
  /**
   * Clave de deduplicación. QStash descarta un mensaje repetido con la misma
   * clave dentro de su ventana. Es lo que evita que un reintento del cron
   * mande dos veces la misma tanda de notificaciones.
   */
  deduplicationId?: string
  /** Reintentos antes de darse por vencido (por defecto los de QStash). */
  reintentos?: number
}

/**
 * Publica un mensaje. Devuelve `false` si QStash no está configurado, para que
 * quien llama decida qué hacer (normalmente: ejecutarlo en línea).
 */
export async function publicar(
  ruta: string,
  cuerpo: unknown,
  opciones: OpcionesPublicar = {}
): Promise<boolean> {
  const token = process.env.QSTASH_TOKEN
  if (!token) return false

  const url = destino(ruta)
  if (!url.startsWith('http')) {
    console.error('[qstash] sin URL de destino: define QSTASH_TARGET_URL o NEXT_PUBLIC_APP_URL')
    return false
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  if (opciones.retrasoS) headers['Upstash-Delay'] = `${opciones.retrasoS}s`
  if (opciones.deduplicationId) headers['Upstash-Deduplication-Id'] = opciones.deduplicationId
  if (opciones.reintentos != null) headers['Upstash-Retries'] = String(opciones.reintentos)

  try {
    const res = await fetch(`https://qstash.upstash.io/v2/publish/${url}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(cuerpo),
    })
    if (!res.ok) {
      console.error('[qstash] publish falló:', res.status, await res.text().catch(() => ''))
      return false
    }
    return true
  } catch (e) {
    console.error('[qstash] publish error:', e)
    return false
  }
}

// ── Verificación de la firma ─────────────────────────────────────────────────

/**
 * QStash firma cada entrega con un JWT (HS256) en `Upstash-Signature`.
 *
 * POR QUÉ SE VERIFICA Y NO BASTA UN SECRETO EN LA CABECERA: el endpoint de
 * trabajos es público (tiene que serlo, QStash lo llama desde fuera) y ejecuta
 * escrituras masivas — notificar a todos los clientes de una empresa. Un
 * secreto compartido se filtra en un log y ya no hay vuelta atrás; la firma,
 * además, ata el mensaje a SU CUERPO: cambiar el `companyId` de la petición
 * invalida la firma.
 *
 * Se comprueban las dos claves (actual y siguiente) porque Upstash las rota:
 * durante la rotación conviven mensajes firmados con una y con otra.
 */
export function verificarFirma(token: string | null, cuerpoCrudo: string): boolean {
  if (!token) return false
  const claves = [
    process.env.QSTASH_CURRENT_SIGNING_KEY,
    process.env.QSTASH_NEXT_SIGNING_KEY,
  ].filter((k): k is string => !!k)
  if (claves.length === 0) return false

  return claves.some((clave) => verificarConClave(token, cuerpoCrudo, clave))
}

function b64urlABuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function verificarConClave(token: string, cuerpoCrudo: string, clave: string): boolean {
  try {
    const partes = token.split('.')
    if (partes.length !== 3) return false
    const [cabecera, carga, firma] = partes

    const esperada = createHmac('sha256', clave)
      .update(`${cabecera}.${carga}`)
      .digest()
    const recibida = b64urlABuffer(firma)
    // Comparación en tiempo constante: comparar con === filtra información
    // sobre cuántos bytes coinciden y permite ir adivinando la firma.
    if (recibida.length !== esperada.length) return false
    if (!timingSafeEqual(recibida, esperada)) return false

    const claims = JSON.parse(b64urlABuffer(carga).toString('utf8')) as {
      exp?: number
      nbf?: number
      body?: string
    }
    const ahora = Math.floor(Date.now() / 1000)
    // Margen de 60 s por el desfase de reloj entre máquinas.
    if (claims.exp != null && claims.exp < ahora - 60) return false
    if (claims.nbf != null && claims.nbf > ahora + 60) return false

    // El claim `body` es el sha256 del cuerpo en base64url. Sin esta
    // comprobación, una firma válida capturada de un mensaje serviría para
    // ejecutar OTRO cuerpo distinto.
    if (claims.body) {
      const hash = createHash('sha256').update(cuerpoCrudo).digest('base64url')
      const esperadoBody = claims.body.replace(/=+$/, '')
      if (hash !== esperadoBody) return false
    }
    return true
  } catch {
    return false
  }
}
