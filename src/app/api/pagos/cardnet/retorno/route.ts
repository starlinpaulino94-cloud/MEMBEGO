import { NextResponse, type NextRequest } from 'next/server'
import { getCardnetConfig, verificarTransaccionCardnet } from '@/lib/payments/cardnet'
import {
  buscarIntentoPorReferencia,
  confirmarIntento,
} from '@/modules/pagos/intentos'
import { logErrorBd } from '@/lib/prisma-errors'

export const dynamic = 'force-dynamic'

/**
 * RETORNO DE CARDNET — a donde vuelve el cliente después de pagar.
 *
 * LA REGLA QUE ORDENA TODO ESTE ARCHIVO: lo que llega aquí NO decide nada.
 * Esta petición viaja por el navegador del cliente; cualquiera puede fabricar
 * una con `aprobado=true`. De todo lo que llega se toma UN solo dato —el
 * identificador de la sesión— y con él se le pregunta a CardNET,
 * servidor a servidor, si esa transacción se aprobó de verdad. La respuesta de
 * esa segunda llamada es la única que activa productos.
 *
 * Acepta GET y POST porque la modalidad "con pantalla" devuelve por POST, pero
 * el cliente puede acabar recargando la página (GET). Los dos caminos son
 * idempotentes: `confirmarIntento` activa una sola vez.
 *
 * PENDIENTE-CARDNET: los nombres de los parámetros del retorno salen del manual
 * de integración. `SESION_CANDIDATOS` recoge las variantes más probables para
 * que, cuando llegue el manual, el ajuste sea de una línea; si ninguno aparece,
 * la ruta lo dice claro en vez de adivinar.
 */

const SESION_CANDIDATOS = ['session', 'SESSION', 'sessionId', 'session-id', 'SESSION-ID']

function leerSesion(params: URLSearchParams | FormData): string | null {
  for (const clave of SESION_CANDIDATOS) {
    const valor = params.get(clave)
    if (typeof valor === 'string' && valor.trim()) return valor.trim()
  }
  return null
}

/** Manda al cliente a una pantalla que entiende, nunca a un JSON crudo. */
function redirigir(req: NextRequest, destino: string, params: Record<string, string>) {
  const url = new URL(destino, req.nextUrl.origin)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  // 303: convierte el POST de CardNET en un GET del navegador. Sin esto, el
  // cliente que recarga reenvía el POST y ve el diálogo de reenvío del
  // formulario.
  return NextResponse.redirect(url, 303)
}

async function manejar(req: NextRequest, sesion: string | null, crudoEntrada: unknown) {
  if (!sesion) {
    logErrorBd('pagos:cardnet:retorno:sinSesion', new Error('Retorno sin identificador de sesión'), {
      recibido: crudoEntrada,
    })
    return redirigir(req, '/cliente/pagos', { pago: 'error' })
  }

  const config = getCardnetConfig()
  if (!config) {
    logErrorBd('pagos:cardnet:retorno:sinConfig', new Error('CardNET no configurado'), { sesion })
    return redirigir(req, '/cliente/pagos', { pago: 'error' })
  }

  const intento = await buscarIntentoPorReferencia(sesion)
  if (!intento) {
    // Sesión desconocida: o es de otro entorno, o alguien está probando URLs.
    // No se activa nada y no se revela si la referencia existe.
    logErrorBd('pagos:cardnet:retorno:intentoDesconocido', new Error('Sesión sin intento'), { sesion })
    return redirigir(req, '/cliente/pagos', { pago: 'error' })
  }

  let verificado
  try {
    verificado = await verificarTransaccionCardnet(config, sesion)
  } catch (e) {
    // Incluye el caso PENDIENTE-CARDNET (integración sin terminar) y las caídas
    // de red. En ninguno se activa: si no se pudo confirmar el cobro, no se
    // entrega el producto. El intento queda para revisión manual.
    logErrorBd('pagos:cardnet:retorno:verificacion', e, { intentoId: intento.id, sesion })
    return redirigir(req, '/cliente/pagos', { pago: 'pendiente' })
  }

  const res = await confirmarIntento(intento.id, {
    aprobada: verificado.aprobada,
    autorizacion: verificado.autorizacion,
    motivo: verificado.motivo,
    crudo: verificado.crudo,
  })

  if (!res.ok) {
    return redirigir(req, '/cliente/pagos', { pago: 'rechazado' })
  }

  // Aprobado: se lleva al cliente a lo que acaba de comprar.
  if (res.compraId) {
    return redirigir(req, `/cliente/mis-promociones/${res.compraId}`, { pago: 'ok' })
  }
  if (res.membershipId) {
    return redirigir(req, '/cliente/membresia', { pago: 'ok' })
  }
  return redirigir(req, '/cliente/pagos', { pago: 'ok' })
}

export async function POST(req: NextRequest) {
  let sesion: string | null = null
  let crudo: unknown = null
  try {
    const tipo = req.headers.get('content-type') ?? ''
    if (tipo.includes('application/json')) {
      const cuerpo = (await req.json()) as Record<string, unknown>
      crudo = cuerpo
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(cuerpo)) params.set(k, String(v))
      sesion = leerSesion(params)
    } else {
      const form = await req.formData()
      crudo = Object.fromEntries(form.entries())
      sesion = leerSesion(form)
    }
  } catch (e) {
    logErrorBd('pagos:cardnet:retorno:cuerpoIlegible', e)
  }
  // Algunas integraciones mandan la sesión en la query aunque el método sea POST.
  sesion ??= leerSesion(req.nextUrl.searchParams)
  return manejar(req, sesion, crudo)
}

export async function GET(req: NextRequest) {
  const sesion = leerSesion(req.nextUrl.searchParams)
  return manejar(req, sesion, Object.fromEntries(req.nextUrl.searchParams.entries()))
}
