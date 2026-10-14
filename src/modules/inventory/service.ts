import { randomUUID } from 'node:crypto'
import { Prisma, type InventoryMovement, type InventoryMovementType, type InventoryReservation, type InventoryReservationStatus } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { siguienteNumero } from '@/lib/commerce-primitives/numeracion'
import { esViolacionUnica } from '@/lib/prisma-errors'
import { normalizarCapacidades } from '@/modules/catalog/domain'
import { auditarInventario, type ContextoAuditoria } from './auditoria'
import {
  TTL_POR_DEFECTO_MINUTOS,
  aplicarMovimiento,
  cubetasDeSaldo,
  CANTIDAD_MAXIMA,
  disponible,
  normalizarMotivo,
  reservaVencida,
  saldoDeCubetas,
  validarCantidad,
  validarTtl,
  validarUmbral,
  vencimientoDeReserva,
  type Movimiento,
  type Saldo,
} from './domain'
import {
  MAX_LINEAS_ENTRADA,
  MAX_NOTA,
  MAX_REFERENCIA,
  PREFIJO_ENTRADA,
  normalizarTextoLibre,
  validarLineasEntrada,
  type LineaEntrada,
} from './entradas'
import {
  MAX_LINEAS_CONTEO,
  MAX_MOTIVO_CANCELACION,
  MAX_NOTA_CONTEO,
  PREFIJO_CONTEO,
  diferenciaDeConteo,
  esModoConteo,
  motivoDeConteo,
  planDeAjuste,
  validarCantidadContada,
  type EstadoConteo,
  type ModoConteo,
} from './conteos'
import {
  MAX_MOTIVO_TRASLADO,
  MAX_NOTA_TRASLADO,
  PREFIJO_TRASLADO,
  motivoDeDevolucion,
  motivoDeEnvio,
  motivoDeRecepcion,
  pendienteDeLinea,
  planDeCancelacion,
  planDeRecepcion,
  validarLineasTraslado,
  type EstadoTraslado,
  type LineaDeTraslado,
  type LineaTraslado,
} from './traslados'
import { InventarioError, fallo } from './errores'

/**
 * COMMERCE CORE · inventario — el servicio (Fase 2).
 *
 * TODA escritura al saldo pasa por `escribirMovimiento`: lee el saldo, aplica el
 * movimiento con el ledger puro (`domain.ts`), escribe el asiento con el antes
 * y el después, y actualiza la caché del saldo. Ningún otro código toca
 * `onHand`, `reserved` ni `damaged`.
 *
 * CONCURRENCIA. Dos operaciones sobre el mismo saldo se serializan con
 * `SELECT … FOR UPDATE` sobre la fila de `inventory_levels` (varias filas, en
 * orden de id: dos transferencias cruzadas no se interbloquean). Con ese
 * candado, «hay suficiente» y «lo aparto» son un solo paso: dos reservas de la
 * última unidad no pueden ganar las dos.
 *
 * VENCIMIENTO. Una reserva vencida deja de apartar aunque ningún barrido haya
 * corrido: toda operación sobre un saldo vence PRIMERO, bajo el mismo candado,
 * las reservas caducadas de ese saldo. El barrido del cron solo recoge lo que
 * nadie tocó.
 *
 * IDEMPOTENCIA. Un movimiento con `idempotencyKey` ya usado no se repite:
 * devuelve el primero (`repetido: true`). El UI de un doble clic y un reintento
 * de red no duplican stock.
 *
 * Todo corre dentro de la `tx` de quien llama (`conEmpresa`), así que la
 * bitácora y el ledger se confirman o se deshacen juntos.
 */

export interface Referencia {
  tipo: string
  id: string
}

export interface EntradaBase {
  varianteId: string
  sucursalId: string
  motivo?: string | null
  referencia?: Referencia | null
  idempotencyKey?: string | null
  /** Para pruebas: el «ahora» contra el que se vencen las reservas. */
  ahora?: Date
}

export interface SaldoVista extends Saldo {
  disponible: number
}

export interface ResultadoMovimiento {
  nivelId: string
  movimientoId: string
  saldo: SaldoVista
  /** true si la clave de idempotencia ya existía: no se hizo nada nuevo. */
  repetido: boolean
}

const vista = (s: Saldo): SaldoVista => ({ onHand: s.onHand, reserved: s.reserved, damaged: s.damaged, disponible: disponible(s) })

// ── Validaciones de contexto ─────────────────────────────────────────────────

/** La variante existe en la empresa y su ítem controla inventario. */
async function exigirVarianteControlada(tx: Tx, companyId: string, varianteId: string) {
  if (typeof varianteId !== 'string' || varianteId === '') fallo('VARIANTE_NO_ENCONTRADA', 'La variante no existe.')
  const v = await tx.catalogVariant.findFirst({
    where: { id: varianteId, companyId },
    select: { id: true, sku: true, name: true, item: { select: { id: true, name: true, type: true, capabilities: true } } },
  })
  if (!v) fallo('VARIANTE_NO_ENCONTRADA', 'La variante no existe.')
  if (!normalizarCapacidades(v.item.type, v.item.capabilities).trackInventory) {
    fallo('SIN_CONTROL_DE_INVENTARIO', 'Este producto no controla inventario. Actívalo en su ficha del catálogo para llevar existencias.')
  }
  return v
}

/** La sucursal existe en la empresa; si `activa`, además debe estar abierta. */
async function exigirSucursal(tx: Tx, companyId: string, sucursalId: string, activa: boolean) {
  if (typeof sucursalId !== 'string' || sucursalId === '') fallo('SUCURSAL_NO_ENCONTRADA', 'La sucursal no existe.')
  const s = await tx.sucursal.findFirst({ where: { id: sucursalId, companyId }, select: { id: true, nombre: true, activa: true } })
  if (!s) fallo('SUCURSAL_NO_ENCONTRADA', 'La sucursal no existe.')
  if (activa && !s.activa) fallo('SUCURSAL_INACTIVA', `La sucursal «${s.nombre}» está desactivada.`)
  return s
}

function cantidadValida(n: unknown): number {
  const r = validarCantidad(n)
  if (!r.ok) fallo('CANTIDAD_INVALIDA', r.error)
  return r.valor
}

function motivoValido(m: unknown, obligatorio: boolean): string | null {
  const r = normalizarMotivo(m)
  if (!r.ok) fallo('MOTIVO_INVALIDO', r.error)
  if (obligatorio && !r.valor) fallo('MOTIVO_OBLIGATORIO', 'Escribe el motivo: un ajuste o un daño sin explicación es un faltante sin explicar.')
  return r.valor
}

/** La referencia de un movimiento o reserva: tipo corto y id acotados (los fija el sistema, pero no se confía). */
function referenciaValida(r: Referencia | null | undefined): Referencia | null {
  if (r === undefined || r === null) return null
  if (typeof r.tipo !== 'string' || typeof r.id !== 'string' || r.tipo === '' || r.id === '' || r.tipo.length > 40 || r.id.length > 120) {
    fallo('REFERENCIA_INVALIDA', 'La referencia del movimiento no es válida.')
  }
  return r
}

function claveValida(k: unknown): string | null {
  if (k === undefined || k === null || k === '') return null
  if (typeof k !== 'string' || k.length > 120) fallo('CLAVE_INVALIDA', 'La clave de idempotencia no es válida.')
  return k
}

// ── Saldos: crear, bloquear, vencer ──────────────────────────────────────────

interface FilaNivel extends Saldo {
  id: string
  catalogVariantId: string
  locationId: string
  lowStockThreshold: number
}

/**
 * El saldo de la variante en la sucursal; se crea en cero si no existía. Crear
 * un saldo NO es un movimiento: no cambia ninguna existencia. `skipDuplicates`
 * es `INSERT … ON CONFLICT DO NOTHING`: dos primeras operaciones simultáneas no
 * chocan.
 */
async function obtenerNivel(tx: Tx, companyId: string, varianteId: string, sucursalId: string): Promise<string> {
  await tx.inventoryLevel.createMany({ data: [{ companyId, catalogVariantId: varianteId, locationId: sucursalId }], skipDuplicates: true })
  const n = await tx.inventoryLevel.findUniqueOrThrow({
    where: { catalogVariantId_locationId: { catalogVariantId: varianteId, locationId: sucursalId } },
    select: { id: true, companyId: true },
  })
  // Defensa en profundidad: la FK compuesta ya lo impide, pero no cuesta nada.
  if (n.companyId !== companyId) fallo('NIVEL_AJENO', 'El saldo no pertenece a esta empresa.')
  return n.id
}

/** Bloquea las filas en orden de id y devuelve sus contadores. */
async function bloquear(tx: Tx, companyId: string, ids: string[]): Promise<Map<string, FilaNivel>> {
  const unicos = [...new Set(ids)].sort()
  const filas = await tx.$queryRaw<FilaNivel[]>`
    SELECT "id", "catalogVariantId", "locationId", "onHand", "reserved", "damaged", "lowStockThreshold"
      FROM "inventory_levels"
     WHERE "companyId" = ${companyId} AND "id" IN (${Prisma.join(unicos)})
     ORDER BY "id"
       FOR UPDATE`
  if (filas.length !== unicos.length) fallo('NIVEL_NO_ENCONTRADO', 'El saldo de inventario no existe.')
  return new Map(filas.map((f) => [f.id, f]))
}

interface MetaMovimiento {
  userId: string | null
  referencia?: Referencia | null
  idempotencyKey?: string | null
}

/** Traduce el error del ledger puro a uno que se le puede enseñar a la persona. */
function traducir(e: unknown, m: Movimiento, nivel: Saldo): never {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.startsWith('No hay ')) {
    if (m.sourceBucket === 'RESERVED') fallo('STOCK_INSUFICIENTE', `Solo hay ${nivel.reserved} unidad(es) apartada(s); no se pueden usar ${m.quantity}.`)
    if (m.sourceBucket === 'DAMAGED') fallo('STOCK_INSUFICIENTE', `Solo hay ${nivel.damaged} unidad(es) dañada(s); no se pueden usar ${m.quantity}.`)
    const apartadas = nivel.reserved > 0 ? ` (${nivel.reserved} más están apartadas)` : ''
    fallo('STOCK_INSUFICIENTE', `No hay suficiente: pides ${m.quantity} y hay ${disponible(nivel)} disponible(s)${apartadas}.`)
  }
  if (msg.includes('máximo admitido')) fallo('EXISTENCIA_MAXIMA', msg)
  fallo('MOVIMIENTO_INVALIDO', msg)
}

/**
 * LA función que mueve unidades. Quien llama tiene el saldo bloqueado. Lee el
 * saldo, aplica el movimiento con el ledger puro, escribe el asiento (antes y
 * después) y actualiza la caché.
 */
async function escribirMovimiento(
  tx: Tx,
  companyId: string,
  nivelId: string,
  m: Movimiento,
  meta: MetaMovimiento
): Promise<{ movimiento: InventoryMovement; saldo: Saldo }> {
  const nivel = await tx.inventoryLevel.findFirstOrThrow({ where: { id: nivelId, companyId } })
  const antes = cubetasDeSaldo(nivel)
  let despues
  try {
    despues = aplicarMovimiento(antes, m)
  } catch (e) {
    traducir(e, m, nivel)
  }
  const saldo = saldoDeCubetas(despues)
  const movimiento = await tx.inventoryMovement.create({
    data: {
      companyId,
      inventoryLevelId: nivelId,
      type: m.type,
      sourceBucket: m.sourceBucket,
      destinationBucket: m.destinationBucket,
      quantity: m.quantity,
      previousOnHand: nivel.onHand,
      newOnHand: saldo.onHand,
      reason: m.reason ?? null,
      userId: meta.userId,
      referenceType: meta.referencia?.tipo ?? null,
      referenceId: meta.referencia?.id ?? null,
      idempotencyKey: meta.idempotencyKey ?? null,
    },
  })
  await tx.inventoryLevel.update({ where: { id: nivelId }, data: { onHand: saldo.onHand, reserved: saldo.reserved, damaged: saldo.damaged } })
  return { movimiento, saldo }
}

/**
 * Cierra una reserva ACTIVE: devuelve lo apartado a lo vendible y la marca.
 * Quien llama tiene el saldo bloqueado.
 */
async function cerrarReserva(
  tx: Tx,
  companyId: string,
  r: InventoryReservation,
  estado: Extract<InventoryReservationStatus, 'RELEASED' | 'EXPIRED'>,
  ahora: Date,
  userId: string | null,
  motivo: string
): Promise<void> {
  await escribirMovimiento(
    tx,
    companyId,
    r.inventoryLevelId,
    { type: 'RESERVATION_RELEASE', sourceBucket: 'RESERVED', destinationBucket: 'AVAILABLE', quantity: r.quantity, reason: motivo },
    { userId, referencia: { tipo: 'RESERVATION', id: r.id } }
  )
  await tx.inventoryReservation.update({ where: { id: r.id }, data: { status: estado, resolvedAt: ahora } })
}

