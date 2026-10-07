import { randomUUID } from 'node:crypto'
import { Prisma, type InventoryMovement, type InventoryMovementType, type InventoryReservation, type InventoryReservationStatus } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { normalizarCapacidades } from '@/modules/catalog/domain'
import { auditarInventario, type ContextoAuditoria } from './auditoria'
import {
  TTL_POR_DEFECTO_MINUTOS,
  aplicarMovimiento,
  cubetasDeSaldo,
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
import { fallo } from './errores'

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
  const [origenNivel, destinoNivel] = [
    await obtenerNivel(tx, companyId, variante.id, origen.id),
    await obtenerNivel(tx, companyId, variante.id, destino.id),
  ]
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
