import type { NextRequest } from 'next/server'
import { conEmpresa } from '@/lib/tenant'
import { crearTransaccionAplicada } from '@/lib/transactions'
import { autenticarSobreEmpresa, esFallo, exigeSistema } from '@/modules/plataforma/api'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'
import { conIdempotencia } from '@/modules/plataforma/idempotencia'
import { registrarTransicionCompra, validarConsumoCompra } from '@/modules/promociones/compra'

export const dynamic = 'force-dynamic'

/**
 * POST /api/platform/v1/promotions/redeem — el vertical canjea una promoción.
 *
 * Hermano del canje de membresías (`/redemptions`), pero para promociones: el
 * satélite dice QUÉ promoción del cliente se usó (el `id` que devolvió
 * `/benefits/evaluate`, que es el de la compra/cupón `ProductoCompra`) y MembeGo
 * la consume.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * MISMA REGLA QUE EL ESCÁNER, SIN EL QR
 *
 * El consumo replica exactamente lo que hace el escáner de MembeGo
 * (`confirmarCanjePromocion`): revalida con el MISMO motor de reglas
 * (`validarConsumoCompra`), decrementa `usosRestantes` con una guarda ATÓMICA
 * (`estado='ACTIVA' AND usosRestantes>0`), marca `CONSUMIDA` en el último uso y
 * registra la transacción `PROMOTION_USE`. Lo único que NO hay es un QR que
 * invalidar: aquí el cliente no escanea; el mostrador del satélite ya lo tiene
 * identificado por su ficha.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UN SOLO USO, GARANTIZADO POR DOS CANDADOS
 *
 *   1. La `Idempotency-Key` (derivada de la factura) hace que un reintento de
 *      red devuelva la MISMA respuesta sin volver a consumir.
 *   2. El decremento atómico (`updateMany` con la guarda) hace que dos peticiones
 *      simultáneas no puedan bajar el saldo dos veces: la segunda toca 0 filas.
 *
 * Con `usosIncluidos = 1` (una promo de «un solo uso por cliente»), el primer
 * canje la deja en `CONSUMIDA` y cualquier intento posterior recibe SIN_USOS.
 */

interface Cuerpo {
  companyId?: string
  /** id de la promoción del cliente = `ProductoCompra.id` (el de /benefits/evaluate). */
  promotionId?: string
  /** Qué se le hizo al carro; va al registro de la transacción. */
  servicio?: string
  branchId?: string | null
  /** Referencia del satélite (la factura), para cruzar sistemas. */
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

  const auth = await autenticarSobreEmpresa(req, 'benefits:redeem', cuerpo.companyId)
  if (esFallo(auth)) return auth.fallo
  const { ctx, companyId } = auth
  // Recurso de SATÉLITE: necesita saber qué sistema respalda el canje. Una clave
  // de API de empresa no llega aquí (la guardia la rechaza antes).
  const sistema = exigeSistema(ctx)

  const clave = req.headers.get('idempotency-key')?.trim() ?? ''
  if (!clave) return errorApi('IDEMPOTENCY_KEY_REQUIRED', ctx.requestId)

  const compraId = cuerpo.promotionId?.trim() ?? ''
  if (!compraId) {
    return errorApi('INVALID_REQUEST', ctx.requestId, { message: 'promotionId is required.' })
  }

  const idem = await conIdempotencia({
    sistemaId: sistema.sistemaId,
    companyId,
    clave,
    endpoint: '/api/platform/v1/promotions/redeem',
    cuerpo: crudo,
    requestId: ctx.requestId,
  })
  if (idem.modo !== 'EJECUTAR') return idem.respuesta

  type Salida =
    | { ok: true; restantes: number; consumida: boolean; transaccionId: string; promocion: string }
    | { ok: false; codigo: 'NO_ENCONTRADA' | 'NO_ELEGIBLE' | 'SIN_USOS'; mensaje?: string }