/**
 * Vence las reservas caducadas de UN saldo. Quien llama lo tiene bloqueado.
 * Devuelve cuántas venció.
 */
async function vencerDeNivel(tx: Tx, companyId: string, nivelId: string, ahora: Date): Promise<number> {
  const vencidas = await tx.inventoryReservation.findMany({
    where: { companyId, inventoryLevelId: nivelId, status: 'ACTIVE', expiresAt: { lte: ahora } },
    orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
  })
  for (const r of vencidas) await cerrarReserva(tx, companyId, r, 'EXPIRED', ahora, null, 'Reserva vencida')
  return vencidas.length
}

/**
 * Bloquea el saldo, vence sus reservas caducadas y revisa la idempotencia.
 * Devuelve el movimiento previo si la clave ya se usó (y es la misma operación).
 */
async function prepararNivel(
  tx: Tx,
  companyId: string,
  nivelId: string,
  clave: string | null,
  mov: Pick<Movimiento, 'type' | 'sourceBucket' | 'destinationBucket' | 'quantity'>,
  ahora: Date
): Promise<InventoryMovement | null> {
  await bloquear(tx, companyId, [nivelId])
  if (clave) {
    const previo = await tx.inventoryMovement.findFirst({ where: { companyId, idempotencyKey: clave } })
    if (previo) {
      // Misma clave = MISMA operación: saldo, tipo, cantidad y dirección. Un
      // sobrante y un faltante de la misma cantidad no son un reintento.
      if (
        previo.inventoryLevelId !== nivelId ||
        previo.type !== mov.type ||
        previo.quantity !== mov.quantity ||
        previo.sourceBucket !== mov.sourceBucket ||
        previo.destinationBucket !== mov.destinationBucket
      ) {
        fallo('CLAVE_REUTILIZADA', 'Esa clave de idempotencia ya se usó para otra operación distinta.')
      }
      return previo
    }
  }
  await vencerDeNivel(tx, companyId, nivelId, ahora)
  return null
}

async function saldoActual(tx: Tx, companyId: string, nivelId: string): Promise<SaldoVista> {
  const n = await tx.inventoryLevel.findFirstOrThrow({ where: { id: nivelId, companyId } })
  return vista(n)
}

// ── Movimientos simples (un saldo, una dirección) ────────────────────────────

interface Plan {
  tipo: InventoryMovementType
  origen: Movimiento['sourceBucket']
  destino: Movimiento['destinationBucket']
  cantidad: number
  motivo: string | null
  /** Exige sucursal abierta (entradas); las salidas se permiten en una cerrada. */
  sucursalActiva: boolean
  /** Deja rastro en la bitácora de actividad (lo que hace una persona a mano). */
  auditar: boolean
  referenciaPorDefecto?: Referencia
}

async function moverSimple(tx: Tx, companyId: string, e: EntradaBase, plan: Plan, ctx: ContextoAuditoria): Promise<ResultadoMovimiento> {
  const ahora = e.ahora ?? new Date()
  const clave = claveValida(e.idempotencyKey)
  const variante = await exigirVarianteControlada(tx, companyId, e.varianteId)
  const sucursal = await exigirSucursal(tx, companyId, e.sucursalId, plan.sucursalActiva)
  const nivelId = await obtenerNivel(tx, companyId, variante.id, sucursal.id)

  const previo = await prepararNivel(tx, companyId, nivelId, clave, { type: plan.tipo, sourceBucket: plan.origen, destinationBucket: plan.destino, quantity: plan.cantidad }, ahora)
  if (previo) return { nivelId, movimientoId: previo.id, saldo: await saldoActual(tx, companyId, nivelId), repetido: true }

  const { movimiento, saldo } = await escribirMovimiento(
    tx,
    companyId,
    nivelId,
    { type: plan.tipo, sourceBucket: plan.origen, destinationBucket: plan.destino, quantity: plan.cantidad, reason: plan.motivo },
    { userId: ctx.actorId, referencia: referenciaValida(e.referencia) ?? plan.referenciaPorDefecto ?? null, idempotencyKey: clave }
  )
  if (plan.auditar) {
    await auditarInventario(tx, ctx, companyId, 'INVENTORY_STOCK_CHANGED', nivelId, {
      tipo: plan.tipo,
      cantidad: plan.cantidad,
      motivo: plan.motivo,
      sku: variante.sku,
      producto: variante.item.name,
      sucursal: sucursal.nombre,
      antes: { onHand: movimiento.previousOnHand },
      despues: { onHand: movimiento.newOnHand },
    })
  }
  return { nivelId, movimientoId: movimiento.id, saldo: vista(saldo), repetido: false }
}

/** Llega mercancía (compra a un proveedor, producción propia): entra a lo vendible. */
export async function recibirEnTx(tx: Tx, companyId: string, e: EntradaBase & { cantidad: number }, ctx: ContextoAuditoria) {
  return moverSimple(tx, companyId, e, { tipo: 'PURCHASE', origen: null, destino: 'AVAILABLE', cantidad: cantidadValida(e.cantidad), motivo: motivoValido(e.motivo, false), sucursalActiva: true, auditar: true }, ctx)
}

/** El cliente devuelve mercancía: vuelve a lo vendible. */
export async function devolverEnTx(tx: Tx, companyId: string, e: EntradaBase & { cantidad: number }, ctx: ContextoAuditoria) {
  return moverSimple(tx, companyId, e, { tipo: 'RETURN', origen: null, destino: 'AVAILABLE', cantidad: cantidadValida(e.cantidad), motivo: motivoValido(e.motivo, false), sucursalActiva: true, auditar: true }, ctx)
}

/**
 * Venta directa (mostrador, sin reserva previa): sale de lo vendible. La llama
 * el sistema (caja, pedidos), no el panel: no deja rastro en la bitácora de
 * actividad —el ledger ya lo tiene—.
 */
export async function venderEnTx(tx: Tx, companyId: string, e: EntradaBase & { cantidad: number }, ctx: ContextoAuditoria) {
  return moverSimple(tx, companyId, e, { tipo: 'SALE', origen: 'AVAILABLE', destino: null, cantidad: cantidadValida(e.cantidad), motivo: motivoValido(e.motivo, false), sucursalActiva: false, auditar: false }, ctx)
}

/** Se daña mercancía vendible: pasa a la cubeta de dañado (no se vende). */
export async function danarEnTx(tx: Tx, companyId: string, e: EntradaBase & { cantidad: number }, ctx: ContextoAuditoria) {
  return moverSimple(tx, companyId, e, { tipo: 'DAMAGE', origen: 'AVAILABLE', destino: 'DAMAGED', cantidad: cantidadValida(e.cantidad), motivo: motivoValido(e.motivo, true), sucursalActiva: false, auditar: true }, ctx)
}

/**
 * Corrige un descuadre: `cambio` positivo = sobrante, negativo = faltante. Solo
 * toca lo vendible: lo apartado se libera o se consume, no se «ajusta».
 */
export async function ajustarEnTx(tx: Tx, companyId: string, e: EntradaBase & { cambio: number }, ctx: ContextoAuditoria) {
  if (typeof e.cambio !== 'number' || !Number.isInteger(e.cambio) || e.cambio === 0) fallo('CANTIDAD_INVALIDA', 'El ajuste debe ser un número entero distinto de cero.')
  const cantidad = cantidadValida(Math.abs(e.cambio))
  const sube = e.cambio > 0
  return moverSimple(
    tx,
    companyId,
    e,
    { tipo: 'ADJUSTMENT', origen: sube ? null : 'AVAILABLE', destino: sube ? 'AVAILABLE' : null, cantidad, motivo: motivoValido(e.motivo, true), sucursalActiva: sube, auditar: true },
    ctx
  )
}

/**
 * Lo dañado se resuelve: resultó vendible (vuelve a lo vendible) o se da de baja
 * (sale del inventario). Es un ajuste, y por eso lleva motivo.
 */
export async function resolverDanadoEnTx(tx: Tx, companyId: string, e: EntradaBase & { cantidad: number; destino: 'VENDIBLE' | 'BAJA' }, ctx: ContextoAuditoria) {
  if (e.destino !== 'VENDIBLE' && e.destino !== 'BAJA') fallo('MOVIMIENTO_INVALIDO', 'Indica si lo dañado vuelve a venderse o se da de baja.')
  return moverSimple(
    tx,
    companyId,
    e,
    { tipo: 'ADJUSTMENT', origen: 'DAMAGED', destino: e.destino === 'VENDIBLE' ? 'AVAILABLE' : null, cantidad: cantidadValida(e.cantidad), motivo: motivoValido(e.motivo, true), sucursalActiva: false, auditar: true },
    ctx
  )
}

/**
 * Conteo físico: la persona cuenta lo que hay (vendible + apartado) y el
 * sistema calcula la diferencia. Sin diferencia no escribe nada.
 */
export async function contarEnTx(
  tx: Tx,
  companyId: string,
  e: EntradaBase & { conteo: number },
  ctx: ContextoAuditoria
): Promise<ResultadoMovimiento & { diferencia: number }> {
  if (typeof e.conteo !== 'number' || !Number.isInteger(e.conteo) || e.conteo < 0) fallo('CANTIDAD_INVALIDA', 'El conteo debe ser un número entero de cero en adelante.')
  const ahora = e.ahora ?? new Date()
  const variante = await exigirVarianteControlada(tx, companyId, e.varianteId)
  const sucursal = await exigirSucursal(tx, companyId, e.sucursalId, false)
  const nivelId = await obtenerNivel(tx, companyId, variante.id, sucursal.id)
  await bloquear(tx, companyId, [nivelId])
  await vencerDeNivel(tx, companyId, nivelId, ahora)

  const nivel = await tx.inventoryLevel.findFirstOrThrow({ where: { id: nivelId, companyId } })
  const diferencia = e.conteo - nivel.onHand
  if (diferencia === 0) return { nivelId, movimientoId: '', saldo: vista(nivel), repetido: false, diferencia: 0 }
  if (diferencia < 0 && -diferencia > disponible(nivel)) {
    fallo('CONTEO_BAJO_APARTADO', `El conteo (${e.conteo}) deja menos de lo apartado (${nivel.reserved}). Libera o cobra las reservas antes de ajustar.`)
  }
  const motivo = motivoValido(e.motivo, false) ?? 'Conteo físico'
  const sube = diferencia > 0
  if (sube) await exigirSucursal(tx, companyId, sucursal.id, true)
  const { movimiento, saldo } = await escribirMovimiento(
    tx,
    companyId,
    nivelId,
    { type: 'ADJUSTMENT', sourceBucket: sube ? null : 'AVAILABLE', destinationBucket: sube ? 'AVAILABLE' : null, quantity: Math.abs(diferencia), reason: motivo },
    { userId: ctx.actorId, referencia: { tipo: 'STOCK_COUNT', id: randomUUID() } }
  )
  await auditarInventario(tx, ctx, companyId, 'INVENTORY_STOCK_CHANGED', nivelId, {
    tipo: 'ADJUSTMENT',
    conteo: e.conteo,
    cantidad: Math.abs(diferencia),
    motivo,
    sku: variante.sku,
    producto: variante.item.name,
    sucursal: sucursal.nombre,
    antes: { onHand: movimiento.previousOnHand },
    despues: { onHand: movimiento.newOnHand },
  })
  return { nivelId, movimientoId: movimiento.id, saldo: vista(saldo), repetido: false, diferencia }
}

// ── Transferencias entre sucursales ──────────────────────────────────────────

export interface ResultadoTransferencia {
  transferenciaId: string
  salida: ResultadoMovimiento
  entrada: ResultadoMovimiento
  repetido: boolean
}

/**
 * Mueve unidades de una sucursal a otra: TRANSFER_OUT en el origen y
 * TRANSFER_IN en el destino, en la MISMA transacción (o pasan las dos o
 * ninguna) y con la misma referencia `TRANSFER`. Solo se transfiere lo
 * vendible: lo apartado no se mueve.
 */
