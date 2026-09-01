import type { NextRequest } from 'next/server'
import { conEmpresa } from '@/lib/tenant'
import { crearTransaccionAplicada } from '@/lib/transactions'
import { autenticarSobreEmpresa, esFallo, exigeSistema } from '@/modules/plataforma/api'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'
import { conIdempotencia } from '@/modules/plataforma/idempotencia'

export const dynamic = 'force-dynamic'

/**
 * POST /api/platform/v1/transactions — el vertical registra una venta suya.
 *
 * El restaurante cobra la cuenta en SU sistema; MembeGo no gestiona su menú ni
 * sus mesas (§14: el Core no replica operación). Pero el dueño quiere ver en un
 * solo sitio lo que facturó, y el motor de fidelización necesita saber que ese
 * cliente gastó para poder premiarlo.
 *
 * Esto es ese puente: una transacción `SALE` en estado APPLIED, con el importe
 * y una descripción, atribuida al cliente si el vertical sabe quién es.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE NO ES
 *
 * NO es un cobro. MembeGo no mueve dinero aquí: el vertical ya cobró y esto es
 * el registro. No toca la caja de MembeGo (`cajaSesionId` va vacío) porque el
 * arqueo de una caja que no existe en MembeGo no significa nada.
 *
 * NO es un canje. Consumir un beneficio es `/redemptions`, que descuenta saldo
 * y consume el QR. Registrar una venta no descuenta nada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IDEMPOTENTE, POR EL MISMO MOTIVO QUE EL CANJE
 *
 * Un reintento sin clave duplica la venta en los informes del dueño. Aquí no se
 * pierde dinero, pero se pierde la confianza en el número — y un informe en el
 * que no se confía deja de mirarse.
 */

interface Cuerpo {
  companyId?: string
  /** Cliente de MembeGo, si el vertical lo identificó. */
  customerId?: string | null
  branchId?: string | null
  amount?: number
  /** Descripción corta para el informe. */
  description?: string
  /** Referencia en el sistema del vertical, para poder cruzar. */
  externalId?: string | null
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

  const auth = await autenticarSobreEmpresa(req, 'transactions:write', cuerpo.companyId)
  if (esFallo(auth)) return auth.fallo
  const { ctx, companyId } = auth
  // Este recurso es de SATÉLITE: necesita saber qué sistema respalda la
  // operación. `exigeSistema` lo afirma con el tipo — una clave de API de
  // empresa no llega aquí (la guardia la rechaza antes con
  // API_KEY_NOT_SUPPORTED), y si algún día llegara, esto lo detendría.
  const sistema = exigeSistema(ctx)

  const clave = req.headers.get('idempotency-key')?.trim() ?? ''
  if (!clave) return errorApi('IDEMPOTENCY_KEY_REQUIRED', ctx.requestId)

  const monto = typeof cuerpo.amount === 'number' ? cuerpo.amount : NaN
  if (!Number.isFinite(monto) || monto < 0) {
    return errorApi('INVALID_REQUEST', ctx.requestId, {
      message: 'amount is required and must be a non-negative number.',
    })
  }

  const idem = await conIdempotencia({
    sistemaId: sistema.sistemaId,
    companyId,
    clave,
    endpoint: '/api/platform/v1/transactions',
    cuerpo: crudo,
    requestId: ctx.requestId,
  })
  if (idem.modo !== 'EJECUTAR') return idem.respuesta

  const creada = await conEmpresa(companyId, async (tx) => {
    // El cliente se valida contra la empresa ANTES de atribuirle nada. Un id de
    // otra empresa no da error: la venta se registra sin cliente. Rechazarla
    // haría perder el importe del informe por un dato accesorio; atribuirla a
    // ciegas metería la venta en la ficha de un cliente ajeno.
    const cliente = cuerpo.customerId
      ? await tx.cliente.findFirst({
          where: { id: cuerpo.customerId, companyId },
          select: { id: true, nombre: true },
        })
      : null

    const sucursal = cuerpo.branchId
      ? await tx.sucursal.findFirst({
          where: { id: cuerpo.branchId, companyId },
          select: { id: true, nombre: true },
        })
      : null

    const empresa = await tx.company.findUnique({
      where: { id: companyId },
      select: { name: true, zonaHoraria: true },
    })

    return crearTransaccionAplicada(tx, {
      tipo: 'SALE',
      companyId,
      sucursalId: sucursal?.id ?? null,
      clienteId: cliente?.id ?? null,
      // Sin empleado: quien atendió trabaja en el vertical, no en MembeGo.
      empleadoId: null,
      monto,
      snapshot: {
        empresa: empresa?.name ?? '',
        cliente: cliente?.nombre,
        sucursal: sucursal?.nombre,
        servicio: cuerpo.description?.trim() || 'Venta',
      },
      auditoria: {
        // De dónde vino, para que una venta del satélite y una del mostrador no
        // sean indistinguibles al revisar un descuadre.
        origen: 'SISTEMA',
        sistema: sistema.sistemaSlug,
        externalId: cuerpo.externalId ?? null,
        requestId: ctx.requestId,
      },
      resultado: cuerpo.description?.trim() || null,
      timeZone: empresa?.zonaHoraria,
    })
  }).catch(() => null)

  if (!creada) {
    const fallo = errorApi('INTERNAL_ERROR', ctx.requestId)
    await idem.guardar(fallo.status, await fallo.clone().json())
    return fallo
  }

  const salida = {
    transactionId: creada.id,
    codigo: creada.codigo,
    ticketNumero: creada.ticketNumero,
    companyId,
    amount: monto,
    recordedAt: new Date().toISOString(),
  }
  await idem.guardar(200, salida)
  return respuestaApi(salida, ctx.requestId)
}
