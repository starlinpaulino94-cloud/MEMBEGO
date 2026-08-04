import { sinEmpresa } from '@/lib/tenant'
import type { Prisma } from '@prisma/client'
import { devolverUsos } from '@/modules/regalos/queries'
import { notificarClienteRegalo } from '@/modules/regalos/entrega'

/**
 * Regalos P2P · Fase R4 — mantenimiento periódico (se cuelga del cron de
 * automatizaciones, /api/cron/automatizaciones):
 *
 *  1. EXPIRAR globalmente los PENDIENTES vencidos (la expiración perezosa de
 *     R2 solo actúa cuando alguna de las partes abre su módulo de regalos;
 *     el cron garantiza que ningún regalo quede colgado y que los usos
 *     reservados vuelvan al remitente aunque nadie entre a la app).
 *  2. RECORDAR al destinatario los regalos que expiran en menos de 24 horas.
 *
 * Idempotente: los guards de estado evitan dobles devoluciones y el
 * recordatorio se deduplica consultando si ya existe una notificación con el
 * título distintivo dentro de la ventana de ese regalo.
 */

export const TITULO_RECORDATORIO = '⏰ Tienes un regalo por expirar'

const VENTANA_RECORDATORIO_MS = 24 * 60 * 60 * 1000

export async function mantenimientoRegalos(): Promise<{
  expirados: number
  recordatorios: number
}> {
  const ahora = new Date()
  let expirados = 0
  let recordatorios = 0
  const notificarExpirado: { remitenteId: string; usos: number }[] = []

  // ── 1 · Expirar vencidos (todas las empresas) ──────────────────────────────
  await sinEmpresa(
    'regalos: cron global expira y recuerda entre todas las empresas',
    async (tx) => {
      const vencidos = await tx.regalo.findMany({
        where: { estado: 'PENDIENTE', expiraAt: { lt: ahora } },
        select: {
          id: true,
          tipo: true,
          usos: true,
          compraOrigenId: true,
          membershipOrigenId: true,
          remitenteId: true,
        },
        take: 200,
      })
      for (const r of vencidos) {
        // Guard atómico: solo quien logra marcarlo devuelve los usos.
        const upd = await tx.regalo.updateMany({
          where: { id: r.id, estado: 'PENDIENTE' },
          data: { estado: 'EXPIRADO', resueltoAt: new Date() },
        })
        if (upd.count === 0) continue
        expirados++
        await devolverUsos(r, tx).catch((e) => console.error('[regalos-cron] refund', e))
        if (r.tipo === 'TRANSFERENCIA_USOS') {
          notificarExpirado.push({ remitenteId: r.remitenteId, usos: r.usos })
        }
      }

      // ── 2 · Recordatorios (<24h para expirar, receptor con cuenta) ─────────
      // Solo transferencias: en los regalos pagados el receptor no tiene nada que
      // aceptar (se entregan solos al confirmarse el pago del remitente).
      const porExpirar = await tx.regalo.findMany({
        where: {
          estado: 'PENDIENTE',
          tipo: 'TRANSFERENCIA_USOS',
          destinatarioId: { not: null },
          expiraAt: { gte: ahora, lt: new Date(ahora.getTime() + VENTANA_RECORDATORIO_MS) },
        },
        select: {
          id: true,
          usos: true,
          expiraAt: true,
          destinatarioId: true,
          remitente: { select: { nombre: true } },
        },
        take: 200,
      })

      // Resolución por LOTE (antes: cliente + user + dedup + insert por regalo →
      // hasta ~4 queries × 200). Tres lecturas fijas + un insert. El dedup se
      // hace en memoria con las mismas reglas que el findFirst por fila.
      const destinatarioIds = porExpirar
        .map((r) => r.destinatarioId)
        .filter((x): x is string => !!x)
      if (destinatarioIds.length > 0) {
        try {
          const clientes = await tx.cliente.findMany({
            where: { id: { in: destinatarioIds } },
            select: { id: true, supabaseId: true },
          })
          const supabaseIdDe = new Map(clientes.map((c) => [c.id, c.supabaseId]))
          const supabaseIds = [...supabaseIdDe.values()].filter((x): x is string => !!x)

          let userIdDe = new Map<string, string>()
          let avisadosPorUsuario = new Map<string, { createdAt: Date }[]>()
          if (supabaseIds.length > 0) {
            const usuarios = await tx.user.findMany({
              where: { supabaseId: { in: supabaseIds } },
              select: { id: true, supabaseId: true },
            })
            userIdDe = new Map(usuarios.map((u) => [u.supabaseId, u.id]))

            // Dedup: un recordatorio por usuario dentro de la ventana de 24h de
            // ese regalo. Como todas las ventanas caen en un rango corto, basta
            // traer desde la ventana más antigua y filtrar en memoria.
            const minVentana = porExpirar.reduce(
              (min, r) => Math.min(min, r.expiraAt.getTime() - VENTANA_RECORDATORIO_MS),
              Infinity
            )
            const avisados = await tx.notificacion.findMany({
              where: {
                userId: { in: usuarios.map((u) => u.id) },
                tipo: 'SISTEMA',
                titulo: TITULO_RECORDATORIO,
                createdAt: { gte: new Date(minVentana) },
              },
              select: { userId: true, createdAt: true },
            })
            avisadosPorUsuario = new Map()
            for (const a of avisados) {
              const lista = avisadosPorUsuario.get(a.userId) ?? []
              lista.push({ createdAt: a.createdAt })
              avisadosPorUsuario.set(a.userId, lista)
            }
          }

          const nuevos: Prisma.NotificacionCreateManyInput[] = []
          const usuarioConRecordatorio = new Set<string>()
          for (const r of porExpirar) {
            if (!r.destinatarioId) continue
            const supabaseId = supabaseIdDe.get(r.destinatarioId)
            if (!supabaseId) continue
            const userId = userIdDe.get(supabaseId)
            if (!userId) continue

            const ventanaInicio = r.expiraAt.getTime() - VENTANA_RECORDATORIO_MS
            const yaAvisado =
              usuarioConRecordatorio.has(userId) ||
              (avisadosPorUsuario.get(userId) ?? []).some(
                (a) => a.createdAt.getTime() >= ventanaInicio
              )
            if (yaAvisado) continue

            const horas = Math.max(1, Math.round((r.expiraAt.getTime() - ahora.getTime()) / 3_600_000))
            nuevos.push({
              userId,
              tipo: 'SISTEMA',
              titulo: TITULO_RECORDATORIO,
              mensaje: `${r.remitente.nombre.split(/\s+/)[0]} te envió ${r.usos} uso${r.usos !== 1 ? 's' : ''} y el regalo expira en ~${horas}h. ¡Acéptalo antes de que vuelva a su cuenta!`,
              href: '/cliente/regalos',
            })
            // Reproduce el dedup del flujo secuencial: los regalos por expirar en
            // <24h comparten ventana, así que a lo sumo un recordatorio por
            // usuario en esta corrida.
            usuarioConRecordatorio.add(userId)
          }

          if (nuevos.length > 0) {
            const creados = await tx.notificacion.createMany({ data: nuevos })
            recordatorios += creados.count
          }
        } catch (e) {
          console.error('[regalos-cron] recordatorios', e)
        }
      }
    }
  )

  for (const n of notificarExpirado) {
    await notificarClienteRegalo(
      n.remitenteId,
      'Tu regalo expiró',
      `Nadie aceptó tu transferencia a tiempo: tus ${n.usos} uso${n.usos !== 1 ? 's' : ''} volvieron a tu cuenta.`,
      '/cliente/regalos'
    )
  }

  return { expirados, recordatorios }
}
