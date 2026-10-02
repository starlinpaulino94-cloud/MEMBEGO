import { NextResponse } from 'next/server'
import { maxBytesCuerpo, verificadorDe } from '@/modules/supply-v2/operations/firma'
import { recibirEventoExterno } from '@/modules/supply-v2/operations/entrada'
import { httpDe, MENSAJE_DE_CODIGO } from '@/modules/supply-v2/operations/respuestas'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 2 · LA PUERTA HTTP (§1).
 *
 * `POST /api/webhooks/supply-v2/<proveedor>`
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ HACE ESTE ARCHIVO, Y QUÉ NO
 *
 * Hace lo único que solo él puede hacer: leer el cuerpo CRUDO, mirar las
 * cabeceras, cortar lo que es demasiado grande y devolver una respuesta. Nada
 * más. No hay aquí ni una decisión financiera: el camino
 * «autenticar → adaptar → registrar → procesar» vive en
 * `operations/entrada.ts`, que se puede probar sin levantar Next.
 *
 * Esa separación no es estética: un route handler es el peor sitio del mundo
 * para poner lógica de dinero, porque es el único que no se puede ejercitar
 * desde una prueba de dominio.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA RUTA ES PÚBLICA Y TIENE QUE SERLO
 *
 * Una pasarela no puede llevar credenciales nuestras. `/api/webhooks` ya está
 * excluido del `matcher` del proxy de sesión (`src/proxy.ts`), así que no se
 * redirige a `/login`. Lo que protege esto NO es la sesión: es la firma, que
 * se verifica antes de tocar la base.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CUERPO SE LEE UNA SOLA VEZ, Y EN CRUDO
 *
 * `request.text()`, nunca `request.json()`. La firma se calcula sobre los bytes
 * que llegaron: volver a serializar un objeto parseado cambia espacios, orden
 * de claves y notación de números, y la firma dejaría de cuadrar para siempre.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Cabeceras que se le pasan al verificador y al adaptador. Lista cerrada. */
const CABECERAS = [
  'x-sv2-timestamp',
  'x-sv2-signature',
  'x-correlation-id',
  'content-type',
  'user-agent',
] as const

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
): Promise<NextResponse> {
  const { provider } = await params

  // Proveedor desconocido: se corta aquí, sin leer el cuerpo. No tiene sentido
  // traerse 64 KB de algo que no vamos a saber verificar.
  if (!verificadorDe(provider)) {
    return respuesta('UNKNOWN_PROVIDER')
  }

  // Tope de tamaño. Se mira primero la cabecera —si viene y ya pasa, se corta
  // sin leer— y después los bytes reales, porque `content-length` lo pone quien
  // llama y puede mentir u omitirse.
  const declarado = Number(request.headers.get('content-length'))
  const tope = maxBytesCuerpo()
  if (Number.isFinite(declarado) && declarado > tope) {
    return respuesta('PAYLOAD_TOO_LARGE')
  }

  let cuerpoCrudo: string
  try {
    cuerpoCrudo = await request.text()
  } catch {
    return respuesta('INVALID_PAYLOAD')
  }
  if (Buffer.byteLength(cuerpoCrudo, 'utf8') > tope) {
    return respuesta('PAYLOAD_TOO_LARGE')
  }

  const cabeceras: Record<string, string | null> = {}
  for (const nombre of CABECERAS) cabeceras[nombre] = request.headers.get(nombre)

  const r = await recibirEventoExterno({
    provider,
    cuerpoCrudo,
    cabeceras,
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: request.headers.get('user-agent'),
  })

  // La respuesta lleva el código, el mensaje de una palabra y el hilo —para que
  // el proveedor pueda citarlo si abre una incidencia—. NUNCA el detalle: ni por
  // qué la firma no cuadró, ni si la orden existe, ni una traza.
  return NextResponse.json(
    { codigo: r.codigo, mensaje: MENSAJE_DE_CODIGO[r.codigo], correlationId: r.correlationId },
    { status: r.http, headers: { 'x-correlation-id': r.correlationId } }
  )
}

/**
 * Lo que se contesta a lo que no es un POST válido.
 *
 * 405 y con `Allow`: un proveedor mal configurado que haga GET tiene que poder
 * leer en la respuesta qué método espera esta URL.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { codigo: 'METHOD_NOT_ALLOWED', mensaje: 'solo POST' },
    { status: 405, headers: { Allow: 'POST' } }
  )
}

function respuesta(codigo: 'UNKNOWN_PROVIDER' | 'PAYLOAD_TOO_LARGE' | 'INVALID_PAYLOAD'): NextResponse {
  return NextResponse.json({ codigo, mensaje: MENSAJE_DE_CODIGO[codigo] }, { status: httpDe(codigo) })
}
