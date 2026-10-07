'use server'

/**
 * POS CONECTADO A COMMERCE CORE · acciones de la caja (Fase 7).
 *
 * Reglas, las mismas de `caja/actions.ts`:
 *  · solo staff con acceso al escáner (SCANNER_ROLES) y de la MISMA empresa, que sale de la sesión
 *    —nunca de lo que mande el navegador—;
 *  · las capacidades `POS_CAJA` y `POS_MEMBEGO` (más el catálogo o los pedidos, según lo que se haga) mandan
 *    en el SERVIDOR, no solo escondiendo el panel;
 *  · la caja tiene que estar abierta y ser de la empresa (lo comprueba el servicio);
 *  · el precio, el descuento y el nivel de verificación los pone el servidor, nunca el navegador.
 *
 * Devuelven un resultado, no lanzan: el mensaje de un error de dominio se enseña tal cual; cualquier otro
 * error se traduce a uno genérico para no filtrar detalles de la base.
 */

import { revalidatePath } from 'next/cache'
import { conEmpresa } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { SCANNER_ROLES } from '@/types'
import { getRequestMeta } from '@/lib/server-utils'
import { formSubmitLimiter } from '@/lib/rate-limit'
import { capturarErrorInesperado } from '@/lib/sentry'
import { FacturacionError } from '@/modules/billing/errores'
import { InventarioError } from '@/modules/inventory/errores'
import { PedidoError } from '@/modules/orders/errores'
import { posPermitido } from './capacidades'
import { PosError } from './errores'
import {
  buscarClientesDeCajaEnTx,
  buscarProductosDeCajaEnTx,
  cobrarPedidoEnCajaEnTx,
  pedidoParaCobrarEnTx,
  sesionAbiertaEnTx,
  venderEnMostradorEnTx,
  type ClienteDeCaja,
  type ContextoCaja,
  type PedidoParaCobrar,
  type ProductoDeCaja,
  type ResultadoDeCobro,
  type ResultadoDeVenta,
} from './service'

export type Resultado<T> = ({ ok: true } & T) | { ok: false; error: string }

const texto = (v: unknown) => (typeof v === 'string' ? v : '')
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

