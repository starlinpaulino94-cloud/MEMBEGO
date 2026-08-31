import { NextResponse, type NextRequest } from 'next/server'
import { verificarFirma } from '@/lib/jobs/qstash'
import { registrarTrabajoMuerto } from '@/modules/jobs/muertos'
import { registrarEvento } from '@/modules/observabilidad/eventos'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * FAILURE CALLBACK de QStash: aquí llegan los trabajos DIFUNTOS — los que
 * agotaron sus reintentos contra `/api/jobs` (Membego Connect · Fase 2).
 *
 * Misma guardia que el ejecutor: el endpoint es público por necesidad y lo
 * primero es verificar la firma sobre el cuerpo CRUDO. Un difunto falsificado
 * no ejecuta nada, pero sí acabaría reencolado por un humano desde el panel —
 * que es una ejecución con un paso intermedio.
 *
 * El cuerpo del callback es de QStash, no nuestro: trae el mensaje ORIGINAL en
 * `sourceBody` (base64) más el estado del último intento. Se decodifica, se
 * valida que sea una carga conocida y se registra. Idempotente por
 * `sourceMessageId`: el callback también se reintenta.
 */

interface CallbackFallo {
  sourceMessageId?: string
  /** Base64 del cuerpo ORIGINAL del mensaje (la carga del trabajo). */
  sourceBody?: string
  /** Estado HTTP del último intento contra /api/jobs. */
  status?: number
  /** Base64 del cuerpo de la última respuesta. */
  body?: string
  retried?: number
  maxRetries?: number
}

function decodificarBase64(v: string | undefined): string | null {
  if (!v) return null
  try {
    return Buffer.from(v, 'base64').toString('utf8')
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  if (!process.env.QSTASH_CURRENT_SIGNING_KEY) {
    return NextResponse.json({ error: 'Cola no configurada en este entorno.' }, { status: 503 })
  }

  const cuerpoCrudo = await request.text()
  const firma = request.headers.get('upstash-signature')
  if (!verificarFirma(firma, cuerpoCrudo)) {
    registrarEvento({ dominio: 'cola', accion: 'difunto', ok: false, motivo: 'firma_invalida' })
    return NextResponse.json({ error: 'Firma no válida.' }, { status: 401 })
  }

  let callback: CallbackFallo
  try {
    callback = JSON.parse(cuerpoCrudo) as CallbackFallo
  } catch {
    // 400 y no 500: un callback ilegible no mejora con reintentos.
    return NextResponse.json({ error: 'Cuerpo no válido.' }, { status: 400 })
  }

  const cargaTexto = decodificarBase64(callback.sourceBody)
  let carga: unknown = null
  try {
    carga = cargaTexto ? JSON.parse(cargaTexto) : null
  } catch {
    carga = null
  }

  const ultimaRespuesta = decodificarBase64(callback.body)?.slice(0, 200)
  const resultado = await registrarTrabajoMuerto({
    mensajeId: callback.sourceMessageId ?? null,
    carga,
    error: [
      callback.status ? `HTTP ${callback.status}` : null,
      ultimaRespuesta || null,
    ]
      .filter(Boolean)
      .join(' · '),
    intentos: (callback.retried ?? callback.maxRetries ?? 0) + 1,
  })

  if (!resultado.ok) {
    // Firmado por QStash pero con una carga que no es nuestra: se anota y se
    // responde 200 — reintentar no lo va a volver legible.
    registrarEvento({ dominio: 'cola', accion: 'difunto', ok: false, motivo: 'carga_invalida' })
    return NextResponse.json({ ok: false, motivo: resultado.motivo })
  }

  // ok:false a propósito aunque el registro saliera bien: el EVENTO que se
  // cuenta es «un trabajo murió», y eso es una mala noticia se mire como se
  // mire. El SLO de la cola debe verlo como fallo.
  registrarEvento({
    dominio: 'cola',
    accion: 'difunto',
    ok: false,
    motivo: 'trabajo_muerto',
    extra: 'duplicado' in resultado ? { duplicado: true } : {},
  })
  return NextResponse.json({ ok: true })
}