export async function transferirEnTx(
  tx: Tx,
  companyId: string,
  e: { varianteId: string; origenId: string; destinoId: string; cantidad: number; motivo?: string | null; idempotencyKey?: string | null; ahora?: Date },
  ctx: ContextoAuditoria
): Promise<ResultadoTransferencia> {
  const cantidad = cantidadValida(e.cantidad)
  const motivo = motivoValido(e.motivo, false)
  const clave = claveValida(e.idempotencyKey)
  const ahora = e.ahora ?? new Date()
  if (e.origenId === e.destinoId) fallo('MISMA_SUCURSAL', 'El origen y el destino son la misma sucursal.')

  const variante = await exigirVarianteControlada(tx, companyId, e.varianteId)
  const origen = await exigirSucursal(tx, companyId, e.origenId, false)
  const destino = await exigirSucursal(tx, companyId, e.destinoId, true)
  // Los saldos que falten se crean en un orden FIJO (por sucursal): con A→B y B→A a la vez, cada una insertando primero el
  // saldo de SU origen, se esperarían la una a la otra (el INSERT espera a la fila que la otra acaba de insertar).
  const nivelesDe = new Map<string, string>()
  for (const sucursalId of [origen.id, destino.id].sort()) nivelesDe.set(sucursalId, await obtenerNivel(tx, companyId, variante.id, sucursalId))
  const [origenNivel, destinoNivel] = [nivelesDe.get(origen.id)!, nivelesDe.get(destino.id)!]
  // Los dos candados juntos y en orden de id: dos transferencias cruzadas
  // (A→B y B→A) no se esperan una a la otra.
  await bloquear(tx, companyId, [origenNivel, destinoNivel])

  if (clave) {
    const salidaPrevia = await tx.inventoryMovement.findFirst({ where: { companyId, idempotencyKey: `${clave}:out` } })
    if (salidaPrevia) {
      const entradaPrevia = await tx.inventoryMovement.findFirst({ where: { companyId, idempotencyKey: `${clave}:in` } })
      if (!entradaPrevia || salidaPrevia.inventoryLevelId !== origenNivel || salidaPrevia.quantity !== cantidad) {
        fallo('CLAVE_REUTILIZADA', 'Esa clave de idempotencia ya se usó para otra operación distinta.')
      }
      return {
        transferenciaId: salidaPrevia.referenceId ?? '',
        repetido: true,
        salida: { nivelId: origenNivel, movimientoId: salidaPrevia.id, saldo: await saldoActual(tx, companyId, origenNivel), repetido: true },
        entrada: { nivelId: destinoNivel, movimientoId: entradaPrevia.id, saldo: await saldoActual(tx, companyId, destinoNivel), repetido: true },
      }
    }
  }
  await vencerDeNivel(tx, companyId, origenNivel, ahora)
  await vencerDeNivel(tx, companyId, destinoNivel, ahora)

  const transferenciaId = randomUUID()
  const referencia = { tipo: 'TRANSFER', id: transferenciaId }
  const sal = await escribirMovimiento(
    tx,
    companyId,
    origenNivel,
    { type: 'TRANSFER_OUT', sourceBucket: 'AVAILABLE', destinationBucket: null, quantity: cantidad, reason: motivo },
    { userId: ctx.actorId, referencia, idempotencyKey: clave ? `${clave}:out` : null }
  )
  const ent = await escribirMovimiento(
    tx,
    companyId,
    destinoNivel,
    { type: 'TRANSFER_IN', sourceBucket: null, destinationBucket: 'AVAILABLE', quantity: cantidad, reason: motivo },
    { userId: ctx.actorId, referencia, idempotencyKey: clave ? `${clave}:in` : null }
  )
  await auditarInventario(tx, ctx, companyId, 'INVENTORY_TRANSFERRED', origenNivel, {
    transferenciaId,
    cantidad,
    motivo,
    sku: variante.sku,
    producto: variante.item.name,
    desde: origen.nombre,
    hacia: destino.nombre,
  })
  return {
    transferenciaId,
    repetido: false,
    salida: { nivelId: origenNivel, movimientoId: sal.movimiento.id, saldo: vista(sal.saldo), repetido: false },
    entrada: { nivelId: destinoNivel, movimientoId: ent.movimiento.id, saldo: vista(ent.saldo), repetido: false },
  }
}

// ── Reservas con vencimiento ─────────────────────────────────────────────────

export interface ResultadoReserva {
  reservaId: string
  nivelId: string
  expiresAt: Date
  saldo: SaldoVista
  repetido: boolean
}

/**
 * Aparta unidades hasta una hora (carrito, pedido por pagar). Pasada esa hora
 * ya no aparta nada, haya corrido el barrido o no. Con `idempotencyKey`, pedir
 * la misma reserva dos veces devuelve la primera.
 */
export async function reservarEnTx(
  tx: Tx,
  companyId: string,
  e: EntradaBase & { cantidad: number; ttlMinutos?: number },
  ctx: ContextoAuditoria
): Promise<ResultadoReserva> {
  const cantidad = cantidadValida(e.cantidad)
  const ttl = validarTtl(e.ttlMinutos ?? TTL_POR_DEFECTO_MINUTOS)
  if (!ttl.ok) fallo('TTL_INVALIDO', ttl.error)
  const clave = claveValida(e.idempotencyKey)
  const referencia = referenciaValida(e.referencia)
  const ahora = e.ahora ?? new Date()
  const variante = await exigirVarianteControlada(tx, companyId, e.varianteId)
  const sucursal = await exigirSucursal(tx, companyId, e.sucursalId, true)
  const nivelId = await obtenerNivel(tx, companyId, variante.id, sucursal.id)

  const previo = await prepararNivel(tx, companyId, nivelId, clave, { type: 'RESERVATION', sourceBucket: 'AVAILABLE', destinationBucket: 'RESERVED', quantity: cantidad }, ahora)
  if (previo) {
    const r = await tx.inventoryReservation.findFirstOrThrow({ where: { id: previo.referenceId ?? '', companyId } })
    return { reservaId: r.id, nivelId, expiresAt: r.expiresAt, saldo: await saldoActual(tx, companyId, nivelId), repetido: true }
  }

  // Se comprueba ANTES de crear la fila: si no alcanza, no queda una reserva
  // huérfana aunque quien llama atrape el error dentro de su misma transacción.
  const nivel = await tx.inventoryLevel.findFirstOrThrow({ where: { id: nivelId, companyId } })
  if (disponible(nivel) < cantidad) {
    const apartadas = nivel.reserved > 0 ? ` (${nivel.reserved} más están apartadas)` : ''
    fallo('STOCK_INSUFICIENTE', `No hay suficiente: pides ${cantidad} y hay ${disponible(nivel)} disponible(s)${apartadas}.`)
  }

  const expiresAt = vencimientoDeReserva(ahora, ttl.valor)
  const reserva = await tx.inventoryReservation.create({
    data: { companyId, inventoryLevelId: nivelId, quantity: cantidad, expiresAt, referenceType: referencia?.tipo ?? null, referenceId: referencia?.id ?? null },
  })
  const { saldo } = await escribirMovimiento(
    tx,
    companyId,
    nivelId,
    { type: 'RESERVATION', sourceBucket: 'AVAILABLE', destinationBucket: 'RESERVED', quantity: cantidad, reason: motivoValido(e.motivo, false) },
    { userId: ctx.actorId, referencia: { tipo: 'RESERVATION', id: reserva.id }, idempotencyKey: clave }
  )
  return { reservaId: reserva.id, nivelId, expiresAt, saldo: vista(saldo), repetido: false }
}

/** Carga una reserva y bloquea su saldo; la vuelve a leer ya bloqueada. */
async function reservaBloqueada(tx: Tx, companyId: string, reservaId: string, ahora: Date): Promise<InventoryReservation> {
  if (typeof reservaId !== 'string' || reservaId === '') fallo('RESERVA_NO_ENCONTRADA', 'La reserva no existe.')
  const previa = await tx.inventoryReservation.findFirst({ where: { id: reservaId, companyId }, select: { inventoryLevelId: true } })
  if (!previa) fallo('RESERVA_NO_ENCONTRADA', 'La reserva no existe.')
  await bloquear(tx, companyId, [previa.inventoryLevelId])
  // Ya bajo candado: si venció, esta lectura lo refleja (EXPIRED).
  await vencerDeNivel(tx, companyId, previa.inventoryLevelId, ahora)
  return tx.inventoryReservation.findFirstOrThrow({ where: { id: reservaId, companyId } })
}

/**
 * Libera una reserva (el pedido se canceló): lo apartado vuelve a lo vendible.
 * Liberar una reserva ya liberada o vencida es inofensivo (`repetido`); una ya
 * convertida en venta no se puede liberar.
 */
export async function liberarReservaEnTx(
  tx: Tx,
  companyId: string,
  reservaId: string,
  opciones: { motivo?: string | null; ahora?: Date },
  ctx: ContextoAuditoria
): Promise<{ estado: InventoryReservationStatus; repetido: boolean; saldo: SaldoVista }> {
  const ahora = opciones.ahora ?? new Date()
  const r = await reservaBloqueada(tx, companyId, reservaId, ahora)
  if (r.status === 'CONSUMED') fallo('RESERVA_CONSUMIDA', 'Esa reserva ya se convirtió en venta: no se puede liberar.')
  if (r.status !== 'ACTIVE') return { estado: r.status, repetido: true, saldo: await saldoActual(tx, companyId, r.inventoryLevelId) }
  await cerrarReserva(tx, companyId, r, 'RELEASED', ahora, ctx.actorId, motivoValido(opciones.motivo, false) ?? 'Reserva liberada')
  return { estado: 'RELEASED', repetido: false, saldo: await saldoActual(tx, companyId, r.inventoryLevelId) }
}

/**
 * Convierte una reserva en venta: lo apartado sale del inventario. Una reserva
 * vencida ya no se puede cobrar (`RESERVA_VENCIDA`): el stock pudo haberse
 * vendido a otra persona, y quien cobra debe volver a reservar.
 */
export async function consumirReservaEnTx(
  tx: Tx,
  companyId: string,
  reservaId: string,
  opciones: { referencia?: Referencia | null; ahora?: Date },
  ctx: ContextoAuditoria
): Promise<{ repetido: boolean; saldo: SaldoVista; movimientoId: string | null }> {
  const ahora = opciones.ahora ?? new Date()
  const r = await reservaBloqueada(tx, companyId, reservaId, ahora)
  if (r.status === 'EXPIRED') fallo('RESERVA_VENCIDA', 'La reserva venció: el stock pudo liberarse. Vuelve a reservar.')
  if (r.status === 'RELEASED') fallo('RESERVA_LIBERADA', 'Esa reserva ya se liberó: no se puede cobrar.')
  if (r.status === 'CONSUMED') return { repetido: true, saldo: await saldoActual(tx, companyId, r.inventoryLevelId), movimientoId: null }
  if (reservaVencida(r.expiresAt, ahora)) fallo('RESERVA_VENCIDA', 'La reserva venció: el stock pudo liberarse. Vuelve a reservar.')

  const referencia = referenciaValida(opciones.referencia) ?? (r.referenceType && r.referenceId ? { tipo: r.referenceType, id: r.referenceId } : { tipo: 'RESERVATION', id: r.id })
  const { movimiento, saldo } = await escribirMovimiento(
    tx,
    companyId,
    r.inventoryLevelId,
    { type: 'SALE', sourceBucket: 'RESERVED', destinationBucket: null, quantity: r.quantity, reason: null },
    { userId: ctx.actorId, referencia }
  )
  await tx.inventoryReservation.update({ where: { id: r.id }, data: { status: 'CONSUMED', resolvedAt: ahora } })
  return { repetido: false, saldo: vista(saldo), movimientoId: movimiento.id }
}

/**
 * Vence las reservas caducadas de la empresa. Es lo que hace el barrido del
 * cron (`barrido.ts`); el stock no depende de él porque cada operación vence
 * antes las suyas. Devuelve cuántas venció.
 */
export async function vencerReservasEnTx(tx: Tx, companyId: string, ahora: Date, limite = 500): Promise<number> {
  const caducadas = await tx.inventoryReservation.findMany({
    where: { companyId, status: 'ACTIVE', expiresAt: { lte: ahora } },
    select: { inventoryLevelId: true },
    orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    take: limite,
  })
  const niveles = [...new Set(caducadas.map((c) => c.inventoryLevelId))].sort()
  let total = 0
  for (const id of niveles) {
    await bloquear(tx, companyId, [id])
    total += await vencerDeNivel(tx, companyId, id, ahora)
  }
  return total
}

// ── Configuración ────────────────────────────────────────────────────────────

/** Fija el umbral de stock bajo de una variante en una sucursal (0 = sin alerta). */
export async function configurarUmbralEnTx(
  tx: Tx,
  companyId: string,
  e: { varianteId: string; sucursalId: string; umbral: number },
  ctx: ContextoAuditoria
): Promise<{ nivelId: string; umbral: number }> {
  const u = validarUmbral(e.umbral)
  if (!u.ok) fallo('UMBRAL_INVALIDO', u.error)
  const variante = await exigirVarianteControlada(tx, companyId, e.varianteId)
  const sucursal = await exigirSucursal(tx, companyId, e.sucursalId, false)
  const nivelId = await obtenerNivel(tx, companyId, variante.id, sucursal.id)
  const [fila] = [...(await bloquear(tx, companyId, [nivelId])).values()]
  if (fila.lowStockThreshold === u.valor) return { nivelId, umbral: u.valor }
  await tx.inventoryLevel.update({ where: { id: nivelId }, data: { lowStockThreshold: u.valor } })
  await auditarInventario(tx, ctx, companyId, 'INVENTORY_CONFIGURED', nivelId, {
    sku: variante.sku,
    producto: variante.item.name,
    sucursal: sucursal.nombre,
    antes: { umbral: fila.lowStockThreshold },
    despues: { umbral: u.valor },
  })
  return { nivelId, umbral: u.valor }
}

