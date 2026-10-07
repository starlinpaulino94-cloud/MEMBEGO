'use server'

/**
 * MARKETPLACE CHECKOUT · acciones (Fase 8).
 *
 * `resumirCarrito` es PÚBLICA (el carrito se arma sin cuenta): solo lee lo que ya es público del catálogo de un
 * negocio publicado, con un límite por IP, y devuelve precios y existencias de HOY.
 *
 * `hacerCheckout` es del CLIENTE (sesión de cliente obligatoria). Lo que cruza al servicio sale SIEMPRE de la
 * sesión y de la base, nunca del navegador:
 *  · la EMPRESA se deduce de las variantes del carrito (todas tienen que ser del mismo negocio);
 *  · la FICHA de cliente es la de esa persona en esa empresa (se crea si no la tiene: pagar es la señal de interés);
 *  · el PRECIO sale del catálogo; el navegador solo dice qué variante y cuántas;
 *  · el CANAL solo admite los que no necesitan verificar nada (navegación, búsqueda, directo).
 */

import { revalidatePath, revalidateTag } from 'next/cache'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'
import { createRateLimiter, formSubmitLimiter, getClientIdentifier } from '@/lib/rate-limit'
import { headers } from 'next/headers'
import { asegurarClienteEnEmpresa } from '@/modules/cliente/afiliacion'
import { NAV_CLIENTE_TAG } from '@/modules/cliente/cacheTags'
import { notificarAdmins } from '@/modules/notificaciones/service'
import { InventarioError } from '@/modules/inventory/errores'
import { PedidoError } from '@/modules/orders/errores'
import { empresaRecibePedidos } from '@/modules/orders/publico'
import type { ContextoPedido } from '@/modules/orders/service'
import { MAX_LINEAS_CARRITO, leerCarrito, type LineaDeCarrito } from './domain'
import { crearPedidoDelCarritoEnTx, resumenDelCarritoEnTx, type ResumenDeCarrito } from './service'
import { transferenciaDisponible } from './publico'

export type Resultado<T> = ({ ok: true } & T) | { ok: false; error: string; sinSesion?: boolean }

// El carrito se refresca al cambiar cantidades: un límite más holgado que el de los formularios.
const limiteLecturas = createRateLimiter({ interval: 60 * 1000, maxRequests: 90, name: 'carrito' })

const texto = (v: unknown) => (typeof v === 'string' ? v : '')
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Las líneas que manda el navegador, saneadas con la misma regla que lo guardado. */
function lineasLimpias(v: unknown): LineaDeCarrito[] {
  const c = leerCarrito({ v: 1, negocios: { x: Array.isArray(v) ? v : [] } })
  return (c.negocios.x ?? []).slice(0, MAX_LINEAS_CARRITO)
}

function aError(e: unknown): { ok: false; error: string } {
  if (e instanceof PedidoError || e instanceof InventarioError) return { ok: false, error: e.message }
  console.error('[checkout]', e instanceof Error ? e.message : e)
  return { ok: false, error: 'No se pudo completar la operación. Intenta de nuevo.' }
}

export interface EmpresaDelCarrito {
  slug: string
  nombre: string
  sucursales: { id: string; nombre: string }[]
}

/** El carrito de un negocio con precios y existencias de hoy. Sin sesión. */
export async function resumirCarrito(entrada: { companySlug: string; sucursalId?: string | null; lineas: unknown }): Promise<Resultado<{ empresa: EmpresaDelCarrito; resumen: ResumenDeCarrito }>> {
  try {
    if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
    const h = await headers()
    if (!(await limiteLecturas(getClientIdentifier({ headers: h })))) return { ok: false, error: 'Demasiadas consultas. Espera un momento.' }
    const slug = texto(entrada.companySlug)
    const empresa = await sinEmpresa('checkout: empresa pública de un carrito (por slug)', (tx) =>
      tx.company.findFirst({
        where: { slug, isPublished: true, isActive: true, esDemo: false },
        select: { id: true, slug: true, name: true, sucursales: { where: { activa: true }, select: { id: true, nombre: true }, orderBy: [{ nombre: 'asc' }, { id: 'asc' }] } },
      })
    )
    // «No existe» y «no recibe pedidos» se ven igual.
    if (!empresa || !(await empresaRecibePedidos(empresa.id))) return { ok: false, error: 'Este negocio no recibe pedidos por ahora.' }
    const sucursalId = texto(entrada.sucursalId)
    const lineas = lineasLimpias(entrada.lineas)
    const resumen = await conEmpresa(empresa.id, (tx) => resumenDelCarritoEnTx(tx, empresa.id, lineas, empresa.sucursales.some((s) => s.id === sucursalId) ? sucursalId : null))
    return { ok: true, empresa: { slug: empresa.slug, nombre: empresa.name, sucursales: empresa.sucursales }, resumen }
  } catch (e) {
    return aError(e)
  }
}

