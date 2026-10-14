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
 *
 * AVISO DE STOCK BAJO. Lo que baja lo vendible a mano —un faltante, un daño, una
 * transferencia (en el origen) o un conteo a la baja— avisa igual que una venta:
 * antes solo avisaban las ventas del marketplace, y un daño que agotaba un
 * producto no se lo decía a nadie. Va DESPUÉS de confirmar y de responder
 * (`after`: un aviso lanzado a medias con `void` puede perderse cuando la
 * respuesta termina) y es best-effort (`avisarStockBajo` nunca lanza): un aviso
 * no puede deshacer un movimiento.
 */

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { conEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getRequestMeta } from '@/lib/server-utils'
import { formSubmitLimiter } from '@/lib/rate-limit'
import type { SessionUser } from '@/types'
import type { ContextoAuditoria } from './auditoria'
import { avisarStockBajo } from './avisos'
import { notificarAdmins } from '@/modules/notificaciones/service'
import type { ModoConteo } from './conteos'
import { InventarioError } from './errores'
import type { InformeImportacion } from './importacion'
import { aplicarImportacionDeConteoEnTx, aplicarImportacionEnTx, informeDeConteoImportadoEnTx, informeDeImportacionEnTx } from './importar'
import { buscarVariantesParaEntradaEnTx, historialDeVarianteEnTx, type HistorialPagina, type VarianteBuscable } from './queries'
import {
  abrirConteoEnTx,
  cancelarTrasladoEnTx,
  enviarTrasladoEnTx,
  recibirTrasladoEnTx,
  aplicarConteoEnTx,
  cancelarConteoEnTx,
  quitarLineaDeConteoEnTx,
  registrarConteoProductoEnTx,
  ajustarEnTx,
  configurarUmbralEnTx,
  configurarUmbralOtrasSucursalesEnTx,
  contarEnTx,
  danarEnTx,
  devolverEnTx,
  recibirEnTx,
  registrarEntradaMultipleEnTx,
  resolverDanadoEnTx,
  transferirEnTx,
  type LineaRechazada,
  type ResumenConteoAplicado,
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

/** Tras confirmar un movimiento que bajó lo vendible: ¿quedó la variante bajo su umbral? */
function avisarTrasBajar(companyId: string, varianteId: unknown) {
  if (typeof varianteId !== 'string' || varianteId === '') return
  after(() => avisarStockBajo(companyId, [varianteId]))
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
  hacer: (companyId: string, e: Record<string, unknown>, ctx: ContextoAuditoria, tx: Parameters<Parameters<typeof conEmpresa>[1]>[0]) => Promise<{ saldo: SaldoVista; repetido: boolean }>,
  /** ¿Este movimiento baja lo vendible? Si sí, tras confirmarse se revisa el umbral de la variante. */
  bajaLoVendible: (e: Record<string, unknown>) => boolean = () => false
): Promise<ResultadoSaldo> {
  const c = await contexto(funcion)
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  try {
    const r = await conEmpresa(c.companyId, (tx) => hacer(c.companyId, entrada, c.ctx, tx))
    refrescar()
    if (!r.repetido && bajaLoVendible(entrada)) avisarTrasBajar(c.companyId, entrada.varianteId)
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
    danarEnTx(tx, companyId, { varianteId: texto(e.varianteId), sucursalId: texto(e.sucursalId), cantidad: e.cantidad as number, motivo: e.motivo as string | null, idempotencyKey: clave(e.clave) }, ctx),
    () => true
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
    ajustarEnTx(tx, companyId, { varianteId: texto(e.varianteId), sucursalId: texto(e.sucursalId), cambio: e.cambio as number, motivo: e.motivo as string | null, idempotencyKey: clave(e.clave) }, ctx),
    (e) => typeof e.cambio === 'number' && e.cambio < 0
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
    if (r.diferencia < 0) avisarTrasBajar(c.companyId, entrada.varianteId)
    return { ok: true, saldo: r.saldo, diferencia: r.diferencia, repetido: r.repetido }
  } catch (e) {
    return aError(e)
  }
}

/**
 * Fija el umbral de stock bajo de una variante en una sucursal (0 = sin alerta).
 * Con `aplicarAOtras`, el mismo umbral se aplica también a las demás sucursales
 * activas donde el producto ya tiene saldo (todo en una sola transacción).
 */
export async function fijarUmbralInventario(entrada: {
  varianteId: string
  sucursalId: string
  umbral: number
  aplicarAOtras?: boolean
}): Promise<ResultadoInventario<{ umbral: number; otras: number }>> {
  const c = await contexto('ajustar')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  try {
    const r = await conEmpresa(c.companyId, async (tx) => {
      const propia = await configurarUmbralEnTx(tx, c.companyId, { varianteId: texto(entrada.varianteId), sucursalId: texto(entrada.sucursalId), umbral: entrada.umbral as number }, c.ctx)
      const otras =
        entrada.aplicarAOtras === true
          ? await configurarUmbralOtrasSucursalesEnTx(tx, c.companyId, { varianteId: texto(entrada.varianteId), sucursalOrigenId: texto(entrada.sucursalId), umbral: entrada.umbral as number }, c.ctx)
          : { sucursales: 0 }
      return { umbral: propia.umbral, otras: otras.sucursales }
    })
    refrescar()
    return { ok: true, umbral: r.umbral, otras: r.otras }
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
    if (!r.repetido) avisarTrasBajar(c.companyId, entrada.varianteId)
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

// ── INV-2a · entrada de mercancía con varias líneas e importación CSV ────────

export interface ResumenEntrada {
  entradaId: string
  numero: string
  lineas: number
  unidades: number
  repetido: boolean
}

/** Lo que cruza al navegador de un informe de importación: sin las líneas (son del servidor, que las rehace al aplicar). */
export type InformeVista = Omit<InformeImportacion, 'lineas'>

const sinLineas = (i: InformeImportacion): InformeVista => {
  const { lineas, ...resto } = i
  void lineas
  return resto
}

/**
 * Registra UNA entrada de mercancía con todas sus líneas, todo o nada. Las
 * líneas se vuelven a validar en el servicio (cantidades, productos, sucursal):
 * lo que manda el navegador no se da por bueno.
 */
export async function registrarEntradaMultiple(entrada: {
  sucursalId: string
  lineas: { varianteId: string; cantidad: number }[]
  referencia?: string | null
  nota?: string | null
  clave?: string | null
}): Promise<ResultadoInventario<ResumenEntrada>> {
  const c = await contexto('ajustar')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  const lineas = Array.isArray(entrada.lineas) ? entrada.lineas.map((l) => ({ varianteId: texto(l?.varianteId), cantidad: l?.cantidad as number })) : []
  try {
    const r = await conEmpresa(c.companyId, (tx) =>
      registrarEntradaMultipleEnTx(
        tx,
        c.companyId,
        { sucursalId: texto(entrada.sucursalId), lineas, referencia: entrada.referencia, nota: entrada.nota, origen: 'MANUAL', idempotencyKey: clave(entrada.clave) },
        c.ctx
      )
    )
    refrescar()
    return { ok: true, ...r }
  } catch (e) {
    return aError(e)
  }
}

/** Busca productos que controlan inventario para añadir a una entrada: nombre, SKU o código de barras (un lector escribe el código). */
export async function buscarProductosParaEntrada(q: string, sucursalId: string | null): Promise<ResultadoInventario<{ productos: VarianteBuscable[] }>> {
  const c = await contexto('ajustar')
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof q !== 'string' || (sucursalId !== null && typeof sucursalId !== 'string')) return { ok: false, error: 'Datos no válidos.' }
  try {
    const productos = await conEmpresa(c.companyId, (tx) => buscarVariantesParaEntradaEnTx(tx, c.companyId, q, sucursalId || null))
    return { ok: true, productos }
  } catch (e) {
    return aError(e)
  }
}

/** Lee el archivo y dice, fila por fila, qué pasaría. NO escribe nada. */
export async function previsualizarImportacion(entrada: { texto: string }): Promise<ResultadoInventario<{ informe: InformeVista }>> {
  const c = await contexto('ajustar')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  if (!(await formSubmitLimiter(`inv-importar:${c.ctx.actorId ?? c.companyId}`))) return { ok: false, error: 'Demasiados intentos. Espera un momento.' }
  try {
    const r = await conEmpresa(c.companyId, (tx) => informeDeImportacionEnTx(tx, c.companyId, entrada.texto))
    if (!r.ok) return { ok: false, error: r.error }
    return { ok: true, informe: sinLineas(r.informe) }
  } catch (e) {
    return aError(e)
  }
}

/**
 * Aplica el archivo: vuelve a leerlo y a validarlo contra el catálogo de AHORA y,
 * solo si no tiene un error, lo registra como una entrada (origen CSV). Con un
 * error devuelve el informe y no escribe nada.
 */
export async function aplicarImportacion(entrada: {
  sucursalId: string
  texto: string
  referencia?: string | null
  nota?: string | null
  clave?: string | null
}): Promise<ResultadoInventario<{ aplicada: true; entrada: ResumenEntrada } | { aplicada: false; informe: InformeVista }>> {
  const c = await contexto('ajustar')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  if (!(await formSubmitLimiter(`inv-importar:${c.ctx.actorId ?? c.companyId}`))) return { ok: false, error: 'Demasiados intentos. Espera un momento.' }
  try {
    const r = await conEmpresa(c.companyId, (tx) =>
      aplicarImportacionEnTx(tx, c.companyId, { sucursalId: texto(entrada.sucursalId), texto: entrada.texto, referencia: entrada.referencia, nota: entrada.nota, idempotencyKey: clave(entrada.clave) }, c.ctx)
    )
    if (!r.ok) return { ok: false, error: r.error }
    if (!r.resultado.aplicada) return { ok: true, aplicada: false, informe: sinLineas(r.resultado.informe) }
    refrescar()
    return { ok: true, aplicada: true, entrada: r.resultado.entrada }
  } catch (e) {
    return aError(e)
  }
}

// ── INV-2b · conteo físico por sucursal ──────────────────────────────────────

export interface ResumenAperturaConteo {
  conteoId: string
  numero: string
  /** true si esa persona ya tenía abierto el conteo de la sucursal: es el mismo. */
  repetido: boolean
}

/**
 * Abre el conteo de una sucursal (uno solo abierto por sucursal). La función es
 * `ajustar`: contar es el paso previo de un ajuste, y aplicarlo los hace.
 */
export async function iniciarConteo(entrada: { sucursalId: string; nota?: string | null }): Promise<ResultadoInventario<ResumenAperturaConteo>> {
  const c = await contexto('ajustar')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  try {
    const r = await conEmpresa(c.companyId, (tx) => abrirConteoEnTx(tx, c.companyId, { sucursalId: texto(entrada.sucursalId), nota: entrada.nota }, c.ctx))
    refrescar()
    return { ok: true, ...r }
  } catch (e) {
    return aError(e)
  }
}

/**
 * Cuenta UN producto (un escaneo suma; escribir la cantidad la fija). Sin límite
 * de envíos a propósito: un lector dispara varias capturas por segundo.
 */
export async function contarProductoEnConteo(entrada: {
  conteoId: string
  varianteId: string
  cantidad: number
  modo: ModoConteo
}): Promise<ResultadoInventario<{ varianteId: string; contado: number; nueva: boolean; lineas: number }>> {
  const c = await contexto('ajustar')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  try {
    const r = await conEmpresa(c.companyId, (tx) =>
      registrarConteoProductoEnTx(tx, c.companyId, { conteoId: texto(entrada.conteoId), varianteId: texto(entrada.varianteId), cantidad: entrada.cantidad, modo: entrada.modo }, c.ctx)
    )
    refrescar()
    return { ok: true, ...r }
  } catch (e) {
    return aError(e)
  }
}

/** Saca un producto del conteo abierto (lo que no tiene línea no se ajusta). */
export async function quitarProductoDelConteo(entrada: { conteoId: string; varianteId: string }): Promise<ResultadoInventario<{ quitada: boolean }>> {
  const c = await contexto('ajustar')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  try {
    const r = await conEmpresa(c.companyId, (tx) => quitarLineaDeConteoEnTx(tx, c.companyId, { conteoId: texto(entrada.conteoId), varianteId: texto(entrada.varianteId) }))
    refrescar()
    return { ok: true, quitada: r.quitada }
  } catch (e) {
    return aError(e)
  }
}

/**
 * Busca productos para contar: nombre, SKU o código de barras. A CIEGAS: no
 * pide sucursal, así que no devuelve lo que hay (`disponible` siempre es null).
 */
export async function buscarProductosParaConteo(q: string): Promise<ResultadoInventario<{ productos: VarianteBuscable[] }>> {
  const c = await contexto('ajustar')
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof q !== 'string') return { ok: false, error: 'Datos no válidos.' }
  try {
    const productos = await conEmpresa(c.companyId, (tx) => buscarVariantesParaEntradaEnTx(tx, c.companyId, q, null))
    return { ok: true, productos }
  } catch (e) {
    return aError(e)
  }
}

/** Lee la hoja contada y dice, fila por fila, qué pasaría. NO escribe nada. */
export async function previsualizarConteoImportado(entrada: { texto: string }): Promise<ResultadoInventario<{ informe: InformeVista }>> {
  const c = await contexto('ajustar')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  if (!(await formSubmitLimiter(`inv-conteo-importar:${c.ctx.actorId ?? c.companyId}`))) return { ok: false, error: 'Demasiados intentos. Espera un momento.' }
  try {
    const r = await conEmpresa(c.companyId, (tx) => informeDeConteoImportadoEnTx(tx, c.companyId, entrada.texto))
    if (!r.ok) return { ok: false, error: r.error }
    return { ok: true, informe: sinLineas(r.informe) }
  } catch (e) {
    return aError(e)
  }
}

/**
 * Carga la hoja contada en el conteo abierto: vuelve a leerla y validarla y, solo
 * si no tiene un error, la registra todo junta. Un producto que ya tenía línea
 * se reemplaza. Con un error devuelve el informe y no escribe nada.
 */
export async function importarConteo(entrada: {
  conteoId: string
  texto: string
}): Promise<ResultadoInventario<{ aplicada: true; nuevas: number; reemplazadas: number; lineas: number } | { aplicada: false; informe: InformeVista }>> {
  const c = await contexto('ajustar')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  if (!(await formSubmitLimiter(`inv-conteo-importar:${c.ctx.actorId ?? c.companyId}`))) return { ok: false, error: 'Demasiados intentos. Espera un momento.' }
  try {
    const r = await conEmpresa(c.companyId, (tx) => aplicarImportacionDeConteoEnTx(tx, c.companyId, { conteoId: texto(entrada.conteoId), texto: entrada.texto }, c.ctx))
    if (!r.ok) return { ok: false, error: r.error }
    if (!r.resultado.aplicada) return { ok: true, aplicada: false, informe: sinLineas(r.resultado.informe) }
    refrescar()
    const { nuevas, reemplazadas, lineas } = r.resultado
    return { ok: true, aplicada: true, nuevas, reemplazadas, lineas }
  } catch (e) {
    return aError(e)
  }
}

/**
 * APLICA el conteo: un ajuste por producto por la diferencia, todo o nada. Si
 * alguna línea no se puede aplicar (dejaría menos de lo apartado), no se aplica
 * ninguna y se devuelven las que fallan. Tras confirmar, los productos cuyo
 * vendible bajó pasan por el aviso de stock bajo, igual que un faltante a mano.
 */
export async function aplicarConteo(entrada: {
  conteoId: string
}): Promise<
  ResultadoInventario<
    { aplicada: true; numero: string; resumen: ResumenConteoAplicado; repetido: boolean } | { aplicada: false; numero: string; rechazadas: LineaRechazada[] }
  >
> {
  const c = await contexto('ajustar')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  try {
    const r = await conEmpresa(c.companyId, (tx) => aplicarConteoEnTx(tx, c.companyId, { conteoId: texto(entrada.conteoId) }, c.ctx))
    if (!r.aplicada) return { ok: true, aplicada: false, numero: r.numero, rechazadas: r.rechazadas }
    refrescar()
    if (!r.repetido && r.variantesBajadas.length > 0) {
      const bajadas = r.variantesBajadas
      after(() => avisarStockBajo(c.companyId, bajadas))
    }
    return { ok: true, aplicada: true, numero: r.numero, resumen: r.resumen, repetido: r.repetido }
  } catch (e) {
    return aError(e)
  }
}

/** Descarta el conteo sin tocar existencias; queda guardado con quién y por qué. */
export async function cancelarConteo(entrada: { conteoId: string; motivo?: string | null }): Promise<ResultadoInventario<{ numero: string }>> {
  const c = await contexto('ajustar')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  try {
    const r = await conEmpresa(c.companyId, (tx) => cancelarConteoEnTx(tx, c.companyId, { conteoId: texto(entrada.conteoId), motivo: entrada.motivo }, c.ctx))
    refrescar()
    return { ok: true, numero: r.numero }
  } catch (e) {
    return aError(e)
  }
}

// ── INV-2c · transferencias con envío ────────────────────────────────────────
//
// La función es `transferir` (la misma de la transferencia directa), no `ajustar`:
// mover mercancía entre sucursales y corregir existencias son permisos distintos.

export interface ResumenEnvio {
  trasladoId: string
  numero: string
  lineas: number
  unidades: number
  repetido: boolean
}

/**
 * Envía mercancía a otra sucursal: sale del origen y queda EN TRÁNSITO hasta que el
 * destino la reciba. Todo o nada. Tras confirmar: aviso de stock bajo en el origen y
 * una notificación a los administradores («viene en camino»), ambos fuera de la
 * transacción y de la respuesta (`after`).
 */
export async function enviarTransferencia(entrada: {
  origenId: string
  destinoId: string
  lineas: { varianteId: string; cantidad: number }[]
  nota?: string | null
  clave?: string | null
}): Promise<ResultadoInventario<ResumenEnvio>> {
  const c = await contexto('transferir')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  const lineas = Array.isArray(entrada.lineas) ? entrada.lineas.map((l) => ({ varianteId: texto(l?.varianteId), cantidad: l?.cantidad as number })) : []
  try {
    const r = await conEmpresa(c.companyId, (tx) =>
      enviarTrasladoEnTx(tx, c.companyId, { origenId: texto(entrada.origenId), destinoId: texto(entrada.destinoId), lineas, nota: entrada.nota, idempotencyKey: clave(entrada.clave) }, c.ctx)
    )
    refrescar()
    if (!r.repetido) {
      const { companyId } = c
      after(() => avisarStockBajo(companyId, r.variantes))
      after(() =>
        notificarAdmins(companyId, {
          tipo: 'SISTEMA',
          titulo: 'Transferencia en camino',
          mensaje: `${r.numero}: ${r.unidades.toLocaleString('es-DO')} unidad${r.unidades === 1 ? '' : 'es'} de ${r.lineas.toLocaleString('es-DO')} producto${r.lineas === 1 ? '' : 's'} salieron de ${r.origenNombre} hacia ${r.destinoNombre}. Recíbela cuando llegue.`,
          href: `/admin/inventario/transferencias/${r.trasladoId}`,
          dedupeKey: `traslado-enviado:${r.trasladoId}`,
        })
      )
    }
    return { ok: true, trasladoId: r.trasladoId, numero: r.numero, lineas: r.lineas, unidades: r.unidades, repetido: r.repetido }
  } catch (e) {
    return aError(e)
  }
}

/** Busca productos que controlan inventario para añadir a un envío; devuelve lo disponible en la sucursal de origen. */
export async function buscarProductosParaTransferencia(q: string, origenId: string | null): Promise<ResultadoInventario<{ productos: VarianteBuscable[] }>> {
  const c = await contexto('transferir')
  if ('error' in c) return { ok: false, error: c.error }
  if (typeof q !== 'string' || (origenId !== null && typeof origenId !== 'string')) return { ok: false, error: 'Datos no válidos.' }
  try {
    const productos = await conEmpresa(c.companyId, (tx) => buscarVariantesParaEntradaEnTx(tx, c.companyId, q, origenId || null))
    return { ok: true, productos }
  } catch (e) {
    return aError(e)
  }
}

export interface ResumenRecepcion {
  trasladoId: string
  numero: string
  estado: 'SENT' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED'
  recibidas: number
  perdidas: number
  enTransito: number
  repetido: boolean
}

/**
 * Registra lo que llegó: parte de las líneas o todo lo que falte. Si algo no llegó, o se
 * sigue esperando (queda «recibida en parte») o se cierra con faltante, y entonces el
 * motivo es obligatorio.
 */
export async function recibirTransferencia(entrada: {
  trasladoId: string
  lineas?: { varianteId: string; cantidad: number }[]
  todo?: boolean
  cerrarConFaltante?: boolean
  motivo?: string | null
  clave?: string | null
}): Promise<ResultadoInventario<ResumenRecepcion>> {
  const c = await contexto('transferir')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  const lineas = Array.isArray(entrada.lineas) ? entrada.lineas.map((l) => ({ varianteId: texto(l?.varianteId), cantidad: l?.cantidad as number })) : undefined
  try {
    const r = await conEmpresa(c.companyId, (tx) =>
      recibirTrasladoEnTx(
        tx,
        c.companyId,
        { trasladoId: texto(entrada.trasladoId), lineas, todo: entrada.todo === true, cerrarConFaltante: entrada.cerrarConFaltante === true, motivo: entrada.motivo, idempotencyKey: clave(entrada.clave) },
        c.ctx
      )
    )
    refrescar()
    return { ok: true, ...r }
  } catch (e) {
    return aError(e)
  }
}

/** Cancela el envío: lo que sigue en camino vuelve al origen. */
export async function cancelarTransferencia(entrada: { trasladoId: string; motivo?: string | null }): Promise<ResultadoInventario<{ numero: string; devueltas: number; repetido: boolean }>> {
  const c = await contexto('transferir')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  try {
    const r = await conEmpresa(c.companyId, (tx) => cancelarTrasladoEnTx(tx, c.companyId, { trasladoId: texto(entrada.trasladoId), motivo: entrada.motivo }, c.ctx))
    refrescar()
    return { ok: true, numero: r.numero, devueltas: r.devueltas, repetido: r.repetido }
  } catch (e) {
    return aError(e)
  }
}
