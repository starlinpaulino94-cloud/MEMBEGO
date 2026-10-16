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
import { MOTIVO_DE_CONTEO, MOTIVO_REASIGNACION_DE_LOTE, resolverMotivo, type ClaseDeMotivo } from './motivos'
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
import {
  TIPOS_VALORADOS_AL_PROMEDIO,
  costoADecimal,
  costoDeDecimal,
  costoOpcional,
  formatearCosto,
  promedioPonderado,
  validarCorreccionDeCosto,
  type Costo,
} from './costos'
import { errorObjetivoContraUmbral, validarObjetivo } from './reposicion'
import { InventarioError, fallo } from './errores'
import {
  CODIGO_SIN_LOTE,
  asignacionDeReserva,
  disponibleDeLote,
  esCodigoSinLote,
  MAX_LOTES_POR_LINEA,
  fusionarReparto,
  ordenFefo,
  planDeBarrido,
  planDeConsumo,
  repartirFefo,
  repartoDeDevolucion,
  sumaDeReparto,
  validarCodigoDeLoteNuevo,
  validarLotesDeLinea,
  validarMovimientoEntreLotes,
  type LoteConSaldo,
  type LoteDeSaldo,
  type LoteDeLinea,
  type RepartoLote,
} from './lotes'
import { repartosPorCodigoEnTx } from './lotes-queries'
import { diaLocal } from '@/modules/reportes/rango'

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

/**
 * INV-4b · Lo que añaden los movimientos que se explican con un motivo del catálogo (ajuste, daño, baja): el CÓDIGO elegido y, si
 * quien llama es una pantalla, la orden de exigirlo. `motivo` (el de `EntradaBase`) pasa a ser el DETALLE en texto libre.
 */
export interface ConMotivoCodificado {
  motivoCodigo?: string | null
  /** Las pantallas lo exigen; los procesos y las pruebas que no eligen un motivo siguen escribiendo solo texto. */
  exigirMotivoCodificado?: boolean
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

/** INV-4b · El motivo de un ajuste, un daño o una baja: el código del catálogo (si se eligió) y el texto que queda en el movimiento. */
function motivoCodificado(e: EntradaBase & ConMotivoCodificado, clase: ClaseDeMotivo): { codigo: string | null; texto: string | null } {
  const r = resolverMotivo({ clase, codigo: e.motivoCodigo, detalle: e.motivo, exigirCodigo: e.exigirMotivoCodificado === true, textoObligatorio: true })
  if (!r.ok) fallo(r.codigo, r.error)
  return { codigo: r.codigo, texto: r.texto }
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
  // INV-5a: SIEMPRE antes que los candados de saldos (ver `candadoDeLotes`): ese orden fijo es lo que evita los ciclos.
  await candadoDeLotes(tx, companyId, false)
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

// ── INV-5a · Lotes y vencimiento ─────────────────────────────────────────────

/**
 * CANDADO DE EMPRESA PARA LOS LOTES. Cada operación sobre un saldo toma este candado COMPARTIDO (muchas a la vez, sin estorbarse);
 * activar los lotes de un producto lo toma EXCLUSIVO: espera a que terminen las operaciones en curso y no deja entrar otras hasta
 * confirmar. Sin él, una venta que decidió «este producto no lleva lotes» y una activación recién confirmada se cruzarían (la base
 * lo rechazaría al cerrar, pero como un error en vez de una espera). Se toma SIEMPRE antes que los candados de los saldos.
 */
async function candadoDeLotes(tx: Tx, companyId: string, exclusivo: boolean): Promise<void> {
  const llave = `inventory_lots:${companyId}`
  if (exclusivo) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${llave}, 0))`
  else await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${llave}, 0))`
}

/** Un producto que lleva lotes: si exige vencimiento y cuál es su lote «SIN LOTE». */
interface PoliticaDeLotes {
  exigirVencimiento: boolean
  legadoId: string
}

/**
 * Qué productos llevan lotes, recordado por transacción: un lote de 200 líneas pregunta por cada producto una sola vez. Es seguro
 * porque el único cambio posible (activar) toma el candado EXCLUSIVO de la empresa y olvida lo recordado (`activarLotesEnTx`).
 */
const politicasPorTx = new WeakMap<Tx, Map<string, PoliticaDeLotes | null>>()

/** `null` = el producto no lleva lotes. */
async function politicaDeLotes(tx: Tx, companyId: string, varianteId: string): Promise<PoliticaDeLotes | null> {
  let memo = politicasPorTx.get(tx)
  if (!memo) {
    memo = new Map()
    politicasPorTx.set(tx, memo)
  }
  const recordada = memo.get(varianteId)
  if (recordada !== undefined) return recordada
  const t = await tx.inventoryLotTracking.findUnique({ where: { catalogVariantId: varianteId }, select: { companyId: true, requiresExpiry: true } })
  let politica: PoliticaDeLotes | null = null
  if (t) {
    if (t.companyId !== companyId) fallo('NIVEL_AJENO', 'El producto no pertenece a esta empresa.')
    const legado = await tx.inventoryLot.findFirst({ where: { catalogVariantId: varianteId, companyId, legacy: true }, select: { id: true } })
    if (!legado) fallo('LOTE_LEGADO_FALTA', 'Este producto lleva lotes pero no tiene su lote «SIN LOTE». Avisa a soporte.')
    politica = { exigirVencimiento: t.requiresExpiry, legadoId: legado.id }
  }
  memo.set(varianteId, politica)
  return politica
}

/** El día de HOY en el calendario de la empresa (su zona horaria), como `YYYY-MM-DD`. */
async function hoyDeEmpresa(tx: Tx, companyId: string, ahora: Date): Promise<string> {
  const c = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
  return diaLocal(ahora, c?.zonaHoraria ?? '')
}

/** Los lotes de un saldo con lo que hay de cada uno (las tres cubetas). Quien llama tiene el saldo bloqueado. */
async function cargarLotesDeNivel(tx: Tx, companyId: string, nivelId: string): Promise<LoteConSaldo[]> {
  const filas = await tx.$queryRaw<
    { loteId: string; codigo: string; vencimiento: string | null; legado: boolean; creadoEn: number; onHand: number; reserved: number; damaged: number }[]
  >`
    SELECT b."lotId" AS "loteId", l."code" AS "codigo", l."expiresOn"::text AS "vencimiento", l."legacy" AS "legado",
           (EXTRACT(EPOCH FROM l."createdAt") * 1000)::float8 AS "creadoEn", b."onHand", b."reserved", b."damaged"
      FROM "inventory_lot_balances" b
      JOIN "inventory_lots" l ON l."id" = b."lotId"
     WHERE b."inventoryLevelId" = ${nivelId} AND b."companyId" = ${companyId}`
  return filas.map((f) => ({ ...f, creadoEn: Number(f.creadoEn) }))
}

/** El mensaje cuando no alcanza lo VENDIBLE de un producto con lotes (lo vencido no cuenta, y se dice cuánto hay). */
function faltaVendible(pides: number, vendible: number, vencido: number, apartado: number): never {
  const apartadas = apartado > 0 ? ` (${apartado} más están apartadas)` : ''
  const vencidas = vencido > 0 ? `; otras ${vencido} están vencidas y no se pueden vender` : ''
  fallo('STOCK_INSUFICIENTE', `No hay suficiente: pides ${pides} y hay ${vendible} disponible(s) para vender${apartadas}${vencidas}.`)
}

/**
 * Crea (si faltan) los lotes que una entrada trae y devuelve el id de cada código. «SIN LOTE» es el legado. Un lote es de UN producto
 * y tiene UN vencimiento: si ya existía con otro, se rechaza (el vencimiento de un lote no se reescribe). Se crean en orden de código
 * y con `skipDuplicates`: dos entradas simultáneas del mismo lote nuevo no chocan ni se interbloquean.
 */
async function asegurarLotes(tx: Tx, companyId: string, varianteId: string, politica: PoliticaDeLotes, lotes: readonly LoteDeLinea[], userId: string | null): Promise<Map<string, string>> {
  const ids = new Map<string, string>()
  const conCodigo = lotes.filter((l) => !esCodigoSinLote(l.codigo))
  for (const l of lotes) if (esCodigoSinLote(l.codigo)) ids.set(l.codigo, politica.legadoId)
  if (conCodigo.length === 0) return ids
  for (const l of conCodigo) {
    const nuevo = validarCodigoDeLoteNuevo(l.codigo)
    if (!nuevo.ok) fallo('LOTE_INVALIDO', nuevo.error)
  }
  const ordenados = [...conCodigo].sort((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0))
  await tx.inventoryLot.createMany({
    data: ordenados.map((l) => ({ companyId, catalogVariantId: varianteId, code: l.codigo, expiresOn: l.vencimiento === null ? null : new Date(`${l.vencimiento}T00:00:00.000Z`), createdBy: userId })),
    skipDuplicates: true,
  })
  const existentes = await tx.inventoryLot.findMany({
    where: { companyId, catalogVariantId: varianteId, code: { in: ordenados.map((l) => l.codigo) } },
    select: { id: true, code: true, expiresOn: true },
  })
  const por = new Map(existentes.map((x) => [x.code, x]))
  for (const l of ordenados) {
    const x = por.get(l.codigo)
    if (!x) fallo('LOTE_NO_ENCONTRADO', `No se pudo preparar el lote ${l.codigo}.`)
    const guardado = x.expiresOn === null ? null : x.expiresOn.toISOString().slice(0, 10)
    if (guardado !== l.vencimiento) {
      fallo('LOTE_VENCIMIENTO_DISTINTO', `El lote ${l.codigo} ya existe ${guardado === null ? 'sin vencimiento' : `y vence el ${guardado}`}: un lote tiene un solo vencimiento.`)
    }
    ids.set(l.codigo, x.id)
  }
  return ids
}

/**
 * Escribe el REPARTO de un movimiento entre lotes: crea (si faltan) los saldos por lote en cero y los renglones del reparto. El
 * saldo de cada lote lo mueve la BASE con el reparto (ver la migración `20261068`); aquí solo se dice de qué lotes es el movimiento.
 */
