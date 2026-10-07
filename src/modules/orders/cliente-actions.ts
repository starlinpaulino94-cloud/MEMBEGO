'use server'

/**
 * COMMERCE CORE · pedidos — acciones del CLIENTE (Fase 3).
 *
 * Sesión de cliente obligatoria. Lo que cruza al servicio es SIEMPRE lo que sale
 * de la sesión y de la base, nunca lo que diga el navegador:
 *
 *  · la EMPRESA se deduce de la variante pedida (no se acepta un `companyId`);
 *  · la FICHA de cliente es la de esa persona en esa empresa (se crea si no la
 *    tiene: pedir es la señal de interés, igual que adquirir una promoción);
 *  · el PRECIO lo pone el servicio desde el catálogo;
 *  · el CANAL de atribución solo admite los tres que no necesitan verificar nada
 *    (navegación, búsqueda, directo): referido, campaña o promoción los fijarán
 *    flujos del servidor que sí los comprueben.
 *
 * Devuelven un resultado, no lanzan.
 */

import { revalidatePath, revalidateTag } from 'next/cache'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'
import { formSubmitLimiter } from '@/lib/rate-limit'
import { asegurarClienteEnEmpresa, misClienteIds } from '@/modules/cliente/afiliacion'
import { NAV_CLIENTE_TAG } from '@/modules/cliente/cacheTags'
import { notificarAdmins } from '@/modules/notificaciones/service'
import { InventarioError } from '@/modules/inventory/errores'
import { PedidoError } from './errores'
import { empresaRecibePedidos } from './publico'
import { MAX_PEDIDOS_ABIERTOS_POR_CLIENTE } from './domain'
import { cancelarPedidoEnTx, confirmarMontoEnTx, contarPedidosAbiertosEnTx, crearPedidoEnTx, renovarQrEnTx, type ContextoPedido } from './service'
import type { MembegoAttributionChannel } from '@prisma/client'

export type ResultadoCliente<T = unknown> = ({ ok: true } & T) | { ok: false; error: string; sinSesion?: boolean }

const ORIGENES: Record<string, MembegoAttributionChannel> = {
  navegacion: 'MARKETPLACE_BROWSE',
  busqueda: 'MARKETPLACE_SEARCH',
  directo: 'DIRECT',
}

const MAX_CANTIDAD = 99

/**
 * Sesión de CLIENTE. No se exige una ficha en ninguna empresa: quien compró solo ofertas de
 * Membego es cliente de la plataforma sin ser todavía cliente de un negocio, y pedir es
 * justamente lo que le crea la ficha en ese negocio.
 */
async function clienteAutenticado() {
  const user = await getUser()
  if (!user || user.metadata.role !== 'CLIENTE') return null
  return user
}

/** Identificador estable de la persona para limitar la frecuencia de envíos. */
const claveDeLimite = (user: NonNullable<Awaited<ReturnType<typeof clienteAutenticado>>>): string => user.metadata.dbUserId ?? user.supabaseId

