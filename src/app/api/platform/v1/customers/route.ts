import type { NextRequest } from 'next/server'
import { altaCliente } from '@/modules/plataforma/alta-cliente'
import { autenticarSobreEmpresa, esFallo, exigeSistema } from '@/modules/plataforma/api'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'
import { conIdempotencia } from '@/modules/plataforma/idempotencia'

export const dynamic = 'force-dynamic'

/**
 * POST /api/platform/v1/customers — el vertical registra a alguien que llegó
 * sin cuenta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA ESCRITURA QUE LA FASE 6 DEJÓ PENDIENTE
 *
 * La validación con Car Wash terminó diciendo que el contrato no aguantaba
 * escribir, y que la conversación había que tenerla con un restaurante delante
 * porque los dos verticales registran clientes que llegan sin cuenta. Es esta.
 *
 * El vertical NO se vuelve dueño de la identidad por poder pedir un alta. Quien
 * decide cómo queda la fila —que no pueda iniciar sesión, que quede marcada
 * como local, de qué canal vino, si en realidad ya existía— es el Core, igual
 * para todos. El satélite manda un nombre; no manda un registro.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DEVUELVE `created`, Y ESO IMPORTA
 *
 * Si el teléfono ya estaba, se devuelve el cliente que ya existe con
 * `created: false` en vez de crear una segunda ficha. Dos fichas de la misma
 * persona parten su historial en dos y nadie vuelve a saber cuántas veces vino.
 *
 * El satélite necesita distinguirlo: un cliente que ya existía puede tener
 * membresía y beneficios, y darle la bienvenida como si fuera nuevo es, para
 * quien está delante, un sistema que no lo reconoce.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IDEMPOTENTE
 *
 * La deduplicación cubre «la misma persona pedida dos veces con su teléfono».
 * No cubre a quien llega solo con su nombre, que es el caso normal de una mesa
 * o de una pista — ahí no hay nada con qué deduplicar, y un reintento por una
 * respuesta que se perdió crearía la segunda ficha. La clave de idempotencia es
 * lo que cierra ese hueco.
 */

interface Cuerpo {
  companyId?: string
  name?: string
  phone?: string | null
  email?: string | null
}

export async function POST(req: NextRequest) {
  const crudo = await req.text()
  const cuerpo = (() => {
    try {
      return JSON.parse(crudo || '{}') as Cuerpo
    } catch {
      return {} as Cuerpo
    }
  })()

  const auth = await autenticarSobreEmpresa(req, 'customers:write', cuerpo.companyId)
  if (esFallo(auth)) return auth.fallo
  const { ctx, companyId } = auth
  // Este recurso es de SATÉLITE: necesita saber qué sistema respalda la
  // operación. `exigeSistema` lo afirma con el tipo — una clave de API de
  // empresa no llega aquí (la guardia la rechaza antes con
  // API_KEY_NOT_SUPPORTED), y si algún día llegara, esto lo detendría.
  const sistema = exigeSistema(ctx)

  const clave = req.headers.get('idempotency-key')?.trim() ?? ''
  if (!clave) return errorApi('IDEMPOTENCY_KEY_REQUIRED', ctx.requestId)

  const idem = await conIdempotencia({
    sistemaId: sistema.sistemaId,
    companyId,
    clave,
    endpoint: '/api/platform/v1/customers',
    cuerpo: crudo,
    requestId: ctx.requestId,
  })
  if (idem.modo !== 'EJECUTAR') return idem.respuesta

  // El canal de origen es el slug del sistema que pide el alta: así una ficha
  // creada por el satélite del restaurante y una creada en el mostrador no son
  // indistinguibles el día que alguien pregunte de dónde vienen los clientes.
  const alta = await altaCliente(
    companyId,
    { nombre: cuerpo.name, telefono: cuerpo.phone, email: cuerpo.email },
    sistema.sistemaSlug
  ).catch(() => ({ error: 'INTERNAL' }) as const)

  if ('error' in alta) {
    const fallo =
      alta.error === 'INTERNAL'
        ? errorApi('INTERNAL_ERROR', ctx.requestId)
        : errorApi('INVALID_REQUEST', ctx.requestId, { message: alta.error })
    await idem.guardar(fallo.status, await fallo.clone().json())
    return fallo
  }

  const salida = { customer: alta.cliente, created: alta.creado }
  await idem.guardar(200, salida)
  return respuestaApi(salida, ctx.requestId)
}
