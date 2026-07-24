'use server'

/**
 * App Car Wash · E5 — acciones de EVIDENCIA FOTOGRÁFICA.
 * La foto se sube desde el navegador al bucket `evidencias` (Supabase
 * Storage); aquí solo se registra la URL resultante con su contexto.
 */

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireSection } from '@/lib/auth/guards'
import { getRequestMeta } from '@/lib/server-utils'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { EVIDENCIA_MOMENTOS } from './evidencias'

const RUTA_EVIDENCIAS = '/admin/app/carwash/evidencias'

export interface EvidenciaActionState {
  error?: string
  success?: string
}

async function contextoEvidencias() {
  const user = await requireSection('app')
  if (!user) return { error: 'No tienes permisos para administrar evidencias.' as const }
  const companyId = user.metadata.companyId
  if (!companyId) return { error: 'Tu cuenta no está vinculada a una empresa.' as const }
  if (!(await tieneCapacidad(companyId, 'EVIDENCIA_FOTOS'))) {
    return { error: 'Las fotos antes/después no están activadas para tu negocio.' as const }
  }
  return { user, companyId }
}

export async function guardarEvidencia(
  _prev: EvidenciaActionState,
  formData: FormData
): Promise<EvidenciaActionState> {
  try {
    const ctx = await contextoEvidencias()
    if ('error' in ctx) return { error: ctx.error }

    const url = String(formData.get('url') ?? '').trim()
    const momento = String(formData.get('momento') ?? '').trim()
    const colaId = String(formData.get('colaId') ?? '').trim()
    let placa = String(formData.get('placa') ?? '').trim().toUpperCase().slice(0, 20)
    const nota = String(formData.get('nota') ?? '').trim().slice(0, 300)

    if (!url) return { error: 'Sube la foto primero.' }
    if (!url.startsWith('https://')) return { error: 'La URL de la foto no es válida.' }
    if (!(EVIDENCIA_MOMENTOS as readonly string[]).includes(momento)) {
      return { error: 'Indica si la foto es de antes o de después.' }
    }

    // Si viene ligada a la cola, hereda cliente/vehículo/placa de la entrada.
    let clienteId: string | null = null
    let vehiculoId: string | null = null
    let colaIdValida: string | null = null
    if (colaId) {
      const entrada = await prisma.colaVehiculo
        .findUnique({
          where: { id: colaId },
          select: { companyId: true, clienteId: true, vehiculoId: true, placa: true },
        })
        .catch(() => null)
      if (!entrada || entrada.companyId !== ctx.companyId) {
        return { error: 'La entrada de cola indicada no existe.' }
      }
      colaIdValida = colaId
      clienteId = entrada.clienteId
      vehiculoId = entrada.vehiculoId
      if (!placa && entrada.placa) placa = entrada.placa
    }

    const evidencia = await prisma.evidenciaFoto.create({
      data: {
        companyId: ctx.companyId,
        colaId: colaIdValida,
        clienteId,
        vehiculoId,
        placa: placa || null,
        momento,
        url,
        nota: nota || null,
        subidaPorId: ctx.user.metadata.dbUserId ?? null,
      },
      select: { id: true },
    })

    const meta = await getRequestMeta()
    await prisma.auditLog
      .create({
        data: {
          companyId: ctx.companyId,
          userId: ctx.user.metadata.dbUserId ?? null,
          accion: 'NOTA_INTERNA',
          entidadTipo: 'EvidenciaFoto',
          entidadId: evidencia.id,
          payload: { tipo: 'EVIDENCIA_SUBIDA', momento, placa, colaId: colaIdValida },
          ...meta,
        },
      })
      .catch(() => {})

    revalidatePath(RUTA_EVIDENCIAS)
    revalidatePath('/admin/app/carwash/cola')
    return { success: 'Foto guardada.' }
  } catch (e) {
    console.error('[evidencias] guardar:', e)
    return {
      error:
        'No se pudo guardar. Si acabas de instalar esta versión, corre la migración 20260759_e5_carwash en la base de datos.',
    }
  }
}

export async function eliminarEvidencia(id: string): Promise<{ ok?: true; error?: string }> {
  try {
    const ctx = await contextoEvidencias()
    if ('error' in ctx) return { error: ctx.error }

    const evidencia = await prisma.evidenciaFoto.findUnique({
      where: { id },
      select: { companyId: true },
    })
    if (!evidencia || evidencia.companyId !== ctx.companyId) {
      return { error: 'Foto no encontrada.' }
    }
    await prisma.evidenciaFoto.delete({ where: { id } })

    revalidatePath(RUTA_EVIDENCIAS)
    revalidatePath('/admin/app/carwash/cola')
    return { ok: true }
  } catch (e) {
    console.error('[evidencias] eliminar:', e)
    return { error: 'No se pudo eliminar la foto. Intenta de nuevo.' }
  }
}