function aError(e: unknown): { ok: false; error: string } {
  if (e instanceof PedidoError || e instanceof InventarioError) return { ok: false, error: e.message }
  console.error('[pedidos-cliente]', e instanceof Error ? e.message : e)
  return { ok: false, error: 'No se pudo completar la operación. Intenta de nuevo.' }
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const texto = (v: unknown) => (typeof v === 'string' ? v : '')

/** Revalida lo que cambia con un pedido: la lista y el detalle del cliente, y el panel de la empresa. */
function refrescar(companyId?: string) {
  revalidatePath('/cliente/pedidos', 'layout')
  if (companyId) revalidatePath('/admin/pedidos-membego', 'layout')
}

export interface EntradaPedidoCliente {
  varianteId: string
  cantidad: number
  sucursalId: string
  notas?: string | null
  /** Clave de idempotencia de ESTE envío del formulario. */
  clave: string
  /** Dónde estaba la persona al pedir: 'navegacion' | 'busqueda' | 'directo'. */
  origen?: string
}

/** Crea un pedido desde la vitrina de una empresa. */
export async function crearPedidoComoCliente(entrada: EntradaPedidoCliente): Promise<ResultadoCliente<{ pedidoId: string; code: string; repetido: boolean }>> {
  try {
    const user = await clienteAutenticado()
    if (!user) {
      // Sin sesión de cliente: el formulario manda a la persona a iniciar sesión. Con la sesión de
      // una empresa o de la plataforma no tiene sentido: pedir es cosa de clientes.
      const hay = await getUser()
      return hay
        ? { ok: false, error: 'Los pedidos se hacen con una cuenta de cliente.' }
        : { ok: false, error: 'Inicia sesión para hacer tu pedido.', sinSesion: true }
    }
    if (!(await formSubmitLimiter(claveDeLimite(user)))) return { ok: false, error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }
    if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }

    const varianteId = texto(entrada.varianteId)
    const cantidad = Number(entrada.cantidad)
    if (!varianteId) return { ok: false, error: 'Elige qué quieres pedir.' }
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD) return { ok: false, error: `La cantidad tiene que ser un entero entre 1 y ${MAX_CANTIDAD}.` }
    const sucursalId = texto(entrada.sucursalId)
    if (!sucursalId) return { ok: false, error: 'Elige la sucursal donde recogerás tu pedido.' }
    const clave = texto(entrada.clave)
    if (clave === '' || clave.length > 100) return { ok: false, error: 'Recarga la página e inténtalo de nuevo.' }
    const canal = ORIGENES[texto(entrada.origen)] ?? 'MARKETPLACE_BROWSE'

    // La empresa sale de la variante, no del navegador.
    const variante = await sinEmpresa('pedidos: empresa de la variante pedida', (tx) =>
      tx.catalogVariant.findUnique({ where: { id: varianteId }, select: { companyId: true, item: { select: { company: { select: { isPublished: true, isActive: true, esDemo: true } } } } } })
    )
    const empresa = variante?.item.company
    if (!variante || !empresa || !empresa.isPublished || !empresa.isActive || empresa.esDemo || !(await empresaRecibePedidos(variante.companyId))) {
      // «No existe» y «no recibe pedidos» se ven igual.
      return { ok: false, error: 'Este producto no está disponible para pedir.' }
    }
    const companyId = variante.companyId

    const ficha = await asegurarClienteEnEmpresa(user.supabaseId, user.email, companyId)
    if ('error' in ficha) return { ok: false, error: ficha.error }

    const meta = await getRequestMeta()
    const ctx: ContextoPedido = { actor: 'CLIENTE', actorId: user.metadata.dbUserId ?? null, ...meta }
    const r = await conEmpresa(companyId, async (tx) => {
      // Freno contra quien aparta el stock con pedidos que nunca recoge. Un reintento del MISMO envío
      // (misma clave) no cuenta: devuelve el pedido ya creado.
      const clave2 = `cli:${user.supabaseId}:${clave}`
      const yaCreado = await tx.membegoOrder.findFirst({ where: { companyId, idempotencyKey: clave2 }, select: { id: true } })
      if (!yaCreado && (await contarPedidosAbiertosEnTx(tx, companyId, ficha.clienteId)) >= MAX_PEDIDOS_ABIERTOS_POR_CLIENTE) {
        throw new PedidoError('DEMASIADOS_PEDIDOS_ABIERTOS', `Ya tienes ${MAX_PEDIDOS_ABIERTOS_POR_CLIENTE} pedidos abiertos con esta empresa. Espera a que atiendan alguno o cancela uno para hacer otro.`)
      }
      return crearPedidoEnTx(
        tx,
        companyId,
        {
          customerId: ficha.clienteId,
          locationId: sucursalId,
          origin: 'MARKETPLACE',
          lineas: [{ varianteId, cantidad }],
          atribucion: { channel: canal },
          notas: entrada.notas ?? null,
          idempotencyKey: clave2,
        },
        ctx
      )
    })
    refrescar(companyId)
    // El primer pedido hace aparecer «Mis pedidos» en el menú del cliente.
    revalidateTag(NAV_CLIENTE_TAG, 'max')
    if (!r.repetido) {
      // Best-effort: un aviso no puede tumbar el pedido.
      void notificarAdmins(companyId, { tipo: 'SISTEMA', titulo: 'Nuevo pedido Membego', mensaje: `Llegó el pedido ${r.code} por ${r.total}. Acéptalo para empezar a atenderlo.`, href: `/admin/pedidos-membego/${r.pedidoId}`, dedupeKey: `pedido-nuevo:${r.pedidoId}` })
    }
    return { ok: true, pedidoId: r.pedidoId, code: r.code, repetido: r.repetido }
  } catch (e) {
    return aError(e)
  }
}

