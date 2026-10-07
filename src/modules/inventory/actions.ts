'use server'

/**
 * COMMERCE CORE · inventario — acciones del panel (Fase 2).
 *
 * Todas detrás de `requireSection('inventario', <función>)`: la capacidad
 * CATALOGO_UNIFICADO y los permisos por empleado gobiernan cada mutación. La
 * empresa sale SIEMPRE de la sesión (`resolveCompanyId`), nunca de lo que mande
 * el navegador, y todo corre en `conEmpresa`.
 *
 * Aquí solo están las operaciones que hace una PERSONA: entradas, ajustes,
 * conteos, daños, devoluciones, transferencias y umbrales. Vender, reservar y
 * liberar reservas las hace el sistema (pedidos, caja) llamando al servicio
 * directamente: no hay botón para eso.
 *
 * Devuelven un resultado, no lanzan: el mensaje de un `InventarioError` se
 * enseña tal cual; cualquier otro error se traduce a uno genérico para no
 * filtrar detalles de la base.
 *
 * Cada formulario manda una `clave` única (idempotencia): un doble clic o un
 * reintento de red no mueve el stock dos veces.
 */

import { revalidatePath } from 'next/cache'
import { conEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getRequestMeta } from '@/lib/server-utils'
import type { SessionUser } from '@/types'
import type { ContextoAuditoria } from './auditoria'
import { InventarioError } from './errores'
import { historialDeVarianteEnTx, type HistorialPagina } from './queries'
import {
  ajustarEnTx,
  configurarUmbralEnTx,
  contarEnTx,
  danarEnTx,
  devolverEnTx,
  recibirEnTx,
  resolverDanadoEnTx,
  transferirEnTx,
  type SaldoVista,
} from './service'

export type ResultadoInventario<T = unknown> = ({ ok: true } & T) | { ok: false; error: string }

const RUTA = '/admin/inventario'

/** Tras cualquier cambio, la lista y el detalle (`layout` cubre las dos). */
function refrescar() {
  revalidatePath(RUTA, 'layout')
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

async function contexto(funcion?: string): Promise<{ user: SessionUser; companyId: string; ctx: ContextoAuditoria } | { error: string }> {
  const user = await requireSection('inventario', funcion)
  if (!user) return { error: 'No autorizado.' }
  const companyId = await resolveCompanyId(user)
  if (!companyId) return { error: 'Selecciona una empresa activa.' }
  const meta = await getRequestMeta()
  return { user, companyId, ctx: { actorId: user.metadata.dbUserId ?? null, ...meta } }
}

function aError(e: unknown): { ok: false; error: string } {
  if (e instanceof InventarioError) return { ok: false, error: e.message }
  console.error('[inventario]', e instanceof Error ? e.message : e)
  return { ok: false, error: 'No se pudo completar la operación. Intenta de nuevo.' }
}

export interface EntradaMovimiento {
  varianteId: string
  sucursalId: string
  cantidad: number
  motivo?: string | null
  clave?: string | null
}

type ResultadoSaldo = ResultadoInventario<{ saldo: SaldoVista; repetido: boolean }>

/** Una acción de un solo saldo: autoriza, valida la forma de la entrada y delega al servicio. */
async function operar(
  funcion: 'ajustar' | 'transferir',
  entrada: unknown,
  hacer: (companyId: string, e: Record<string, unknown>, ctx: ContextoAuditoria, tx: Parameters<Parameters<typeof conEmpresa>[1]>[0]) => Promise<{ saldo: SaldoVista; repetido: boolean }>
): Promise<ResultadoSaldo> {
  const c = await contexto(funcion)
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  try {
    const r = await conEmpresa(c.companyId, (tx) => hacer(c.companyId, entrada, c.ctx, tx))
    refrescar()
    return { ok: true, saldo: r.saldo, repetido: r.repetido }
  } catch (e) {
    return aError(e)
  }
}

const texto = (v: unknown) => (typeof v === 'string' ? v : '')
const clave = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)

/** Llega mercancía: entra a lo vendible. */
export async function registrarEntradaInventario(entrada: EntradaMovimiento): Promise<ResultadoSaldo> {
  return operar('ajustar', entrada, (companyId, e, ctx, tx) =>
    recibirEnTx(tx, companyId, { varianteId: texto(e.varianteId), sucursalId: texto(e.sucursalId), cantidad: e.cantidad as number, motivo: e.motivo as string | null, idempotencyKey: clave(e.clave) }, ctx)
  )
}

/** El cliente devuelve mercancía. */
export async function registrarDevolucionInventario(entrada: EntradaMovimiento): Promise<ResultadoSaldo> {
  return operar('ajustar', entrada, (companyId, e, ctx, tx) =>
    devolverEnTx(tx, companyId, { varianteId: texto(e.varianteId), sucursalId: texto(e.sucursalId), cantidad: e.cantidad as number, motivo: e.motivo as string | null, idempotencyKey: clave(e.clave) }, ctx)
  )
}

