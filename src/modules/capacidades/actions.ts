'use server'

/**
 * Plataforma modular · E4 — administración de capacidades por empresa.
 * SOLO el superadmin edita (el admin de la empresa las ve reflejadas en su
 * launchpad/shell). Guarda ÚNICAMENTE los overrides que difieren del paquete
 * base de la categoría: así, si mañana el paquete base cambia, las empresas
 * sin override lo heredan solo.
 */

import { revalidatePath, revalidateTag } from 'next/cache'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'
import {
  CAPACIDADES,
  CATEGORIAS,
  CAPACIDADES_BASE,
  categoriaDeType,
  type Capacidad,
  type CategoriaNegocio,
} from './catalogo'
import { CAPACIDADES_TAG } from './resolver'

export interface CapacidadesActionState {
  error?: string
  success?: string
}

export async function guardarCapacidades(
  _prev: CapacidadesActionState,
  formData: FormData
): Promise<CapacidadesActionState> {
  try {
    const user = await getUser()
    if (!user || user.metadata.role !== 'SUPERADMIN') {
      return { error: 'Solo el superadmin puede administrar capacidades.' }
    }

    const companyId = String(formData.get('companyId') ?? '').trim()
    if (!companyId) return { error: 'Empresa no especificada.' }
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, type: true },
    })
    if (!company) return { error: 'Empresa no encontrada.' }

    // Categoría elegida (o la derivada del type si no se cambia).
    const categoriaRaw = String(formData.get('categoria') ?? '').trim()
    const categoria: CategoriaNegocio = (CATEGORIAS as readonly string[]).includes(categoriaRaw)
      ? (categoriaRaw as CategoriaNegocio)
      : categoriaDeType(company.type)

    // Toggles del formulario → overrides SOLO donde difieren del paquete base.
    const base = new Set(CAPACIDADES_BASE[categoria])
    const overrides: Partial<Record<Capacidad, boolean>> = {}
    for (const cap of CAPACIDADES) {
      const encendida = formData.get(`cap_${cap}`) === 'on'
      if (encendida !== base.has(cap)) overrides[cap] = encendida
    }

    const derivada = categoriaDeType(company.type)
    const config = {
      ...(categoria !== derivada ? { categoria } : {}),
      ...(Object.keys(overrides).length ? { overrides } : {}),
    }

    const meta = await getRequestMeta()
    await prisma.company.update({
      where: { id: companyId },
      data: { capacidades: Object.keys(config).length ? config : Prisma.DbNull },
    })
    await prisma.auditLog
      .create({
        data: {
          companyId,
          userId: user.metadata.dbUserId ?? null,
          accion: 'NOTA_INTERNA',
          entidadTipo: 'Company',
          entidadId: companyId,
          payload: { tipo: 'CAPACIDADES_ACTUALIZADAS', categoria, overrides },
          ...meta,
        },
      })
      .catch(() => {})

    // El resolutor está cacheado por tag: los cambios aplican de inmediato.
    revalidateTag(CAPACIDADES_TAG, 'max')
    revalidatePath('/superadmin/capacidades')
    revalidatePath('/admin/aplicaciones')
    revalidatePath('/admin/app/carwash')
    return { success: `Capacidades de ${company.name} guardadas.` }
  } catch (e) {
    console.error('[capacidades] guardar:', e)
    return {
      error:
        'No se pudo guardar. Si acabas de instalar esta versión, corre la migración 20260758_capacidades en la base de datos.',
    }
  }
}
