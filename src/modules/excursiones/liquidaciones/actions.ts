'use server'

/**
 * EXCURSIONES · Liquidaciones — acciones.
 *
 * Aquí sale el dinero de la empresa, así que todo va en TRANSACCIÓN: la
 * liquidación y el marcado de sus comisiones ocurren juntos o no ocurren. Una
 * liquidación creada a medias —con comisiones apuntando a un pago que no se
 * guardó, o con comisiones libres dentro de un pago que sí— es exactamente el
 * descuadre que nadie sabe explicar tres meses después.
 */

import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getRequestMeta } from '@/lib/server-utils'
import { anotarFallo } from '@/lib/prisma-errors'
import { netoComision } from '@/modules/excursiones/comisiones/nucleo'
import { getExcursionesConfig, convertirMoneda } from '../config'
import {
  ESTADOS_LIQUIDACION,
  comisionesDelPeriodo,
  totalLiquidacion,
  totalMonetarioComisiones,
  centavos,
  numeroLiquidacion,
  puedeTransicionarLiquidacion,
  motivoTransicionLiquidacion,
  validarPeriodo,
  validarPagoLiquidacion,
  type ComisionLiquidable,
  type EstadoLiquidacion,
} from './nucleo'

export interface LiquidacionActionState {
  error?: string
  success?: string
  liquidacionId?: string
}

async function auditar(
  companyId: string,
  userId: string | null,
  entidadId: string,
  payload: Record<string, unknown>
) {
  const meta = await getRequestMeta()
  await conEmpresa(companyId, (tx) =>
    tx.auditLog.create({
      data: {
        companyId,
        userId,
        accion: 'NOTA_INTERNA',
        entidadTipo: 'Liquidacion',
        entidadId,
        payload: payload as Prisma.InputJsonObject,
        ...meta,
      },
    })
  ).catch(anotarFallo('excursiones:liquidaciones:auditLog'))
}

/**
 * ADMIN · Preparar la liquidación de un vendedor por un período.
 *
 * Las comisiones se eligen y se marcan DENTRO de la misma transacción, y la
 * selección se vuelve a filtrar ahí con `liquidacionId: null` — si dos
 * personas liquidan al mismo vendedor a la vez, la segunda no se lleva
 * comisiones que la primera acaba de tomar.
 */