/**
 * Aplica el MISMO umbral a las demás sucursales ACTIVAS donde la variante ya
 * tiene un saldo registrado. Solo donde ya hay saldo: crear saldos en cero en
 * sucursales que nunca llevaron el producto, con un umbral encima, las llenaría
 * de alertas de «Agotado» por un producto que allí no existe.
 *
 * Cada sucursal pasa por `configurarUmbralEnTx` (bloquea el saldo, no escribe si
 * no cambia, audita el cambio), así que repetirlo es inofensivo. Devuelve en
 * cuántas sucursales hubo un cambio real.
 */
export async function configurarUmbralOtrasSucursalesEnTx(
  tx: Tx,
  companyId: string,
  e: { varianteId: string; sucursalOrigenId: string; umbral: number },
  ctx: ContextoAuditoria
): Promise<{ sucursales: number }> {
  const u = validarUmbral(e.umbral)
  if (!u.ok) fallo('UMBRAL_INVALIDO', u.error)
  const variante = await exigirVarianteControlada(tx, companyId, e.varianteId)
  const otras = await tx.inventoryLevel.findMany({
    where: { companyId, catalogVariantId: variante.id, locationId: { not: e.sucursalOrigenId }, location: { activa: true } },
    select: { locationId: true, lowStockThreshold: true },
    orderBy: { id: 'asc' },
  })
  let cambiadas = 0
  for (const n of otras) {
    if (n.lowStockThreshold === u.valor) continue
    await configurarUmbralEnTx(tx, companyId, { varianteId: variante.id, sucursalId: n.locationId, umbral: u.valor }, ctx)
    cambiadas++
  }
  return { sucursales: cambiadas }
}

// ── INV-2a · Entrada de mercancía con varias líneas ──────────────────────────

/**
 * UNA línea de un lote: un saldo ya BLOQUEADO, su valor antes y después de
 * aplicar el movimiento con el ledger puro, y a qué se debe.
 */
interface ItemLote {
  nivelId: string
  movimiento: Movimiento
  antes: Saldo
  despues: Saldo
  meta: MetaMovimiento
}

/**
 * La SEGUNDA (y última) puerta que escribe contadores de saldo, junto a
 * `escribirMovimiento`. Existe por una razón de rendimiento y no de lógica: una
 * entrada de 1.000 líneas con `escribirMovimiento` son ~3.000 consultas (leer,
 * insertar, actualizar por línea) y no cabe en los 45 s de una transacción
 * contra una base remota. Aquí son TRES: un `INSERT … RETURNING` de todos los
 * movimientos, un `UPDATE … FROM (VALUES …)` de todos los saldos, y nada más.
 *
 * Mantiene TODAS las garantías de la otra puerta:
 *   · quien llama tiene los saldos BLOQUEADOS (`bloquear`) y ya aplicó cada
 *     movimiento con el ledger puro (`aplicarMovimiento`), así que el invariante
 *     «available nunca negativo» y el tope de existencia salen del mismo código;
 *   · cada movimiento guarda su antes y su después;
 *   · un saldo aparece UNA sola vez en el lote (si no, el «antes» de la segunda
 *     ocurrencia sería mentira);
 *   · los CHECK y el trigger de la base siguen siendo la última red.
 *
 * Devuelve el id de cada movimiento, en el orden de `items`.
 */
async function escribirMovimientosPorLote(tx: Tx, companyId: string, items: readonly ItemLote[]): Promise<string[]> {
  if (items.length === 0) return []
  if (new Set(items.map((i) => i.nivelId)).size !== items.length) fallo('LOTE_INVALIDO', 'Un saldo no puede aparecer dos veces en el mismo lote.')
  const creados = await tx.inventoryMovement.createManyAndReturn({
    data: items.map((i) => ({
      companyId,
      inventoryLevelId: i.nivelId,
      type: i.movimiento.type,
      sourceBucket: i.movimiento.sourceBucket,
      destinationBucket: i.movimiento.destinationBucket,
      quantity: i.movimiento.quantity,
      previousOnHand: i.antes.onHand,
      newOnHand: i.despues.onHand,
      reason: i.movimiento.reason ?? null,
      userId: i.meta.userId,
      referenceType: i.meta.referencia?.tipo ?? null,
      referenceId: i.meta.referencia?.id ?? null,
      idempotencyKey: i.meta.idempotencyKey ?? null,
    })),
    select: { id: true, inventoryLevelId: true },
  })
  const idPorNivel = new Map(creados.map((c) => [c.inventoryLevelId, c.id]))
  const filas = items.map((i) => Prisma.sql`(${i.nivelId}, ${i.despues.onHand}::int, ${i.despues.reserved}::int, ${i.despues.damaged}::int)`)
  // `now() AT TIME ZONE 'UTC'` y no `now()`: la columna es `timestamp` sin zona y Prisma escribe en UTC; `now()` la
  // convertiría con la zona de la sesión.
  const actualizados = await tx.$executeRaw`
    UPDATE "inventory_levels" AS l
       SET "onHand" = v."onHand", "reserved" = v."reserved", "damaged" = v."damaged", "updatedAt" = (now() AT TIME ZONE 'UTC')
      FROM (VALUES ${Prisma.join(filas)}) AS v("id", "onHand", "reserved", "damaged")
     WHERE l."id" = v."id" AND l."companyId" = ${companyId}`
  if (actualizados !== items.length) fallo('LOTE_INCOMPLETO', 'No se pudieron actualizar todos los saldos de la entrada.')
  return items.map((i) => {
    const id = idPorNivel.get(i.nivelId)
    if (!id) fallo('LOTE_INCOMPLETO', 'Falta el movimiento de una línea de la entrada.')
    return id
  })
}

export interface EntradaMultiple {
  sucursalId: string
  lineas: readonly LineaEntrada[]
  referencia?: string | null
  nota?: string | null
  origen?: 'MANUAL' | 'CSV'
  idempotencyKey?: string | null
  /** Tope de líneas; el de una importación es mayor que el de una captura a mano. */
  maxLineas?: number
  /** Para pruebas: el «ahora» del número correlativo y la fecha. */
  ahora?: Date
}

export interface ResultadoEntradaMultiple {
  entradaId: string
  numero: string
  lineas: number
  unidades: number
  /** true si la clave de idempotencia ya existía: no se hizo nada nuevo. */
  repetido: boolean
}

/** El último correlativo de entradas de la empresa para el prefijo con año (`ENT-2026-`). */
async function ultimaEntrada(tx: Tx, companyId: string, prefijo: string): Promise<string | null> {
  const filas = await tx.$queryRaw<{ number: string }[]>`
    SELECT "number" FROM "inventory_receipts"
     WHERE "companyId" = ${companyId} AND "number" ~ ${'^' + prefijo + '[0-9]{6,}$'}
     ORDER BY "number" DESC LIMIT 1`
  return filas[0]?.number ?? null
}

/**
 * ENTRADA DE MERCANCÍA con varias líneas: TODO O NADA.
 *
 * Una factura de proveedor trae 20–50 productos. Esto las registra juntas como
 * UN documento (`ENT-2026-000001`, sucursal, referencia) cuyas líneas apuntan a
 * los movimientos PURCHASE que produjeron. Si cualquier línea falla —producto
 * que no controla inventario, existencia máxima superada, sucursal cerrada—
 * no queda NADA: ni movimientos, ni saldos, ni número consumido.
 *
 * CONCURRENCIA. Antes de escribir nada se BLOQUEAN, en orden de id y de una vez,
 * todos los saldos que la entrada toca. Dos entradas simultáneas con los mismos
 * productos en distinto orden (A: v1, v2 — B: v2, v1) no se interbloquean: las
 * dos piden los candados en el mismo orden. La idempotencia se revisa YA con los
 * candados puestos, así que dos envíos idénticos simultáneos se turnan y el
 * segundo devuelve la entrada del primero.
 */
export async function registrarEntradaMultipleEnTx(tx: Tx, companyId: string, e: EntradaMultiple, ctx: ContextoAuditoria): Promise<ResultadoEntradaMultiple> {
  const validas = validarLineasEntrada(e.lineas, e.maxLineas ?? MAX_LINEAS_ENTRADA)
  if (!validas.ok) fallo(validas.codigo, validas.error)
  const referencia = normalizarTextoLibre(e.referencia, MAX_REFERENCIA, 'La referencia')
  if (!referencia.ok) fallo('REFERENCIA_INVALIDA', referencia.error)
  const nota = normalizarTextoLibre(e.nota, MAX_NOTA, 'La nota')
  if (!nota.ok) fallo('NOTA_INVALIDA', nota.error)
  const clave = claveValida(e.idempotencyKey)
  const ahora = e.ahora ?? new Date()

  const sucursal = await exigirSucursal(tx, companyId, e.sucursalId, true)

  // Las variantes: todas existen en la empresa y todas controlan inventario.
  const ids = validas.lineas.map((l) => l.varianteId)
  const variantes = await tx.catalogVariant.findMany({
    where: { companyId, id: { in: ids } },
    select: { id: true, sku: true, name: true, isDefault: true, item: { select: { name: true, type: true, capabilities: true } } },
  })
  const porId = new Map(variantes.map((v) => [v.id, v]))
  for (const l of validas.lineas) {
    const v = porId.get(l.varianteId)
    if (!v) fallo('VARIANTE_NO_ENCONTRADA', 'Uno de los productos de la entrada ya no existe.')
    if (!normalizarCapacidades(v.item.type, v.item.capabilities).trackInventory) {
      fallo('SIN_CONTROL_DE_INVENTARIO', `«${v.item.name}» no controla inventario. Actívalo en su ficha del catálogo para llevar existencias.`)
    }
  }

  // Los saldos: se crean en cero los que falten (no es un movimiento) y se BLOQUEAN todos, en orden de id.
  // Se crean en un orden FIJO (por producto): un INSERT … ON CONFLICT fila a fila espera a la fila que otra transacción
  // acaba de insertar, y dos entradas con los mismos productos nuevos en distinto orden se interbloquearían.
  await tx.inventoryLevel.createMany({ data: [...ids].sort().map((v) => ({ companyId, catalogVariantId: v, locationId: sucursal.id })), skipDuplicates: true })
  const niveles = await tx.inventoryLevel.findMany({
    where: { companyId, locationId: sucursal.id, catalogVariantId: { in: ids } },
    select: { id: true, catalogVariantId: true },
  })
  const nivelDeVariante = new Map(niveles.map((n) => [n.catalogVariantId, n.id]))
  if (nivelDeVariante.size !== ids.length) fallo('NIVEL_NO_ENCONTRADO', 'No se pudieron preparar los saldos de la entrada.')
  const bloqueados = await bloquear(tx, companyId, niveles.map((n) => n.id))

  // Idempotencia, YA con los candados: el segundo de dos envíos idénticos llega aquí tras el primero.
  if (clave) {
    const previa = await tx.inventoryReceipt.findFirst({
      where: { companyId, idempotencyKey: clave },
      select: { id: true, number: true, locationId: true, lineCount: true, unitCount: true, lines: { select: { catalogVariantId: true, quantity: true } } },
    })
    if (previa) {
      const mismas =
        previa.locationId === sucursal.id &&
        previa.lines.length === validas.lineas.length &&
        validas.lineas.every((l) => previa.lines.some((p) => p.catalogVariantId === l.varianteId && p.quantity === l.cantidad))
      if (!mismas) fallo('CLAVE_REUTILIZADA', 'Esa clave de idempotencia ya se usó para otra entrada distinta.')
      return { entradaId: previa.id, numero: previa.number, lineas: previa.lineCount, unidades: previa.unitCount, repetido: true }
    }
  }

  // Cada línea se aplica con el ledger PURO sobre el saldo bloqueado: el invariante y el tope de existencia son los de siempre.
  const items: ItemLote[] = validas.lineas.map((l) => {
    const nivelId = nivelDeVariante.get(l.varianteId)!
    const fila = bloqueados.get(nivelId)!
    const movimiento: Movimiento = { type: 'PURCHASE', sourceBucket: null, destinationBucket: 'AVAILABLE', quantity: l.cantidad, reason: null }
    let despues
    try {
      despues = aplicarMovimiento(cubetasDeSaldo(fila), movimiento)
    } catch (err) {
      const v = porId.get(l.varianteId)!
      const nombre = v.isDefault ? v.item.name : `${v.item.name} · ${v.name}`
      fallo('EXISTENCIA_MAXIMA', `«${nombre}»: ${err instanceof Error ? err.message : 'la existencia no es válida.'}`)
    }
    return { nivelId, movimiento, antes: { onHand: fila.onHand, reserved: fila.reserved, damaged: fila.damaged }, despues: saldoDeCubetas(despues), meta: { userId: ctx.actorId } }
  })

  const numero = await siguienteNumero(tx, PREFIJO_ENTRADA, (prefijo) => ultimaEntrada(tx, companyId, prefijo), ahora, `entrada:${companyId}`)
  let entrada
  try {
    entrada = await tx.inventoryReceipt.create({
      data: {
        companyId,
        number: numero,
        locationId: sucursal.id,
        source: e.origen ?? 'MANUAL',
        reference: referencia.valor,
        note: nota.valor,
        userId: ctx.actorId,
        idempotencyKey: clave,
        lineCount: validas.lineas.length,
        unitCount: validas.unidades,
      },
      select: { id: true },
    })
  } catch (err) {
    if (esViolacionUnica(err)) fallo('CLAVE_REUTILIZADA', 'Esa clave de idempotencia ya se usó para otra entrada distinta.')
    throw err
  }

  // El movimiento apunta a la entrada que lo explica.
  for (const i of items) i.meta = { ...i.meta, referencia: { tipo: 'RECEIPT', id: entrada.id } }
  const movimientoIds = await escribirMovimientosPorLote(tx, companyId, items)
  await tx.inventoryReceiptLine.createMany({
    data: validas.lineas.map((l, idx) => ({ companyId, receiptId: entrada.id, catalogVariantId: l.varianteId, position: idx, quantity: l.cantidad, movementId: movimientoIds[idx] })),
  })

  await auditarInventario(
    tx,
    ctx,
    companyId,
    'INVENTORY_STOCK_CHANGED',
    entrada.id,
    { tipo: 'PURCHASE', entrada: numero, origen: e.origen ?? 'MANUAL', sucursal: sucursal.nombre, referencia: referencia.valor, lineas: validas.lineas.length, unidades: validas.unidades },
    'InventoryReceipt'
  )
  return { entradaId: entrada.id, numero, lineas: validas.lineas.length, unidades: validas.unidades, repetido: false }
}

