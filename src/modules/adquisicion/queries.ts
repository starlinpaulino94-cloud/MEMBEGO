import { conEmpresa } from '@/lib/tenant'
import type { Prisma } from '@prisma/client'
import { canalLabel } from './shared'

/**
 * Atribución de marketing (docs/ADQUISICION.md): ¿de dónde llegan los
 * clientes que se registran? Agrupa los registros por canal (facebook,
 * instagram, tarjeta en la calle, invitación de otro cliente, directo…).
 */

export interface CanalStat {
  canal: string
  label: string
  registros: number
  /** % sobre el total del período. */
  porcentaje: number
}

export interface RegistroReciente {
  clienteId: string
  nombre: string
  contacto: string | null
  canal: string
  canalLabel: string
  fecha: Date
}

export interface AdquisicionData {
  total: number
  /** Registros con canal de marketing conocido (no directo/invitación). */
  conCanal: number
  porCanal: CanalStat[]
  recientes: RegistroReciente[]
}

export interface AdquisicionFiltro {
  desde?: string
  hasta?: string
}

interface ClienteRow {
  id: string
  nombre: string
  telefono: string | null
  email: string | null
  createdAt: Date
  canalOrigen: string | null
  esReferido: boolean
}

/**
 * Clientes del período. Tolerante a la migración pendiente: si la columna
 * `canalOrigen` aún no existe, todo cae en directo/invitación y el módulo
 * sigue funcionando.
 */
async function clientesDelPeriodo(
  tx: Prisma.TransactionClient,
  companyId: string,
  filtro: AdquisicionFiltro
): Promise<ClienteRow[]> {
  const where: Prisma.ClienteWhereInput = { companyId }
  if (filtro.desde || filtro.hasta) {
    where.createdAt = {
      ...(filtro.desde ? { gte: new Date(`${filtro.desde}T00:00:00`) } : {}),
      ...(filtro.hasta ? { lte: new Date(`${filtro.hasta}T23:59:59`) } : {}),
    }
  }
  const base = {
    id: true,
    nombre: true,
    telefono: true,
    email: true,
    createdAt: true,
    referidoComo: { select: { id: true }, take: 1 },
  } as const
  try {
    const rows = await tx.cliente.findMany({
      where,
      select: { ...base, canalOrigen: true },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      telefono: r.telefono,
      email: r.email,
      createdAt: r.createdAt,
      canalOrigen: r.canalOrigen,
      esReferido: r.referidoComo.length > 0,
    }))
  } catch (e) {
    console.error('[adquisicion] fallback sin canalOrigen (¿migración 20260755 pendiente?)', e)
    const rows = await tx.cliente.findMany({
      where,
      select: base,
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      telefono: r.telefono,
      email: r.email,
      createdAt: r.createdAt,
      canalOrigen: null,
      esReferido: r.referidoComo.length > 0,
    }))
  }
}

/** Canal efectivo de un registro: cookie > invitación de cliente > directo. */
function canalDe(row: ClienteRow): string {
  if (row.canalOrigen) return row.canalOrigen
  if (row.esReferido) return 'invitacion'
  return 'directo'
}

export async function getAdquisicion(
  companyId: string,
  filtro: AdquisicionFiltro = {}
): Promise<AdquisicionData> {
  const rows = await conEmpresa(companyId, (tx) => clientesDelPeriodo(tx, companyId, filtro))
  const total = rows.length

  const conteo = new Map<string, number>()
  let conCanal = 0
  for (const r of rows) {
    const canal = canalDe(r)
    conteo.set(canal, (conteo.get(canal) ?? 0) + 1)
    if (canal !== 'directo' && canal !== 'invitacion') conCanal++
  }
  const porCanal: CanalStat[] = [...conteo.entries()]
    .map(([canal, registros]) => ({
      canal,
      label: canalLabel(canal),
      registros,
      porcentaje: total > 0 ? Math.round((registros / total) * 100) : 0,
    }))
    .sort((a, b) => b.registros - a.registros)

  const recientes: RegistroReciente[] = rows.slice(0, 100).map((r) => {
    const canal = canalDe(r)
    return {
      clienteId: r.id,
      nombre: r.nombre,
      contacto: r.telefono ?? r.email,
      canal,
      canalLabel: canalLabel(canal),
      fecha: r.createdAt,
    }
  })

  return { total, conCanal, porCanal, recientes }
}
