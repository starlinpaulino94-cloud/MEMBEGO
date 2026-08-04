import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { crearNotificacion } from '@/modules/notificaciones/service'
import {
  renderMensajeSeguimiento,
  resolverSeguimientoConfig,
  type SeguimientoConfig,
} from '@/modules/seguimiento/config'

/**
 * Seguimiento de beneficios gratis · Fase S3: recordatorio AUTOMÁTICO diario
 * (colgado del cron /api/cron/automatizaciones). Para cada empresa con el
 * recordatorio activo, avisa dentro de la app a los clientes con recompensas
 * gratis sin usar que vencen en ≤ N días. Deduplicado: no repite si ya hubo
 * recordatorio (manual o automático) dentro de la frecuencia configurada.
 * Idempotente y tolerante a fallos por empresa.
 */
export async function recordatoriosSeguimientoAuto(): Promise<{ recordatorios: number }> {
  const ahora = new Date()
  // Ventana generosa (90 días = máximo configurable); el corte fino por
  // empresa se aplica con su config.
  const ventanaMax = new Date(ahora.getTime() + 90 * 86_400_000)

  const compras = await sinEmpresa(
    'seguimiento: cron barre recompensas de todas las empresas',
    (tx) =>
      tx.productoCompra.findMany({
        where: {
          tipo: 'PROMOCION',
          promocionId: { not: null },
          estado: 'ACTIVA',
          usosRestantes: { gt: 0 },
          fechaVencimiento: { gt: ahora, lte: ventanaMax },
          OR: [{ precioCongelado: null }, { precioCongelado: { lte: 0 } }],
        },
        select: {
          id: true,
          companyId: true,
          promocionId: true,
          fechaVencimiento: true,
          promocion: { select: { titulo: true } },
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
  if (compras.length === 0) return { recordatorios: 0 }

  // Config por empresa (tolerante a la columna aún sin migrar).
  const companyIds = [...new Set(compras.map((c) => c.companyId))]
  const configs = new Map<string, SeguimientoConfig>()
  try {
    const companies = await sinEmpresa(
      'seguimiento: cron lee la config de varias empresas a la vez',
      (tx) =>
        tx.company.findMany({
          where: { id: { in: companyIds } },
          select: { id: true, seguimientoConfig: true },
        })
    )
    for (const c of companies) configs.set(c.id, resolverSeguimientoConfig(c.seguimientoConfig))
  } catch (e) {
    console.error('[seguimiento] cron config fallback a defaults', e)
    for (const id of companyIds) configs.set(id, resolverSeguimientoConfig(null))
  }

  // Candidatos según la config de SU empresa.
  const candidatos = compras.filter((c) => {
    const cfg = configs.get(c.companyId) ?? resolverSeguimientoConfig(null)
    if (!cfg.recordatorioAuto) return false
    if (c.promocionId && cfg.promosExcluidas.includes(c.promocionId)) return false
    const limite = ahora.getTime() + cfg.recordatorioDiasAntes * 86_400_000
    return !!c.fechaVencimiento && c.fechaVencimiento.getTime() <= limite
  })
  if (candidatos.length === 0) return { recordatorios: 0 }

  // Dedupe: recordatorios recientes (manuales o automáticos) por compra.
  const frecuenciaMax = Math.max(
    ...candidatos.map(
      (c) => (configs.get(c.companyId) ?? resolverSeguimientoConfig(null)).recordatorioFrecuenciaDias
    )
  )
  const desde = new Date(ahora.getTime() - frecuenciaMax * 86_400_000)
  const recientes = await sinEmpresa(
    'seguimiento: cron deduce la auditoría de varias empresas a la vez',
    (tx) =>
      tx.auditLog.findMany({
        where: {
          accion: 'NOTA_INTERNA',
          entidadTipo: 'ProductoCompra',
          entidadId: { in: candidatos.map((c) => c.id) },
          createdAt: { gte: desde },
        },
        select: { entidadId: true, createdAt: true, payload: true },
      })
  )
  const ultimoRecordatorio = new Map<string, Date>()
  for (const r of recientes) {
    const payload = (r.payload ?? {}) as { tipo?: string }
    if (payload.tipo !== 'RECORDATORIO_SEGUIMIENTO' || !r.entidadId) continue
    const prev = ultimoRecordatorio.get(r.entidadId)
    if (!prev || r.createdAt > prev) ultimoRecordatorio.set(r.entidadId, r.createdAt)
  }
  const pendientes = candidatos.filter((c) => {
    const cfg = configs.get(c.companyId) ?? resolverSeguimientoConfig(null)
    const ultimo = ultimoRecordatorio.get(c.id)
    if (!ultimo) return true
    return ahora.getTime() - ultimo.getTime() >= cfg.recordatorioFrecuenciaDias * 86_400_000
  })
  if (pendientes.length === 0) return { recordatorios: 0 }

  // Cliente → cuenta de usuario (para la notificación in-app).
  const supabaseIds = [...new Set(pendientes.map((c) => c.cliente.supabaseId))]
  const users = await sinEmpresa(
    'seguimiento: cron resuelve las cuentas de usuario de los clientes (tabla global)',
    (tx) =>
      tx.user.findMany({
        where: { supabaseId: { in: supabaseIds } },
        select: { id: true, supabaseId: true },
      })
  )
  const userPorSupabase = new Map(users.map((u) => [u.supabaseId, u.id]))

  let enviados = 0
  for (const c of pendientes) {
    const userId = userPorSupabase.get(c.cliente.supabaseId)
    if (!userId) continue
    const cfg = configs.get(c.companyId) ?? resolverSeguimientoConfig(null)
    const vence = c.fechaVencimiento
      ? new Intl.DateTimeFormat('es-DO', {
          timeZone: c.cliente.company.zonaHoraria,
          dateStyle: 'medium',
        }).format(c.fechaVencimiento)
      : null
    try {
      await crearNotificacion({
        userId,
        tipo: 'SISTEMA',
        titulo: '🎁 Tu recompensa gratis está por vencer',
        mensaje: renderMensajeSeguimiento(cfg.plantillaMensaje, {
          cliente: c.cliente.nombre,
          empresa: c.cliente.company.name,
          recompensa: c.promocion?.titulo ?? 'tu recompensa',
          vence,
        }),
        href: '/cliente/mis-promociones',
      })
      await conEmpresa(c.companyId, (tx) =>
        tx.auditLog.create({
          data: {
            companyId: c.companyId,
            accion: 'NOTA_INTERNA',
            entidadTipo: 'ProductoCompra',
            entidadId: c.id,
            payload: {
              tipo: 'RECORDATORIO_SEGUIMIENTO',
              auto: true,
              promocionId: c.promocionId,
              cliente: c.cliente.nombre,
            },
          },
        })
      )
      enviados++
    } catch (e) {
      console.error('[seguimiento] cron recordatorio compra', c.id, e)
    }
  }
  return { recordatorios: enviados }
}