// ── INV-2b · Conteo físico por sucursal ──────────────────────────────────────

/**
 * UN inventario físico por sucursal a la vez, en tres tiempos:
 *
 *   1. ABRIR el conteo (`abrirConteoEnTx`): un documento `CNT-2026-000001` con la
 *      sucursal. Solo uno abierto por sucursal (índice único parcial en la base).
 *   2. CONTAR (`registrarConteoProductoEnTx`, `importarConteoEnTx`): una línea por
 *      producto con lo contado y lo que decía el sistema EN ESE MOMENTO. Mientras
 *      está abierto es un borrador: se corrige y se quita.
 *   3. APLICAR (`aplicarConteoEnTx`) o CANCELAR. Aplicar ajusta cada producto por
 *      la DIFERENCIA (contado − esperado al contar), no por el número: una venta
 *      ocurrida mientras se contaba no se pierde. Lo que no se contó no se toca.
 *      Todo o nada: si una línea no se puede aplicar (dejaría menos de lo
 *      apartado) no se aplica NINGUNA y se dice cuáles son.
 *
 * Cada operación sobre un conteo lo BLOQUEA primero (`SELECT … FOR UPDATE`), y
 * después —en `aplicar`— los saldos, en orden de id. Nada más bloquea sesiones,
 * así que no hay ciclos.
 */

/** El último correlativo de conteos de la empresa para el prefijo con año (`CNT-2026-`). */
async function ultimoConteo(tx: Tx, companyId: string, prefijo: string): Promise<string | null> {
  const filas = await tx.$queryRaw<{ number: string }[]>`
    SELECT "number" FROM "inventory_count_sessions"
     WHERE "companyId" = ${companyId} AND "number" ~ ${'^' + prefijo + '[0-9]{6,}$'}
     ORDER BY "number" DESC LIMIT 1`
  return filas[0]?.number ?? null
}

interface ConteoBloqueado {
  id: string
  number: string
  status: EstadoConteo
  locationId: string
}

/** Bloquea el conteo y lo devuelve; si no existe (o es de otra empresa) se dice igual: no existe. */
async function bloquearConteo(tx: Tx, companyId: string, conteoId: string): Promise<ConteoBloqueado> {
  if (typeof conteoId !== 'string' || conteoId === '' || conteoId.length > 120) fallo('CONTEO_NO_ENCONTRADO', 'El conteo no existe.')
  const filas = await tx.$queryRaw<ConteoBloqueado[]>`
    SELECT "id", "number", "status", "locationId"
      FROM "inventory_count_sessions"
     WHERE "id" = ${conteoId} AND "companyId" = ${companyId}
       FOR UPDATE`
  if (!filas[0]) fallo('CONTEO_NO_ENCONTRADO', 'El conteo no existe.')
  return filas[0]
}

function exigirAbierto(c: ConteoBloqueado): void {
  if (c.status !== 'OPEN') {
    fallo('CONTEO_CERRADO', c.status === 'APPLIED' ? `El conteo ${c.number} ya se aplicó: no admite cambios. Abre otro para contar de nuevo.` : `El conteo ${c.number} está cancelado: no admite cambios.`)
  }
}

/** Lo que dice el sistema hoy de un producto en una sucursal (0 si nunca tuvo saldo). */
async function existenciaDe(tx: Tx, companyId: string, varianteId: string, sucursalId: string): Promise<number> {
  const n = await tx.inventoryLevel.findFirst({ where: { companyId, catalogVariantId: varianteId, locationId: sucursalId }, select: { onHand: true } })
  return n?.onHand ?? 0
}

export interface ResultadoAbrirConteo {
  conteoId: string
  numero: string
  /** true si esa persona ya tenía abierto el conteo de esta sucursal: se le devuelve el mismo (un doble clic no abre dos). */
  repetido: boolean
}

export async function abrirConteoEnTx(tx: Tx, companyId: string, e: { sucursalId: string; nota?: string | null; ahora?: Date }, ctx: ContextoAuditoria): Promise<ResultadoAbrirConteo> {
  const nota = normalizarTextoLibre(e.nota, MAX_NOTA_CONTEO, 'La nota')
  if (!nota.ok) fallo('NOTA_INVALIDA', nota.error)
  const sucursal = await exigirSucursal(tx, companyId, e.sucursalId, true)
  // Dos aperturas simultáneas de la misma sucursal se turnan; sin esto, la segunda toparía con el índice único y
  // PostgreSQL aborta toda la transacción en vez de dejarnos contestar con el conteo que ya existe.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'conteo-abrir:' + sucursal.id}))`
  const abierto = await tx.inventoryCountSession.findFirst({ where: { companyId, locationId: sucursal.id, status: 'OPEN' }, select: { id: true, number: true, openedById: true } })
  if (abierto) {
    if (abierto.openedById !== null && abierto.openedById === ctx.actorId) return { conteoId: abierto.id, numero: abierto.number, repetido: true }
    fallo('CONTEO_YA_ABIERTO', `Ya hay un conteo abierto en «${sucursal.nombre}» (${abierto.number}). Termínalo —aplícalo o cancélalo— antes de abrir otro.`)
  }
  const ahora = e.ahora ?? new Date()
  const numero = await siguienteNumero(tx, PREFIJO_CONTEO, (prefijo) => ultimoConteo(tx, companyId, prefijo), ahora, `conteo:${companyId}`)
  try {
    const c = await tx.inventoryCountSession.create({
      data: { companyId, number: numero, locationId: sucursal.id, note: nota.valor, openedById: ctx.actorId },
      select: { id: true },
    })
    return { conteoId: c.id, numero, repetido: false }
  } catch (err) {
    if (esViolacionUnica(err)) fallo('CONTEO_YA_ABIERTO', `Ya hay un conteo abierto en «${sucursal.nombre}». Termínalo antes de abrir otro.`)
    throw err
  }
}

export interface EntradaConteoProducto {
  conteoId: string
  varianteId: string
  cantidad: number
  modo: ModoConteo
  ahora?: Date
}

export interface ResultadoConteoProducto {
  varianteId: string
  /** Lo contado de ese producto después de esta captura. */
  contado: number
  /** true si era la primera vez que se contaba en este conteo. */
  nueva: boolean
  /** Productos con línea en el conteo, contando este. */
  lineas: number
}

/**
 * Cuenta UN producto. `SUMAR` es un escaneo (una unidad más, o las que diga);
 * `FIJAR` es escribir el número (reemplaza lo contado y vuelve a tomar la foto de
 * lo que decía el sistema: es un recuento en este momento).
 */
export async function registrarConteoProductoEnTx(tx: Tx, companyId: string, e: EntradaConteoProducto, ctx: ContextoAuditoria): Promise<ResultadoConteoProducto> {
  if (!esModoConteo(e.modo)) fallo('MODO_INVALIDO', 'Indica si sumas una captura o escribes la cantidad.')
  const cantidad = validarCantidadContada(e.cantidad, e.modo)
  if (!cantidad.ok) fallo('CANTIDAD_INVALIDA', cantidad.error)
  const conteo = await bloquearConteo(tx, companyId, e.conteoId)
  exigirAbierto(conteo)
  const variante = await exigirVarianteControlada(tx, companyId, e.varianteId)
  const previa = await tx.inventoryCountLine.findFirst({ where: { companyId, sessionId: conteo.id, catalogVariantId: variante.id }, select: { id: true, counted: true } })
  const total = await tx.inventoryCountLine.count({ where: { companyId, sessionId: conteo.id } })
  if (!previa && total >= MAX_LINEAS_CONTEO) {
    fallo('DEMASIADAS_LINEAS', `Un conteo admite hasta ${MAX_LINEAS_CONTEO.toLocaleString('es-DO')} productos. Aplícalo y abre otro para seguir.`)
  }
  const esperado = await existenciaDe(tx, companyId, variante.id, conteo.locationId)
  const ahora = e.ahora ?? new Date()
  if (!previa) {
    await tx.inventoryCountLine.create({
      data: { companyId, sessionId: conteo.id, catalogVariantId: variante.id, counted: cantidad.valor, expected: esperado, countedById: ctx.actorId, countedAt: ahora },
    })
    return { varianteId: variante.id, contado: cantidad.valor, nueva: true, lineas: total + 1 }
  }
  const contado = e.modo === 'SUMAR' ? previa.counted + cantidad.valor : cantidad.valor
  if (contado > CANTIDAD_MAXIMA) fallo('CANTIDAD_INVALIDA', `Un conteo no puede pasar de ${CANTIDAD_MAXIMA.toLocaleString('es-DO')} unidades por producto.`)
  await tx.inventoryCountLine.update({
    where: { id: previa.id },
    data: { counted: contado, countedById: ctx.actorId, countedAt: ahora, ...(e.modo === 'FIJAR' ? { expected: esperado } : {}) },
  })
  return { varianteId: variante.id, contado, nueva: false, lineas: total }
}

/** Saca un producto del conteo (mientras está abierto): lo que no tiene línea no se ajusta. */
export async function quitarLineaDeConteoEnTx(tx: Tx, companyId: string, e: { conteoId: string; varianteId: string }): Promise<{ quitada: boolean }> {
  const conteo = await bloquearConteo(tx, companyId, e.conteoId)
  exigirAbierto(conteo)
  if (typeof e.varianteId !== 'string' || e.varianteId === '') fallo('VARIANTE_NO_ENCONTRADA', 'La variante no existe.')
  const r = await tx.inventoryCountLine.deleteMany({ where: { companyId, sessionId: conteo.id, catalogVariantId: e.varianteId } })
  return { quitada: r.count > 0 }
}

export interface ResultadoImportarConteo {
  nuevas: number
  reemplazadas: number
  lineas: number
}

/**
 * Carga de golpe lo contado en una hoja (CSV): TODO O NADA y siempre como
 * `FIJAR`. Un producto que ya tenía línea se reemplaza (la hoja es el recuento
 * más reciente); los demás no se tocan.
 */
