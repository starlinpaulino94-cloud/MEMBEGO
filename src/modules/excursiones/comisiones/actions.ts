'use server'

/**
 * EXCURSIONES · Comisiones — acciones.
 *
 * Las reglas se pueden crear y desactivar, pero NUNCA se recalculan las
 * comisiones ya generadas: cada una lleva dentro el snapshot de la regla con
 * la que nació. Cambiar la regla afecta a lo que venga, no a lo que fue (§26).
 */

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getRequestMeta } from '@/lib/server-utils'
import { anotarFallo } from '@/lib/prisma-errors'
import {
  validarRegla,
  puedeTransicionar,
  motivoTransicionInvalida,
  netoComision,
  ESTADOS_COMISION,
  type EstadoComision,
} from './nucleo'

export interface ComisionActionState {
  error?: string
  success?: string
}

async function auditar(
  companyId: string,
  userId: string | null,
  entidadTipo: string,
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
        entidadTipo,
        entidadId,
        payload: payload as Prisma.InputJsonObject,
        ...meta,
      },
    })
  ).catch(anotarFallo('excursiones:comisiones:auditLog'))
}

/** Los escalones llegan como filas paralelas del formulario. */
function escalonesDelFormulario(formData: FormData) {
  const desde = formData.getAll('escalonDesde').map(String)
  const hasta = formData.getAll('escalonHasta').map(String)
  const pct = formData.getAll('escalonPct').map(String)
  return desde
    .map((d, i) => ({ desde: d, hasta: hasta[i] ?? '', pct: pct[i] ?? '' }))
    .filter((e) => e.desde.trim() && e.pct.trim())
}