export async function crearLiquidacion(
  _prev: LiquidacionActionState,
  formData: FormData
): Promise<LiquidacionActionState> {
  try {
    const user = await requireSection('excursiones', 'liquidacion_crear')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }

    const v = validarPeriodo({
      vendedorId: String(formData.get('vendedorId') ?? ''),
      desde: String(formData.get('desde') ?? ''),
      hasta: String(formData.get('hasta') ?? ''),
    })
    if (!v.ok) return { error: v.error }

    const vendedor = await conEmpresa(companyId, (tx) =>
      tx.vendedor.findFirst({
        where: { id: v.datos.vendedorId, companyId },
        select: { id: true, nombre: true, codigo: true },
      })
    )
    if (!vendedor) return { error: 'Ese vendedor no existe en tu empresa.' }

    const anio = v.datos.hasta.getUTCFullYear()
    const config = await getExcursionesConfig(companyId)
    const moneda = config.monedaDefecto || 'DOP'

    const resultado = await conEmpresa(companyId, async (tx) => {
      const [candidatas, bonosCandidatos] = await Promise.all([
        tx.comisionEntrada.findMany({
          where: {
            companyId,
            vendedorId: v.datos.vendedorId,
            liquidacionId: null,
            estado: 'APROBADA',
            createdAt: { gte: v.datos.desde, lte: v.datos.hasta },
          },
          select: {
            id: true,
            vendedorId: true,
            estado: true,
            monto: true,
            moneda: true,
            reglaSnapshot: true,
            createdAt: true,
            liquidacionId: true,
            ajustes: { select: { monto: true } },
          },
        }),
        tx.vendedorBono.findMany({
          where: {
            companyId,
            vendedorId: v.datos.vendedorId,
            liquidacionId: null,
            estado: 'OTORGADO',
            createdAt: { gte: v.datos.desde, lte: v.datos.hasta },
          },
          select: {
            id: true,
            monto: true,
            moneda: true,
            createdAt: true,
          },
        }),
      ])

      const liquidables: ComisionLiquidable[] = candidatas.map((c) => {
        const snapshot = c.reglaSnapshot as { tipoCalculo?: string } | null
        const netoOrig = netoComision(
          Number(c.monto),
          c.ajustes.map((a) => ({ monto: Number(a.monto) }))
        )
        const netoConvertido = convertirMoneda(netoOrig, c.moneda, moneda, config.tasasCambio)
        return {
          id: c.id,
          vendedorId: c.vendedorId,
          estado: c.estado,
          neto: netoConvertido,
          createdAt: c.createdAt,
          liquidacionId: c.liquidacionId,
          tipoCalculo: snapshot?.tipoCalculo ?? 'PORCENTAJE',
        }
      })
      const elegidas = comisionesDelPeriodo(liquidables, {
        vendedorId: v.datos.vendedorId,
        desde: v.datos.desde,
        hasta: v.datos.hasta,
      })

      if (elegidas.length === 0 && bonosCandidatos.length === 0) {
        return { vacia: true as const }
      }

      // Total monetario: comisiones en efectivo (excluye premios en especie) + bonos por metas
      const totalComisiones = totalMonetarioComisiones(elegidas)
      const totalBonos = centavos(
        bonosCandidatos.reduce((s, b) => {
          const conv = convertirMoneda(Number(b.monto), b.moneda, moneda, config.tasasCambio)
          return s + conv
        }, 0)
      )
      const total = centavos(totalComisiones + totalBonos)

      let intento =
        (await tx.liquidacion.count({
          where: {
            companyId,
            periodoHasta: {
              gte: new Date(Date.UTC(anio, 0, 1)),
              lt: new Date(Date.UTC(anio + 1, 0, 1)),
            },
          },
        })) + 1

      for (let i = 0; i < 5; i++) {
        try {
          const liquidacion = await tx.liquidacion.create({
            data: {
              companyId,
              numero: numeroLiquidacion('PAY', anio, intento),
              vendedorId: v.datos.vendedorId,
              periodoDesde: v.datos.desde,
              periodoHasta: v.datos.hasta,
              total,
              moneda,
              estado: 'BORRADOR',
            },
            select: { id: true, numero: true },
          })

          // Reserva atómica: solo se llevan las que SIGUEN libres y aprobadas. Si otra
          // liquidación ganó la carrera, aquí se ve y se corrige el total.
          const tomadas = await tx.comisionEntrada.updateMany({
            where: {
              id: { in: elegidas.map((c) => c.id) },
              companyId,
              liquidacionId: null,
              estado: 'APROBADA',
            },
            data: { liquidacionId: liquidacion.id, estado: 'PENDIENTE_PAGO' },
          })

          // Vincular los bonos de metas otorgados del período
          if (bonosCandidatos.length > 0) {
            await tx.vendedorBono.updateMany({
              where: {
                id: { in: bonosCandidatos.map((b) => b.id) },
                companyId,
                liquidacionId: null,
                estado: 'OTORGADO',
              },
              data: { liquidacionId: liquidacion.id },
            })
          }

          if (tomadas.count !== elegidas.length) {
            const reales = await tx.comisionEntrada.findMany({
              where: { companyId, liquidacionId: liquidacion.id },
              select: { monto: true, moneda: true, reglaSnapshot: true, ajustes: { select: { monto: true } } },
            })
            const realesComisiones = reales.map((r) => {
              const snapshot = r.reglaSnapshot as { tipoCalculo?: string } | null
              const netoOrig = netoComision(
                Number(r.monto),
                r.ajustes.map((a) => ({ monto: Number(a.monto) }))
              )
              return {
                neto: convertirMoneda(netoOrig, r.moneda, moneda, config.tasasCambio),
                tipoCalculo: snapshot?.tipoCalculo ?? 'PORCENTAJE',
              }
            })
            const totalReal = centavos(totalMonetarioComisiones(realesComisiones) + totalBonos)
            await tx.liquidacion.update({
              where: { id: liquidacion.id },
              data: { total: totalReal },
            })
            return {
              liquidacion,
              total: totalReal,
              cantidad: tomadas.count,
              parcial: true as const,
            }
          }

          return { liquidacion, total, cantidad: tomadas.count, parcial: false as const }
        } catch (e) {
          const esUnique = e instanceof Error && 'code' in e && (e as { code?: string }).code === 'P2002'
          if (!esUnique || i === 4) throw e
          intento += 1
        }
      }
      throw new Error('sin_numero')
    })

    if ('vacia' in resultado) {
      return {
        error: `${vendedor.nombre} no tiene comisiones aprobadas sin liquidar en ese período.`,
      }
    }

    await auditar(companyId, user.metadata.dbUserId ?? null, resultado.liquidacion.id, {
      tipo: 'LIQUIDACION_CREADA',
      numero: resultado.liquidacion.numero,
      vendedor: vendedor.codigo,
      comisiones: resultado.cantidad,
      total: resultado.total,
    })
    revalidatePath('/admin/excursiones/liquidaciones')
    revalidatePath('/admin/excursiones/comisiones')
    return {
      success: resultado.parcial
        ? `Liquidación ${resultado.liquidacion.numero} creada con ${resultado.cantidad} comisiones. Alguna quedó fuera porque ya entró en otra liquidación.`
        : `Liquidación ${resultado.liquidacion.numero} creada con ${resultado.cantidad} comisiones.`,
      liquidacionId: resultado.liquidacion.id,
    }
  } catch (e) {
    console.error('[excursiones] crearLiquidacion:', e)
    return { error: 'No se pudo preparar la liquidación.' }
  }
}

