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

/** ADMIN · Ponerle una meta a un vendedor. */
export async function crearMeta(
  _prev: MetaActionState,
  formData: FormData
): Promise<MetaActionState> {
  try {
    const user = await requireSection('excursiones', 'meta_definir')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }

    const v = validarMeta({
      vendedorId: String(formData.get('vendedorId') ?? ''),
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

    const vendedor = await conEmpresa(companyId, (tx) =>
      tx.vendedor.findFirst({
        where: { id: v.datos.vendedorId, companyId },
        select: { id: true, codigo: true },
      })
    )
    if (!vendedor) return { error: 'Ese vendedor no existe en tu empresa.' }

    const meta = await conEmpresa(companyId, (tx) =>
      tx.vendedorMeta.create({
        data: { companyId, ...v.datos },
        select: { id: true },
      })
    )

    await auditar(companyId, user.metadata.dbUserId ?? null, meta.id, {
      tipo: 'META_CREADA',
      vendedor: vendedor.codigo,
      periodo: v.datos.periodo,
    })
    revalidatePath('/admin/excursiones/metas')
    return { success: 'Meta creada.' }
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