  const resultado: Salida | null = await conEmpresa(companyId, async (tx) => {
    const compra = await tx.productoCompra.findFirst({
      where: { id: compraId, companyId },
      include: {
        promocion: true,
        cliente: {
          include: { company: { select: { name: true, zonaHoraria: true } } },
        },
      },
    })
    if (!compra || !compra.promocion) {
      return { ok: false as const, codigo: 'NO_ENCONTRADA' as const }
    }

    // Mismo motor de reglas que el escáner y que /benefits/evaluate: días, horas,
    // vencimiento y estado. No se reimplementa aquí para que mostrador y satélite
    // nunca den veredictos distintos sobre el mismo cupón.
    const v = validarConsumoCompra(
      {
        estado: compra.estado,
        usosRestantes: compra.usosRestantes,
        fechaVencimiento: compra.fechaVencimiento,
      },
      {
        diasPermitidos: compra.promocion.diasPermitidos,
        horaDesde: compra.promocion.horaDesde,
        horaHasta: compra.promocion.horaHasta,
      },
      new Date(),
      compra.cliente.company.zonaHoraria
    )
    if (!v.puedeUsar) {
      return { ok: false as const, codigo: 'NO_ELEGIBLE' as const, mensaje: v.mensaje ?? undefined }
    }

    let sucursalId: string | null = null
    let sucursalNombre: string | null = null
    if (cuerpo.branchId) {
      const suc = await tx.sucursal.findFirst({
        where: { id: cuerpo.branchId, companyId },
        select: { id: true, nombre: true },
      })
      if (suc) {
        sucursalId = suc.id
        sucursalNombre = suc.nombre
      }
    }

    // Candado atómico anti doble-consumo: si otra petición ya bajó el saldo, esta
    // toca 0 filas y se rechaza. Idéntico al del escáner.
    const upd = await tx.productoCompra.updateMany({
      where: { id: compra.id, estado: 'ACTIVA', usosRestantes: { gt: 0 } },
      data: { usosRestantes: { decrement: 1 } },
    })
    if (upd.count === 0) return { ok: false as const, codigo: 'SIN_USOS' as const }

    const actual = await tx.productoCompra.findUniqueOrThrow({
      where: { id: compra.id },
      select: { usosRestantes: true },
    })
    const restantes = actual.usosRestantes
    const consumida = restantes <= 0

    if (consumida) {
      await tx.productoCompra.update({
        where: { id: compra.id },
        data: { estado: 'CONSUMIDA', consumidaAt: new Date() },
      })
      await registrarTransicionCompra(tx, {
        compraId: compra.id,
        desde: 'ACTIVA',
        hacia: 'CONSUMIDA',
        motivo: `Canje desde sistema satélite (${sistema.sistemaSlug})`,
        userId: null,
      })
    }

    // Registro oficial (Transaction Engine), igual que el escáner. Sin QR ni
    // empleado: el mostrador que atendió es del satélite, no de MembeGo.
    const transaccion = await crearTransaccionAplicada(tx, {
      tipo: 'PROMOTION_USE',
      companyId,
      sucursalId,
      clienteId: compra.clienteId,
      empleadoId: null,
      snapshot: {
        cliente: compra.cliente.nombre,
        empresa: compra.cliente.company.name,
        sucursal: sucursalNombre ?? undefined,
        promocion: compra.promocion.titulo,
        servicio: cuerpo.servicio?.trim() || compra.promocion.titulo,
        restantes,
      },
      auditoria: {
        origen: 'SISTEMA',
        sistema: sistema.sistemaSlug,
        externalId: cuerpo.externalId ?? null,
        requestId: ctx.requestId,
      },
      timeZone: compra.cliente.company.zonaHoraria,
      userId: null,
    })

    return {
      ok: true as const,
      restantes,
      consumida,
      transaccionId: transaccion.id,
      promocion: compra.promocion.titulo,
    }
  }).catch(() => null)

  if (!resultado) {
    const fallo = errorApi('INTERNAL_ERROR', ctx.requestId)
    await idem.guardar(fallo.status, await fallo.clone().json())
    return fallo
  }

  if (!resultado.ok) {
    const fallo = errorApi('INVALID_REQUEST', ctx.requestId, {
      message:
        resultado.codigo === 'NO_ENCONTRADA'
          ? 'La promoción no existe para esta empresa.'
          : resultado.codigo === 'SIN_USOS'
            ? 'La promoción ya no tiene usos disponibles.'
            : resultado.mensaje ?? 'La promoción no puede canjearse ahora.',
    })
    await idem.guardar(fallo.status, await fallo.clone().json())
    return fallo
  }

  const salida = {
    redemptionId: resultado.transaccionId,
    promotion: resultado.promocion,
    usesLeft: resultado.restantes,
    consumed: resultado.consumida,
    redeemedAt: new Date().toISOString(),
  }
  await idem.guardar(200, salida)
  return respuestaApi(salida, ctx.requestId)
}
