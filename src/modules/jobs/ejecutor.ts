import { prisma } from '@/lib/prisma'
import {
  TAMANO_LOTE_NOTIF,
  type CargaNotificar,
  type CargaTrabajo,
} from '@/modules/jobs/tipos'

/**
 * EJECUTOR DE TRABAJOS — lo que corre fuera del request.
 *
 * Cada trabajo tiene que ser IDEMPOTENTE: QStash reintenta ante cualquier
 * respuesta que no sea 2xx, y un reintento sobre un trabajo no idempotente
 * duplica notificaciones o vuelve a cobrar. Aquí la idempotencia viene de que
 * cada lote está acotado por un desplazamiento fijo sobre un orden estable, y
 * de la clave de deduplicación de la cola.
 */

export interface ResultadoTrabajo {
  procesados: number
  /** Trabajo que queda encadenado, si lo hay. */
  continua?: boolean
  detalle?: string
}

export async function ejecutarTrabajo(carga: CargaTrabajo): Promise<ResultadoTrabajo> {
  switch (carga.tipo) {
    case 'notificar':
      return notificarLote(carga)
    case 'automatizaciones': {
      const { ejecutarAutomatizacionesEmpresa } = await import(
        '@/modules/admin/automatizaciones'
      )
      const r = await ejecutarAutomatizacionesEmpresa(carga.companyId)
      return {
        procesados: r.cumpleanos + r.porVencer + r.inactivos,
        detalle: `cumpleaños ${r.cumpleanos} · por vencer ${r.porVencer} · inactivos ${r.inactivos}`,
      }
    }
  }
}

/**
 * Un lote de notificaciones y, si quedan más, el encadenamiento del siguiente.
 *
 * EL ORDEN ES PARTE DE LA CORRECCIÓN, no un detalle estético: se ordena por
 * `id` ascendente, que es estable. Sin `orderBy`, PostgreSQL puede devolver las
 * filas en cualquier orden entre una consulta y la siguiente, y entonces
 * `skip`/`take` se solapan o se saltan gente — algunos recibirían la
 * notificación dos veces y otros ninguna.
 */
async function notificarLote(carga: CargaNotificar): Promise<ResultadoTrabajo> {
  const userIds =
    carga.audiencia === 'seguidores'
      ? await idsSeguidores(carga.companyId, carga.desde)
      : await idsClientes(carga.companyId, carga.desde)

  if (userIds.length === 0) return { procesados: 0 }

  await prisma.notificacion.createMany({
    data: userIds.map((userId) => ({ userId, ...carga.payload })),
    // Sin unicidad en la tabla `skipDuplicates` no hace nada, pero se deja
    // puesto: el día que se añada un índice único por (userId, tipo, día), el
    // reintento deja de duplicar sin tocar este archivo.
    skipDuplicates: true,
  })

  const hayMas = userIds.length === TAMANO_LOTE_NOTIF
  if (hayMas) {
    const { encolar } = await import('@/modules/jobs/cola')
    await encolar({ ...carga, desde: carga.desde + TAMANO_LOTE_NOTIF })
  }

  return { procesados: userIds.length, continua: hayMas }
}

async function idsSeguidores(companyId: string, desde: number): Promise<string[]> {
  const filas = await prisma.companyFollow.findMany({
    where: { companyId },
    select: { userId: true },
    orderBy: { id: 'asc' },
    skip: desde,
    take: TAMANO_LOTE_NOTIF,
  })
  return filas.map((f) => f.userId)
}

/**
 * Clientes de la empresa → sus cuentas de usuario.
 *
 * Se pagina sobre `clientes` (que es donde vive el orden estable) y después se
 * resuelven las cuentas. Paginar sobre `users` sería incorrecto: una persona
 * puede ser cliente de varias empresas y el recorte no coincidiría.
 */
async function idsClientes(companyId: string, desde: number): Promise<string[]> {
  const clientes = await prisma.cliente.findMany({
    where: { companyId },
    select: { supabaseId: true },
    orderBy: { id: 'asc' },
    skip: desde,
    take: TAMANO_LOTE_NOTIF,
  })
  if (clientes.length === 0) return []

  const users = await prisma.user.findMany({
    where: { supabaseId: { in: clientes.map((c) => c.supabaseId) } },
    select: { id: true },
  })
  return users.map((u) => u.id)
}
