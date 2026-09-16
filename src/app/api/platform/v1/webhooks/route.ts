import type { NextRequest } from 'next/server'
import { appUrl } from '@/lib/site'
import { autenticarSobreEmpresa, esFallo, exigeEmpresa } from '@/modules/plataforma/api'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'
import { crearSuscripcion, suscripcionesDeEmpresa } from '@/modules/connect/webhooks'
import { MENSAJE_URL } from '@/modules/connect/webhooksNucleo'
import { soloEventosConocidos } from '@/modules/connect/eventosSuscribibles'

export const dynamic = 'force-dynamic'

/**
 * SUSCRIPCIONES DE WEBHOOK POR API (hallazgo B-2).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PARA QUÉ EXISTE
 *
 * Es lo que necesita un constructor de flujos —Zapier, Make— para comportarse
 * como la gente espera: al montar el flujo crea la suscripción, y al apagarlo
 * la retira. Sin esta ruta habría que entrar al panel a mano cada vez, que es
 * exactamente lo que nadie hace — y una integración que exige eso se abandona
 * en la primera prueba.
 *
 * SOLO CLAVES DE EMPRESA. Un satélite atiende a muchas empresas y no le
 * corresponde decidir a quién avisan ellas; y desde luego no le corresponde
 * poder apuntar los avisos de una empresa a una dirección suya.
 *
 * No hace falta `companyId`: la clave ya dice de quién habla, así que no hay
 * parámetro que manipular.
 */

export async function GET(req: NextRequest) {
  const auth = await autenticarSobreEmpresa(req, 'webhooks:manage', null, {
    claveDeEmpresa: true,
  })
  if (esFallo(auth)) return auth.fallo
  exigeEmpresa(auth.ctx)

  const filas = await suscripcionesDeEmpresa(auth.companyId)
  return respuestaApi(
    {
      // Sin el secreto: se entrega UNA vez, al crear. Devolverlo en cada
      // listado convertiría cualquier lectura en una copia de la credencial.
      webhooks: filas.map((w) => ({
        id: w.id,
        name: w.nombre,
        url: w.url,
        events: w.eventos,
        status: w.estado,
        createdAt: w.createdAt.toISOString(),
      })),
    },
    auth.ctx.requestId
  )
}

export async function POST(req: NextRequest) {
  const auth = await autenticarSobreEmpresa(req, 'webhooks:manage', null, {
    claveDeEmpresa: true,
  })
  if (esFallo(auth)) return auth.fallo
  exigeEmpresa(auth.ctx)

  const cuerpo = (await req.json().catch(() => null)) as {
    url?: unknown
    name?: unknown
    events?: unknown
  } | null
  if (!cuerpo) return errorApi('INVALID_REQUEST', auth.ctx.requestId, { message: 'Invalid JSON body.' })

  const url = typeof cuerpo.url === 'string' ? cuerpo.url : ''
  // El nombre es opcional y tiene un defecto útil: Zapier no pide uno, y una
  // lista de webhooks llamados «» no le dice nada a quien abre el panel.
  const nombre =
    typeof cuerpo.name === 'string' && cuerpo.name.trim() ? cuerpo.name.trim() : 'Creado por API'

  const eventos = Array.isArray(cuerpo.events)
    ? soloEventosConocidos(cuerpo.events.map(String))
    : []

  const res = await crearSuscripcion({
    companyId: auth.companyId,
    nombre,
    url,
    eventos,
  })

  if (!res.ok) {
    if (res.motivo === 'url_invalida') {
      return errorApi('INVALID_REQUEST', auth.ctx.requestId, {
        message: MENSAJE_URL[res.detalle],
      })
    }
    // El límite del plan no es un error del cliente: su petición está bien y la
    // respuesta correcta dice qué pasa, no «petición inválida».
    return errorApi('QUOTA_EXCEEDED', auth.ctx.requestId, {
      message: 'This company has reached its webhook limit.',
    })
  }

  return respuestaApi(
    {
      id: res.id,
      // El secreto, UNA vez. Quien integra lo necesita para verificar la firma
      // de cada aviso, y no hay forma de volver a verlo.
      secret: res.secreto,
      events: eventos,
      unsubscribeUrl: `${appUrl()}/api/platform/v1/webhooks/${res.id}`,
    },
    auth.ctx.requestId,
    { status: 201 }
  )
}
