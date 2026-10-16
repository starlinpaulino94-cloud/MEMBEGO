import type { Tx } from '@/lib/tenant'
import { normalizarCapacidades } from '@/modules/catalog/domain'
import { auditarInventario, type ContextoAuditoria } from './auditoria'
import { InventarioError, fallo } from './errores'
import { nombreCompleto } from './formato'
import { unidadesParaKits, validarReceta } from './kits'
import { recetasDeKitsEnTx } from './kits-queries'
import { consumirReservaEnTx, devolverEnTx, liberarReservaEnTx, reservarEnTx, venderEnTx, type Referencia } from './service'

/**
 * COMMERCE CORE · inventario — INV-5d: KITS. Un kit es una variante sin existencias propias, armada con una receta de componentes. La receta se
 * guarda aquí; vender un kit (`reservarKitEnTx`, `consumirKitsDeReferenciaEnTx`, …) mueve los COMPONENTES por las mismas puertas de siempre
 * (`reservarEnTx`, `consumirReservaEnTx`, `venderEnTx`, `liberarReservaEnTx`, `devolverEnTx`), así que lotes, series, FEFO, costos y el ledger
 * funcionan igual: el kit no es otra fuente de existencias. Lo único propio es `inventory_kit_reservations`, que anota qué reservas de
 * componentes salieron de qué kit en qué pedido (la foto de lo apartado: si la receta cambia después, el pedido sabe lo que apartó).
 */