/**
 * ADMIN · Aprobar, pagar o anular.
 *
 * Pagar exige método y referencia (salvo efectivo) y marca sus comisiones como
 * PAGADAS. Anular DEVUELVE las comisiones al pozo: vuelven a APROBADA y sin
 * liquidación, listas para entrar en la siguiente. Nada se borra.
 */
export async function cambiarEstadoLiquidacion(
  _prev: LiquidacionActionState,
  formData: FormData
): Promise<LiquidacionActionState> {
  try {
    const estado = String(formData.get('estado') ?? '') as EstadoLiquidacion
    if (!(ESTADOS_LIQUIDACION as readonly string[]).includes(estado)) {
      return { error: 'Estado no reconocido.' }
    }
    const funcion = estado === 'PAGADA' ? 'liquidacion_pagar' : 'liquidacion_crear'
    const user = await requireSection('excursiones', funcion)
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const liquidacionId = String(formData.get('liquidacionId') ?? '')

    const liquidacion = await conEmpresa(companyId, (tx) =>
      tx.liquidacion.findFirst({
        where: { id: liquidacionId, companyId },
        select: { id: true, numero: true, estado: true, total: true, notas: true },
      })
    )
    if (!liquidacion) return { error: 'Liquidación no encontrada.' }

    const desde = liquidacion.estado as EstadoLiquidacion
    if (!puedeTransicionarLiquidacion(desde, estado)) {
      return { error: motivoTransicionLiquidacion(desde, estado) ?? 'Cambio no permitido.' }
    }

    let pago: { metodo: string; referencia: string | null; notas: string | null } | null = null
    if (estado === 'PAGADA') {
      const v = validarPagoLiquidacion({
        metodo: String(formData.get('metodo') ?? ''),
        referencia: String(formData.get('referencia') ?? ''),
        notas: String(formData.get('notas') ?? ''),
      })
      if (!v.ok) return { error: v.error }
      pago = v.datos
    }

    const motivo = String(formData.get('motivo') ?? '').trim().slice(0, 300)
    if (estado === 'ANULADA' && !motivo) {
      return { error: 'Escribe por qué se anula la liquidación.' }
    }

    await conEmpresa(companyId, async (tx) => {
      const notasFinales = [
        pago ? pago.notas : liquidacion.notas,
        motivo ? `[${estado}] ${motivo}` : null,
      ]
        .filter(Boolean)
        .join('\n')

      await tx.liquidacion.update({
        where: { id: liquidacion.id },
        data: {
          estado,
          ...(pago
            ? {
                metodo: pago.metodo,
                referencia: pago.referencia,
                pagadaPorId: user.metadata.dbUserId ?? null,
                pagadaAt: new Date(),
              }
            : {}),
          ...(notasFinales !== liquidacion.notas ? { notas: notasFinales } : {}),
        },
      })

      if (estado === 'PAGADA') {
        await tx.comisionEntrada.updateMany({
          where: { companyId, liquidacionId: liquidacion.id, estado: 'PENDIENTE_PAGO' },
          data: { estado: 'PAGADA' },
        })
        await tx.vendedorBono.updateMany({
          where: { companyId, liquidacionId: liquidacion.id },
          data: { estado: 'PAGADO' },
        })
      }

      if (estado === 'ANULADA') {
        // Las comisiones vuelven al pozo. Las que ya se habían marcado como
        // PAGADAS se dejan como están: ese dinero salió, y lo que haya que
        // corregir se corrige con un ajuste sobre la comisión (§27).
        await tx.comisionEntrada.updateMany({
          where: { companyId, liquidacionId: liquidacion.id, estado: 'PENDIENTE_PAGO' },
          data: { liquidacionId: null, estado: 'APROBADA' },
        })
        await tx.vendedorBono.updateMany({
          where: { companyId, liquidacionId: liquidacion.id, estado: { not: 'PAGADO' } },
          data: { liquidacionId: null, estado: 'OTORGADO' },
        })
      }
    })

    await auditar(companyId, user.metadata.dbUserId ?? null, liquidacion.id, {
      tipo: 'LIQUIDACION_ESTADO',
      numero: liquidacion.numero,
      desde,
      hacia: estado,
      total: String(liquidacion.total),
      ...(pago ? { metodo: pago.metodo, referencia: pago.referencia } : {}),
      ...(motivo ? { motivo } : {}),
    })
    revalidatePath('/admin/excursiones/liquidaciones')
    revalidatePath(`/admin/excursiones/liquidaciones/${liquidacion.id}`)
    revalidatePath('/admin/excursiones/comisiones')
    return { success: `Liquidación ${liquidacion.numero} ${estado.toLowerCase()}.` }
  } catch (e) {
    console.error('[excursiones] cambiarEstadoLiquidacion:', e)
    return { error: 'No se pudo cambiar el estado de la liquidación.' }
  }
}