export async function importarConteoEnTx(
  tx: Tx,
  companyId: string,
  e: { conteoId: string; lineas: ReadonlyArray<{ varianteId: string; cantidad: number }>; ahora?: Date },
  ctx: ContextoAuditoria
): Promise<ResultadoImportarConteo> {
  if (!Array.isArray(e.lineas) || e.lineas.length === 0) fallo('CONTEO_SIN_LINEAS', 'El archivo no trae ningún producto contado.')
  if (e.lineas.length > MAX_LINEAS_CONTEO) fallo('DEMASIADAS_LINEAS', `Un conteo admite hasta ${MAX_LINEAS_CONTEO.toLocaleString('es-DO')} productos.`)
  const ids: string[] = []
  const vistos = new Set<string>()
  for (const l of e.lineas) {
    if (!l || typeof l.varianteId !== 'string' || l.varianteId === '') fallo('LINEA_INVALIDA', 'Una línea del archivo no tiene producto.')
    const c = validarCantidadContada(l.cantidad, 'FIJAR')
    if (!c.ok) fallo('CANTIDAD_INVALIDA', c.error)
    if (vistos.has(l.varianteId)) fallo('LINEA_REPETIDA', 'Un producto aparece dos veces en el archivo.')
    vistos.add(l.varianteId)
    ids.push(l.varianteId)
  }
  const conteo = await bloquearConteo(tx, companyId, e.conteoId)
  exigirAbierto(conteo)

  const variantes = await tx.catalogVariant.findMany({
    where: { companyId, id: { in: ids } },
    select: { id: true, name: true, isDefault: true, item: { select: { name: true, type: true, capabilities: true } } },
  })
  const porId = new Map(variantes.map((v) => [v.id, v]))
  for (const id of ids) {
    const v = porId.get(id)
    if (!v) fallo('VARIANTE_NO_ENCONTRADA', 'Uno de los productos del archivo ya no existe.')
    if (!normalizarCapacidades(v.item.type, v.item.capabilities).trackInventory) {
      fallo('SIN_CONTROL_DE_INVENTARIO', `«${v.item.name}» no controla inventario. Actívalo en su ficha del catálogo para contarlo.`)
    }
  }

  const previas = await tx.inventoryCountLine.findMany({ where: { companyId, sessionId: conteo.id }, select: { id: true, catalogVariantId: true } })
  const previaDe = new Map(previas.map((p) => [p.catalogVariantId, p.id]))
  const nuevas = ids.filter((id) => !previaDe.has(id)).length
  if (previas.length + nuevas > MAX_LINEAS_CONTEO) {
    fallo('DEMASIADAS_LINEAS', `Con este archivo el conteo pasaría de ${MAX_LINEAS_CONTEO.toLocaleString('es-DO')} productos. Aplícalo y abre otro para seguir.`)
  }

  const niveles = await tx.inventoryLevel.findMany({ where: { companyId, locationId: conteo.locationId, catalogVariantId: { in: ids } }, select: { catalogVariantId: true, onHand: true } })
  const esperadoDe = new Map(niveles.map((n) => [n.catalogVariantId, n.onHand]))
  const ahora = e.ahora ?? new Date()

  const aCrear = e.lineas.filter((l) => !previaDe.has(l.varianteId))
  if (aCrear.length > 0) {
    await tx.inventoryCountLine.createMany({
      data: aCrear.map((l) => ({ companyId, sessionId: conteo.id, catalogVariantId: l.varianteId, counted: l.cantidad, expected: esperadoDe.get(l.varianteId) ?? 0, countedById: ctx.actorId, countedAt: ahora })),
    })
  }
  const aCambiar = e.lineas.filter((l) => previaDe.has(l.varianteId))
  if (aCambiar.length > 0) {
    const filas = aCambiar.map((l) => Prisma.sql`(${previaDe.get(l.varianteId)!}, ${l.cantidad}::int, ${esperadoDe.get(l.varianteId) ?? 0}::int)`)
    // `AT TIME ZONE 'UTC'`: la columna es `timestamp` sin zona y Prisma escribe en UTC (ver `escribirMovimientosPorLote`).
    const cambiadas = await tx.$executeRaw`
      UPDATE "inventory_count_lines" AS l
         SET "counted" = v."counted", "expected" = v."expected", "countedById" = ${ctx.actorId}, "countedAt" = (${ahora.toISOString()}::timestamptz AT TIME ZONE 'UTC')
        FROM (VALUES ${Prisma.join(filas)}) AS v("id", "counted", "expected")
       WHERE l."id" = v."id" AND l."companyId" = ${companyId} AND l."sessionId" = ${conteo.id}`
    if (cambiadas !== aCambiar.length) fallo('LOTE_INCOMPLETO', 'No se pudieron actualizar todas las líneas del conteo.')
  }
  return { nuevas: aCrear.length, reemplazadas: aCambiar.length, lineas: previas.length + aCrear.length }
}

export interface LineaRechazada {
  varianteId: string
  sku: string
  nombre: string
  contado: number
  esperado: number
  /** Las existencias reales de ahora. */
  existenciaActual: number
  motivo: string
}

export interface ResumenConteoAplicado {
  lineas: number
  ajustadas: number
  unidadesSobrantes: number
  unidadesFaltantes: number
  sinContar: number
}

export type ResultadoAplicarConteo =
  | {
      aplicada: true
      conteoId: string
      numero: string
      resumen: ResumenConteoAplicado
      /** true si ya estaba aplicado: no se hizo nada nuevo. */
      repetido: boolean
      /** Productos cuyo vendible bajó (para revisar sus umbrales de aviso). */
      variantesBajadas: string[]
    }
  | { aplicada: false; conteoId: string; numero: string; rechazadas: LineaRechazada[] }

/**
 * APLICA el conteo: un ajuste por producto por la diferencia, todo en una
 * transacción. Si alguna línea no se puede aplicar, NO se aplica ninguna y se
 * devuelven todas las que fallan (la persona las corrige o las quita y vuelve a
 * aplicar). Aplicar dos veces el mismo conteo no repite nada.
 */
export async function aplicarConteoEnTx(tx: Tx, companyId: string, e: { conteoId: string; ahora?: Date }, ctx: ContextoAuditoria): Promise<ResultadoAplicarConteo> {
  const conteo = await bloquearConteo(tx, companyId, e.conteoId)
  if (conteo.status === 'APPLIED') {
    const r = await tx.inventoryCountSession.findFirstOrThrow({
      where: { id: conteo.id, companyId },
      select: { countedLines: true, adjustedLines: true, unitsOver: true, unitsShort: true, uncountedLines: true },
    })
    return {
      aplicada: true,
      conteoId: conteo.id,
      numero: conteo.number,
      repetido: true,
      variantesBajadas: [],
      resumen: { lineas: r.countedLines ?? 0, ajustadas: r.adjustedLines ?? 0, unidadesSobrantes: r.unitsOver ?? 0, unidadesFaltantes: r.unitsShort ?? 0, sinContar: r.uncountedLines ?? 0 },
    }
  }
  exigirAbierto(conteo)
  const ahora = e.ahora ?? new Date()

  const lineas = await tx.inventoryCountLine.findMany({
    where: { companyId, sessionId: conteo.id },
    orderBy: [{ catalogVariantId: 'asc' }],
    select: {
      id: true,
      catalogVariantId: true,
      counted: true,
      expected: true,
      variant: { select: { sku: true, name: true, isDefault: true, item: { select: { name: true, type: true, capabilities: true } } } },
    },
  })
  if (lineas.length === 0) fallo('CONTEO_SIN_LINEAS', 'Cuenta al menos un producto antes de aplicar el conteo.')
  const nombreDe = (l: (typeof lineas)[number]) => (l.variant.isDefault ? l.variant.item.name : `${l.variant.item.name} · ${l.variant.name}`)

  const sucursal = await exigirSucursal(tx, companyId, conteo.locationId, false)
  if (lineas.some((l) => diferenciaDeConteo(l.counted, l.expected) > 0)) await exigirSucursal(tx, companyId, conteo.locationId, true)

  // Los saldos: se crean en cero los que falten (en orden fijo) y se BLOQUEAN todos juntos, en orden de id.
  const variantes = lineas.map((l) => l.catalogVariantId)
  await tx.inventoryLevel.createMany({ data: [...variantes].sort().map((v) => ({ companyId, catalogVariantId: v, locationId: sucursal.id })), skipDuplicates: true })
  const niveles = await tx.inventoryLevel.findMany({ where: { companyId, locationId: sucursal.id, catalogVariantId: { in: variantes } }, select: { id: true, catalogVariantId: true } })
  const nivelDe = new Map(niveles.map((n) => [n.catalogVariantId, n.id]))
  if (nivelDe.size !== variantes.length) fallo('NIVEL_NO_ENCONTRADO', 'No se pudieron preparar los saldos del conteo.')
  const idsNivel = niveles.map((n) => n.id)
  let filas = await bloquear(tx, companyId, idsNivel)

  const motivo = motivoDeConteo(conteo.number)
  const evaluar = () =>
    lineas.map((l) => {
      const fila = filas.get(nivelDe.get(l.catalogVariantId)!)!
      const delta = diferenciaDeConteo(l.counted, l.expected)
      const trackea = normalizarCapacidades(l.variant.item.type, l.variant.item.capabilities).trackInventory
      const plan = trackea ? planDeAjuste(delta, fila, motivo) : ({ tipo: 'RECHAZADA', motivo: `«${l.variant.item.name}» ya no controla inventario: actívalo en su ficha del catálogo o quítalo del conteo.` } as const)
      return { l, fila, delta, plan }
    })

  // Una reserva vencida que nadie ha barrido aún sigue «apartando»: antes de rechazar un faltante por eso, se vencen las caducadas.
  let evaluadas = evaluar()
  const paraVencer = evaluadas.filter((x) => x.plan.tipo === 'RECHAZADA' && x.delta < 0 && x.fila.reserved > 0).map((x) => x.fila.id)
  if (paraVencer.length > 0) {
    let vencidas = 0
    for (const id of paraVencer) vencidas += await vencerDeNivel(tx, companyId, id, ahora)
    if (vencidas > 0) {
      filas = await bloquear(tx, companyId, idsNivel)
      evaluadas = evaluar()
    }
  }

  const rechazadas = evaluadas.flatMap((x) =>
    x.plan.tipo === 'RECHAZADA'
      ? [{ varianteId: x.l.catalogVariantId, sku: x.l.variant.sku, nombre: nombreDe(x.l), contado: x.l.counted, esperado: x.l.expected, existenciaActual: x.fila.onHand, motivo: x.plan.motivo } satisfies LineaRechazada]
      : []
  )
  if (rechazadas.length > 0) return { aplicada: false, conteoId: conteo.id, numero: conteo.number, rechazadas }

  // Los ajustes: uno por producto con diferencia, con el ledger puro sobre el saldo bloqueado.
  const items: ItemLote[] = []
  const idLineaDeItem: string[] = []
  const bajadas: string[] = []
  let unidadesSobrantes = 0
  let unidadesFaltantes = 0
  for (const x of evaluadas) {
    if (x.plan.tipo !== 'AJUSTE') continue
    const despues = saldoDeCubetas(aplicarMovimiento(cubetasDeSaldo(x.fila), x.plan.movimiento))
    items.push({
      nivelId: x.fila.id,
      movimiento: x.plan.movimiento,
      antes: { onHand: x.fila.onHand, reserved: x.fila.reserved, damaged: x.fila.damaged },
      despues,
      meta: { userId: ctx.actorId, referencia: { tipo: 'STOCK_COUNT', id: conteo.id } },
    })
    idLineaDeItem.push(x.l.id)
    if (x.delta > 0) unidadesSobrantes += x.delta
    else {
      unidadesFaltantes += -x.delta
      bajadas.push(x.l.catalogVariantId)
    }
  }
  const movimientoIds = await escribirMovimientosPorLote(tx, companyId, items)
  const movimientoDeLinea = new Map(idLineaDeItem.map((id, i) => [id, movimientoIds[i]]))
  const despuesDeNivel = new Map(items.map((i) => [i.nivelId, i.despues.onHand]))

  // El resultado de CADA línea (también las que coincidieron): se escribe ANTES de cerrar el conteo, que después no admite cambios.
  const resultados = evaluadas.map((x) => Prisma.sql`(${x.l.id}, ${x.fila.onHand}::int, ${despuesDeNivel.get(x.fila.id) ?? x.fila.onHand}::int, ${movimientoDeLinea.get(x.l.id) ?? null}::text)`)
  const escritas = await tx.$executeRaw`
    UPDATE "inventory_count_lines" AS l
       SET "onHandBefore" = v."antes", "onHandAfter" = v."despues", "movementId" = v."movimiento"
      FROM (VALUES ${Prisma.join(resultados)}) AS v("id", "antes", "despues", "movimiento")
     WHERE l."id" = v."id" AND l."companyId" = ${companyId} AND l."sessionId" = ${conteo.id}`
  if (escritas !== evaluadas.length) fallo('LOTE_INCOMPLETO', 'No se pudieron guardar los resultados del conteo.')

  const sinContar = await tx.inventoryLevel.count({ where: { companyId, locationId: sucursal.id, onHand: { gt: 0 }, catalogVariantId: { notIn: variantes } } })
  const resumen: ResumenConteoAplicado = { lineas: lineas.length, ajustadas: items.length, unidadesSobrantes, unidadesFaltantes, sinContar }
  await tx.inventoryCountSession.update({
    where: { id: conteo.id },
    data: {
      status: 'APPLIED',
      appliedAt: ahora,
      appliedById: ctx.actorId,
      countedLines: resumen.lineas,
      adjustedLines: resumen.ajustadas,
      unitsOver: resumen.unidadesSobrantes,
      unitsShort: resumen.unidadesFaltantes,
      uncountedLines: resumen.sinContar,
    },
  })
  await auditarInventario(
    tx,
    ctx,
    companyId,
    'INVENTORY_STOCK_CHANGED',
    conteo.id,
    { tipo: 'ADJUSTMENT', conteo: conteo.number, sucursal: sucursal.nombre, lineas: resumen.lineas, ajustadas: resumen.ajustadas, sobrantes: unidadesSobrantes, faltantes: unidadesFaltantes, sinContar },
    'InventoryCountSession'
  )
  return { aplicada: true, conteoId: conteo.id, numero: conteo.number, resumen, repetido: false, variantesBajadas: bajadas }
}

