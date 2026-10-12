'use server'

/**
 * COMMERCE CORE · ofertas con presupuesto — acciones del panel de la empresa (Fase 5).
 *
 * Todas detrás de `requireSection('deals', <función>)`: la capacidad DEALS_MARKETPLACE y los
 * permisos por empleado gobiernan cada mutación. La empresa sale SIEMPRE de la sesión
 * (`resolveCompanyId`), nunca de lo que mande el navegador, y todo corre en `conEmpresa`.
 *
 * Aquí está lo que hace la EMPRESA con sus ofertas: crear, editar, publicar, pausar, reanudar,
 * ampliar el presupuesto y archivar. Reclamar es del cliente (`cliente-actions.ts`); el canje
 * lo cierra el escáner (pedidos).
 *
 * Devuelven un resultado, no lanzan: el mensaje de un `OfertaError` se enseña tal cual;
 * cualquier otro error se traduce a uno genérico para no filtrar detalles de la base.
 */

import { revalidatePath } from 'next/cache'
import { conEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getRequestMeta } from '@/lib/server-utils'
import { OfertaError } from './errores'
import { refrescarVitrinasDeOfertas } from './vitrinas'
import { leerCambiosDeOferta, leerOfertaNueva, type FormularioDeOferta } from './formulario'
import {
  actualizarOfertaEnTx,
  ampliarPresupuestoEnTx,
  archivarOfertaEnTx,
  crearOfertaEnTx,
  pausarOfertaEnTx,
  publicarOfertaEnTx,
  reanudarOfertaEnTx,
  type ContextoOferta,
} from './service'

export type ResultadoOferta<T = unknown> = ({ ok: true } & T) | { ok: false; error: string }

const RUTA = '/admin/deals'

type Funcion = 'crear' | 'publicar' | 'presupuesto' | 'archivar'

/** Tras cualquier cambio, la lista y el detalle (`layout` cubre las dos) y lo que ve el público. */
function refrescar() {
  revalidatePath(RUTA, 'layout')
  refrescarVitrinasDeOfertas()
}

async function contexto(funcion: Funcion): Promise<{ companyId: string; ctx: ContextoOferta } | { error: string }> {
  const user = await requireSection('deals', funcion)
  if (!user) return { error: 'No autorizado.' }
  const companyId = await resolveCompanyId(user)
  if (!companyId) return { error: 'Selecciona una empresa activa.' }
  const meta = await getRequestMeta()
  return { companyId, ctx: { actorId: user.metadata.dbUserId ?? null, ...meta } }
}

function aError(e: unknown): { ok: false; error: string } {
  if (e instanceof OfertaError) return { ok: false, error: e.message }
  console.error('[deals]', e instanceof Error ? e.message : e)
  return { ok: false, error: 'No se pudo completar la operación. Intenta de nuevo.' }
}

const texto = (v: unknown) => (typeof v === 'string' ? v : '')
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Crea una oferta en borrador. La cuota por canje se toma de la tarifa de la cuenta y se congela. */
export async function crearOferta(entrada: FormularioDeOferta): Promise<ResultadoOferta<{ id: string; fee: string; currency: string }>> {
  const c = await contexto('crear')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  const leida = leerOfertaNueva(entrada)
  if (!leida.ok) return { ok: false, error: leida.error }
  try {
    const r = await conEmpresa(c.companyId, (tx) => crearOfertaEnTx(tx, c.companyId, leida.valor, c.ctx))
    refrescar()
    return { ok: true, ...r }
  } catch (e) {
    return aError(e)
  }
}

/** Edita una oferta (en borrador todo; ya publicada, solo título, descripción, fin y cupos). */
export async function editarOferta(id: string, cambios: FormularioDeOferta): Promise<ResultadoOferta> {
  const c = await contexto('crear')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(cambios)) return { ok: false, error: 'Datos no válidos.' }
  const leidos = leerCambiosDeOferta(cambios)
  if (!leidos.ok) return { ok: false, error: leidos.error }
  try {
    await conEmpresa(c.companyId, (tx) => actualizarOfertaEnTx(tx, c.companyId, texto(id), leidos.valor, c.ctx))
    refrescar()
    return { ok: true }
  } catch (e) {
    return aError(e)
  }
}

/** Publica una oferta en borrador: desde ahora los clientes pueden reclamarla. */
export async function publicarOferta(id: string): Promise<ResultadoOferta<{ estado: string }>> {
  const c = await contexto('publicar')
  if ('error' in c) return { ok: false, error: c.error }
  try {
    const r = await conEmpresa(c.companyId, (tx) => publicarOfertaEnTx(tx, c.companyId, texto(id), c.ctx))
    refrescar()
    return { ok: true, estado: r.status }
  } catch (e) {
    return aError(e)
  }
}

/** Pausa una oferta: nadie nuevo la reclama; los cupones ya reclamados siguen valiendo. */
export async function pausarOferta(id: string, motivo?: string): Promise<ResultadoOferta<{ estado: string }>> {
  const c = await contexto('publicar')
  if ('error' in c) return { ok: false, error: c.error }
  const razon = texto(motivo).trim().slice(0, 200) || null
  try {
    const r = await conEmpresa(c.companyId, (tx) => pausarOfertaEnTx(tx, c.companyId, texto(id), razon, c.ctx))
    refrescar()
    return { ok: true, estado: r.status }
  } catch (e) {
    return aError(e)
  }
}

/** Reanuda una oferta pausada. */
export async function reanudarOferta(id: string): Promise<ResultadoOferta<{ estado: string }>> {
  const c = await contexto('publicar')
  if ('error' in c) return { ok: false, error: c.error }
  try {
    const r = await conEmpresa(c.companyId, (tx) => reanudarOfertaEnTx(tx, c.companyId, texto(id), c.ctx))
    refrescar()
    return { ok: true, estado: r.status }
  } catch (e) {
    return aError(e)
  }
}

/** Suma presupuesto (nunca lo quita). Reabre una oferta agotada. */
export async function ampliarPresupuestoOferta(id: string, adicional: string | number): Promise<ResultadoOferta<{ presupuesto: string; estado: string }>> {
  const c = await contexto('presupuesto')
  if ('error' in c) return { ok: false, error: c.error }
  const monto = typeof adicional === 'number' ? String(adicional) : texto(adicional).trim()
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(monto)) return { ok: false, error: 'Escribe el monto como un número (por ejemplo 2000).' }
  try {
    const r = await conEmpresa(c.companyId, (tx) => ampliarPresupuestoEnTx(tx, c.companyId, texto(id), monto, c.ctx))
    refrescar()
    return { ok: true, presupuesto: r.budgetTotal, estado: r.status }
  } catch (e) {
    return aError(e)
  }
}

/** Archiva una oferta que ya no se va a usar (los cupones vivos se respetan hasta su vencimiento). */
export async function archivarOferta(id: string): Promise<ResultadoOferta<{ estado: string }>> {
  const c = await contexto('archivar')
  if ('error' in c) return { ok: false, error: c.error }
  try {
    const r = await conEmpresa(c.companyId, (tx) => archivarOfertaEnTx(tx, c.companyId, texto(id), c.ctx))
    refrescar()
    return { ok: true, estado: r.status }
  } catch (e) {
    return aError(e)
  }
}