/** Mercancía dañada: sale de lo vendible a la cubeta de dañado. Motivo obligatorio. */
export async function registrarDanoInventario(entrada: EntradaMovimiento): Promise<ResultadoSaldo> {
  return operar('ajustar', entrada, (companyId, e, ctx, tx) =>
    danarEnTx(tx, companyId, { varianteId: texto(e.varianteId), sucursalId: texto(e.sucursalId), cantidad: e.cantidad as number, motivo: e.motivo as string | null, idempotencyKey: clave(e.clave) }, ctx)
  )
}

/** Resuelve lo dañado: vuelve a venderse o se da de baja. Motivo obligatorio. */
export async function resolverDanadoInventario(entrada: EntradaMovimiento & { destino: 'VENDIBLE' | 'BAJA' }): Promise<ResultadoSaldo> {
  return operar('ajustar', entrada, (companyId, e, ctx, tx) =>
    resolverDanadoEnTx(
      tx,
      companyId,
      { varianteId: texto(e.varianteId), sucursalId: texto(e.sucursalId), cantidad: e.cantidad as number, motivo: e.motivo as string | null, idempotencyKey: clave(e.clave), destino: e.destino as 'VENDIBLE' | 'BAJA' },
      ctx
    )
  )
}

/** Corrige un descuadre: `cambio` positivo = sobrante, negativo = faltante. Motivo obligatorio. */
export async function ajustarInventario(entrada: Omit<EntradaMovimiento, 'cantidad'> & { cambio: number }): Promise<ResultadoSaldo> {
  return operar('ajustar', entrada, (companyId, e, ctx, tx) =>
    ajustarEnTx(tx, companyId, { varianteId: texto(e.varianteId), sucursalId: texto(e.sucursalId), cambio: e.cambio as number, motivo: e.motivo as string | null, idempotencyKey: clave(e.clave) }, ctx)
  )
}

/** Conteo físico: la persona cuenta y el sistema calcula la diferencia. */
export async function contarInventario(entrada: Omit<EntradaMovimiento, 'cantidad' | 'clave'> & { conteo: number }): Promise<ResultadoInventario<{ saldo: SaldoVista; diferencia: number; repetido: boolean }>> {
  const c = await contexto('ajustar')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  try {
    const r = await conEmpresa(c.companyId, (tx) =>
      contarEnTx(tx, c.companyId, { varianteId: texto(entrada.varianteId), sucursalId: texto(entrada.sucursalId), conteo: entrada.conteo as number, motivo: entrada.motivo as string | null }, c.ctx)
    )
    refrescar()
    return { ok: true, saldo: r.saldo, diferencia: r.diferencia, repetido: r.repetido }
  } catch (e) {
    return aError(e)
  }
}

/** Fija el umbral de stock bajo de una variante en una sucursal (0 = sin alerta). */
export async function fijarUmbralInventario(entrada: { varianteId: string; sucursalId: string; umbral: number }): Promise<ResultadoInventario<{ umbral: number }>> {
  const c = await contexto('ajustar')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  try {
    const r = await conEmpresa(c.companyId, (tx) =>
      configurarUmbralEnTx(tx, c.companyId, { varianteId: texto(entrada.varianteId), sucursalId: texto(entrada.sucursalId), umbral: entrada.umbral as number }, c.ctx)
    )
    refrescar()
    return { ok: true, umbral: r.umbral }
  } catch (e) {
    return aError(e)
  }
}

/** Transfiere existencias de una sucursal a otra (solo lo vendible). */
export async function transferirInventario(entrada: {
  varianteId: string
  origenId: string
  destinoId: string
  cantidad: number
  motivo?: string | null
  clave?: string | null
}): Promise<ResultadoInventario<{ repetido: boolean }>> {
  const c = await contexto('transferir')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  try {
    const r = await conEmpresa(c.companyId, (tx) =>
      transferirEnTx(
        tx,
        c.companyId,
        { varianteId: texto(entrada.varianteId), origenId: texto(entrada.origenId), destinoId: texto(entrada.destinoId), cantidad: entrada.cantidad as number, motivo: entrada.motivo as string | null, idempotencyKey: clave(entrada.clave) },
        c.ctx
      )
    )
    refrescar()
    return { ok: true, repetido: r.repetido }
  } catch (e) {
    return aError(e)
  }
}

/** Más movimientos del historial de una variante (paginación por cursor). */
export async function cargarMasHistorialInventario(varianteId: string, cursor: string | null): Promise<ResultadoInventario<{ pagina: SerializableHistorial }>> {
  const c = await contexto()
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof varianteId !== 'string' || (cursor !== null && typeof cursor !== 'string')) return { ok: false, error: 'Datos no válidos.' }
  try {
    const p = await conEmpresa(c.companyId, (tx) => historialDeVarianteEnTx(tx, c.companyId, varianteId, cursor))
    return { ok: true, pagina: serializar(p) }
  } catch (e) {
    return aError(e)
  }
}

/** El historial tal como cruza al navegador: las fechas, en texto ISO. */
export interface SerializableHistorial extends Omit<HistorialPagina, 'filas'> {
  filas: Array<Omit<HistorialPagina['filas'][number], 'creadoEn'> & { creadoEn: string }>
}

function serializar(p: HistorialPagina): SerializableHistorial {
  return { siguiente: p.siguiente, filas: p.filas.map((f) => ({ ...f, creadoEn: f.creadoEn.toISOString() })) }
}
