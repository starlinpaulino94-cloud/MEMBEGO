'use server'

/**
 * Seguimiento de beneficios gratis · Fase S2 (docs/SEGUIMIENTO-BENEFICIOS.md).
 * Recordatorio in-app al cliente que aún no ha usado su recompensa. El canje
 * interno NO vive aquí: reutiliza `confirmarCanjePromocion` con `interno=1`
 * (un solo flujo de canje para todos los reportes).
 */

import { revalidatePath } from 'next/cache'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { getRequestMeta } from '@/lib/server-utils'
import { crearNotificacion } from '@/modules/notificaciones/service'
import {
  getSeguimientoConfig,
  renderMensajeSeguimiento,
  SEGUIMIENTO_DEFAULTS,
} from '@/modules/seguimiento/config'

export async function enviarRecordatorioSeguimiento(
  compraId: string
): Promise<{ ok?: true; error?: string }> {
  try {
    const user = await requireSection('seguimiento')
    if (!user) return { error: 'No tienes permisos para enviar recordatorios.' }

    const compra = await sinEmpresa(
      'seguimiento: localizar recompensa por id (su empresa se deriva de la compra)',
      (tx) =>
        tx.productoCompra.findUnique({
          where: { id: compraId },
          select: {
            id: true,
            companyId: true,
            estado: true,
            usosRestantes: true,
            fechaVencimiento: true,
            promocion: { select: { id: true, titulo: true } },
            cliente: {
              select: {
                supabaseId: true,
                nombre: true,
                company: { select: { name: true, zonaHoraria: true } },
              },
            },
          },
        })
    )
    if (!compra) return { error: 'Recompensa no encontrada.' }
    if (
      user.metadata.role !== 'SUPERADMIN' &&
      user.metadata.companyId !== compra.companyId
    ) {
      return { error: 'Esta recompensa pertenece a otra empresa.' }
    }
    if (compra.estado !== 'ACTIVA' || compra.usosRestantes <= 0) {
      return { error: 'Esta recompensa ya no está disponible para el cliente.' }
    }

    const destinatario = await sinEmpresa(
      'seguimiento: buscar usuario global por supabaseId (id del destinatario de la notificación)',
      (tx) =>
        tx.user.findUnique({
          where: { supabaseId: compra.cliente.supabaseId },
          select: { id: true },
        })
    )
    if (!destinatario) {
      return { error: 'El cliente no tiene cuenta de usuario para notificar.' }
    }

    const config = await getSeguimientoConfig(compra.companyId)
    const vence = compra.fechaVencimiento
      ? new Intl.DateTimeFormat('es-DO', {
          timeZone: compra.cliente.company.zonaHoraria,
          dateStyle: 'medium',
        }).format(compra.fechaVencimiento)
      : null
    await crearNotificacion({
      userId: destinatario.id,
      tipo: 'SISTEMA',
      titulo: '🎁 Tienes una recompensa sin usar',
      mensaje: renderMensajeSeguimiento(config.plantillaMensaje, {
        cliente: compra.cliente.nombre,
        empresa: compra.cliente.company.name,
        recompensa: compra.promocion?.titulo ?? 'tu recompensa',
        vence,
      }),
      href: '/cliente/mis-promociones',
    })

    // Trazabilidad: el recordatorio queda en auditoría con fecha/hora y admin.
    const meta = await getRequestMeta()
    await conEmpresa(compra.companyId, (tx) =>
      tx.auditLog.create({
        data: {
          companyId: compra.companyId,
          userId: user.metadata.dbUserId ?? null,
          accion: 'NOTA_INTERNA',
          entidadTipo: 'ProductoCompra',
          entidadId: compra.id,
          payload: {
            tipo: 'RECORDATORIO_SEGUIMIENTO',
            promocionId: compra.promocion?.id ?? null,
            cliente: compra.cliente.nombre,
          },
          ...meta,
        },
      })
    )

    return { ok: true }
  } catch (e) {
    console.error('[seguimiento] enviarRecordatorioSeguimiento:', e)
    return { error: 'Error interno al enviar el recordatorio.' }
  }
}

// ── Parametrización (Fase S3) ───────────────────────────────────────────────

export interface SeguimientoConfigState {
  error?: string
  success?: string
}

export async function guardarSeguimientoConfig(
  _prev: SeguimientoConfigState,
  formData: FormData
): Promise<SeguimientoConfigState> {
  try {
    const user = await requireSection('seguimiento')
    if (!user) return { error: 'No autorizado.' }
    const companyId = user.metadata.companyId
    if (!companyId) return { error: 'Tu cuenta no está vinculada a una empresa.' }

    const int = (name: string, min: number, max: number, campo: string) => {
      const n = Math.trunc(Number(formData.get(name)))
      if (!Number.isFinite(n) || n < min || n > max) {
        throw new Error(`VALIDACION:${campo} debe estar entre ${min} y ${max}.`)
      }
      return n
    }
    const umbralPorVencerDias = int('umbralPorVencerDias', 1, 90, 'El umbral de "por vencer"')
    const recordatorioDiasAntes = int('recordatorioDiasAntes', 1, 90, 'Los días de anticipación')
    const recordatorioFrecuenciaDias = int(
      'recordatorioFrecuenciaDias',
      1,
      90,
      'La frecuencia del recordatorio'
    )
    const plantillaMensaje =
      String(formData.get('plantillaMensaje') ?? '').trim().slice(0, 500) ||
      SEGUIMIENTO_DEFAULTS.plantillaMensaje
    // Excluidas = todas las promos listadas en el formulario menos las marcadas
    // como "rastrear" (así una promo nueva queda rastreada por defecto).
    const todas = formData.getAll('promoTodas').map(String).filter(Boolean)
    const rastreadas = new Set(formData.getAll('promoRastrear').map(String))
    const promosExcluidas = todas.filter((id) => !rastreadas.has(id)).slice(0, 100)

    const config = {
      umbralPorVencerDias,
      recordatorioAuto: formData.get('recordatorioAuto') === 'on',
      recordatorioDiasAntes,
      recordatorioFrecuenciaDias,
      plantillaMensaje,
      promosExcluidas,
    }

    await conEmpresa(companyId, (tx) =>
      tx.company.update({
        where: { id: companyId },
        data: { seguimientoConfig: config },
      })
    )
    revalidatePath('/admin/seguimiento')
    return { success: 'Configuración guardada.' }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('VALIDACION:')) {
      return { error: e.message.slice('VALIDACION:'.length) }
    }
    console.error('[seguimiento] guardarSeguimientoConfig:', e)
    return {
      error:
        'No se pudo guardar. Si acabas de instalar esta versión, corre la migración 20260754_seguimiento_config en la base de datos.',
    }
  }
}
