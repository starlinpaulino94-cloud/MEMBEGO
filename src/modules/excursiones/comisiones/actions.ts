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

    const v = validarRegla({
      ambito: String(formData.get('ambito') ?? ''),
      tipoCalculo: String(formData.get('tipoCalculo') ?? ''),
      valor: String(formData.get('valor') ?? ''),
      excursionId: String(formData.get('excursionId') ?? ''),
      vendedorId: String(formData.get('vendedorId') ?? ''),
      categoria: String(formData.get('categoria') ?? ''),
      vigenciaDesde: String(formData.get('vigenciaDesde') ?? ''),
      vigenciaHasta: String(formData.get('vigenciaHasta') ?? ''),
      escalones: escalonesDelFormulario(formData),
    })
    if (!v.ok) return { error: v.error }

    // La excursión y el vendedor referidos tienen que ser de ESTA empresa.
    if (v.datos.excursionId) {
      const ok = await conEmpresa(companyId, (tx) =>
        tx.excursion.findFirst({ where: { id: v.datos.excursionId!, companyId }, select: { id: true } })
      )
      if (!ok) return { error: 'Esa excursión no existe en tu empresa.' }
    }
    if (v.datos.vendedorId) {
      const ok = await conEmpresa(companyId, (tx) =>
        tx.vendedor.findFirst({ where: { id: v.datos.vendedorId!, companyId }, select: { id: true } })
      )
      if (!ok) return { error: 'Ese vendedor no existe en tu empresa.' }
    }

    const regla = await conEmpresa(companyId, (tx) =>
      tx.comisionRegla.create({
        data: {
          companyId,
          ambito: v.datos.ambito,
          tipoCalculo: v.datos.tipoCalculo,
          valor: v.datos.valor,
          escalones: v.datos.escalones
            ? (v.datos.escalones as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          excursionId: v.datos.excursionId,
          vendedorId: v.datos.vendedorId,
          categoria: v.datos.categoria,
          vigenciaDesde: v.datos.vigenciaDesde,
          vigenciaHasta: v.datos.vigenciaHasta,
        },
        select: { id: true },
      })
    )

    await auditar(companyId, user.metadata.dbUserId ?? null, 'ComisionRegla', regla.id, {
      tipo: 'REGLA_CREADA',
      ambito: v.datos.ambito,
      tipoCalculo: v.datos.tipoCalculo,
      valor: v.datos.valor,
    })
    revalidatePath('/admin/excursiones/comisiones/reglas')
    return { success: 'Regla creada. Se aplicará a las ventas que se confirmen desde ahora.' }
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

    await conEmpresa(companyId, (tx) =>
      tx.comisionEntrada.updateMany({
        where: { id: comision.id, companyId },
        data: { estado },
      })
    )

    await auditar(companyId, user.metadata.dbUserId ?? null, 'ComisionEntrada', comision.id, {
      tipo: 'COMISION_ESTADO',
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
        select: { id: true, monto: true, ajustes: { select: { monto: true } } },
      })
    )
    if (!comision) return { error: 'Comisión no encontrada.' }

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