async function bloquearVariante(tx: Tx, companyId: string, varianteId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "catalog_variants" WHERE "id" = ${varianteId} AND "companyId" = ${companyId} FOR UPDATE`
}

export interface ResultadoReceta {
  kitVarianteId: string
  componentes: number
  /** Primera receta del kit. */
  nueva: boolean
  /** La receta pedida ya era la guardada: no se tocó nada. */
  sinCambios: boolean
}

/**
 * Guarda (reemplaza) la receta de un kit. El kit es una variante de un producto de la empresa que NO controla inventario por su cuenta; cada
 * componente controla inventario y no es, a su vez, un kit (los kits no se anidan). Cambiar la receta no toca lo que ya se apartó en pedidos.
 */
export async function guardarRecetaDeKitEnTx(tx: Tx, companyId: string, e: { kitVarianteId: string; componentes: unknown }, ctx: ContextoAuditoria): Promise<ResultadoReceta> {
  const kitId = typeof e.kitVarianteId === 'string' ? e.kitVarianteId : ''
  const valida = validarReceta(e.componentes, kitId)
  if (!valida.ok) fallo(valida.codigo, valida.error)
  const kit = await tx.catalogVariant.findFirst({
    where: { id: kitId, companyId },
    select: { id: true, sku: true, name: true, isDefault: true, item: { select: { name: true, type: true, capabilities: true, source: true } } },
  })
  if (!kit) fallo('VARIANTE_NO_ENCONTRADA', 'El producto del kit no existe.')
  const nombreKit = nombreCompleto(kit.item.name, kit.name, kit.isDefault)
  if (kit.item.source !== 'MERCHANT') fallo('KIT_DE_SUPPLY', `«${nombreKit}» viene de Membego Supply: no se puede convertir en kit.`)
  if (normalizarCapacidades(kit.item.type, kit.item.capabilities).trackInventory) {
    fallo('KIT_CONTROLA_INVENTARIO', `«${nombreKit}» controla inventario por su cuenta. Un kit no lleva existencias propias: deja de controlar su inventario en su ficha del catálogo (con las existencias en cero) y vuelve a intentar.`)
  }
  await bloquearVariante(tx, companyId, kit.id)

  if ((await tx.inventoryKitComponent.count({ where: { companyId, componentVariantId: kit.id } })) > 0) {
    fallo('KIT_ES_COMPONENTE', `«${nombreKit}» ya es componente de otro kit: un kit no puede ser componente de otro kit.`)
  }
  const ids = valida.receta.map((c) => c.varianteId)
  const variantes = await tx.catalogVariant.findMany({
    where: { companyId, id: { in: ids } },
    select: { id: true, name: true, isDefault: true, item: { select: { name: true, type: true, capabilities: true } } },
  })
  const porId = new Map(variantes.map((v) => [v.id, v]))
  const conReceta = new Set((await tx.inventoryKitComponent.findMany({ where: { companyId, kitVariantId: { in: ids } }, select: { kitVariantId: true }, distinct: ['kitVariantId'] })).map((k) => k.kitVariantId))
  for (const c of valida.receta) {
    const v = porId.get(c.varianteId)
    if (!v) fallo('VARIANTE_NO_ENCONTRADA', 'Uno de los componentes ya no existe.')
    const nombre = nombreCompleto(v.item.name, v.name, v.isDefault)
    if (conReceta.has(v.id)) fallo('COMPONENTE_ES_KIT', `«${nombre}» es un kit: un kit no puede ser componente de otro kit.`)
    if (!normalizarCapacidades(v.item.type, v.item.capabilities).trackInventory) {
      fallo('COMPONENTE_SIN_INVENTARIO', `«${nombre}» no controla inventario: un componente tiene que llevar existencias para poder descontarlas.`)
    }
  }

  const previa = await tx.inventoryKitComponent.findMany({ where: { companyId, kitVariantId: kit.id }, select: { componentVariantId: true, quantity: true } })
  const igual = previa.length === valida.receta.length && valida.receta.every((c) => previa.some((p) => p.componentVariantId === c.varianteId && p.quantity === c.cantidad))
  if (igual) return { kitVarianteId: kit.id, componentes: previa.length, nueva: false, sinCambios: true }

  await tx.inventoryKitComponent.deleteMany({ where: { companyId, kitVariantId: kit.id, componentVariantId: { notIn: ids } } })
  for (const c of valida.receta) {
    await tx.inventoryKitComponent.upsert({
      where: { kitVariantId_componentVariantId: { kitVariantId: kit.id, componentVariantId: c.varianteId } },
      create: { companyId, kitVariantId: kit.id, componentVariantId: c.varianteId, quantity: c.cantidad },
      update: { quantity: c.cantidad },
    })
  }
  await auditarInventario(
    tx,
    ctx,
    companyId,
    'INVENTORY_CONFIGURED',
    kit.id,
    { tipo: 'KIT_RECETA', sku: kit.sku, producto: nombreKit, componentes: valida.receta.map((c) => `${c.varianteId}×${c.cantidad}`), anteriores: previa.length },
    'InventoryKit'
  )
  return { kitVarianteId: kit.id, componentes: valida.receta.length, nueva: previa.length === 0, sinCambios: false }
}

/** Quita la receta de un kit: vuelve a ser un producto cualquiera. Lo ya apartado en pedidos no cambia. */
export async function quitarRecetaDeKitEnTx(tx: Tx, companyId: string, e: { kitVarianteId: string }, ctx: ContextoAuditoria): Promise<{ componentes: number }> {
  const kitId = typeof e.kitVarianteId === 'string' ? e.kitVarianteId : ''
  const kit = await tx.catalogVariant.findFirst({ where: { id: kitId, companyId }, select: { id: true, sku: true, name: true, isDefault: true, item: { select: { name: true } } } })
  if (!kit) fallo('VARIANTE_NO_ENCONTRADA', 'El producto del kit no existe.')
  await bloquearVariante(tx, companyId, kit.id)
  const n = await tx.inventoryKitComponent.deleteMany({ where: { companyId, kitVariantId: kit.id } })
  if (n.count === 0) fallo('KIT_SIN_RECETA', 'Ese producto no es un kit.')
  await auditarInventario(tx, ctx, companyId, 'INVENTORY_CONFIGURED', kit.id, { tipo: 'KIT_RECETA_QUITADA', sku: kit.sku, producto: nombreCompleto(kit.item.name, kit.name, kit.isDefault), componentes: n.count }, 'InventoryKit')
  return { componentes: n.count }
}

export interface EntradaReservaKit {
  kitVarianteId: string
  sucursalId: string
  /** Cuántos kits. */
  cantidad: number
  ttlMinutos?: number
  referencia: Referencia
  /** Base de las claves de idempotencia (la de cada componente la completa con el kit y el componente). */
  claveBase: string
  ahora?: Date
}

export interface ResultadoReservaKit {
  reservaIds: string[]
  repetido: boolean
}

/**
 * Aparta los componentes de `cantidad` kits en una sucursal (todo o nada: si falta uno, falla todo y la transacción de quien llama se deshace).
 * El kit tiene que tener receta. Reintentar la misma referencia no aparta dos veces.
 */
export async function reservarKitEnTx(tx: Tx, companyId: string, e: EntradaReservaKit, ctx: ContextoAuditoria): Promise<ResultadoReservaKit> {
  const previas = await tx.inventoryKitReservation.findMany({
    where: { companyId, referenceType: e.referencia.tipo, referenceId: e.referencia.id, kitVariantId: e.kitVarianteId },
    select: { reservationId: true },
    orderBy: { componentVariantId: 'asc' },
  })
  if (previas.length > 0) return { reservaIds: previas.map((p) => p.reservationId), repetido: true }

  const receta = (await recetasDeKitsEnTx(tx, companyId, [e.kitVarianteId])).get(e.kitVarianteId)
  if (!receta) fallo('KIT_SIN_RECETA', 'Ese producto no es un kit.')
  const plan = unidadesParaKits(receta, e.cantidad)
  if (!plan.ok) fallo(plan.codigo, plan.error)
  const nombres = await tx.catalogVariant.findMany({
    where: { companyId, id: { in: [e.kitVarianteId, ...receta.map((c) => c.varianteId)] } },
    select: { id: true, name: true, isDefault: true, item: { select: { name: true } } },
  })
  const nombreDe = (id: string) => {
    const v = nombres.find((x) => x.id === id)
    return v ? nombreCompleto(v.item.name, v.name, v.isDefault) : 'un producto'
  }
  const reservaIds: string[] = []
  for (const u of plan.unidades) {
    let reservaId: string
    try {
      const r = await reservarEnTx(
        tx,
        companyId,
        { varianteId: u.varianteId, sucursalId: e.sucursalId, cantidad: u.cantidad, ttlMinutos: e.ttlMinutos, referencia: e.referencia, idempotencyKey: `${e.claveBase}:${e.kitVarianteId}:${u.varianteId}`, ahora: e.ahora },
        ctx
      )
      reservaId = r.reservaId
    } catch (err) {
      if (err instanceof InventarioError && err.codigo === 'STOCK_INSUFICIENTE') {
        fallo('STOCK_INSUFICIENTE', `No alcanza para armar ${e.cantidad} de «${nombreDe(e.kitVarianteId)}»: de «${nombreDe(u.varianteId)}» ${err.message.charAt(0).toLowerCase()}${err.message.slice(1)}`)
      }
      throw err
    }
    await tx.inventoryKitReservation.create({
      data: { companyId, kitVariantId: e.kitVarianteId, componentVariantId: u.varianteId, reservationId: reservaId, referenceType: e.referencia.tipo, referenceId: e.referencia.id, kitQuantity: e.cantidad, quantity: u.cantidad },
    })
    reservaIds.push(reservaId)
  }
  return { reservaIds, repetido: false }
}

type FilaDeKit = { kitVariantId: string; componentVariantId: string; reservationId: string; quantity: number }

async function filasDeReferencia(tx: Tx, companyId: string, referencia: Referencia): Promise<FilaDeKit[]> {
  return tx.inventoryKitReservation.findMany({
    where: { companyId, referenceType: referencia.tipo, referenceId: referencia.id },
    select: { kitVariantId: true, componentVariantId: true, reservationId: true, quantity: true },
    orderBy: [{ kitVariantId: 'asc' }, { componentVariantId: 'asc' }],
  })
}

/**
 * Vende lo apartado por los kits de una referencia (un pedido que se cierra). Si la reserva de algún componente venció o se liberó, se vende de
 * lo disponible; si ni así alcanza, falla todo (`STOCK_YA_NO_ALCANZA`). Cerrar dos veces no vende dos veces.
 */
export async function consumirKitsDeReferenciaEnTx(
  tx: Tx,
  companyId: string,
  e: { referencia: Referencia; sucursalId: string; claveBase: string; ahora?: Date },
  ctx: ContextoAuditoria
): Promise<{ componentes: number }> {
  const filas = await filasDeReferencia(tx, companyId, e.referencia)
  for (const f of filas) {
    try {
      await consumirReservaEnTx(tx, companyId, f.reservationId, { referencia: e.referencia, ahora: e.ahora }, ctx)
      continue
    } catch (err) {
      if (!(err instanceof InventarioError) || (err.codigo !== 'RESERVA_VENCIDA' && err.codigo !== 'RESERVA_LIBERADA')) throw err
    }
    try {
      await venderEnTx(
        tx,
        companyId,
        { varianteId: f.componentVariantId, sucursalId: e.sucursalId, cantidad: f.quantity, referencia: e.referencia, idempotencyKey: `${e.claveBase}:${f.kitVariantId}:${f.componentVariantId}:venta`, ahora: e.ahora },
        ctx
      )
    } catch (err) {
      if (err instanceof InventarioError && err.codigo === 'STOCK_INSUFICIENTE') {
        fallo('STOCK_YA_NO_ALCANZA', 'La reserva de un kit de este pedido venció y ya no hay existencias suficientes de sus componentes. Repón el stock o cancela el pedido.')
      }
      throw err
    }
  }
  return { componentes: filas.length }
}

/** Libera lo apartado por los kits de una referencia (el pedido se canceló). Liberar lo ya liberado o vencido es inofensivo. */
export async function liberarKitsDeReferenciaEnTx(tx: Tx, companyId: string, e: { referencia: Referencia; motivo?: string | null; ahora?: Date }, ctx: ContextoAuditoria): Promise<{ componentes: number }> {
  const filas = await filasDeReferencia(tx, companyId, e.referencia)
  for (const f of filas) await liberarReservaEnTx(tx, companyId, f.reservationId, { motivo: e.motivo, ahora: e.ahora }, ctx)
  return { componentes: filas.length }
}

/** Devuelve a lo vendible los componentes de los kits vendidos en una referencia (el pedido se reembolsó). Idempotente por clave. */
export async function devolverKitsDeReferenciaEnTx(
  tx: Tx,
  companyId: string,
  e: { referencia: Referencia; sucursalId: string; claveBase: string; motivo?: string | null; ahora?: Date },
  ctx: ContextoAuditoria
): Promise<{ componentes: number }> {
  const filas = await filasDeReferencia(tx, companyId, e.referencia)
  for (const f of filas) {
    await devolverEnTx(
      tx,
      companyId,
      { varianteId: f.componentVariantId, sucursalId: e.sucursalId, cantidad: f.quantity, motivo: e.motivo, referencia: e.referencia, idempotencyKey: `${e.claveBase}:${f.kitVariantId}:${f.componentVariantId}:reembolso`, ahora: e.ahora },
      ctx
    )
  }
  return { componentes: filas.length }
}