/** ADMIN · Crear una regla de comisión. */
export async function crearRegla(
  _prev: ComisionActionState,
  formData: FormData
): Promise<ComisionActionState> {
  try {
    const user = await requireSection('excursiones', 'comision_reglas')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }

    const rawExcursionIds = Array.from(
      new Set(
        formData
          .getAll('excursionId')
          .map((e) => String(e).trim())
          .filter(Boolean)
      )
    )
    const primerExcursion = rawExcursionIds[0] || String(formData.get('excursionId') ?? '').trim()

    const rawTiposVendedor = Array.from(
      new Set(
        formData
          .getAll('tipoVendedor')
          .map((t) => String(t).trim())
          .filter(Boolean)
      )
    )
    const primerTipoVendedor = rawTiposVendedor[0] || String(formData.get('tipoVendedor') ?? '').trim()

    const rawVendedorIds = Array.from(
      new Set(
        formData
          .getAll('vendedorId')
          .map((v) => String(v).trim())
          .filter(Boolean)
      )
    )
    const primerVendedor = rawVendedorIds[0] || String(formData.get('vendedorId') ?? '').trim()

    const v = validarRegla({
      ambito: String(formData.get('ambito') ?? ''),
      tipoCalculo: String(formData.get('tipoCalculo') ?? ''),
      valor: String(formData.get('valor') ?? ''),
      excursionId: primerExcursion,
      vendedorId: primerVendedor,
      categoria: String(formData.get('categoria') ?? ''),
      tipoVendedor: primerTipoVendedor,
      vigenciaDesde: String(formData.get('vigenciaDesde') ?? ''),
      vigenciaHasta: String(formData.get('vigenciaHasta') ?? ''),
      escalones: escalonesDelFormulario(formData),
    })
    if (!v.ok) return { error: v.error }

    const pideExcursion = v.datos.ambito === 'EXCURSION' || v.datos.ambito === 'VENDEDOR_EXCURSION'
    const listaExcursiones = pideExcursion
      ? rawExcursionIds.length > 0
        ? rawExcursionIds
        : primerExcursion
          ? [primerExcursion]
          : []
      : []

    if (pideExcursion && listaExcursiones.length === 0) {
      return { error: 'Selecciona al menos una excursión.' }
    }

    if (listaExcursiones.length > 0) {
      const encontradas = await conEmpresa(companyId, (tx) =>
        tx.excursion.count({ where: { id: { in: listaExcursiones }, companyId } })
      )
      if (encontradas !== listaExcursiones.length) {
        return { error: 'Una o más excursiones seleccionadas no existen en tu empresa.' }
      }
    }

    const pideVendedor = v.datos.ambito === 'VENDEDOR' || v.datos.ambito === 'VENDEDOR_EXCURSION'
    const listaVendedores = pideVendedor
      ? rawVendedorIds.length > 0
        ? rawVendedorIds
        : primerVendedor
          ? [primerVendedor]
          : []
      : []

    if (pideVendedor && listaVendedores.length === 0) {
      return { error: 'Selecciona al menos un vendedor.' }
    }

    if (listaVendedores.length > 0) {
      const encontrados = await conEmpresa(companyId, (tx) =>
        tx.vendedor.count({ where: { id: { in: listaVendedores }, companyId } })
      )
      if (encontrados !== listaVendedores.length) {
        return { error: 'Uno o más vendedores seleccionados no existen en tu empresa.' }
      }
    }

    const pideTipoVendedor = v.datos.ambito === 'TIPO_VENDEDOR'
    const listaTiposVendedor = pideTipoVendedor
      ? rawTiposVendedor.length > 0
        ? rawTiposVendedor
        : primerTipoVendedor
          ? [primerTipoVendedor]
          : []
      : []

    if (pideTipoVendedor && listaTiposVendedor.length === 0) {
      return { error: 'Selecciona al menos un tipo de vendedor.' }
    }

    // Armar combinaciones para la creación de reglas
    let combinaciones: {
      vendedorId: string | null
      excursionId: string | null
      tipoVendedor: string | null
    }[] = []
    if (v.datos.ambito === 'VENDEDOR_EXCURSION') {
      combinaciones = listaVendedores.flatMap((vid) =>
        listaExcursiones.map((eid) => ({ vendedorId: vid, excursionId: eid, tipoVendedor: null }))
      )
    } else if (v.datos.ambito === 'EXCURSION') {
      combinaciones = listaExcursiones.map((eid) => ({ vendedorId: null, excursionId: eid, tipoVendedor: null }))
    } else if (v.datos.ambito === 'VENDEDOR') {
      combinaciones = listaVendedores.map((vid) => ({ vendedorId: vid, excursionId: null, tipoVendedor: null }))
    } else if (v.datos.ambito === 'TIPO_VENDEDOR') {
      combinaciones = listaTiposVendedor.map((tid) => ({ vendedorId: null, excursionId: null, tipoVendedor: tid }))
    } else {
      combinaciones = [{ vendedorId: null, excursionId: null, tipoVendedor: null }]
    }

    const resultado = await conEmpresa(companyId, async (tx) => {
      if (combinaciones.length > 1) {
        await tx.comisionRegla.createMany({
          data: combinaciones.map((c) => ({
            companyId,
            ambito: v.datos.ambito,
            tipoCalculo: v.datos.tipoCalculo,
            valor: v.datos.valor,
            escalones: v.datos.escalones
              ? (v.datos.escalones as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            excursionId: c.excursionId,
            vendedorId: c.vendedorId,
            categoria: v.datos.categoria,
            tipoVendedor: c.tipoVendedor,
            vigenciaDesde: v.datos.vigenciaDesde,
            vigenciaHasta: v.datos.vigenciaHasta,
          })),
        })
        return { id: 'multiples', total: combinaciones.length }
      }

      const unica = await tx.comisionRegla.create({
        data: {
          companyId,
          ambito: v.datos.ambito,
          tipoCalculo: v.datos.tipoCalculo,
          valor: v.datos.valor,
          escalones: v.datos.escalones
            ? (v.datos.escalones as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          excursionId: combinaciones[0]?.excursionId || null,
          vendedorId: combinaciones[0]?.vendedorId || null,
          categoria: v.datos.categoria,
          tipoVendedor: combinaciones[0]?.tipoVendedor || null,
          vigenciaDesde: v.datos.vigenciaDesde,
          vigenciaHasta: v.datos.vigenciaHasta,
        },
        select: { id: true },
      })
      return { id: unica.id, total: 1 }
    })

    await auditar(companyId, user.metadata.dbUserId ?? null, 'ComisionRegla', resultado.id, {
      tipo: 'REGLA_CREADA',
      ambito: v.datos.ambito,
      tipoCalculo: v.datos.tipoCalculo,
      valor: v.datos.valor,
      totalReglas: resultado.total,
    })
    revalidatePath('/admin/excursiones/comisiones/reglas')
    return {
      success:
        resultado.total > 1
          ? `Reglas creadas (${resultado.total} en total).`
          : 'Regla creada. Se aplicará a las ventas que se confirmen desde ahora.',
    }
  } catch (e) {
    console.error('[excursiones] crearRegla:', e)
    return { error: 'No se pudo crear la regla.' }
  }
}

/**
 * ADMIN · Activar o desactivar una regla. Nunca se borra: una regla apagada
 * sigue explicando las comisiones que generó cuando estaba encendida.
 */
export async function alternarRegla(
  _prev: ComisionActionState,
  formData: FormData
): Promise<ComisionActionState> {
  try {
    const user = await requireSection('excursiones', 'comision_reglas')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const reglaId = String(formData.get('reglaId') ?? '')
    const activa = String(formData.get('activa') ?? '') === 'true'

    const upd = await conEmpresa(companyId, (tx) =>
      tx.comisionRegla.updateMany({ where: { id: reglaId, companyId }, data: { activa } })
    )
    if (upd.count === 0) return { error: 'Regla no encontrada.' }

    await auditar(companyId, user.metadata.dbUserId ?? null, 'ComisionRegla', reglaId, {
      tipo: 'REGLA_ESTADO',
      activa,
    })
    revalidatePath('/admin/excursiones/comisiones/reglas')
    return { success: activa ? 'Regla activada.' : 'Regla desactivada.' }
  } catch (e) {
    console.error('[excursiones] alternarRegla:', e)
    return { error: 'No se pudo cambiar la regla.' }
  }
}

/**
 * ADMIN · Mover una comisión por su ciclo de vida. La máquina de estados vive
 * en el núcleo y aquí solo se obedece: una comisión pagada no retrocede.
 */
export async function cambiarEstadoComision(
  _prev: ComisionActionState,
  formData: FormData
): Promise<ComisionActionState> {
  try {
    const estado = String(formData.get('estado') ?? '') as EstadoComision
    if (!(ESTADOS_COMISION as readonly string[]).includes(estado)) {
      return { error: 'Estado no reconocido.' }
    }
    const user = await requireSection('excursiones', 'comision_aprobar')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const comisionId = String(formData.get('comisionId') ?? '')

    const comision = await conEmpresa(companyId, (tx) =>
      tx.comisionEntrada.findFirst({
        where: { id: comisionId, companyId },
        select: { id: true, estado: true },
      })
    )
    if (!comision) return { error: 'Comisión no encontrada.' }

    const desde = comision.estado as EstadoComision
    if (!puedeTransicionar(desde, estado)) {
      return { error: motivoTransicionInvalida(desde, estado) ?? 'Cambio no permitido.' }
    }

    const esReanude = desde === 'ANULADA' && estado === 'GENERADA'

    await conEmpresa(companyId, (tx) =>
      tx.comisionEntrada.updateMany({
        where: { id: comision.id, companyId },
        data: esReanude ? { estado, liquidacionId: null } : { estado },
      })
    )

    await auditar(companyId, user.metadata.dbUserId ?? null, 'ComisionEntrada', comision.id, {
      tipo: esReanude ? 'COMISION_REANUDE' : 'COMISION_ESTADO',
      desde,
      hacia: estado,
    })
    revalidatePath('/admin/excursiones/comisiones')
    return { success: `Comisión ${estado.toLowerCase().replace('_', ' ')}.` }
  } catch (e) {
    console.error('[excursiones] cambiarEstadoComision:', e)
    return { error: 'No se pudo cambiar el estado.' }
  }
}

/**
 * ADMIN · Ajustar una comisión con un monto firmado y su motivo. Es el único
 * camino para corregir una comisión ya pagada: las dos cifras quedan a la
 * vista y el histórico cuadra.
 */
export async function ajustarComision(
  _prev: ComisionActionState,
  formData: FormData
): Promise<ComisionActionState> {
  try {
    const user = await requireSection('excursiones', 'comision_ajustar')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const comisionId = String(formData.get('comisionId') ?? '')
    const motivo = String(formData.get('motivo') ?? '').trim().slice(0, 300)
    const monto = Math.round(Number(String(formData.get('monto') ?? '')) * 100) / 100
    if (!motivo) return { error: 'Un ajuste sin motivo no se puede auditar: escribe por qué.' }
    if (!Number.isFinite(monto) || monto === 0) {
      return { error: 'El ajuste debe ser un monto distinto de cero (negativo para descontar).' }
    }

    const comision = await conEmpresa(companyId, (tx) =>
      tx.comisionEntrada.findFirst({
        where: { id: comisionId, companyId },
        select: { id: true, monto: true, estado: true, ajustes: { select: { monto: true } } },
      })
    )
    if (!comision) return { error: 'Comisión no encontrada.' }

    const ESTADOS_AJUSTABLES = ['APROBADA', 'PENDIENTE_PAGO', 'PAGADA'] as const
    if (!(ESTADOS_AJUSTABLES as readonly string[]).includes(comision.estado)) {
      return { error: 'Solo se pueden ajustar comisiones en estado Aprobada, Pendiente de pago o Pagada.' }
    }

    // Un ajuste no puede dejar al vendedor debiendo dinero.
    const neto = netoComision(
      Number(comision.monto),
      comision.ajustes.map((a) => ({ monto: Number(a.monto) }))
    )
    if (monto < 0 && Math.abs(monto) > neto) {
      return { error: `El descuento no puede pasar del neto actual (${neto}).` }
    }

    await conEmpresa(companyId, (tx) =>
      tx.comisionAjuste.create({
        data: {
          companyId,
          comisionId: comision.id,
          monto,
          motivo,
          responsableId: user.metadata.dbUserId ?? null,
        },
      })
    )

    await auditar(companyId, user.metadata.dbUserId ?? null, 'ComisionEntrada', comision.id, {
      tipo: 'COMISION_AJUSTE',
      monto,
      motivo,
    })
    revalidatePath('/admin/excursiones/comisiones')
    return { success: 'Ajuste registrado.' }
  } catch (e) {
    console.error('[excursiones] ajustarComision:', e)
    return { error: 'No se pudo registrar el ajuste.' }
  }
}
