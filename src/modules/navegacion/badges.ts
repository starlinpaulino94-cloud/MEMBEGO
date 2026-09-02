import { unstable_cache } from 'next/cache'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { COLAS_TICKET } from '@/lib/soporte'
import type { ClaveBadge } from '@/components/layout/nav-config'
import type { AppRole } from '@/types'

/**
 * ════════════════════════════════════════════════════════════════════════════
 * LOS CONTADORES DEL MENÚ. TODOS REALES.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES REGLAS, Y LAS TRES IMPORTAN
 *
 * 1. SI EL CONTEO FALLA, NO HAY INSIGNIA. No hay número por defecto, ni un
 *    cero, ni un interrogante: la clave simplemente no viene y el módulo se
 *    pinta como cualquier otro. Un cero inventado es peor que no contar —
 *    dice «no tienes nada pendiente», que es una afirmación, y puede ser
 *    falsa.
 *
 * 2. LA NAVEGACIÓN NUNCA SE ROMPE POR UN CONTADOR. Cada consulta va por su
 *    lado con `allSettled` y su propio `catch`. Que la tabla de solicitudes no
 *    exista todavía en una base sin migrar no puede dejar a nadie sin menú.
 *
 * 3. CAMBIAR DE ESPACIO NO CONSULTA NADA. Esto se resuelve UNA vez por
 *    petición en el layout —que es un componente de servidor— y viaja al
 *    cliente como tres números. El riel y el panel no piden datos: recorrer
 *    los espacios es gratis, y tiene que seguir siéndolo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SOLO TRES
 *
 * Son los tres sitios donde un número cambia lo que alguien hace a
 * continuación: tickets que le tocan al negocio, solicitudes de alta sin
 * revisar y trabajos de la cola que murieron. Todo lo demás —clientes en
 * riesgo, pagos por confirmar— exige agregaciones que no caben en el coste de
 * pintar un menú en cada navegación. Una insignia que cuesta 300 ms se paga en
 * TODAS las pantallas, no solo en la que la enseña.
 */

/** Contadores del menú. Una clave ausente significa «no se pudo contar». */
export type BadgesNavegacion = Partial<Record<ClaveBadge, number>>

/** Segundos de caché. Corto: es un aviso, no un informe. */
const REVALIDAR = 60

/** Tickets con la pelota en el lado del negocio, en ESTA empresa. */
const ticketsDeEmpresa = unstable_cache(
  async (companyId: string): Promise<number> =>
    conEmpresa(companyId, (tx) =>
      tx.supportTicket.count({
        where: { companyId, estado: { in: [...COLAS_TICKET.pendientes] } },
      })
    ),
  ['nav-badge-tickets-empresa'],
  { revalidate: REVALIDAR }
)

/** Tickets pendientes en TODA la plataforma (superadmin). */
const ticketsDePlataforma = unstable_cache(
  async (): Promise<number> =>
    sinEmpresa('insignia del menú: tickets pendientes de toda la plataforma', (tx) =>
      tx.supportTicket.count({ where: { estado: { in: [...COLAS_TICKET.pendientes] } } })
    ),
  ['nav-badge-tickets-plataforma'],
  { revalidate: REVALIDAR }
)

/** Solicitudes de alta que nadie ha resuelto todavía (superadmin). */
const solicitudesSinResolver = unstable_cache(
  async (): Promise<number> =>
    sinEmpresa('insignia del menú: solicitudes de alta sin resolver', (tx) =>
      tx.solicitudEmpresa.count({ where: { estado: { in: ['NUEVA', 'EN_REVISION'] } } })
    ),
  ['nav-badge-solicitudes'],
  { revalidate: REVALIDAR }
)

/**
 * Trabajos que la cola agotó y esperan una decisión (superadmin).
 *
 * Es el número que antes solo se veía entrando a la pantalla: la cola crecía
 * en silencio y se descubría cuando un satélite llamaba para decir que no
 * recibía eventos.
 */
const trabajosMuertos = unstable_cache(
  async (): Promise<number> =>
    sinEmpresa('insignia del menú: trabajos muertos de la cola', (tx) =>
      tx.trabajoMuerto.count({ where: { estado: 'PENDIENTE' } })
    ),
  ['nav-badge-trabajos-muertos'],
  { revalidate: REVALIDAR }
)

/**
 * Los contadores que le corresponden a esta persona.
 *
 * Lo que NO se pide no se cuenta: un administrador de empresa no dispara la
 * consulta de solicitudes de alta, que es de plataforma y no vería de todos
 * modos. Es la diferencia entre un menú que cuesta una consulta y uno que
 * cuesta cuatro para tirar tres.
 */
export async function badgesDeNavegacion(
  role: AppRole,
  companyId: string | null | undefined
): Promise<BadgesNavegacion> {
  const tareas: { clave: ClaveBadge; contar: () => Promise<number> }[] = []

  if (role === 'SUPERADMIN') {
    tareas.push(
      { clave: 'tickets', contar: ticketsDePlataforma },
      { clave: 'solicitudes', contar: solicitudesSinResolver },
      { clave: 'colaAtascada', contar: trabajosMuertos }
    )
  } else if (companyId) {
    tareas.push({ clave: 'tickets', contar: () => ticketsDeEmpresa(companyId) })
  }

  const resultados = await Promise.allSettled(tareas.map((t) => t.contar()))

  const badges: BadgesNavegacion = {}
  resultados.forEach((r, i) => {
    // `rejected` no se registra ni se convierte en cero: la clave se queda
    // fuera y el módulo se pinta sin insignia, que es la verdad.
    if (r.status !== 'fulfilled') return
    if (typeof r.value !== 'number' || !Number.isFinite(r.value)) return
    badges[tareas[i].clave] = r.value
  })
  return badges
}