/** Descarta el conteo sin tocar existencias. Queda guardado (quién y por qué), pero ya no admite cambios. */
export async function cancelarConteoEnTx(tx: Tx, companyId: string, e: { conteoId: string; motivo?: string | null; ahora?: Date }, ctx: ContextoAuditoria): Promise<{ conteoId: string; numero: string; repetido: boolean }> {
  const motivo = normalizarTextoLibre(e.motivo, MAX_MOTIVO_CANCELACION, 'El motivo')
  if (!motivo.ok) fallo('MOTIVO_INVALIDO', motivo.error)
  const conteo = await bloquearConteo(tx, companyId, e.conteoId)
  if (conteo.status === 'CANCELLED') return { conteoId: conteo.id, numero: conteo.number, repetido: true }
  exigirAbierto(conteo)
  await tx.inventoryCountSession.update({
    where: { id: conteo.id },
    data: { status: 'CANCELLED', cancelledAt: e.ahora ?? new Date(), cancelledById: ctx.actorId, cancelReason: motivo.valor },
  })
  return { conteoId: conteo.id, numero: conteo.number, repetido: false }
}

// ── INV-2c · Transferencias con envío entre sucursales ───────────────────────

/**
 * Una transferencia CON ENVÍO, en tres tiempos:
 *
 *   1. ENVIAR (`enviarTrasladoEnTx`): las unidades SALEN del origen (TRANSFER_OUT)
 *      y quedan EN TRÁNSITO —no disponibles en ninguna sucursal—. Todo o nada.
 *   2. RECIBIR (`recibirTrasladoEnTx`): el destino recibe lo que llegó, en una o
 *      varias recepciones (TRANSFER_IN). Recibir todo la cierra; si no llegó todo se
 *      puede cerrar con faltante, y entonces el motivo es obligatorio.
 *   3. CANCELAR (`cancelarTrasladoEnTx`): lo que sigue en tránsito VUELVE al origen.
 *
 * La transferencia directa de siempre (`transferirEnTx`: sale y entra en el mismo
 * instante) no pasa por aquí y no cambia.
 *
 * CONCURRENCIA. Enviar bloquea los saldos del origen (orden de id); recibir y
 * cancelar bloquean PRIMERO la transferencia y después los saldos (orden de id).
 * Enviar no espera a ninguna transferencia que ya exista, así que no hay ciclos. Los
 * saldos que falten se crean siempre en un orden fijo (por producto).
 */

/** El último correlativo de transferencias de la empresa para el prefijo con año (`TRF-2026-`). */
async function ultimoTraslado(tx: Tx, companyId: string, prefijo: string): Promise<string | null> {
  const filas = await tx.$queryRaw<{ number: string }[]>`
    SELECT "number" FROM "inventory_transfers"
     WHERE "companyId" = ${companyId} AND "number" ~ ${'^' + prefijo + '[0-9]{6,}$'}
     ORDER BY "number" DESC LIMIT 1`
  return filas[0]?.number ?? null
}

interface TrasladoBloqueado {
  id: string
  number: string
  status: EstadoTraslado
  fromLocationId: string
  toLocationId: string
}

/** Bloquea la transferencia y la devuelve; si no existe (o es de otra empresa) se dice igual: no existe. */
async function bloquearTraslado(tx: Tx, companyId: string, trasladoId: string): Promise<TrasladoBloqueado> {
  if (typeof trasladoId !== 'string' || trasladoId === '' || trasladoId.length > 120) fallo('TRASLADO_NO_ENCONTRADO', 'La transferencia no existe.')
  const filas = await tx.$queryRaw<TrasladoBloqueado[]>`
    SELECT "id", "number", "status", "fromLocationId", "toLocationId"
      FROM "inventory_transfers"
     WHERE "id" = ${trasladoId} AND "companyId" = ${companyId}
       FOR UPDATE`
  if (!filas[0]) fallo('TRASLADO_NO_ENCONTRADO', 'La transferencia no existe.')
  return filas[0]
}

function exigirTrasladoAbierto(t: TrasladoBloqueado): void {
  if (t.status === 'RECEIVED' || t.status === 'CANCELLED') {
    fallo('TRASLADO_CERRADO', t.status === 'RECEIVED' ? `La transferencia ${t.number} ya está recibida: no admite cambios.` : `La transferencia ${t.number} está cancelada: no admite cambios.`)
  }
}

/** Las líneas de una transferencia, en el orden en que se capturaron, con lo que ha pasado con cada una. */
async function lineasDeTraslado(tx: Tx, companyId: string, trasladoId: string) {
  const filas = await tx.inventoryTransferLine.findMany({
    where: { companyId, transferId: trasladoId },
    orderBy: [{ position: 'asc' }],
    select: { id: true, catalogVariantId: true, quantitySent: true, quantityReceived: true, quantityReturned: true, quantityLost: true },
  })
  const lineas: Array<LineaDeTraslado & { id: string }> = filas.map((l) => ({
    id: l.id,
    varianteId: l.catalogVariantId,
    enviado: l.quantitySent,
    recibido: l.quantityReceived,
    devuelto: l.quantityReturned,
    perdido: l.quantityLost,
  }))
  return lineas
}

/** Crea, EN ORDEN FIJO por producto, los saldos que falten de unas variantes en una sucursal. */
async function crearSaldosEnOrden(tx: Tx, companyId: string, sucursalId: string, variantes: readonly string[]) {
  await tx.inventoryLevel.createMany({ data: [...new Set(variantes)].sort().map((v) => ({ companyId, catalogVariantId: v, locationId: sucursalId })), skipDuplicates: true })
  const niveles = await tx.inventoryLevel.findMany({ where: { companyId, locationId: sucursalId, catalogVariantId: { in: [...variantes] } }, select: { id: true, catalogVariantId: true } })
  const nivelDe = new Map(niveles.map((n) => [n.catalogVariantId, n.id]))
  if (nivelDe.size !== new Set(variantes).size) fallo('NIVEL_NO_ENCONTRADO', 'No se pudieron preparar los saldos de la transferencia.')
  return nivelDe
}

export interface EntradaEnvio {
  origenId: string
  destinoId: string
  lineas: readonly LineaTraslado[]
  nota?: string | null
  idempotencyKey?: string | null
  ahora?: Date
}

export interface ResultadoEnvio {
  trasladoId: string
  numero: string
  lineas: number
  unidades: number
  /** true si la clave de idempotencia ya existía: no se hizo nada nuevo. */
  repetido: boolean
  /** Los productos cuyo vendible bajó en el origen (para revisar sus umbrales de aviso). */
  variantes: string[]
  origenNombre: string
  destinoNombre: string
}

export async function enviarTrasladoEnTx(tx: Tx, companyId: string, e: EntradaEnvio, ctx: ContextoAuditoria): Promise<ResultadoEnvio> {
  const validas = validarLineasTraslado(e.lineas)
  if (!validas.ok) fallo(validas.codigo, validas.error)
  const nota = normalizarTextoLibre(e.nota, MAX_NOTA_TRASLADO, 'La nota')
  if (!nota.ok) fallo('NOTA_INVALIDA', nota.error)
  const clave = claveValida(e.idempotencyKey)
  if (e.origenId === e.destinoId) fallo('MISMA_SUCURSAL', 'El origen y el destino son la misma sucursal.')
  const ahora = e.ahora ?? new Date()

  const origen = await exigirSucursal(tx, companyId, e.origenId, false)
  const destino = await exigirSucursal(tx, companyId, e.destinoId, true)

  const ids = validas.lineas.map((l) => l.varianteId)
  const variantes = await tx.catalogVariant.findMany({
    where: { companyId, id: { in: ids } },
    select: { id: true, name: true, isDefault: true, item: { select: { name: true, type: true, capabilities: true } } },
  })
  const porId = new Map(variantes.map((v) => [v.id, v]))
  const nombreDe = (id: string) => {
    const v = porId.get(id)!
    return v.isDefault ? v.item.name : `${v.item.name} · ${v.name}`
  }
  for (const l of validas.lineas) {
    const v = porId.get(l.varianteId)
    if (!v) fallo('VARIANTE_NO_ENCONTRADA', 'Uno de los productos del envío ya no existe.')
    if (!normalizarCapacidades(v.item.type, v.item.capabilities).trackInventory) {
      fallo('SIN_CONTROL_DE_INVENTARIO', `«${v.item.name}» no controla inventario. Actívalo en su ficha del catálogo para llevar existencias.`)
    }
  }

  // Los saldos del origen: los que existan se BLOQUEAN todos juntos, en orden de id. El que no existe es un saldo en cero.
  const niveles = await tx.inventoryLevel.findMany({ where: { companyId, locationId: origen.id, catalogVariantId: { in: ids } }, select: { id: true, catalogVariantId: true } })
  const nivelDe = new Map(niveles.map((n) => [n.catalogVariantId, n.id]))
  let filas = niveles.length > 0 ? await bloquear(tx, companyId, niveles.map((n) => n.id)) : new Map<string, FilaNivel>()

  // Idempotencia, YA con los candados: el segundo de dos envíos idénticos llega aquí tras el primero.
  if (clave) {
    const previo = await tx.inventoryTransfer.findFirst({
      where: { companyId, idempotencyKey: clave },
      select: { id: true, number: true, fromLocationId: true, toLocationId: true, lineCount: true, unitCount: true, lines: { select: { catalogVariantId: true, quantitySent: true } } },
    })
    if (previo) {
      const mismas =
        previo.fromLocationId === origen.id &&
        previo.toLocationId === destino.id &&
        previo.lines.length === validas.lineas.length &&
        validas.lineas.every((l) => previo.lines.some((p) => p.catalogVariantId === l.varianteId && p.quantitySent === l.cantidad))
      if (!mismas) fallo('CLAVE_REUTILIZADA', 'Esa clave de idempotencia ya se usó para otro envío distinto.')
      return { trasladoId: previo.id, numero: previo.number, lineas: previo.lineCount, unidades: previo.unitCount, repetido: true, variantes: [], origenNombre: origen.nombre, destinoNombre: destino.nombre }
    }
  }

  const evaluar = () =>
    validas.lineas.map((l) => {
      const nivelId = nivelDe.get(l.varianteId)
      const fila = nivelId ? (filas.get(nivelId) ?? null) : null
      let ok = false
      if (fila) {
        try {
          aplicarMovimiento(cubetasDeSaldo(fila), { type: 'TRANSFER_OUT', sourceBucket: 'AVAILABLE', destinationBucket: null, quantity: l.cantidad, reason: null })
          ok = true
        } catch {
          ok = false
        }
      }
      return { l, nivelId: nivelId ?? null, fila, ok }
    })
  // Una reserva vencida que nadie ha barrido sigue «apartando»: antes de decir que no alcanza, se vencen las caducadas.
  let evaluadas = evaluar()
  const paraVencer = evaluadas.filter((x) => !x.ok && x.fila && x.fila.reserved > 0).map((x) => x.fila!.id)
  if (paraVencer.length > 0) {
    let vencidas = 0
    for (const id of paraVencer) vencidas += await vencerDeNivel(tx, companyId, id, ahora)
    if (vencidas > 0) {
      filas = await bloquear(tx, companyId, niveles.map((n) => n.id))
      evaluadas = evaluar()
    }
  }
  const noAlcanza = evaluadas.filter((x) => !x.ok)
  if (noAlcanza.length > 0) {
    const detalle = noAlcanza.map((x) => `«${nombreDe(x.l.varianteId)}» (pides ${x.l.cantidad.toLocaleString('es-DO')}, hay ${(x.fila ? disponible(x.fila) : 0).toLocaleString('es-DO')} disponible${x.fila && disponible(x.fila) === 1 ? '' : 's'})`)
    fallo('STOCK_INSUFICIENTE', `No alcanza para enviar desde «${origen.nombre}»: ${detalle.join('; ')}.`)
  }

  const numero = await siguienteNumero(tx, PREFIJO_TRASLADO, (prefijo) => ultimoTraslado(tx, companyId, prefijo), ahora, `traslado:${companyId}`)
  let traslado
  try {
    traslado = await tx.inventoryTransfer.create({
      data: {
        companyId,
        number: numero,
        fromLocationId: origen.id,
        toLocationId: destino.id,
        note: nota.valor,
        idempotencyKey: clave,
        sentById: ctx.actorId,
        lineCount: validas.lineas.length,
        unitCount: validas.unidades,
      },
      select: { id: true },
    })
  } catch (err) {
    if (esViolacionUnica(err)) fallo('CLAVE_REUTILIZADA', 'Esa clave de idempotencia ya se usó para otro envío distinto.')
    throw err
  }

  const items: ItemLote[] = evaluadas.map((x) => {
    const fila = x.fila!
    const movimiento: Movimiento = { type: 'TRANSFER_OUT', sourceBucket: 'AVAILABLE', destinationBucket: null, quantity: x.l.cantidad, reason: motivoDeEnvio(numero, destino.nombre) }
    return {
      nivelId: fila.id,
      movimiento,
      antes: { onHand: fila.onHand, reserved: fila.reserved, damaged: fila.damaged },
      despues: saldoDeCubetas(aplicarMovimiento(cubetasDeSaldo(fila), movimiento)),
      meta: { userId: ctx.actorId, referencia: { tipo: 'TRANSFER', id: traslado.id } },
    }
  })
  const movimientoIds = await escribirMovimientosPorLote(tx, companyId, items)
  await tx.inventoryTransferLine.createMany({
    data: validas.lineas.map((l, idx) => ({ companyId, transferId: traslado.id, catalogVariantId: l.varianteId, position: idx, quantitySent: l.cantidad, outMovementId: movimientoIds[idx] })),
  })
  await auditarInventario(
    tx,
    ctx,
    companyId,
    'INVENTORY_TRANSFERRED',
    traslado.id,
    { tipo: 'ENVIO', traslado: numero, desde: origen.nombre, hacia: destino.nombre, lineas: validas.lineas.length, unidades: validas.unidades },
    'InventoryTransfer'
  )
  return { trasladoId: traslado.id, numero, lineas: validas.lineas.length, unidades: validas.unidades, repetido: false, variantes: ids, origenNombre: origen.nombre, destinoNombre: destino.nombre }
}