async function escribirRepartos(tx: Tx, companyId: string, varianteId: string, filas: readonly { nivelId: string; movimientoId: string; reparto: readonly RepartoLote[] }[]): Promise<void> {
  const saldos = new Map<string, { inventoryLevelId: string; lotId: string }>()
  for (const f of filas) for (const r of f.reparto) saldos.set(`${f.nivelId}|${r.loteId}`, { inventoryLevelId: f.nivelId, lotId: r.loteId })
  const ordenados = [...saldos.values()].sort((a, b) => (a.inventoryLevelId !== b.inventoryLevelId ? (a.inventoryLevelId < b.inventoryLevelId ? -1 : 1) : a.lotId < b.lotId ? -1 : a.lotId > b.lotId ? 1 : 0))
  await tx.inventoryLotBalance.createMany({ data: ordenados.map((x) => ({ companyId, catalogVariantId: varianteId, ...x })), skipDuplicates: true })
  await tx.inventoryMovementLot.createMany({
    data: filas.flatMap((f) => f.reparto.map((r) => ({ companyId, movementId: f.movimientoId, inventoryLevelId: f.nivelId, lotId: r.loteId, quantity: r.cantidad }))),
  })
}

/**
 * Lo que quien llama dice de los lotes de un movimiento de UN producto con lotes:
 *   · ENTRANTE: de qué lotes es lo que entra, por CÓDIGO (se crean si faltan): `[{ codigo, vencimiento?, cantidad }]`.
 *   · SALIENTE: de qué lotes sale, por ID de lote: `[{ loteId, cantidad }]`. Sin esto, sale por FEFO (lo que antes vence).
 *   · DEVOLUCION: vuelve a los lotes de que salió en esa referencia (un pedido); lo que no explique, al lote «SIN LOTE».
 * Si el producto no lleva lotes, ninguno de los tres puede venir con contenido.
 */
export type PeticionDeLotes = { tipo: 'ENTRANTE'; lotes: unknown } | { tipo: 'SALIENTE'; lotes: unknown } | { tipo: 'DEVOLUCION'; referencia: Referencia | null }

const sinContenido = (v: unknown) => v === undefined || v === null || (Array.isArray(v) && v.length === 0)

/**
 * Lo que el movimiento de una referencia sacó de cada lote y todavía no volvió (ventas menos devoluciones), en el orden en que salió
 * (a igual momento, primero el lote que antes vence: es el que FEFO tocó primero).
 */
async function vendidoPorLote(tx: Tx, companyId: string, nivelId: string, referencia: Referencia): Promise<RepartoLote[]> {
  const filas = await tx.$queryRaw<{ loteId: string; neto: number }[]>`
    SELECT ml."lotId" AS "loteId", SUM(CASE WHEN m."type" = 'SALE' THEN ml."quantity" ELSE -ml."quantity" END)::int AS "neto"
      FROM "inventory_movement_lots" ml
      JOIN "inventory_movements" m ON m."id" = ml."movementId"
      JOIN "inventory_lots" l ON l."id" = ml."lotId"
     WHERE m."companyId" = ${companyId} AND m."inventoryLevelId" = ${nivelId}
       AND m."referenceType" = ${referencia.tipo} AND m."referenceId" = ${referencia.id}
       AND m."type" IN ('SALE', 'RETURN')
     GROUP BY ml."lotId", l."expiresOn"
     ORDER BY MIN(m."createdAt"), l."expiresOn" NULLS LAST, ml."lotId"`
  return filas.filter((f) => Number(f.neto) > 0).map((f) => ({ loteId: f.loteId, cantidad: Number(f.neto) }))
}

/** Valida un reparto de SALIDA elegido por quien captura (por id de lote) contra lo que cada lote tiene en la cubeta de la que sale. */
function validarRepartoSalida(crudo: unknown, cantidad: number, lotes: readonly LoteConSaldo[], cubeta: 'AVAILABLE' | 'RESERVED' | 'DAMAGED', nombre: string): RepartoLote[] {
  if (!Array.isArray(crudo) || crudo.length === 0) fallo('LOTES_FALTAN', `«${nombre}» lleva lotes: indica de qué lote sale.`)
  if (crudo.length > MAX_LOTES_POR_LINEA) fallo('DEMASIADOS_LOTES', `Se admiten hasta ${MAX_LOTES_POR_LINEA} lotes por movimiento.`)
  const pedido: RepartoLote[] = []
  for (const x of crudo as unknown[]) {
    const l = x as { loteId?: unknown; cantidad?: unknown } | null
    if (typeof l?.loteId !== 'string' || l.loteId === '') fallo('LOTE_INVALIDO', 'Uno de los lotes no está bien indicado.')
    pedido.push({ loteId: l.loteId, cantidad: cantidadValida(l.cantidad) })
  }
  const reparto = fusionarReparto(pedido)
  if (sumaDeReparto(reparto) !== cantidad) fallo('LOTES_NO_CUADRAN', `Los lotes suman ${sumaDeReparto(reparto)} unidades y el movimiento es de ${cantidad}.`)
  const por = new Map(lotes.map((l) => [l.loteId, l]))
  for (const r of reparto) {
    const lote = por.get(r.loteId)
    if (!lote) fallo('LOTE_NO_ENCONTRADO', 'Ese lote no tiene existencias en esta sucursal.')
    const tiene = cubeta === 'AVAILABLE' ? disponibleDeLote(lote) : cubeta === 'DAMAGED' ? lote.damaged : lote.reserved
    if (r.cantidad > tiene) {
      const que = cubeta === 'DAMAGED' ? 'dañada(s)' : cubeta === 'RESERVED' ? 'apartada(s)' : 'disponible(s)'
      fallo('STOCK_INSUFICIENTE', `El lote ${lote.codigo} solo tiene ${Math.max(0, tiene)} unidad(es) ${que}; no se pueden usar ${r.cantidad}.`)
    }
  }
  return reparto
}

/**
 * De qué lotes es un movimiento. `undefined` = el producto no lleva lotes (el movimiento no se reparte). Quien llama tiene el saldo
 * BLOQUEADO. Lo que entra, por código (se crean los lotes que falten) o, sin indicarlo, al lote «SIN LOTE» (salvo una compra, que
 * debe decir de qué lote es); lo que sale, por los lotes elegidos o por FEFO (lo que antes vence; lo vencido no se vende).
 */
async function resolverReparto(
  tx: Tx,
  companyId: string,
  c: { nivelId: string; varianteId: string; nombre: string },
  m: Pick<Movimiento, 'type' | 'sourceBucket' | 'destinationBucket' | 'quantity'>,
  peticion: PeticionDeLotes | undefined,
  ahora: Date,
  userId: string | null
): Promise<RepartoLote[] | undefined> {
  const politica = await politicaDeLotes(tx, companyId, c.varianteId)
  if (!politica) {
    if (peticion && peticion.tipo !== 'DEVOLUCION' && !sinContenido(peticion.lotes)) fallo('LOTES_NO_APLICAN', `«${c.nombre}» no lleva lotes: quita el lote o actívalos en su ficha de inventario.`)
    return undefined
  }
  const cantidad = m.quantity
  // ENTRA desde fuera.
  if (m.sourceBucket === null) {
    if (peticion?.tipo === 'ENTRANTE' && !sinContenido(peticion.lotes)) {
      const r = validarLotesDeLinea(peticion.lotes, cantidad, { exigirVencimiento: politica.exigirVencimiento })
      if (!r.ok) fallo(r.codigo, `«${c.nombre}»: ${r.error}`)
      const ids = await asegurarLotes(tx, companyId, c.varianteId, politica, r.lotes, userId)
      return fusionarReparto(r.lotes.map((x) => ({ loteId: ids.get(x.codigo)!, cantidad: x.cantidad })))
    }
    if (m.type === 'PURCHASE') fallo('LOTES_FALTAN', `«${c.nombre}» lleva lotes: indica de qué lote es lo que entra (o «SIN LOTE»).`)
    if (m.type === 'RETURN' && peticion?.tipo === 'DEVOLUCION' && peticion.referencia) {
      return repartoDeDevolucion(await vendidoPorLote(tx, companyId, c.nivelId, peticion.referencia), cantidad, politica.legadoId)
    }
    return [{ loteId: politica.legadoId, cantidad }]
  }
  // SALE de una cubeta del saldo.
  const lotes = await cargarLotesDeNivel(tx, companyId, c.nivelId)
  if (peticion?.tipo === 'SALIENTE' && !sinContenido(peticion.lotes)) return validarRepartoSalida(peticion.lotes, cantidad, lotes, m.sourceBucket, c.nombre)
  if (m.sourceBucket === 'AVAILABLE') {
    const r = repartirFefo(lotes, cantidad, await hoyDeEmpresa(tx, companyId, ahora))
    if (!r.ok) faltaVendible(cantidad, r.vendible, r.vencido, lotes.reduce((s, l) => s + l.reserved, 0))
    return r.reparto
  }
  if (m.sourceBucket === 'DAMAGED') {
    // Lo dañado sale primero de donde antes vence (lo vencido es lo primero que se da de baja).
    const reparto: RepartoLote[] = []
    let resto = cantidad
    for (const l of lotes.filter((x) => x.damaged > 0).sort(ordenFefo)) {
      if (resto === 0) break
      const toma = Math.min(resto, l.damaged)
      reparto.push({ loteId: l.loteId, cantidad: toma })
      resto -= toma
    }
    if (resto > 0) fallo('STOCK_INSUFICIENTE', `Solo hay ${lotes.reduce((s, l) => s + l.damaged, 0)} unidad(es) dañada(s); no se pueden usar ${cantidad}.`)
    return reparto
  }
  fallo('REPARTO_FALTANTE', 'Lo apartado se saca con el reparto de su reserva.')
}