/** Paga el carrito de UN negocio: crea el pedido esperando a la empresa y aparta las existencias. */
export async function hacerCheckout(entrada: {
  lineas: unknown
  sucursalId: string
  metodo: string
  notas?: string
  origen?: string
  clave: string
}): Promise<Resultado<{ pedidoId: string; code: string; total: string; repetido: boolean }>> {
  try {
    const user = await getUser()
    if (!user) return { ok: false, error: 'Inicia sesión para hacer tu pedido.', sinSesion: true }
    if (user.metadata.role !== 'CLIENTE') return { ok: false, error: 'Los pedidos se hacen con una cuenta de cliente.' }
    if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
    if (!(await formSubmitLimiter(user.metadata.dbUserId ?? user.supabaseId))) return { ok: false, error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }

    const lineas = lineasLimpias(entrada.lineas)
    if (lineas.length === 0) return { ok: false, error: 'Tu carrito está vacío.' }
    const sucursalId = texto(entrada.sucursalId)
    if (!sucursalId) return { ok: false, error: 'Elige la sucursal donde recogerás tu pedido.' }
    const clave = texto(entrada.clave)
    if (clave === '' || clave.length > 100) return { ok: false, error: 'Recarga la página e inténtalo de nuevo.' }

    // La empresa sale de las variantes: todas del mismo negocio, publicado y que recibe pedidos.
    const variantes = await sinEmpresa('checkout: empresa de las variantes del carrito', (tx) =>
      tx.catalogVariant.findMany({
        where: { id: { in: lineas.map((l) => l.varianteId) } },
        select: { id: true, companyId: true, item: { select: { company: { select: { isPublished: true, isActive: true, esDemo: true } } } } },
      })
    )
    const empresas = new Set(variantes.map((v) => v.companyId))
    if (variantes.length !== new Set(lineas.map((l) => l.varianteId)).size || empresas.size !== 1) return { ok: false, error: 'Algunos productos del carrito ya no están disponibles. Revisa tu carrito.' }
    const companyId = [...empresas][0]
    const e = variantes[0].item.company
    if (!e.isPublished || !e.isActive || e.esDemo || !(await empresaRecibePedidos(companyId))) return { ok: false, error: 'Este negocio no recibe pedidos por ahora.' }

    // La transferencia solo se acepta si el negocio la tiene encendida y dice adónde transferir.
    if (entrada.metodo === 'TRANSFERENCIA' && !(await transferenciaDisponible(companyId))) return { ok: false, error: 'Este negocio no acepta transferencias por ahora. Elige pagar al recoger.' }

    const ficha = await asegurarClienteEnEmpresa(user.supabaseId, user.email, companyId)
    if ('error' in ficha) return { ok: false, error: ficha.error }

    const meta = await getRequestMeta()
    const ctx: ContextoPedido = { actor: 'CLIENTE', actorId: user.metadata.dbUserId ?? null, ...meta }
    const r = await conEmpresa(companyId, (tx) =>
      crearPedidoDelCarritoEnTx(tx, companyId, { customerId: ficha.clienteId, locationId: sucursalId, lineas, metodo: entrada.metodo, notas: entrada.notas, canal: entrada.origen, clave }, ctx)
    )
    revalidatePath('/cliente/pedidos', 'layout')
    revalidatePath('/admin/pedidos-membego', 'layout')
    revalidateTag(NAV_CLIENTE_TAG, 'max')
    if (!r.repetido) {
      // Best-effort: un aviso no puede tumbar el pedido.
      void notificarAdmins(companyId, { tipo: 'SISTEMA', titulo: 'Nuevo pedido Membego', mensaje: `Llegó el pedido ${r.code} por ${r.total}. Acéptalo para empezar a atenderlo.`, href: `/admin/pedidos-membego/${r.pedidoId}`, dedupeKey: `pedido-nuevo:${r.pedidoId}` })
    }
    return { ok: true, ...r }
  } catch (e) {
    return aError(e)
  }
}
