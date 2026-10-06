import 'server-only'

import { revalidatePath } from 'next/cache'
import { getRequestMeta } from '@/lib/server-utils'
import type { ContextoAuditoria } from './core/auditoria'
import { BASE_SUPPLY_V2 } from './core/catalogo'
import { SupplyV2Error } from './core/errores'
import type { ActorSupplyV2 } from './permisos'

/**
 * MEMBEGO SUPPLY · lo que comparten las server actions.
 */

export interface EstadoAccion<T = undefined> {
  error?: string
  success?: string
  /** Id de lo recién creado, para navegar. */
  id?: string
  data?: T
}

export async function contextoDeAuditoria(actor: ActorSupplyV2): Promise<ContextoAuditoria> {
  const meta = await getRequestMeta()
  return { actorId: actor.id, ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null }
}

/** Un error de dominio se enseña tal cual; cualquier otro, con un mensaje genérico. */
export function comoError<T = undefined>(e: unknown, contexto: string): EstadoAccion<T> {
  if (e instanceof SupplyV2Error) return { error: e.message }
  if (e instanceof Error && /no se puede pasar de|no la puede aprobar|exige un motivo/.test(e.message)) {
    return { error: e.message }
  }
  console.error(`[supply-v2:${contexto}]`, e)
  return { error: e instanceof Error && e.message ? e.message : 'No se pudo completar la operación.' }
}

export function refrescarSupplyV2(...sufijos: string[]): void {
  revalidatePath(BASE_SUPPLY_V2)
  for (const s of sufijos) revalidatePath(`${BASE_SUPPLY_V2}/${s}`)
}

export function texto(fd: FormData, clave: string, max = 500): string {
  return String(fd.get(clave) ?? '').trim().slice(0, max)
}

export function numero(fd: FormData, clave: string): number | null {
  const v = String(fd.get(clave) ?? '').trim()
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function entero(fd: FormData, clave: string): number | null {
  const n = numero(fd, clave)
  return n == null ? null : Math.trunc(n)
}

export function fecha(fd: FormData, clave: string): Date | null {
  const v = String(fd.get(clave) ?? '').trim()
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Fin de día para un `<input type="date">`: «hasta el 30» incluye el 30. */
export function fechaFinDeDia(fd: FormData, clave: string): Date | null {
  const d = fecha(fd, clave)
  if (!d) return null
  d.setUTCHours(23, 59, 59, 999)
  return d
}
