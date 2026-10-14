import { notificarSuperadmins } from '@/modules/notificaciones/service'
import type { EfectoAEntregar, EjecutorDeEfecto, ResultadoDeEfecto } from '@/modules/supply-v2/operations/worker'
import { avisarAdminsDeEmpresa } from '@/modules/visitas-membego/efectos'
import { RUTA_PORTAL_SOLICITUD_MERCHANT, RUTA_SOLICITUDES_MERCHANT } from '@/modules/supply-v2/core/catalogo'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · efectos del outbox de la solicitud
 * Supplier → Merchant (§50–§51): a Membego cuando llega una; al proveedor
 * cuando Membego decide. Mismo outbox y mismo `Notificacion` de siempre.
 */

function payloadDe(e: EfectoAEntregar): Record<string, unknown> {
  return e.payload && typeof e.payload === 'object' && !Array.isArray(e.payload) ? (e.payload as Record<string, unknown>) : {}
}

export const EFECTOS_DE_SOLICITUD_MERCHANT: Record<string, EjecutorDeEfecto> = {
  'supplier.merchant_application_submitted': async (e): Promise<ResultadoDeEfecto> => {
    const p = payloadDe(e)
    const n = await notificarSuperadmins({
      tipo: 'SUPPLY_SOLICITUD_MERCHANT',
      titulo: p.respuesta ? 'Un proveedor respondió a tu petición' : 'Un proveedor quiere ser empresa Membego',
      mensaje: `${String(p.nombre ?? 'Un proveedor')} ${p.respuesta ? 'completó la información que pediste' : 'envió su solicitud para operar también como empresa Membego'}. Revísala.`,
      href: RUTA_SOLICITUDES_MERCHANT,
      dedupeKey: e.idempotencyKey,
    })
    return { detalle: `${n} aviso(s) a la plataforma` }
  },
  'supplier.merchant_application_more_info': async (e) => {
    const p = payloadDe(e)
    const companyId = String(p.companyId ?? '')
    if (!companyId) return { detalle: 'sin empresa' }
    return avisarAdminsDeEmpresa(companyId, {
      tipo: 'SUPPLY_SOLICITUD_MERCHANT',
      titulo: 'Membego necesita más información',
      mensaje: `Para seguir con tu solicitud de empresa Membego: ${String(p.peticion ?? '')}`,
      href: RUTA_PORTAL_SOLICITUD_MERCHANT,
    }, e.idempotencyKey)
  },
  'supplier.merchant_rejected': async (e) => {
    const p = payloadDe(e)
    const companyId = String(p.companyId ?? '')
    if (!companyId) return { detalle: 'sin empresa' }
    return avisarAdminsDeEmpresa(companyId, {
      tipo: 'SUPPLY_SOLICITUD_MERCHANT',
      titulo: 'Tu solicitud de empresa Membego no fue aprobada',
      mensaje: `Motivo: ${String(p.motivo ?? '')}. Puedes volver a solicitarlo más adelante.`,
      href: RUTA_PORTAL_SOLICITUD_MERCHANT,
    }, e.idempotencyKey)
  },
  'supplier.merchant_approved': async (e) => {
    const p = payloadDe(e)
    const companyId = String(p.companyId ?? '')
    if (!companyId) return { detalle: 'sin empresa' }
    return avisarAdminsDeEmpresa(companyId, {
      tipo: 'SUPPLY_SOLICITUD_MERCHANT',
      titulo: '¡Ya eres empresa Membego!',
      mensaje: 'Aprobamos tu solicitud: tu misma empresa ahora tiene catálogo, pedidos y ofertas. Completa tu perfil para publicar tu vitrina.',
      href: '/admin/perfil',
    }, e.idempotencyKey)
  },
}