/** Las unidades apartadas de una reserva, por lote, según el ledger (ver `asignacionDeReserva`). `undefined` si el producto no lleva lotes. */
async function repartoDeReserva(tx: Tx, companyId: string, r: Pick<InventoryReservation, 'id' | 'inventoryLevelId' | 'quantity'>): Promise<RepartoLote[] | undefined> {
  const nivel = await tx.inventoryLevel.findFirstOrThrow({ where: { id: r.inventoryLevelId, companyId }, select: { catalogVariantId: true } })
  const politica = await politicaDeLotes(tx, companyId, nivel.catalogVariantId)
  if (!politica) return undefined
  const filas = await tx.$queryRaw<{ loteId: string; neto: number }[]>`
    SELECT ml."lotId" AS "loteId", SUM(CASE WHEN m."type" = 'RESERVATION' THEN ml."quantity" ELSE -ml."quantity" END)::int AS "neto"
      FROM "inventory_movement_lots" ml
      JOIN "inventory_movements" m ON m."id" = ml."movementId"
     WHERE m."companyId" = ${companyId} AND m."inventoryLevelId" = ${r.inventoryLevelId}
       AND m."referenceType" = 'RESERVATION' AND m."referenceId" = ${r.id}
       AND m."type" IN ('RESERVATION', 'RESERVATION_RELEASE')
     GROUP BY ml."lotId"`
  const a = asignacionDeReserva(filas.map((f) => ({ loteId: f.loteId, cantidad: Number(f.neto) })), r.quantity, politica.legadoId)
  if (!a.ok) fallo('RESERVA_DESCUADRADA', `${a.error} Avisa a soporte.`)
  return a.reparto
}

/**
 * La MISMA clave con OTROS lotes no es un reintento: devuelve `false` si el movimiento previo se repartió distinto de lo que se pide
 * ahora. Solo compara cuando quien llama indicó lotes (sin indicarlos manda FEFO, y reintentar devuelve el movimiento de siempre).
 */
async function mismoRepartoQueElPrevio(tx: Tx, companyId: string, movimientoId: string, peticion: PeticionDeLotes | undefined, varianteId: string): Promise<boolean> {
  if (!peticion || peticion.tipo === 'DEVOLUCION' || sinContenido(peticion.lotes)) return true
  const previos = await tx.inventoryMovementLot.findMany({
    where: { companyId, movementId: movimientoId },
    select: { lotId: true, quantity: true, balance: { select: { lot: { select: { code: true } } } } },
  })
  if (previos.length === 0) return false // el movimiento previo no se repartió: el producto no llevaba lotes
  if (peticion.tipo === 'SALIENTE') {
    const pedido = Array.isArray(peticion.lotes) ? fusionarReparto((peticion.lotes as { loteId?: string; cantidad?: number }[]).map((x) => ({ loteId: String(x?.loteId), cantidad: Number(x?.cantidad) }))) : []
    return pedido.length === previos.length && pedido.every((x) => previos.some((p) => p.lotId === x.loteId && p.quantity === x.cantidad))
  }
  const cantidad = previos.reduce((s, p) => s + p.quantity, 0)
  const politica = await politicaDeLotes(tx, companyId, varianteId)
  const r = validarLotesDeLinea(peticion.lotes, cantidad, { exigirVencimiento: politica?.exigirVencimiento === true })
  return r.ok && r.lotes.length === previos.length && r.lotes.every((x) => previos.some((p) => p.balance.lot.code === x.codigo && p.quantity === x.cantidad))
}

/** Los flujos que todavía no reparten por lote se niegan a tocar un producto que los lleva (en vez de descuadrarlo). */
export async function exigirSinLotes(tx: Tx, companyId: string, varianteIds: readonly string[], operacion: string): Promise<void> {
  const unicos = [...new Set(varianteIds)]
  if (unicos.length === 0) return
  const con = await tx.inventoryLotTracking.findMany({ where: { companyId, catalogVariantId: { in: unicos } }, select: { variant: { select: { name: true, isDefault: true, item: { select: { name: true } } } } } })
  if (con.length === 0) return
  const nombres = con.map((c) => (c.variant.isDefault ? c.variant.item.name : `${c.variant.item.name} · ${c.variant.name}`))
  fallo('LOTES_NO_SOPORTADO', `${nombres.map((n) => `«${n}»`).join(', ')} ${nombres.length === 1 ? 'lleva' : 'llevan'} lotes y ${operacion} todavía no trabaja con lotes. Usa una entrada de mercancía, una venta, un ajuste o un daño, que sí los reparten.`)
}

interface MetaMovimiento {
  userId: string | null
  referencia?: Referencia | null
  idempotencyKey?: string | null
  /**
   * INV-3a: el costo unitario con que se valora el movimiento. `undefined` = que lo decida el tipo (una venta, devolución,
   * daño o ajuste se valoran con el promedio de ese instante; lo demás, sin costo); `null` = sin costo, aunque el tipo se
   * valoraría; un número = ese costo (el de una línea de entrada).
   */
  costo?: Costo | null
  /** INV-4b: el motivo del catálogo (solo un ajuste o un daño lo lleva). */
  motivoCodigo?: string | null
  /**
   * INV-5a: de qué lotes es el movimiento (suma su cantidad). OBLIGATORIO si el producto lleva lotes y prohibido si no: la puerta
   * lo comprueba, y la base lo vuelve a comprobar al cerrar la transacción.
   */
  reparto?: readonly RepartoLote[]
}

/**
 * El costo con que vale hoy cada producto: su promedio, o el de referencia de su ficha; null = no tiene costo. UNA consulta
 * para todos (las ventas y los conteos la pagan en cada movimiento). Es una LECTURA: no bloquea nada, así que una venta
 * nunca espera a una entrada que está moviendo el promedio.
 */
async function costosVigentes(tx: Tx, companyId: string, varianteIds: readonly string[]): Promise<Map<string, Costo | null>> {
  const unicos = [...new Set(varianteIds)]
  const salida = new Map<string, Costo | null>()
  if (unicos.length === 0) return salida
  const filas = await tx.$queryRaw<{ id: string; costo: Prisma.Decimal | null }[]>`
    SELECT v."id", COALESCE(c."averageCost", v."cost") AS "costo"
      FROM "catalog_variants" v
      LEFT JOIN "inventory_variant_costs" c ON c."catalogVariantId" = v."id" AND c."companyId" = v."companyId"
     WHERE v."companyId" = ${companyId} AND v."id" IN (${Prisma.join(unicos)})`
  for (const f of filas) salida.set(f.id, f.costo === null ? null : costoDeDecimal(f.costo))
  return salida
}