/** Ubica MI pedido (entre todas mis fichas) y devuelve su empresa y la ficha con que se hizo. */
async function ubicarMiPedido(supabaseId: string, pedidoId: string): Promise<{ companyId: string; customerId: string } | null> {
  if (!pedidoId) return null
  const ids = await misClienteIds(supabaseId)
  if (ids.length === 0) return null
  const p = await sinEmpresa('pedidos: ubicar mi pedido', (tx) => tx.membegoOrder.findFirst({ where: { id: pedidoId, customerId: { in: ids } }, select: { companyId: true, customerId: true } }))
  return p
}

async function accionSobreMiPedido<T extends object>(
  pedidoId: string,
  hacer: (companyId: string, customerId: string, ctx: ContextoPedido, tx: Parameters<Parameters<typeof conEmpresa>[1]>[0]) => Promise<T>
): Promise<ResultadoCliente<T>> {
  try {
    const user = await clienteAutenticado()
    if (!user) return { ok: false, error: 'No autorizado.' }
    if (!(await formSubmitLimiter(claveDeLimite(user)))) return { ok: false, error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }
    const mio = await ubicarMiPedido(user.supabaseId, texto(pedidoId))
    if (!mio) return { ok: false, error: 'El pedido no existe.' }
    const meta = await getRequestMeta()
    const ctx: ContextoPedido = { actor: 'CLIENTE', actorId: user.metadata.dbUserId ?? null, ...meta }
    const r = await conEmpresa(mio.companyId, (tx) => hacer(mio.companyId, mio.customerId, ctx, tx))
    refrescar(mio.companyId)
    return { ok: true, ...r }
  } catch (e) {
    return aError(e)
  }
}

/** Confirma el monto que la persona tiene en pantalla; si cambió entretanto, se rechaza. */
export async function confirmarMontoPedido(entrada: { pedidoId: string; montoVisto: string }): Promise<ResultadoCliente<{ repetido: boolean }>> {
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  return accionSobreMiPedido(texto(entrada.pedidoId), async (companyId, customerId, ctx, tx) => {
    const r = await confirmarMontoEnTx(tx, companyId, texto(entrada.pedidoId), { customerId, montoVisto: texto(entrada.montoVisto) }, ctx)
    return { repetido: r.repetido }
  })
}

/** Cancela mi pedido (solo antes de que la empresa lo acepte). */
export async function cancelarMiPedido(entrada: { pedidoId: string; motivo: string }): Promise<ResultadoCliente<{ repetido: boolean }>> {
  if (!esObjeto(entrada)) return { ok: false, error: 'Datos no válidos.' }
  return accionSobreMiPedido(texto(entrada.pedidoId), async (companyId, customerId, ctx, tx) => {
    const r = await cancelarPedidoEnTx(tx, companyId, texto(entrada.pedidoId), { motivo: texto(entrada.motivo), customerId }, ctx)
    return { repetido: r.repetido }
  })
}

/** Pide un QR nuevo para mi pedido listo (el anterior deja de valer). */
export async function renovarQrDeMiPedido(pedidoId: string): Promise<ResultadoCliente> {
  return accionSobreMiPedido(texto(pedidoId), async (companyId, customerId, ctx, tx) => {
    await renovarQrEnTx(tx, companyId, texto(pedidoId), { customerId }, ctx)
    return {}
  })
}