async function cajero(necesita: 'cobrarPedidos' | 'venderEnMostrador'): Promise<{ companyId: string; ctx: ContextoCaja } | { error: string }> {
  const user = await requireRole(SCANNER_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return { error: 'No autorizado.' }
  if (!(await posPermitido(companyId))[necesita]) return { error: 'La caja conectada no está activada para este negocio.' }
  const userId = user.metadata.dbUserId ?? null
  // Documento comercial: SIEMPRE el nombre de quien cobra, nunca su correo.
  const nombre = userId ? ((await conEmpresa(companyId, (tx) => tx.user.findUnique({ where: { id: userId }, select: { name: true } })))?.name ?? user.email ?? null) : (user.email ?? null)
  const meta = await getRequestMeta()
  return { companyId, ctx: { actorId: userId, nombre, ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null } }
}

function aError(e: unknown, etiqueta: string): { ok: false; error: string } {
  if (e instanceof PosError || e instanceof PedidoError || e instanceof InventarioError || e instanceof FacturacionError) return { ok: false, error: e.message }
  capturarErrorInesperado(`pos:${etiqueta}`, e)
  return { ok: false, error: 'No se pudo completar la operación. Intenta de nuevo.' }
}

// ── Lecturas de la pantalla (no cambian nada) ────────────────────────────────

/** Qué se puede vender en el mostrador (de la sucursal de la caja). */
export async function buscarProductosCaja(entrada: { cajaSesionId: string; q: string }): Promise<Resultado<{ productos: ProductoDeCaja[] }>> {
  const c = await cajero('venderEnMostrador')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  try {
    const productos = await conEmpresa(c.companyId, async (tx) => {
      const sesion = await sesionAbiertaEnTx(tx, c.companyId, texto(entrada.cajaSesionId))
      return buscarProductosDeCajaEnTx(tx, c.companyId, sesion.sucursalId, texto(entrada.q))
    })
    return { ok: true, productos }
  } catch (e) {
    return aError(e, 'productos')
  }
}

/** Busca al cliente por nombre, teléfono o correo. */
export async function buscarClientesCaja(entrada: { q: string }): Promise<Resultado<{ clientes: ClienteDeCaja[] }>> {
  const c = await cajero('venderEnMostrador')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  try {
    return { ok: true, clientes: await conEmpresa(c.companyId, (tx) => buscarClientesDeCajaEnTx(tx, c.companyId, texto(entrada.q))) }
  } catch (e) {
    return aError(e, 'clientes')
  }
}

/** El pedido del QR que se escaneó o tecleó, y si esta caja lo puede cobrar. */
export async function buscarPedidoParaCobrar(entrada: { cajaSesionId: string; token: string }): Promise<Resultado<{ pedido: PedidoParaCobrar }>> {
  const c = await cajero('cobrarPedidos')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  if (!(await formSubmitLimiter(`pos-buscar:${c.ctx.actorId ?? c.companyId}`))) return { ok: false, error: 'Demasiados intentos. Espera un momento.' }
  try {
    return { ok: true, pedido: await conEmpresa(c.companyId, (tx) => pedidoParaCobrarEnTx(tx, c.companyId, texto(entrada.cajaSesionId), entrada.token)) }
  } catch (e) {
    return aError(e, 'buscar-pedido')
  }
}

// ── Cobrar ───────────────────────────────────────────────────────────────────

/** Cobra en la caja el pedido de quien presenta su QR y lo cierra. */
export async function cobrarPedidoMembego(entrada: { cajaSesionId: string; token: string; metodo: string; referencia?: string; recibido?: string }): Promise<Resultado<{ cobro: ResultadoDeCobro }>> {
  const c = await cajero('cobrarPedidos')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  if (!(await formSubmitLimiter(`pos-cobro:${c.ctx.actorId ?? c.companyId}`))) return { ok: false, error: 'Demasiados intentos. Espera un momento.' }
  try {
    const cobro = await conEmpresa(c.companyId, (tx) =>
      cobrarPedidoEnCajaEnTx(tx, c.companyId, { cajaSesionId: texto(entrada.cajaSesionId), token: texto(entrada.token), metodo: entrada.metodo, referencia: entrada.referencia, recibido: entrada.recibido }, c.ctx)
    )
    revalidatePath('/empleado/caja')
    revalidatePath('/admin/pedidos-membego', 'layout')
    revalidatePath('/admin/deals', 'layout')
    return { ok: true, cobro }
  } catch (e) {
    return aError(e, 'cobrar-pedido')
  }
}

/** Una venta de mostrador de productos del catálogo. */
export async function venderEnMostrador(entrada: {
  cajaSesionId: string
  lineas: { varianteId: string; cantidad: number }[]
  clienteId?: string | null
  metodo: string
  referencia?: string
  recibido?: string
  clave: string
}): Promise<Resultado<{ venta: ResultadoDeVenta }>> {
  const c = await cajero('venderEnMostrador')
  if ('error' in c) return { ok: false, error: c.error }
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  if (!(await formSubmitLimiter(`pos-venta:${c.ctx.actorId ?? c.companyId}`))) return { ok: false, error: 'Demasiados intentos. Espera un momento.' }
  try {
    // Del renglón solo se toman la variante y la cantidad: un precio o un descuento escondido se ignora.
    const lineas = Array.isArray(entrada.lineas) ? entrada.lineas.map((l) => ({ varianteId: texto(l?.varianteId), cantidad: Number(l?.cantidad) })) : []
    const venta = await conEmpresa(c.companyId, (tx) =>
      venderEnMostradorEnTx(
        tx,
        c.companyId,
        { cajaSesionId: texto(entrada.cajaSesionId), lineas, clienteId: texto(entrada.clienteId) || null, metodo: entrada.metodo, referencia: entrada.referencia, recibido: entrada.recibido, clave: entrada.clave },
        c.ctx
      )
    )
    revalidatePath('/empleado/caja')
    revalidatePath('/admin/pedidos-membego', 'layout')
    revalidatePath('/admin/inventario', 'layout')
    return { ok: true, venta }
  } catch (e) {
    return aError(e, 'vender')
  }
}