/** El costo con que se escribe un movimiento (ver `MetaMovimiento.costo`). */
function costoDeMovimiento(tipo: string, explicito: Costo | null | undefined, vigente: Costo | null | undefined): Costo | null {
  if (explicito !== undefined) return explicito
  return TIPOS_VALORADOS_AL_PROMEDIO.has(tipo) ? (vigente ?? null) : null
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
  if (meta.motivoCodigo && m.type !== 'ADJUSTMENT' && m.type !== 'DAMAGE') fallo('MOTIVO_NO_APLICA', 'Solo un ajuste o un daño se explica con un motivo del catálogo.')
  const nivel = await tx.inventoryLevel.findFirstOrThrow({ where: { id: nivelId, companyId } })
  // INV-5a: un producto con lotes reparte CADA movimiento entre sus lotes; uno sin lotes, nunca.
  const lotes = await politicaDeLotes(tx, companyId, nivel.catalogVariantId)
  if (lotes) {
    if (!meta.reparto || sumaDeReparto(meta.reparto) !== m.quantity) fallo('REPARTO_FALTANTE', 'Un movimiento de un producto con lotes debe indicar de qué lotes sale o entra, y la suma debe ser su cantidad.')
  } else if (meta.reparto) {
    fallo('LOTES_NO_APLICAN', 'Este producto no lleva lotes.')
  }
  const antes = cubetasDeSaldo(nivel)
  let despues
  try {
    despues = aplicarMovimiento(antes, m)
  } catch (e) {
    traducir(e, m, nivel)
  }
  const saldo = saldoDeCubetas(despues)
  const vigente = meta.costo === undefined && TIPOS_VALORADOS_AL_PROMEDIO.has(m.type) ? (await costosVigentes(tx, companyId, [nivel.catalogVariantId])).get(nivel.catalogVariantId) : undefined
  const costo = costoDeMovimiento(m.type, meta.costo, vigente)
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
      reasonCode: meta.motivoCodigo ?? null,
      userId: meta.userId,
      referenceType: meta.referencia?.tipo ?? null,
      referenceId: meta.referencia?.id ?? null,
      idempotencyKey: meta.idempotencyKey ?? null,
      unitCost: costo === null ? null : costoADecimal(costo),
    },
  })
  await tx.inventoryLevel.update({ where: { id: nivelId }, data: { onHand: saldo.onHand, reserved: saldo.reserved, damaged: saldo.damaged } })
  if (lotes && meta.reparto) await escribirRepartos(tx, companyId, nivel.catalogVariantId, [{ nivelId, movimientoId: movimiento.id, reparto: meta.reparto }])
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
  // INV-5a: lo apartado vuelve a los MISMOS lotes de que se apartó.
  const reparto = await repartoDeReserva(tx, companyId, r)
  await escribirMovimiento(
    tx,
    companyId,
    r.inventoryLevelId,
    { type: 'RESERVATION_RELEASE', sourceBucket: 'RESERVED', destinationBucket: 'AVAILABLE', quantity: r.quantity, reason: motivo },
    { userId, referencia: { tipo: 'RESERVATION', id: r.id }, reparto }
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

// ── INV-3a · Costo promedio ponderado ────────────────────────────────────────

interface CostoDeLinea {
  varianteId: string
  cantidad: number
  costo: Costo
}

/**
 * Mueve el costo PROMEDIO de los productos de una entrada que trae costo.
 *
 * Quien llama tiene bloqueados los saldos de la entrada y TODAVÍA NO ha escrito sus movimientos: las existencias que se
 * leen aquí son las de antes. Pesa todo lo que la empresa tiene del producto (vendible + apartado + dañado, en todas las
 * sucursales), no solo la sucursal que recibe.
 *
 * ORDEN DE BLOQUEO. Primero los saldos (quien llama), después el renglón de costo de cada producto, en orden de producto.
 * Los renglones que faltan se crean en ese mismo orden fijo: un `INSERT … ON CONFLICT` espera a la fila que otra
 * transacción acaba de insertar, y dos entradas con los mismos productos nuevos en distinto orden se interbloquearían
 * (es lo que pasó con los saldos en INV-2a). Las ventas solo LEEN el costo: nunca esperan por aquí.
 *
 * Una pequeña aproximación asumida: las existencias se leen sin bloquear las otras sucursales, así que una venta que
 * confirme en otra sucursal en el mismo instante puede mover el peso de lo viejo en, como mucho, las unidades de esa venta.
 */
async function aplicarCostosDeEntradaEnTx(tx: Tx, companyId: string, lineas: readonly CostoDeLinea[]): Promise<void> {
  if (lineas.length === 0) return
  const ordenadas = [...lineas].sort((a, b) => (a.varianteId < b.varianteId ? -1 : a.varianteId > b.varianteId ? 1 : 0))
  const ids = ordenadas.map((l) => l.varianteId)
  if (new Set(ids).size !== ids.length) fallo('LOTE_INVALIDO', 'Un producto no puede aparecer dos veces al mover el costo promedio.')

  const creados = await tx.inventoryVariantCost.createManyAndReturn({
    data: ordenadas.map((l) => ({ companyId, catalogVariantId: l.varianteId, averageCost: costoADecimal(l.costo) })),
    skipDuplicates: true,
    select: { catalogVariantId: true },
  })
  const nuevos = new Set(creados.map((c) => c.catalogVariantId))
  const bloqueados = await tx.$queryRaw<{ catalogVariantId: string; averageCost: Prisma.Decimal }[]>`
    SELECT "catalogVariantId", "averageCost"
      FROM "inventory_variant_costs"
     WHERE "companyId" = ${companyId} AND "catalogVariantId" IN (${Prisma.join(ids)})
     ORDER BY "catalogVariantId"
       FOR UPDATE`
  if (bloqueados.length !== ids.length) fallo('COSTO_NO_ENCONTRADO', 'No se pudo preparar el costo promedio de la entrada.')
  const promedioDe = new Map(bloqueados.map((b) => [b.catalogVariantId, costoDeDecimal(b.averageCost)]))

  const existencias = await tx.$queryRaw<{ catalogVariantId: string; unidades: number }[]>`
    SELECT "catalogVariantId", COALESCE(SUM("onHand" + "damaged"), 0)::int AS "unidades"
      FROM "inventory_levels"
     WHERE "companyId" = ${companyId} AND "catalogVariantId" IN (${Prisma.join(ids)})
     GROUP BY "catalogVariantId"`
  const unidadesDe = new Map(existencias.map((x) => [x.catalogVariantId, Number(x.unidades)]))
  const referencias = await tx.$queryRaw<{ id: string; cost: Prisma.Decimal | null }[]>`
    SELECT "id", "cost" FROM "catalog_variants" WHERE "companyId" = ${companyId} AND "id" IN (${Prisma.join(ids)})`
  const referenciaDe = new Map(referencias.map((r) => [r.id, r.cost === null ? null : costoDeDecimal(r.cost)]))

  const filas = ordenadas.map((l) => {
    const promedio = promedioPonderado(
      { unidades: unidadesDe.get(l.varianteId) ?? 0, promedio: nuevos.has(l.varianteId) ? null : (promedioDe.get(l.varianteId) ?? null), referencia: referenciaDe.get(l.varianteId) ?? null },
      { unidades: l.cantidad, costo: l.costo }
    )
    return Prisma.sql`(${l.varianteId}, ${costoADecimal(promedio)}::numeric, ${costoADecimal(l.costo)}::numeric)`
  })
  // `now() AT TIME ZONE 'UTC'` y no `now()`: la columna es `timestamp` sin zona y Prisma escribe en UTC.
  const actualizados = await tx.$executeRaw`
    UPDATE "inventory_variant_costs" AS t
       SET "averageCost" = v."promedio", "lastCost" = v."ultimo", "lastCostAt" = (now() AT TIME ZONE 'UTC'), "updatedAt" = (now() AT TIME ZONE 'UTC')
      FROM (VALUES ${Prisma.join(filas)}) AS v("id", "promedio", "ultimo")
     WHERE t."catalogVariantId" = v."id" AND t."companyId" = ${companyId}`
  if (actualizados !== ordenadas.length) fallo('LOTE_INCOMPLETO', 'No se pudo actualizar el costo promedio de todos los productos de la entrada.')
}

export interface ResultadoCorreccionCosto {
  varianteId: string
  /** El costo vigente antes de corregir (el promedio, o el de referencia del catálogo); null si no tenía. */
  costoAnterior: string | null
  costoNuevo: string
  /** Unidades de toda la empresa que valen distinto desde ahora. */
  unidades: number
}

/**
 * CORRIGE el costo promedio de un producto, con motivo. Es la salida de un costo mal capturado (un cero de más en una
 * entrada) y la forma de fijar el costo de lo que ya había antes de llevar costos. No toca el ledger: los movimientos
 * viejos conservan el costo con que se valoraron; lo que cambia es el costo con que vale el producto DESDE AHORA (el
 * valor del inventario y las próximas salidas). Deja una fila inmutable en el historial de correcciones y una en la bitácora.
 */
export async function corregirCostoEnTx(tx: Tx, companyId: string, e: { varianteId: string; costo: unknown; motivo: unknown }, ctx: ContextoAuditoria): Promise<ResultadoCorreccionCosto> {
  const v = validarCorreccionDeCosto(e.costo, e.motivo)
  if (!v.ok) fallo(v.codigo, v.error)
  const variante = await exigirVarianteControlada(tx, companyId, e.varianteId)
  // Solo un producto que ya ha tenido existencias: el costo de uno que nunca se ha recibido se escribe en su ficha del catálogo.
  const tuvoExistencias = await tx.inventoryLevel.findFirst({ where: { companyId, catalogVariantId: variante.id }, select: { id: true } })
  if (!tuvoExistencias) fallo('SIN_EXISTENCIAS_PREVIAS', 'Este producto todavía no ha tenido existencias. Escribe su costo de referencia en su ficha del catálogo.')

  const creados = await tx.inventoryVariantCost.createManyAndReturn({
    data: [{ companyId, catalogVariantId: variante.id, averageCost: costoADecimal(v.costo) }],
    skipDuplicates: true,
    select: { catalogVariantId: true },
  })
  const esNuevo = creados.length > 0
  const bloqueado = await tx.$queryRaw<{ averageCost: Prisma.Decimal }[]>`
    SELECT "averageCost" FROM "inventory_variant_costs"
     WHERE "companyId" = ${companyId} AND "catalogVariantId" = ${variante.id}
       FOR UPDATE`
  if (!bloqueado[0]) fallo('COSTO_NO_ENCONTRADO', 'No se pudo preparar el costo del producto.')
  const referencia = await tx.catalogVariant.findFirst({ where: { id: variante.id, companyId }, select: { cost: true } })
  const anterior: Costo | null = esNuevo ? (referencia?.cost ? costoDeDecimal(referencia.cost) : null) : costoDeDecimal(bloqueado[0].averageCost)
  if (!esNuevo && anterior === v.costo) fallo('SIN_CAMBIOS', 'El costo promedio ya es ese: no hay nada que corregir.')

  const existencias = await tx.$queryRaw<{ unidades: number }[]>`
    SELECT COALESCE(SUM("onHand" + "damaged"), 0)::int AS "unidades" FROM "inventory_levels"
     WHERE "companyId" = ${companyId} AND "catalogVariantId" = ${variante.id}`
  const unidades = Number(existencias[0]?.unidades ?? 0)
  if (!esNuevo) {
    await tx.inventoryVariantCost.update({ where: { catalogVariantId_companyId: { catalogVariantId: variante.id, companyId } }, data: { averageCost: costoADecimal(v.costo) } })
  }
  await tx.inventoryCostAdjustment.create({
    data: { companyId, catalogVariantId: variante.id, previousCost: anterior === null ? null : costoADecimal(anterior), newCost: costoADecimal(v.costo), unitsOnHand: unidades, reason: v.motivo, userId: ctx.actorId },
  })
  await auditarInventario(
    tx,
    ctx,
    companyId,
    'INVENTORY_CONFIGURED',
    variante.id,
    { tipo: 'COSTO', sku: variante.sku, producto: variante.item.name, antes: anterior === null ? null : formatearCosto(anterior), despues: formatearCosto(v.costo), unidades, motivo: v.motivo },
    'InventoryVariantCost'
  )
  return { varianteId: variante.id, costoAnterior: anterior === null ? null : formatearCosto(anterior), costoNuevo: formatearCosto(v.costo), unidades }
}

// ── Movimientos simples (un saldo, una dirección) ────────────────────────────

interface Plan {
  tipo: InventoryMovementType
  origen: Movimiento['sourceBucket']
  destino: Movimiento['destinationBucket']
  cantidad: number
  motivo: string | null
  /** INV-4b: el motivo del catálogo (ajuste, daño, baja). */
  motivoCodigo?: string | null
  /** Exige sucursal abierta (entradas); las salidas se permiten en una cerrada. */
  sucursalActiva: boolean
  /** Deja rastro en la bitácora de actividad (lo que hace una persona a mano). */
  auditar: boolean
  referenciaPorDefecto?: Referencia
  /** INV-3a: el costo unitario de una ENTRADA. Si viene, mueve el costo promedio del producto y valora el movimiento. */
  costoEntrada?: Costo
  /** INV-5a: lo que se indicó de los lotes (solo importa si el producto los lleva). */
  lotes?: PeticionDeLotes
}

async function moverSimple(tx: Tx, companyId: string, e: EntradaBase, plan: Plan, ctx: ContextoAuditoria): Promise<ResultadoMovimiento> {
  const ahora = e.ahora ?? new Date()
  const clave = claveValida(e.idempotencyKey)
  const variante = await exigirVarianteControlada(tx, companyId, e.varianteId)
  const sucursal = await exigirSucursal(tx, companyId, e.sucursalId, plan.sucursalActiva)
  const nivelId = await obtenerNivel(tx, companyId, variante.id, sucursal.id)

  const previo = await prepararNivel(tx, companyId, nivelId, clave, { type: plan.tipo, sourceBucket: plan.origen, destinationBucket: plan.destino, quantity: plan.cantidad }, ahora)
  if (previo) {
    if (!(await mismoRepartoQueElPrevio(tx, companyId, previo.id, plan.lotes, variante.id))) fallo('CLAVE_REUTILIZADA', 'Esa clave de idempotencia ya se usó para otra operación distinta.')
    return { nivelId, movimientoId: previo.id, saldo: await saldoActual(tx, companyId, nivelId), repetido: true }
  }

  // INV-5a: de qué lotes es el movimiento (si el producto los lleva).
  const reparto = await resolverReparto(
    tx,
    companyId,
    { nivelId, varianteId: variante.id, nombre: variante.item.name },
    { type: plan.tipo, sourceBucket: plan.origen, destinationBucket: plan.destino, quantity: plan.cantidad },
    plan.lotes,
    ahora,
    ctx.actorId
  )
  // El costo promedio se mueve ANTES de escribir el movimiento: las existencias que pesan son las de antes de esta entrada.
  if (plan.costoEntrada !== undefined) await aplicarCostosDeEntradaEnTx(tx, companyId, [{ varianteId: variante.id, cantidad: plan.cantidad, costo: plan.costoEntrada }])
  const { movimiento, saldo } = await escribirMovimiento(
    tx,
    companyId,
    nivelId,
    { type: plan.tipo, sourceBucket: plan.origen, destinationBucket: plan.destino, quantity: plan.cantidad, reason: plan.motivo },
    { userId: ctx.actorId, referencia: referenciaValida(e.referencia) ?? plan.referenciaPorDefecto ?? null, idempotencyKey: clave, costo: plan.costoEntrada, motivoCodigo: plan.motivoCodigo ?? null, reparto }
  )
  if (plan.auditar) {
    await auditarInventario(tx, ctx, companyId, 'INVENTORY_STOCK_CHANGED', nivelId, {
      tipo: plan.tipo,
      cantidad: plan.cantidad,
      motivo: plan.motivo,
      ...(plan.motivoCodigo ? { motivoCodigo: plan.motivoCodigo } : {}),
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
export async function recibirEnTx(tx: Tx, companyId: string, e: EntradaBase & { cantidad: number; costo?: unknown; lotes?: unknown }, ctx: ContextoAuditoria) {
  const costo = costoOpcional(e.costo)
  if (!costo.ok) fallo('COSTO_INVALIDO', costo.error)
  return moverSimple(
    tx,
    companyId,
    e,
    { tipo: 'PURCHASE', origen: null, destino: 'AVAILABLE', cantidad: cantidadValida(e.cantidad), motivo: motivoValido(e.motivo, false), sucursalActiva: true, auditar: true, costoEntrada: costo.valor ?? undefined, lotes: { tipo: 'ENTRANTE', lotes: e.lotes } },
    ctx
  )
}

/** El cliente devuelve mercancía: vuelve a lo vendible. */
export async function devolverEnTx(tx: Tx, companyId: string, e: EntradaBase & { cantidad: number; lotes?: unknown }, ctx: ContextoAuditoria) {
  // INV-5a: con lotes, vuelve a los lotes de que salió en esa referencia (un pedido); los lotes explícitos mandan sobre eso.
  const lotes: PeticionDeLotes = sinContenido(e.lotes) ? { tipo: 'DEVOLUCION', referencia: referenciaValida(e.referencia) } : { tipo: 'ENTRANTE', lotes: e.lotes }
  return moverSimple(tx, companyId, e, { tipo: 'RETURN', origen: null, destino: 'AVAILABLE', cantidad: cantidadValida(e.cantidad), motivo: motivoValido(e.motivo, false), sucursalActiva: true, auditar: true, lotes }, ctx)
}

/**
 * Venta directa (mostrador, sin reserva previa): sale de lo vendible. La llama
 * el sistema (caja, pedidos), no el panel: no deja rastro en la bitácora de
 * actividad —el ledger ya lo tiene—.
 */
export async function venderEnTx(tx: Tx, companyId: string, e: EntradaBase & { cantidad: number; lotesSalida?: unknown }, ctx: ContextoAuditoria) {
  return moverSimple(
    tx,
    companyId,
    e,
    { tipo: 'SALE', origen: 'AVAILABLE', destino: null, cantidad: cantidadValida(e.cantidad), motivo: motivoValido(e.motivo, false), sucursalActiva: false, auditar: false, lotes: { tipo: 'SALIENTE', lotes: e.lotesSalida } },
    ctx
  )
}

/** Se daña mercancía vendible: pasa a la cubeta de dañado (no se vende). */
export async function danarEnTx(tx: Tx, companyId: string, e: EntradaBase & ConMotivoCodificado & { cantidad: number; lotesSalida?: unknown }, ctx: ContextoAuditoria) {
  const m = motivoCodificado(e, 'DANO')
  return moverSimple(
    tx,
    companyId,
    e,
    { tipo: 'DAMAGE', origen: 'AVAILABLE', destino: 'DAMAGED', cantidad: cantidadValida(e.cantidad), motivo: m.texto, motivoCodigo: m.codigo, sucursalActiva: false, auditar: true, lotes: { tipo: 'SALIENTE', lotes: e.lotesSalida } },
    ctx
  )
}

/**
 * Corrige un descuadre: `cambio` positivo = sobrante, negativo = faltante. Solo
 * toca lo vendible: lo apartado se libera o se consume, no se «ajusta».
 */
export async function ajustarEnTx(tx: Tx, companyId: string, e: EntradaBase & ConMotivoCodificado & { cambio: number; lotes?: unknown; lotesSalida?: unknown }, ctx: ContextoAuditoria) {
  if (typeof e.cambio !== 'number' || !Number.isInteger(e.cambio) || e.cambio === 0) fallo('CANTIDAD_INVALIDA', 'El ajuste debe ser un número entero distinto de cero.')
  const cantidad = cantidadValida(Math.abs(e.cambio))
  const sube = e.cambio > 0
  const m = motivoCodificado(e, sube ? 'SOBRANTE' : 'FALTANTE')
  // INV-5a: un sobrante dice de qué lote es (sin decirlo, va al «SIN LOTE»); un faltante, de cuál sale (sin decirlo, por FEFO).
  const lotes: PeticionDeLotes = sube ? { tipo: 'ENTRANTE', lotes: e.lotes } : { tipo: 'SALIENTE', lotes: e.lotesSalida }
  return moverSimple(
    tx,
    companyId,
    e,
    { tipo: 'ADJUSTMENT', origen: sube ? null : 'AVAILABLE', destino: sube ? 'AVAILABLE' : null, cantidad, motivo: m.texto, motivoCodigo: m.codigo, sucursalActiva: sube, auditar: true, lotes },
    ctx
  )
}

/**
 * Lo dañado se resuelve: resultó vendible (vuelve a lo vendible) o se da de baja
 * (sale del inventario). Es un ajuste, y por eso lleva motivo.
 */
export async function resolverDanadoEnTx(tx: Tx, companyId: string, e: EntradaBase & ConMotivoCodificado & { cantidad: number; destino: 'VENDIBLE' | 'BAJA'; lotesSalida?: unknown }, ctx: ContextoAuditoria) {
  if (e.destino !== 'VENDIBLE' && e.destino !== 'BAJA') fallo('MOVIMIENTO_INVALIDO', 'Indica si lo dañado vuelve a venderse o se da de baja.')
  // Recuperar lo dañado no es una pérdida: no lleva motivo del catálogo (solo el texto). Dar de baja sí.
  if (e.destino === 'VENDIBLE' && e.motivoCodigo) fallo('MOTIVO_NO_APLICA', 'Recuperar lo dañado no es una pérdida: no lleva motivo del catálogo.')
  const m = e.destino === 'BAJA' ? motivoCodificado(e, 'BAJA') : { codigo: null, texto: motivoValido(e.motivo, true) }
  return moverSimple(
    tx,
    companyId,
    e,
    { tipo: 'ADJUSTMENT', origen: 'DAMAGED', destino: e.destino === 'VENDIBLE' ? 'AVAILABLE' : null, cantidad: cantidadValida(e.cantidad), motivo: m.texto, motivoCodigo: m.codigo, sucursalActiva: false, auditar: true, lotes: { tipo: 'SALIENTE', lotes: e.lotesSalida } },
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
  await exigirSinLotes(tx, companyId, [variante.id], 'el conteo')
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
    { userId: ctx.actorId, referencia: { tipo: 'STOCK_COUNT', id: randomUUID() }, motivoCodigo: MOTIVO_DE_CONTEO }
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
  await exigirSinLotes(tx, companyId, [variante.id], 'la transferencia entre sucursales')
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
  // INV-5a: con lotes se aparta por FEFO y solo de lo que no ha vencido; sin lotes, de lo disponible.
  const reparto = await resolverReparto(
    tx,
    companyId,
    { nivelId, varianteId: variante.id, nombre: variante.item.name },
    { type: 'RESERVATION', sourceBucket: 'AVAILABLE', destinationBucket: 'RESERVED', quantity: cantidad },
    undefined,
    ahora,
    ctx.actorId
  )
  if (!reparto && disponible(nivel) < cantidad) {
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
    { userId: ctx.actorId, referencia: { tipo: 'RESERVATION', id: reserva.id }, idempotencyKey: clave, reparto }
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
  // INV-5a: se vende de los lotes en que se apartó. Si alguno venció entretanto NO se entrega vencido: se libera y se aparta de nuevo
  // del siguiente lote que sí se vende (si no hay con qué reponerlo, la venta no se puede completar).
  let reparto = await repartoDeReserva(tx, companyId, r)
  if (reparto) {
    const lotes = await cargarLotesDeNivel(tx, companyId, r.inventoryLevelId)
    const plan = planDeConsumo(reparto, lotes, await hoyDeEmpresa(tx, companyId, ahora))
    if (!plan.ok) fallo('LOTES_VENCIDOS', 'Los lotes de lo apartado ya vencieron y no hay otros vigentes para reponerlos. Repón el stock o cancela el pedido.')
    if (plan.liberar.length > 0) {
      const ref = { tipo: 'RESERVATION', id: r.id }
      const motivoCambio = 'Lote vencido: se repone con otro lote'
      await escribirMovimiento(tx, companyId, r.inventoryLevelId, { type: 'RESERVATION_RELEASE', sourceBucket: 'RESERVED', destinationBucket: 'AVAILABLE', quantity: sumaDeReparto(plan.liberar), reason: motivoCambio }, { userId: ctx.actorId, referencia: ref, reparto: plan.liberar })
      await escribirMovimiento(tx, companyId, r.inventoryLevelId, { type: 'RESERVATION', sourceBucket: 'AVAILABLE', destinationBucket: 'RESERVED', quantity: sumaDeReparto(plan.reapartar), reason: motivoCambio }, { userId: ctx.actorId, referencia: ref, reparto: plan.reapartar })
    }
    reparto = plan.vender
  }
  const { movimiento, saldo } = await escribirMovimiento(
    tx,
    companyId,
    r.inventoryLevelId,
    { type: 'SALE', sourceBucket: 'RESERVED', destinationBucket: null, quantity: r.quantity, reason: null },
    { userId: ctx.actorId, referencia, reparto }
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
  // INV-3c: con «llenar hasta» definido, el umbral tiene que quedar por debajo (si no, Reposición no pediría nada).
  const { targetStock } = await tx.inventoryLevel.findUniqueOrThrow({ where: { id: nivelId }, select: { targetStock: true } })
  const choque = errorObjetivoContraUmbral({ umbral: u.valor, llenarHasta: targetStock, sucursal: sucursal.nombre })
  if (choque) fallo('UMBRAL_MAYOR_QUE_OBJETIVO', choque)
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

/**
 * INV-3c · Fija el «llenar hasta» de una variante en una sucursal (0 = sin objetivo: no aparece en Reposición). Tiene que
 * quedar por encima del umbral de aviso de ese saldo, si lo hay. Repetirlo con el mismo valor no hace nada ni se audita.
 */
export async function configurarObjetivoEnTx(
  tx: Tx,
  companyId: string,
  e: { varianteId: string; sucursalId: string; llenarHasta: number },
  ctx: ContextoAuditoria
): Promise<{ nivelId: string; llenarHasta: number }> {
  const o = validarObjetivo(e.llenarHasta)
  if (!o.ok) fallo('OBJETIVO_INVALIDO', o.error)
  const variante = await exigirVarianteControlada(tx, companyId, e.varianteId)
  const sucursal = await exigirSucursal(tx, companyId, e.sucursalId, false)
  const nivelId = await obtenerNivel(tx, companyId, variante.id, sucursal.id)
  const [fila] = [...(await bloquear(tx, companyId, [nivelId])).values()]
  const { targetStock } = await tx.inventoryLevel.findUniqueOrThrow({ where: { id: nivelId }, select: { targetStock: true } })
  if (targetStock === o.valor) return { nivelId, llenarHasta: o.valor }
  const choque = errorObjetivoContraUmbral({ umbral: fila.lowStockThreshold, llenarHasta: o.valor, sucursal: sucursal.nombre })
  if (choque) fallo('OBJETIVO_MENOR_QUE_UMBRAL', choque)
  await tx.inventoryLevel.update({ where: { id: nivelId }, data: { targetStock: o.valor } })
  await auditarInventario(tx, ctx, companyId, 'INVENTORY_CONFIGURED', nivelId, {
    sku: variante.sku,
    producto: variante.item.name,
    sucursal: sucursal.nombre,
    antes: { llenarHasta: targetStock },
    despues: { llenarHasta: o.valor },
  })
  return { nivelId, llenarHasta: o.valor }
}

/**
 * INV-3c · Aplica el MISMO «llenar hasta» a las demás sucursales ACTIVAS donde la variante ya tiene un saldo (igual que el
 * umbral: no se crean saldos en cero donde el producto nunca estuvo). Cada sucursal pasa por `configurarObjetivoEnTx`, así
 * que repetirlo es inofensivo; si en alguna el umbral lo impide, todo se deshace y el mensaje dice cuál. Devuelve en cuántas
 * hubo un cambio real.
 */
export async function configurarObjetivoOtrasSucursalesEnTx(
  tx: Tx,
  companyId: string,
  e: { varianteId: string; sucursalOrigenId: string; llenarHasta: number },
  ctx: ContextoAuditoria
): Promise<{ sucursales: number }> {
  const o = validarObjetivo(e.llenarHasta)
  if (!o.ok) fallo('OBJETIVO_INVALIDO', o.error)
  const variante = await exigirVarianteControlada(tx, companyId, e.varianteId)
  const otras = await tx.inventoryLevel.findMany({
    where: { companyId, catalogVariantId: variante.id, locationId: { not: e.sucursalOrigenId }, location: { activa: true } },
    select: { locationId: true, targetStock: true },
    orderBy: { id: 'asc' },
  })
  let cambiadas = 0
  for (const n of otras) {
    if (n.targetStock === o.valor) continue
    await configurarObjetivoEnTx(tx, companyId, { varianteId: variante.id, sucursalId: n.locationId, llenarHasta: o.valor }, ctx)
    cambiadas++
  }
  return { sucursales: cambiadas }
}

// ── INV-5a · Activar los lotes de un producto ────────────────────────────────

export interface ResultadoActivarLotes {
  varianteId: string
  /** El lote «SIN LOTE» del producto. */
  legadoId: string
  /** Sucursales con existencias que pasaron al lote «SIN LOTE». */
  sucursales: number
  /** Unidades (vendibles + apartadas + dañadas) que pasaron al lote «SIN LOTE». */
  unidades: number
  /** true si el producto ya llevaba lotes: no se hizo nada. */
  repetido: boolean
}

/**
 * ACTIVA los lotes de un producto. Es de UN SOLO SENTIDO (por ahora): desde aquí cada unidad es de un lote y cada movimiento se
 * reparte entre lotes. Lo que ya había (en todas las sucursales, en sus tres cubetas) pasa íntegro al lote «SIN LOTE» como una
 * APERTURA: el saldo de partida de cada saldo por lote, del que sale cualquier saldo posterior.
 *
 * CONCURRENCIA. Toma el candado EXCLUSIVO de lotes de la empresa (espera a que terminen las operaciones en curso y no deja entrar
 * otras hasta confirmar) y luego bloquea todos los saldos del producto. Por eso lo que se lee aquí no cambia mientras se activa.
 *
 * NO SE ACTIVA con trabajo a medias que no sabe de lotes: un conteo abierto o una transferencia en tránsito que incluya el producto
 * (esos flujos todavía no reparten por lote; ciérralos y vuelve). Una ORDEN DE COMPRA abierta sí deja activar (INV-5b2): se pide por
 * producto y los lotes se dicen al recibir, de modo que lo que llegue después entra con su lote. Y no se activa si lo apartado de
 * un saldo no coincide con la suma de sus reservas vivas: la apertura copiaría un descuadre.
 */
export async function activarLotesEnTx(
  tx: Tx,
  companyId: string,
  e: { varianteId: string; exigirVencimiento?: boolean; ahora?: Date },
  ctx: ContextoAuditoria
): Promise<ResultadoActivarLotes> {
  const ahora = e.ahora ?? new Date()
  const variante = await exigirVarianteControlada(tx, companyId, e.varianteId)
  const nombre = variante.item.name
  await candadoDeLotes(tx, companyId, true)
  // Lo recordado de este producto ya no vale: se lee de nuevo bajo el candado.
  politicasPorTx.get(tx)?.delete(variante.id)

  const ya = await politicaDeLotes(tx, companyId, variante.id)
  if (ya) return { varianteId: variante.id, legadoId: ya.legadoId, sucursales: 0, unidades: 0, repetido: true }

  const abiertos = await tx.inventoryCountLine.findFirst({ where: { companyId, catalogVariantId: variante.id, session: { status: 'OPEN' } }, select: { session: { select: { number: true } } } })
  if (abiertos) fallo('ACTIVAR_CON_CONTEO_ABIERTO', `«${nombre}» está en el conteo ${abiertos.session.number}, que sigue abierto. Aplícalo o cancélalo y vuelve a intentar.`)
  const enTransito = await tx.inventoryTransferLine.findFirst({ where: { companyId, catalogVariantId: variante.id, transfer: { status: { in: ['SENT', 'PARTIAL'] } } }, select: { transfer: { select: { number: true } } } })
  if (enTransito) fallo('ACTIVAR_CON_TRANSFERENCIA', `«${nombre}» va en la transferencia ${enTransito.transfer.number}, que sigue en tránsito. Recíbela o cancélala y vuelve a intentar.`)

  const ids = (await tx.inventoryLevel.findMany({ where: { companyId, catalogVariantId: variante.id }, select: { id: true }, orderBy: { id: 'asc' } })).map((n) => n.id)
  if (ids.length > 0) {
    await bloquear(tx, companyId, ids)
  }
  const niveles = ids.length > 0 ? await tx.inventoryLevel.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, onHand: true, reserved: true, damaged: true }, orderBy: { id: 'asc' } }) : []
  const vivas = await tx.inventoryReservation.groupBy({ by: ['inventoryLevelId'], where: { companyId, inventoryLevelId: { in: ids }, status: 'ACTIVE' }, _sum: { quantity: true } })
  const apartadoPorReservas = new Map(vivas.map((v) => [v.inventoryLevelId, v._sum.quantity ?? 0]))
  for (const n of niveles) {
    if ((apartadoPorReservas.get(n.id) ?? 0) !== n.reserved) {
      fallo('ACTIVAR_RESERVAS_DESCUADRADAS', `«${nombre}» tiene ${n.reserved} unidad(es) apartada(s) y sus reservas vivas suman ${apartadoPorReservas.get(n.id) ?? 0}. Corrige las reservas antes de activar los lotes.`)
    }
  }

  await tx.inventoryLotTracking.create({ data: { companyId, catalogVariantId: variante.id, requiresExpiry: e.exigirVencimiento === true, activatedBy: ctx.actorId } })
  const legado = await tx.inventoryLot.create({ data: { companyId, catalogVariantId: variante.id, code: CODIGO_SIN_LOTE, legacy: true, createdBy: ctx.actorId }, select: { id: true } })
  const conExistencias = niveles.filter((n) => n.onHand > 0 || n.damaged > 0)
  // Los saldos por lote nacen en cero; la apertura los pone al día (la base mueve el saldo con ella).
  await tx.inventoryLotBalance.createMany({ data: conExistencias.map((n) => ({ companyId, catalogVariantId: variante.id, inventoryLevelId: n.id, lotId: legado.id })) })
  await tx.inventoryLotOpening.createMany({
    data: conExistencias.map((n) => ({ companyId, inventoryLevelId: n.id, lotId: legado.id, onHand: n.onHand, reserved: n.reserved, damaged: n.damaged, createdBy: ctx.actorId })),
  })
  const unidades = conExistencias.reduce((s, n) => s + n.onHand + n.damaged, 0)
  // Lo que se recordó hace un momento («este producto no lleva lotes») ya no es verdad.
  politicasPorTx.get(tx)?.delete(variante.id)
  // Las reservas caducadas que nadie ha barrido se vencen DESPUÉS de activar, no antes: su movimiento de liberación tiene que traer
  // su reparto (la base comprueba al cerrar que todo movimiento de un producto con lotes está repartido, y uno escrito antes de que
  // el producto llevara lotes no lo estaría). Lo apartado se copió tal cual a la apertura y la liberación lo devuelve a vendible.
  for (const id of ids) await vencerDeNivel(tx, companyId, id, ahora)
  await auditarInventario(
    tx,
    ctx,
    companyId,
    'INVENTORY_CONFIGURED',
    variante.id,
    { tipo: 'LOTES', sku: variante.sku, producto: nombre, exigirVencimiento: e.exigirVencimiento === true, sucursales: conExistencias.length, unidades },
    'InventoryLotTracking'
  )
  return { varianteId: variante.id, legadoId: legado.id, sucursales: conExistencias.length, unidades, repetido: false }
}

// ── INV-5a · Mover unidades entre lotes y vencer lotes ───────────────────────

export interface ResultadoMoverEntreLotes {
  nivelId: string
  salidaId: string
  entradaId: string
  saldo: SaldoVista
  repetido: boolean
}

/**
 * Pasa unidades DISPONIBLES de un lote a otro de la misma sucursal: la salida de corregir un lote mal capturado (un código mal
 * tecleado, un vencimiento equivocado: un lote no se edita, sus unidades se mueven a otro). Se escribe como un par de ajustes —uno
 * que saca del lote de origen y otro que mete en el de destino— con el motivo «Reasignación de lote»: dejan rastro de qué se
 * corrigió, valen lo mismo (se valoran con el mismo costo promedio) y NO cuentan como merma, porque las unidades no salieron.
 * Las dos patas van en la misma transacción y con la misma referencia.
 */
export async function moverEntreLotesEnTx(
  tx: Tx,
  companyId: string,
  e: EntradaBase & { deLoteId: string; aLoteId: string; cantidad: number },
  ctx: ContextoAuditoria
): Promise<ResultadoMoverEntreLotes> {
  const cantidad = cantidadValida(e.cantidad)
  const ahora = e.ahora ?? new Date()
  const clave = claveValida(e.idempotencyKey)
  const variante = await exigirVarianteControlada(tx, companyId, e.varianteId)
  const sucursal = await exigirSucursal(tx, companyId, e.sucursalId, false)
  if (!(await politicaDeLotes(tx, companyId, variante.id))) fallo('LOTES_NO_APLICAN', `«${variante.item.name}» no lleva lotes.`)
  const nivelId = await obtenerNivel(tx, companyId, variante.id, sucursal.id)
  await bloquear(tx, companyId, [nivelId])

  if (clave) {
    const salidaPrevia = await tx.inventoryMovement.findFirst({ where: { companyId, idempotencyKey: `${clave}:out` } })
    if (salidaPrevia) {
      const entradaPrevia = await tx.inventoryMovement.findFirst({ where: { companyId, idempotencyKey: `${clave}:in` } })
      // La MISMA clave con otro lote de origen —o de destino— es otra operación, no un reintento.
      const mismoLote = await mismoRepartoQueElPrevio(tx, companyId, salidaPrevia.id, { tipo: 'SALIENTE', lotes: [{ loteId: e.deLoteId, cantidad }] }, variante.id)
      const mismoDestino = entradaPrevia ? await mismoRepartoQueElPrevio(tx, companyId, entradaPrevia.id, { tipo: 'SALIENTE', lotes: [{ loteId: e.aLoteId, cantidad }] }, variante.id) : false
      if (!entradaPrevia || salidaPrevia.inventoryLevelId !== nivelId || salidaPrevia.quantity !== cantidad || !mismoLote || !mismoDestino) {
        fallo('CLAVE_REUTILIZADA', 'Esa clave de idempotencia ya se usó para otra operación distinta.')
      }
      return { nivelId, salidaId: salidaPrevia.id, entradaId: entradaPrevia.id, saldo: await saldoActual(tx, companyId, nivelId), repetido: true }
    }
  }
  await vencerDeNivel(tx, companyId, nivelId, ahora)

  const lotes = await cargarLotesDeNivel(tx, companyId, nivelId)
  const origen = lotes.find((l) => l.loteId === e.deLoteId)
  if (!origen) fallo('LOTE_NO_ENCONTRADO', 'El lote de origen no tiene existencias en esta sucursal.')
  const destinoFila = await tx.inventoryLot.findFirst({ where: { id: e.aLoteId, companyId, catalogVariantId: variante.id }, select: { id: true, code: true, expiresOn: true, legacy: true, createdAt: true } })
  if (!destinoFila) fallo('LOTE_NO_ENCONTRADO', 'El lote de destino no existe en este producto.')
  const destino: LoteConSaldo = lotes.find((l) => l.loteId === destinoFila.id) ?? {
    loteId: destinoFila.id,
    codigo: destinoFila.code,
    vencimiento: destinoFila.expiresOn === null ? null : destinoFila.expiresOn.toISOString().slice(0, 10),
    legado: destinoFila.legacy,
    creadoEn: destinoFila.createdAt.getTime(),
    onHand: 0,
    reserved: 0,
    damaged: 0,
  }
  const error = validarMovimientoEntreLotes({ origen, destino, cantidad })
  if (error) fallo('MOVIMIENTO_INVALIDO', error)

  const referencia = { tipo: 'LOT_REASSIGN', id: randomUUID() }
  const texto = `Reasignación de lote: ${origen.codigo} → ${destino.codigo}`
  const sal = await escribirMovimiento(
    tx,
    companyId,
    nivelId,
    { type: 'ADJUSTMENT', sourceBucket: 'AVAILABLE', destinationBucket: null, quantity: cantidad, reason: texto },
    { userId: ctx.actorId, referencia, idempotencyKey: clave ? `${clave}:out` : null, motivoCodigo: MOTIVO_REASIGNACION_DE_LOTE, reparto: [{ loteId: origen.loteId, cantidad }] }
  )
  const ent = await escribirMovimiento(
    tx,
    companyId,
    nivelId,
    { type: 'ADJUSTMENT', sourceBucket: null, destinationBucket: 'AVAILABLE', quantity: cantidad, reason: texto },
    { userId: ctx.actorId, referencia, idempotencyKey: clave ? `${clave}:in` : null, motivoCodigo: MOTIVO_REASIGNACION_DE_LOTE, reparto: [{ loteId: destino.loteId, cantidad }] }
  )
  await auditarInventario(tx, ctx, companyId, 'INVENTORY_STOCK_CHANGED', nivelId, {
    tipo: 'LOT_REASSIGN',
    cantidad,
    de: origen.codigo,
    a: destino.codigo,
    sku: variante.sku,
    producto: variante.item.name,
    sucursal: sucursal.nombre,
  })
  return { nivelId, salidaId: sal.movimiento.id, entradaId: ent.movimiento.id, saldo: vista(ent.saldo), repetido: false }
}

/**
 * Saca de lo vendible las unidades DISPONIBLES de los lotes vencidos de la empresa: pasan a dañado con el motivo «Vencido». Es lo que
 * hace el barrido diario; la venta NO depende de él (FEFO no vende lo vencido aunque nadie haya barrido), pero sin barrer, `disponible`
 * seguiría contando unidades que ya no se pueden vender. Idempotente: una segunda pasada no encuentra nada. Lo apartado de un lote
 * vencido no se toca aquí: se resuelve al consumir o al vencer su reserva (y de ahí vuelve a disponible y lo recoge la siguiente pasada).
 * Devuelve cuántos lotes y unidades sacó.
 */
export async function vencerLotesEnTx(tx: Tx, companyId: string, ahora: Date, limite = 500): Promise<{ lotes: number; unidades: number }> {
  const hoy = await hoyDeEmpresa(tx, companyId, ahora)
  const candidatos = await tx.$queryRaw<{ nivelId: string }[]>`
    SELECT DISTINCT b."inventoryLevelId" AS "nivelId"
      FROM "inventory_lot_balances" b
      JOIN "inventory_lots" l ON l."id" = b."lotId"
     WHERE b."companyId" = ${companyId} AND l."expiresOn" IS NOT NULL AND l."expiresOn" < ${hoy}::date AND b."onHand" - b."reserved" > 0
     ORDER BY b."inventoryLevelId"
     LIMIT ${limite}`
  let lotesVencidos = 0
  let unidades = 0
  for (const { nivelId } of candidatos) {
    await bloquear(tx, companyId, [nivelId])
    await vencerDeNivel(tx, companyId, nivelId, ahora)
    const lotes = await cargarLotesDeNivel(tx, companyId, nivelId)
    for (const baja of planDeBarrido(lotes.map((l): LoteDeSaldo => ({ ...l, nivelId })), hoy)) {
      const lote = lotes.find((l) => l.loteId === baja.loteId)!
      await escribirMovimiento(
        tx,
        companyId,
        nivelId,
        { type: 'DAMAGE', sourceBucket: 'AVAILABLE', destinationBucket: 'DAMAGED', quantity: baja.cantidad, reason: `Lote ${lote.codigo} vencido el ${lote.vencimiento}` },
        { userId: null, referencia: { tipo: 'LOT_EXPIRY', id: baja.loteId }, motivoCodigo: 'EXPIRED', reparto: [{ loteId: baja.loteId, cantidad: baja.cantidad }] }
      )
      lotesVencidos++
      unidades += baja.cantidad
    }
  }
  return { lotes: lotesVencidos, unidades }
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
  /** El producto del saldo: hace falta para valorar con el promedio los tipos que lo piden (conteos). */
  varianteId?: string
}

/** INV-5a: los saldos de este lote que son de un producto con lotes (una consulta para todo el lote). */
async function nivelesConLotes(tx: Tx, companyId: string, nivelIds: readonly string[]): Promise<Map<string, string>> {
  const filas = await tx.$queryRaw<{ id: string; catalogVariantId: string }[]>`
    SELECT l."id", l."catalogVariantId"
      FROM "inventory_levels" l
      JOIN "inventory_lot_tracking" t ON t."catalogVariantId" = l."catalogVariantId"
     WHERE l."companyId" = ${companyId} AND l."id" IN (${Prisma.join(nivelIds)})`
  return new Map(filas.map((f) => [f.id, f.catalogVariantId]))
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
  // INV-5a: los saldos de productos con lotes traen su reparto (y suma su cantidad); los demás, nunca.
  const conLotes = await nivelesConLotes(tx, companyId, items.map((i) => i.nivelId))
  for (const i of items) {
    if (conLotes.has(i.nivelId)) {
      if (!i.meta.reparto || sumaDeReparto(i.meta.reparto) !== i.movimiento.quantity) fallo('REPARTO_FALTANTE', 'Un movimiento de un producto con lotes debe indicar de qué lotes sale o entra, y la suma debe ser su cantidad.')
    } else if (i.meta.reparto) {
      fallo('LOTES_NO_APLICAN', 'Un producto que no lleva lotes no puede traer reparto por lotes.')
    }
  }
  // INV-3a: los movimientos que se valoran con el promedio lo leen de UNA vez para todo el lote.
  const aValorar = items.filter((i) => i.meta.costo === undefined && TIPOS_VALORADOS_AL_PROMEDIO.has(i.movimiento.type))
  for (const i of aValorar) if (!i.varianteId) fallo('LOTE_INVALIDO', 'Falta el producto de un movimiento que se valora con el costo promedio.')
  const vigentes = await costosVigentes(tx, companyId, aValorar.map((i) => i.varianteId!))
  const creados = await tx.inventoryMovement.createManyAndReturn({
    data: items.map((i) => {
      const costo = costoDeMovimiento(i.movimiento.type, i.meta.costo, i.varianteId ? vigentes.get(i.varianteId) : undefined)
      return {
        companyId,
        inventoryLevelId: i.nivelId,
        type: i.movimiento.type,
        sourceBucket: i.movimiento.sourceBucket,
        destinationBucket: i.movimiento.destinationBucket,
        quantity: i.movimiento.quantity,
        previousOnHand: i.antes.onHand,
        newOnHand: i.despues.onHand,
        reason: i.movimiento.reason ?? null,
        reasonCode: i.meta.motivoCodigo ?? null,
        userId: i.meta.userId,
        referenceType: i.meta.referencia?.tipo ?? null,
        referenceId: i.meta.referencia?.id ?? null,
        idempotencyKey: i.meta.idempotencyKey ?? null,
        unitCost: costo === null ? null : costoADecimal(costo),
      }
    }),
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
  const ids = items.map((i) => {
    const id = idPorNivel.get(i.nivelId)
    if (!id) fallo('LOTE_INCOMPLETO', 'Falta el movimiento de una línea de la entrada.')
    return id
  })
  // INV-5a: el reparto de cada movimiento de un producto con lotes (un producto por vez: los saldos por lote cuelgan de su producto).
  const porProducto = new Map<string, { nivelId: string; movimientoId: string; reparto: readonly RepartoLote[] }[]>()
  items.forEach((i, idx) => {
    const variante = conLotes.get(i.nivelId)
    if (variante && i.meta.reparto) porProducto.set(variante, [...(porProducto.get(variante) ?? []), { nivelId: i.nivelId, movimientoId: ids[idx], reparto: i.meta.reparto }])
  })
  for (const [variante, filas] of [...porProducto.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) await escribirRepartos(tx, companyId, variante, filas)
  return ids
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
  /** INV-3b: la orden de compra a la que responde esta entrada (solo la pone `recibirOrdenEnTx`). */
  ordenCompraId?: string | null
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

  // INV-5a: los productos CON lotes traen los suyos en cada línea (y suman su cantidad); los demás no pueden traerlos.
  const nombreDe = (id: string) => {
    const v = porId.get(id)!
    return v.isDefault ? v.item.name : `${v.item.name} · ${v.name}`
  }
  const politicaDe = new Map<string, PoliticaDeLotes>()
  const lotesDe = new Map<string, LoteDeLinea[]>()
  for (const l of validas.lineas) {
    const politica = await politicaDeLotes(tx, companyId, l.varianteId)
    if (!politica) {
      if (l.lotes && l.lotes.length > 0) fallo('LOTES_NO_APLICAN', `«${nombreDe(l.varianteId)}» no lleva lotes: quita los lotes de esa línea o actívalos en su ficha de inventario.`)
      continue
    }
    const r = validarLotesDeLinea(l.lotes, l.cantidad, { exigirVencimiento: politica.exigirVencimiento })
    if (!r.ok) fallo(r.codigo, `«${nombreDe(l.varianteId)}»: ${r.error}`)
    politicaDe.set(l.varianteId, politica)
    lotesDe.set(l.varianteId, r.lotes)
  }

  // Idempotencia, YA con los candados: el segundo de dos envíos idénticos llega aquí tras el primero.
  if (clave) {
    const previa = await tx.inventoryReceipt.findFirst({
      where: { companyId, idempotencyKey: clave },
      select: { id: true, number: true, locationId: true, purchaseOrderId: true, lineCount: true, unitCount: true, lines: { select: { catalogVariantId: true, quantity: true, unitCost: true, movementId: true } } },
    })
    if (previa) {
      // El costo es parte de la operación: la misma clave con otro costo no es un reintento. Tampoco lo es la que responde a otra orden.
      const costoDe = (d: { toFixed(n: number): string } | null) => (d === null ? null : costoADecimal(costoDeDecimal(d)))
      // INV-5a: los lotes también son parte de la operación (código y cantidad de cada uno).
      const repartosPrevios = lotesDe.size > 0 ? await repartosPorCodigoEnTx(tx, companyId, previa.lines.map((p) => p.movementId)) : new Map<string, Map<string, number>>()
      const mismosLotes = (l: LineaEntrada, p: { movementId: string }) => {
        const pedidos = lotesDe.get(l.varianteId)
        const previos = repartosPrevios.get(p.movementId)
        if (!pedidos) return !previos || previos.size === 0
        return !!previos && previos.size === pedidos.length && pedidos.every((x) => previos.get(x.codigo) === x.cantidad)
      }
      const mismas =
        previa.locationId === sucursal.id &&
        previa.purchaseOrderId === (e.ordenCompraId ?? null) &&
        previa.lines.length === validas.lineas.length &&
        validas.lineas.every((l) => previa.lines.some((p) => p.catalogVariantId === l.varianteId && p.quantity === l.cantidad && costoDe(p.unitCost) === (l.costo ?? null) && mismosLotes(l, p)))
      if (!mismas) fallo('CLAVE_REUTILIZADA', 'Esa clave de idempotencia ya se usó para otra entrada distinta.')
      return { entradaId: previa.id, numero: previa.number, lineas: previa.lineCount, unidades: previa.unitCount, repetido: true }
    }
  }

  // INV-5a: los lotes que faltan se crean (en orden de producto y de código: dos entradas simultáneas no se interbloquean).
  const repartoDe = new Map<string, RepartoLote[]>()
  for (const l of [...validas.lineas].sort((a, b) => (a.varianteId < b.varianteId ? -1 : a.varianteId > b.varianteId ? 1 : 0))) {
    const lotes = lotesDe.get(l.varianteId)
    if (!lotes) continue
    const ids = await asegurarLotes(tx, companyId, l.varianteId, politicaDe.get(l.varianteId)!, lotes, ctx.actorId)
    repartoDe.set(l.varianteId, fusionarReparto(lotes.map((x) => ({ loteId: ids.get(x.codigo)!, cantidad: x.cantidad }))))
  }

  // Cada línea se aplica con el ledger PURO sobre el saldo bloqueado: el invariante y el tope de existencia son los de siempre.
  const items: ItemLote[] = validas.lineas.map((l) => {
    const nivelId = nivelDeVariante.get(l.varianteId)!
    const fila = bloqueados.get(nivelId)!
    const movimiento: Movimiento = { type: 'PURCHASE', sourceBucket: null, destinationBucket: 'AVAILABLE', quantity: l.cantidad, reason: null }
    const costo: Costo | null = l.costo ? costoDeDecimal(l.costo) : null
    let despues
    try {
      despues = aplicarMovimiento(cubetasDeSaldo(fila), movimiento)
    } catch (err) {
      fallo('EXISTENCIA_MAXIMA', `«${nombreDe(l.varianteId)}»: ${err instanceof Error ? err.message : 'la existencia no es válida.'}`)
    }
    return { nivelId, movimiento, antes: { onHand: fila.onHand, reserved: fila.reserved, damaged: fila.damaged }, despues: saldoDeCubetas(despues), meta: { userId: ctx.actorId, costo, reparto: repartoDe.get(l.varianteId) }, varianteId: l.varianteId }
  })
  // INV-3a: el costo promedio de los productos que traen costo, ANTES de escribir los movimientos (pesan las existencias de antes).
  await aplicarCostosDeEntradaEnTx(
    tx,
    companyId,
    validas.lineas.flatMap((l) => (l.costo ? [{ varianteId: l.varianteId, cantidad: l.cantidad, costo: costoDeDecimal(l.costo) }] : []))
  )

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
        purchaseOrderId: e.ordenCompraId ?? null,
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
    data: validas.lineas.map((l, idx) => ({ companyId, receiptId: entrada.id, catalogVariantId: l.varianteId, position: idx, quantity: l.cantidad, unitCost: l.costo ?? null, movementId: movimientoIds[idx] })),
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
  await exigirSinLotes(tx, companyId, [variante.id], 'el conteo físico')
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
  await exigirSinLotes(tx, companyId, ids, 'el conteo físico')

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
  await exigirSinLotes(tx, companyId, lineas.map((l) => l.catalogVariantId), 'el conteo físico')
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
      meta: { userId: ctx.actorId, referencia: { tipo: 'STOCK_COUNT', id: conteo.id }, motivoCodigo: MOTIVO_DE_CONTEO },
      varianteId: x.l.catalogVariantId,
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
  await exigirSinLotes(tx, companyId, ids, 'la transferencia con envío')
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
