'use server'

/**
 * SUPPLY BRIDGE · acciones del superadmin (Fase 2.5).
 *
 * SOLO el superadmin: designar la empresa de la casa decide de quién cuelgan las
 * ofertas de Membego en el catálogo, y sincronizar cruza empresas. Devuelven un
 * resultado, no lanzan: el mensaje de un `PuenteError` se enseña tal cual; lo
 * demás se traduce a uno genérico.
 */

import { revalidatePath, revalidateTag } from 'next/cache'
import { after } from 'next/server'
import { sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'
import { MARKETPLACE_TAG } from '@/modules/marketplace/cached'
import { barridoPuente, type ResultadoBarridoPuente } from './barrido'
import { PuenteError } from './errores'
import { designarCasaEnTx } from './service'

export type ResultadoPuente<T = unknown> = ({ ok: true } & T) | { ok: false; error: string }

const RUTA = '/superadmin/puente-supply'

async function exigirSuperadmin() {
  const user = await getUser()
  return user && user.metadata.role === 'SUPERADMIN' ? user : null
}

function aError(e: unknown): { ok: false; error: string } {
  if (e instanceof PuenteError) return { ok: false, error: e.message }
  console.error('[supply-bridge]', e instanceof Error ? e.message : e)
  return { ok: false, error: 'No se pudo completar la operación. Intenta de nuevo.' }
}

/** Designa la empresa de la casa (`null` la retira y archiva lo puente). Al designar, sincroniza en segundo plano. */
export async function designarCasaMembego(companyId: string | null): Promise<ResultadoPuente<{ archivados: number }>> {
  const user = await exigirSuperadmin()
  if (!user) return { ok: false, error: 'Solo el superadmin puede administrar el puente.' }
  if (companyId !== null && (typeof companyId !== 'string' || companyId === '')) return { ok: false, error: 'Datos no válidos.' }
  try {
    const meta = await getRequestMeta()
    const r = await sinEmpresa('puente Supply→Catálogo: designar la empresa de la casa', (tx) =>
      designarCasaEnTx(tx, companyId, { actorId: user.metadata.dbUserId ?? null, ...meta })
    )
    revalidatePath(RUTA)
    revalidateTag(MARKETPLACE_TAG, 'max')
    if (companyId !== null) after(() => barridoPuente().catch((e) => console.error('[supply-bridge]', e)))
    return { ok: true, archivados: r.archivados }
  } catch (e) {
    return aError(e)
  }
}

/** «Sincronizar ahora»: la misma reconciliación que hace el cron, a pedido. */
export async function sincronizarPuenteAhora(): Promise<ResultadoPuente<{ resultado: ResultadoBarridoPuente }>> {
  const user = await exigirSuperadmin()
  if (!user) return { ok: false, error: 'Solo el superadmin puede administrar el puente.' }
  try {
    const resultado = await barridoPuente()
    revalidatePath(RUTA)
    return { ok: true, resultado }
  } catch (e) {
    return aError(e)
  }
}
