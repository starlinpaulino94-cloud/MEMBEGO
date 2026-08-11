import { sinEmpresa, type Tx } from '@/lib/tenant'
import {
  TAMANO_LOTE_NOTIF,
  type CargaEmail,
  type CargaEvento,
  type CargaNotificar,
  type CargaRecompensas,
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
        procesados: r.cumpleanos + r.porVencer + r.inactivos + r.vigilancia,
        detalle: `cumpleaños ${r.cumpleanos} · por vencer ${r.porVencer} · inactivos ${r.inactivos} · vigilancia ${r.vigilancia}`,
      }
    }
    case 'email':
      return enviarEmail(carga)
    case 'evento-estrategia':
      return despacharEvento(carga)
    case 'recompensas-referido':
      return procesarRecompensas(carga)
    case 'campana-dirigida':
      return procesarLoteCampanaDirigida(carga)
  }
}

/**
 * Lote del fan-out de una campaña geosegmentada. Si el lote quedó lleno, el
 * propio worker encadena el siguiente (idempotente por desplazamiento fijo).
 */
async function procesarLoteCampanaDirigida(
  carga: import('@/modules/jobs/tipos').CargaCampanaDirigida
): Promise<ResultadoTrabajo> {
  const { procesarLoteCampana } = await import('@/modules/geo/segmentacion/entrega')
  const r = await procesarLoteCampana(carga.campanaId, carga.desde)
  return {
    procesados: r.procesados,
    continua: r.continua,
    detalle: r.excludos > 0 ? `${r.excludos} excluidos por frecuencia` : undefined,
  }
}

/**
 * Entrega un correo transaccional. `sendEmail` nunca lanza (best-effort):
 * un fallo del proveedor devuelve `sent:false` y el trabajo termina en 2xx, lo
 * que es lo correcto — QStash no debe reintentar un correo que Resend rechazó
 * con un 4xx, y el duplicado por reintento se corta con la clave de dedup.
 */
async function enviarEmail(carga: CargaEmail): Promise<ResultadoTrabajo> {
  const { sendEmail } = await import('@/lib/email')
  const res = await sendEmail({
    to: carga.to,
    subject: carga.subject,
    html: carga.html,
    text: carga.text,
    companyId: carga.companyId,
  })
  return { procesados: res.sent ? 1 : 0, detalle: res.reason }
}

/**
 * Despacha un evento del bus de estrategias pendiente. El flip atómico
 * processed:false → true da exclusión mutua: el reintento de QStash (o el cron
 * de barrido) encuentra el evento ya procesado y no lo duplica.
 */
async function despacharEvento(carga: CargaEvento): Promise<ResultadoTrabajo> {
  const { despacharEventoEstrategia } = await import('@/modules/estrategias/eventos')
  return despacharEventoEstrategia(carga.eventoId)
}

/**
 * Calcula y asigna las recompensas de una conversión de referido. Idempotente:
 * el unique (referenteClienteId, reglaId) + manejo de P2002 hacen que un
 * reintento salte las recompensas ya otorgadas.
 */
async function procesarRecompensas(carga: CargaRecompensas): Promise<ResultadoTrabajo> {
  const { evaluarRecompensas } = await import('@/modules/referidos/actions')
  await evaluarRecompensas(carga.referenteClienteId, carga.companyId)
  return { procesados: 1 }
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
  const { userIds, hayMas } = await sinEmpresa(
    'jobs: lote de notificaciones por usuario (cross-tenant)',
    async (tx) => {
      const userIds =
        carga.audiencia === 'seguidores'
          ? await idsSeguidores(tx, carga.companyId, carga.desde)
          : await idsClientes(tx, carga.companyId, carga.desde)

      if (userIds.length === 0) return { userIds, hayMas: false }

      await tx.notificacion.createMany({
        data: userIds.map((userId) => ({ userId, ...carga.payload })),
        // Sin unicidad en la tabla `skipDuplicates` no hace nada, pero se deja
        // puesto: el día que se añada un índice único por (userId, tipo, día), el
        // reintento deja de duplicar sin tocar este archivo.
        skipDuplicates: true,
      })

      return { userIds, hayMas: userIds.length === TAMANO_LOTE_NOTIF }
    }
  )

  if (userIds.length === 0) return { procesados: 0 }

  if (hayMas) {
    const { encolar } = await import('@/modules/jobs/cola')
    await encolar({ ...carga, desde: carga.desde + TAMANO_LOTE_NOTIF })
  }

  return { procesados: userIds.length, continua: hayMas }
}

async function idsSeguidores(
  tx: Tx,
  companyId: string,
  desde: number
): Promise<string[]> {
  const filas = await tx.companyFollow.findMany({
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
async function idsClientes(
  tx: Tx,
  companyId: string,
  desde: number
): Promise<string[]> {
  const clientes = await tx.cliente.findMany({
    where: { companyId },
    select: { supabaseId: true },
    orderBy: { id: 'asc' },
    skip: desde,
    take: TAMANO_LOTE_NOTIF,
  })
  if (clientes.length === 0) return []

  const users = await tx.user.findMany({
    where: { supabaseId: { in: clientes.map((c) => c.supabaseId) } },
    select: { id: true },
  })
  return users.map((u) => u.id)
}
