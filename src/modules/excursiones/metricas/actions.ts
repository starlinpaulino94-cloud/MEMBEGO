'use server'

/**
 * EXCURSIONES · Metas — acciones. Una meta se define y se apaga; no se borra,
 * porque el histórico de qué se le pidió a alguien explica después por qué
 * cobró (o no) su bono.
 */

import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getRequestMeta } from '@/lib/server-utils'
import { anotarFallo } from '@/lib/prisma-errors'
import { validarMeta } from './nucleo'

export interface MetaActionState {
  error?: string
  success?: string
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
        entidadTipo: 'VendedorMeta',
        entidadId,
        payload: payload as Prisma.InputJsonObject,
        ...meta,
      },
    })
  ).catch(anotarFallo('excursiones:metas:auditLog'))
}

/** ADMIN · Ponerle una meta a uno o varios vendedores, o por tipo de vendedor. */
export async function crearMeta(
  _prev: MetaActionState,
  formData: FormData
): Promise<MetaActionState> {
  try {
    const user = await requireSection('excursiones', 'meta_definir')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }

    const ambito = String(formData.get('ambito') ?? 'VENDEDOR')
    const rawVendedorIds = Array.from(
      new Set(formData.getAll('vendedorId').map(String).filter(Boolean))
    )
    const primerVendedor = rawVendedorIds[0] || String(formData.get('vendedorId') ?? '').trim()
    const tipoVendedor = String(formData.get('tipoVendedor') ?? '').trim() || null
    const excursionId = String(formData.get('excursionId') ?? '').trim() || null

    const v = validarMeta({
      vendedorId: primerVendedor || null,
      tipoVendedor: ambito === 'TIPO_VENDEDOR' ? tipoVendedor : null,
      excursionId,
      periodo: String(formData.get('periodo') ?? ''),
      desde: String(formData.get('desde') ?? ''),
      hasta: String(formData.get('hasta') ?? ''),
      metaVentas: String(formData.get('metaVentas') ?? ''),
      metaPasajeros: String(formData.get('metaPasajeros') ?? ''),
      metaIngresos: String(formData.get('metaIngresos') ?? ''),
      metaRegistros: String(formData.get('metaRegistros') ?? ''),
      metaReservas: String(formData.get('metaReservas') ?? ''),
    })
    if (!v.ok) return { error: v.error }

    if (ambito === 'VENDEDOR' && rawVendedorIds.length === 0 && !primerVendedor) {
      return { error: 'Selecciona al menos un vendedor.' }
    }

    if (ambito === 'TIPO_VENDEDOR' && !tipoVendedor) {
      return { error: 'Selecciona un tipo de vendedor.' }
    }

    if (ambito === 'VENDEDOR' && rawVendedorIds.length > 1) {
      await conEmpresa(companyId, (tx) =>
        tx.vendedorMeta.createMany({
          data: rawVendedorIds.map((vid) => ({
            companyId,
            vendedorId: vid,
            tipoVendedor: null,
            excursionId: v.datos.excursionId,
            periodo: v.datos.periodo,
            desde: v.datos.desde,
            hasta: v.datos.hasta,
            metaVentas: v.datos.metaVentas,
            metaPasajeros: v.datos.metaPasajeros,
            metaIngresos: v.datos.metaIngresos,
            metaRegistros: v.datos.metaRegistros,
            metaReservas: v.datos.metaReservas,
          })),
        })
      )
    } else {
      await conEmpresa(companyId, (tx) =>
        tx.vendedorMeta.create({
          data: {
            companyId,
            vendedorId: ambito === 'VENDEDOR' ? (rawVendedorIds[0] || primerVendedor || null) : null,
            tipoVendedor: ambito === 'TIPO_VENDEDOR' ? tipoVendedor : null,
            excursionId: v.datos.excursionId,
            periodo: v.datos.periodo,
            desde: v.datos.desde,
            hasta: v.datos.hasta,
            metaVentas: v.datos.metaVentas,
            metaPasajeros: v.datos.metaPasajeros,
            metaIngresos: v.datos.metaIngresos,
            metaRegistros: v.datos.metaRegistros,
            metaReservas: v.datos.metaReservas,
          },
        })
      )
    }

    revalidatePath('/admin/excursiones/metas')
    revalidatePath('/vendedor')
    revalidatePath('/vendedor/metas')
    return { success: 'Meta creada exitosamente.' }
  } catch (e) {
    console.error('[excursiones] crearMeta:', e)
    return { error: 'No se pudo crear la meta.' }
  }
}

/** ADMIN · Apagar una meta (su histórico se queda). */
export async function archivarMeta(
  _prev: MetaActionState,
  formData: FormData
): Promise<MetaActionState> {
  try {
    const user = await requireSection('excursiones', 'meta_definir')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const metaId = String(formData.get('metaId') ?? '')

    const upd = await conEmpresa(companyId, (tx) =>
      tx.vendedorMeta.updateMany({ where: { id: metaId, companyId }, data: { activa: false } })
    )
    if (upd.count === 0) return { error: 'Meta no encontrada.' }

    await auditar(companyId, user.metadata.dbUserId ?? null, metaId, { tipo: 'META_ARCHIVADA' })
    revalidatePath('/admin/excursiones/metas')
    return { success: 'Meta archivada.' }
  } catch (e) {
    console.error('[excursiones] archivarMeta:', e)
    return { error: 'No se pudo archivar la meta.' }
  }
}