export interface EntradaRecepcion {
  trasladoId: string
  /** Lo que llegó de cada producto. Si falta, `todo` debe venir. */
  lineas?: readonly LineaTraslado[]
  /** Recibir todo lo que falte por llegar. */
  todo?: boolean
  /** Dar por perdido lo que no llegó y cerrar. Exige motivo. */
  cerrarConFaltante?: boolean
  motivo?: string | null
  idempotencyKey?: string | null
  ahora?: Date
}

export interface ResultadoRecepcion {
  trasladoId: string
  numero: string
  estado: EstadoTraslado
  recibidas: number
  perdidas: number
  /** Lo que sigue en camino después de esta recepción. */
  enTransito: number
  /** true si la clave de idempotencia ya existía: no se hizo nada nuevo. */
  repetido: boolean
}

export async function recibirTrasladoEnTx(tx: Tx, companyId: string, e: EntradaRecepcion, ctx: ContextoAuditoria): Promise<ResultadoRecepcion> {
  const motivo = normalizarTextoLibre(e.motivo, MAX_MOTIVO_TRASLADO, 'El motivo')
  if (!motivo.ok) fallo('MOTIVO_INVALIDO', motivo.error)
  const clave = claveValida(e.idempotencyKey)
  const ahora = e.ahora ?? new Date()
  const traslado = await bloquearTraslado(tx, companyId, e.trasladoId)

  const lineas = await lineasDeTraslado(tx, companyId, traslado.id)
  const estadoActual = async (repetido: boolean): Promise<ResultadoRecepcion> => {
    const t = await tx.inventoryTransfer.findFirstOrThrow({ where: { id: traslado.id, companyId }, select: { status: true } })
    const fresco = await lineasDeTraslado(tx, companyId, traslado.id)
    return { trasladoId: traslado.id, numero: traslado.number, estado: t.status, recibidas: 0, perdidas: 0, enTransito: fresco.reduce((s, l) => s + pendienteDeLinea(l), 0), repetido }
  }

  // Idempotencia, YA con la transferencia bloqueada: el segundo de dos envíos idénticos llega aquí tras el primero.
  if (clave) {
    const previos = await tx.inventoryMovement.findMany({
      where: { companyId, referenceType: 'TRANSFER', referenceId: traslado.id, idempotencyKey: { startsWith: `${clave}:in:` } },
      select: { idempotencyKey: true, quantity: true },
    })
    if (previos.length > 0) {
      const pedidas = e.todo ? null : new Map((e.lineas ?? []).filter((l) => l?.cantidad > 0).map((l) => [`${clave}:in:${l.varianteId}`, l.cantidad]))
      // Mismo envío = mismos productos y cantidades (con `todo`, no se puede comparar: cuenta lo que ya llegó con esa clave).
      if (pedidas && (pedidas.size !== previos.length || previos.some((p) => pedidas.get(p.idempotencyKey ?? '') !== p.quantity))) {
        fallo('CLAVE_REUTILIZADA', 'Esa clave de idempotencia ya se usó para otra recepción distinta.')
      }
      return { ...(await estadoActual(true)), recibidas: previos.reduce((s, p) => s + p.quantity, 0) }
    }
  }
  exigirTrasladoAbierto(traslado)

  const plan = planDeRecepcion(lineas, e.todo ? 'TODO' : (e.lineas ?? []), e.cerrarConFaltante === true, motivo.valor)
  if (!plan.ok) fallo(plan.codigo, plan.error)

  const origen = await exigirSucursal(tx, companyId, traslado.fromLocationId, false)
  let destino: Awaited<ReturnType<typeof exigirSucursal>> | null = null
  if (plan.recibir.length > 0) {
    try {
      destino = await exigirSucursal(tx, companyId, traslado.toLocationId, true)
    } catch (err) {
      if (err instanceof InventarioError && err.codigo === 'SUCURSAL_INACTIVA') {
        fallo('SUCURSAL_INACTIVA', `${err.message} No se puede recibir en una sucursal cerrada: cancela la transferencia para que lo pendiente vuelva a «${origen.nombre}».`)
      }
      throw err
    }
    const variantes = plan.recibir.map((r) => r.varianteId)
    const nivelDe = await crearSaldosEnOrden(tx, companyId, destino.id, variantes)
    const filas = await bloquear(tx, companyId, [...nivelDe.values()])
    const items: ItemLote[] = plan.recibir.map((r) => {
      const fila = filas.get(nivelDe.get(r.varianteId)!)!
      const movimiento: Movimiento = { type: 'TRANSFER_IN', sourceBucket: null, destinationBucket: 'AVAILABLE', quantity: r.cantidad, reason: motivoDeRecepcion(traslado.number, origen.nombre) }
      let despues
      try {
        despues = aplicarMovimiento(cubetasDeSaldo(fila), movimiento)
      } catch (err) {
        traducir(err, movimiento, fila)
      }
      return {
        nivelId: fila.id,
        movimiento,
        antes: { onHand: fila.onHand, reserved: fila.reserved, damaged: fila.damaged },
        despues: saldoDeCubetas(despues),
        meta: { userId: ctx.actorId, referencia: { tipo: 'TRANSFER', id: traslado.id }, idempotencyKey: clave ? `${clave}:in:${r.varianteId}` : null },
      }
    })
    await escribirMovimientosPorLote(tx, companyId, items)
  }

  // Lo recibido y lo perdido de cada línea: se escribe ANTES de cerrar la transferencia, que después no admite cambios.
  const recibidoAhora = new Map(plan.recibir.map((r) => [r.varianteId, r.cantidad]))
  const perdidoAhora = new Map(plan.perder.map((r) => [r.varianteId, r.cantidad]))
  const tocadas = lineas.filter((l) => recibidoAhora.has(l.varianteId) || perdidoAhora.has(l.varianteId))
  if (tocadas.length > 0) {
    const valores = tocadas.map((l) => Prisma.sql`(${l.id}, ${recibidoAhora.get(l.varianteId) ?? 0}::int, ${perdidoAhora.get(l.varianteId) ?? 0}::int)`)
    const escritas = await tx.$executeRaw`
      UPDATE "inventory_transfer_lines" AS l
         SET "quantityReceived" = l."quantityReceived" + v."recibido", "quantityLost" = l."quantityLost" + v."perdido"
        FROM (VALUES ${Prisma.join(valores)}) AS v("id", "recibido", "perdido")
       WHERE l."id" = v."id" AND l."companyId" = ${companyId} AND l."transferId" = ${traslado.id}`
    if (escritas !== tocadas.length) fallo('LOTE_INCOMPLETO', 'No se pudieron actualizar todas las líneas de la transferencia.')
  }

  const recibidasAhora = plan.recibir.reduce((s, r) => s + r.cantidad, 0)
  const perdidasAhora = plan.perder.reduce((s, r) => s + r.cantidad, 0)
  if (plan.estadoFinal === 'RECEIVED') {
    const totalRecibido = lineas.reduce((s, l) => s + l.recibido, 0) + recibidasAhora
    const totalPerdido = lineas.reduce((s, l) => s + l.perdido, 0) + perdidasAhora
    await tx.inventoryTransfer.update({
      where: { id: traslado.id },
      data: { status: 'RECEIVED', closedAt: ahora, closedById: ctx.actorId, closeReason: perdidasAhora > 0 ? motivo.valor : null, receivedUnits: totalRecibido, returnedUnits: 0, lostUnits: totalPerdido },
    })
  } else if (traslado.status === 'SENT') {
    await tx.inventoryTransfer.update({ where: { id: traslado.id }, data: { status: 'PARTIAL' } })
  }
  await auditarInventario(
    tx,
    ctx,
    companyId,
    'INVENTORY_TRANSFERRED',
    traslado.id,
    { tipo: 'RECEPCION', traslado: traslado.number, recibidas: recibidasAhora, perdidas: perdidasAhora, enTransito: plan.pendienteDespues, estado: plan.estadoFinal, motivo: motivo.valor },
    'InventoryTransfer'
  )
  return { trasladoId: traslado.id, numero: traslado.number, estado: plan.estadoFinal, recibidas: recibidasAhora, perdidas: perdidasAhora, enTransito: plan.pendienteDespues, repetido: false }
}

/** Cancela la transferencia: lo que sigue en tránsito VUELVE al origen. Lo que ya llegó al destino se queda allí. */
export async function cancelarTrasladoEnTx(
  tx: Tx,
  companyId: string,
  e: { trasladoId: string; motivo?: string | null; ahora?: Date },
  ctx: ContextoAuditoria
): Promise<{ trasladoId: string; numero: string; devueltas: number; repetido: boolean }> {
  const motivo = normalizarTextoLibre(e.motivo, MAX_MOTIVO_TRASLADO, 'El motivo')
  if (!motivo.ok) fallo('MOTIVO_INVALIDO', motivo.error)
  const ahora = e.ahora ?? new Date()
  const traslado = await bloquearTraslado(tx, companyId, e.trasladoId)
  if (traslado.status === 'CANCELLED') return { trasladoId: traslado.id, numero: traslado.number, devueltas: 0, repetido: true }
  exigirTrasladoAbierto(traslado)

  const lineas = await lineasDeTraslado(tx, companyId, traslado.id)
  const devolver = planDeCancelacion(lineas)
  if (devolver.length === 0) fallo('NADA_QUE_DEVOLVER', 'Esta transferencia no tiene nada en camino que devolver.')
  const origen = await exigirSucursal(tx, companyId, traslado.fromLocationId, false)

  // Volver al origen es devolver lo que salió: se admite aunque la sucursal ya esté cerrada.
  const nivelDe = await crearSaldosEnOrden(tx, companyId, origen.id, devolver.map((d) => d.varianteId))
  const filas = await bloquear(tx, companyId, [...nivelDe.values()])
  const items: ItemLote[] = devolver.map((d) => {
    const fila = filas.get(nivelDe.get(d.varianteId)!)!
    const movimiento: Movimiento = { type: 'TRANSFER_IN', sourceBucket: null, destinationBucket: 'AVAILABLE', quantity: d.cantidad, reason: motivoDeDevolucion(traslado.number) }
    let despues
    try {
      despues = aplicarMovimiento(cubetasDeSaldo(fila), movimiento)
    } catch (err) {
      traducir(err, movimiento, fila)
    }
    return {
      nivelId: fila.id,
      movimiento,
      antes: { onHand: fila.onHand, reserved: fila.reserved, damaged: fila.damaged },
      despues: saldoDeCubetas(despues),
      meta: { userId: ctx.actorId, referencia: { tipo: 'TRANSFER', id: traslado.id } },
    }
  })
  await escribirMovimientosPorLote(tx, companyId, items)

  const devueltoDe = new Map(devolver.map((d) => [d.varianteId, d.cantidad]))
  const tocadas = lineas.filter((l) => devueltoDe.has(l.varianteId))
  const valores = tocadas.map((l) => Prisma.sql`(${l.id}, ${devueltoDe.get(l.varianteId)!}::int)`)
  const escritas = await tx.$executeRaw`
    UPDATE "inventory_transfer_lines" AS l
       SET "quantityReturned" = l."quantityReturned" + v."devuelto"
      FROM (VALUES ${Prisma.join(valores)}) AS v("id", "devuelto")
     WHERE l."id" = v."id" AND l."companyId" = ${companyId} AND l."transferId" = ${traslado.id}`
  if (escritas !== tocadas.length) fallo('LOTE_INCOMPLETO', 'No se pudieron actualizar todas las líneas de la transferencia.')

  const devueltas = devolver.reduce((s, d) => s + d.cantidad, 0)
  await tx.inventoryTransfer.update({
    where: { id: traslado.id },
    data: {
      status: 'CANCELLED',
      closedAt: ahora,
      closedById: ctx.actorId,
      closeReason: motivo.valor,
      receivedUnits: lineas.reduce((s, l) => s + l.recibido, 0),
      returnedUnits: devueltas,
      lostUnits: 0,
    },
  })
  await auditarInventario(
    tx,
    ctx,
    companyId,
    'INVENTORY_TRANSFERRED',
    traslado.id,
    { tipo: 'CANCELACION', traslado: traslado.number, devueltas, motivo: motivo.valor },
    'InventoryTransfer'
  )
  return { trasladoId: traslado.id, numero: traslado.number, devueltas, repetido: false }
}
