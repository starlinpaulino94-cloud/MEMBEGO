import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { crearItemEnTx } from '../../src/modules/catalog/service'
import {
  ajustarEnTx,
  danarEnTx,
  devolverEnTx,
  liberarReservaEnTx,
  registrarEntradaMultipleEnTx,
  reservarEnTx,
  resolverDanadoEnTx,
  transferirEnTx,
  venderEnTx,
} from '../../src/modules/inventory/service'
import { TOPE_BUSQUEDA_KARDEX, buscarProductosParaKardexEnTx, kardexEnTx, rotacionEnTx, sinVentasEnTx, type KardexVista, type RotacionVista, type SinVentasVista } from '../../src/modules/inventory/reportes-queries'
import { costoDeVentasEnRangoEnTx, valorTotalEnTx } from '../../src/modules/inventory/valor'
import { diaLocal, sumarDias } from '../../src/modules/reportes/rango'
import { efectoFisico, type Cubeta } from '../../src/modules/inventory/reportes'
import { costoADecimal, parsearCosto, type Costo } from '../../src/modules/inventory/costos'

/**
 * INV-4a · INFORMES DE EXISTENCIAS contra PostgreSQL de verdad.
 *
 * Lo que solo se puede comprobar aquí:
 *
 *  · que el kardex cuadra con el ledger y con los saldos: la apertura más lo que entró menos lo que salió es el cierre, y el cierre
 *    de un periodo que llega a hoy es la existencia física (vendible + apartado + dañado) que hay;
 *  · que un movimiento de reserva no aparece, que dañar no cambia la existencia física pero dar de baja sí, y que una transferencia
 *    inmediata deja las dos patas;
 *  · que los rangos de días se miden en el calendario de la empresa y que el costo no se LEE sin la función de costos;
 *  · qué cuenta como «sin ventas» (y qué no: un saldo nuevo, uno vacío), con y sin costos, por sucursal y por búsqueda;
 *  · la rotación y la cobertura sobre un ledger con fechas distintas: lo vendido (menos lo devuelto) en el periodo, la existencia
 *    con la que empezó, y los estados de cobertura;
 *  · lo que cuesta lo vendido en un periodo y lo que vale todo el inventario, y que ninguna empresa ve lo de otra.
 *
 * Las fechas del ledger se mueven con `session_replication_role = replica` (el ledger no se puede editar) solo en estas pruebas.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })
const ZONA = 'America/Santo_Domingo'
const DIA = 86_400_000

const ctx = { a: '', b: '', c: '', usuario: '', sucA1: '', sucA2: '', sucCerrada: '', sucB: '', sucC: '', varianteB: '' }

type Transaccion = Parameters<Parameters<typeof conEmpresa>[1]>[0]
const enA = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.a, fn)
const enB = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.b, fn)
const enC = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.c, fn)

const costo = (t: string): Costo => {
  const r = parsearCosto(t)
  assert.ok(r.ok, t)
  return r.valor
}

let contador = 0
/** Un producto nuevo (con control de inventario) de la empresa A, o de la C. `nombre` es único: sirve de filtro de búsqueda. */
async function producto(nombre: string, empresa: 'a' | 'c' = 'a'): Promise<{ variante: string; nombre: string; sku: string }> {
  const n = ++contador
  const nombreCompleto = `${nombre} ${n} ${sufijo}`
  const sku = `INF-${n}-${sufijo}`.toUpperCase()
  const id = ctx[empresa]
  const run = empresa === 'a' ? enA : enC
  const r = await run((tx) => crearItemEnTx(tx, id, { name: nombreCompleto, type: 'PHYSICAL_PRODUCT', price: 100, sku }, como(ctx.usuario)))
  const v = await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })
  return { variante: v.id, nombre: nombreCompleto, sku }
}

before(async () => {
  const [a, b, c] = await Promise.all(
    ['a', 'b', 'c'].map((x) => prisma.company.create({ data: { name: `Informes ${x} ${sufijo}`, slug: `informes-${x}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo', zonaHoraria: ZONA }, select: { id: true } }))
  )
  ctx.a = a.id
  ctx.b = b.id
  ctx.c = c.id
  ctx.usuario = (await prisma.user.create({ data: { supabaseId: `sb-inf-${sufijo}`, email: `inf-${sufijo}@prueba.test`, name: 'Contadora', role: 'SUPERADMIN' }, select: { id: true } })).id
  const suc = (companyId: string, nombre: string, activa = true) => prisma.sucursal.create({ data: { companyId, nombre, activa }, select: { id: true } })
  ctx.sucA1 = (await suc(ctx.a, 'Principal')).id
  ctx.sucA2 = (await suc(ctx.a, 'Norte')).id
  ctx.sucCerrada = (await suc(ctx.a, 'Cerrada', false)).id
  ctx.sucB = (await suc(ctx.b, 'De B')).id
  ctx.sucC = (await suc(ctx.c, 'Única')).id
  const r = await enB((tx) => crearItemEnTx(tx, ctx.b, { name: `Ajeno ${sufijo}`, type: 'PHYSICAL_PRODUCT', price: 100, sku: `INF-B-${sufijo}` }, como(ctx.usuario)))
  ctx.varianteB = (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })).id
})

after(async () => {
  const ids = [ctx.a, ctx.b, ctx.c]
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      for (const tabla of [
        'inventory_transfer_lines',
        'inventory_transfers',
        'inventory_receipt_lines',
        'inventory_receipts',
        'inventory_cost_adjustments',
        'inventory_variant_costs',
        'inventory_movements',
        'inventory_reservations',
        'inventory_levels',
      ]) {
        await tx.$executeRawUnsafe(`DELETE FROM "${tabla}" WHERE "companyId" IN (${ids.map((i) => `'${i}'`).join(',')})`)
      }
    },
    { timeout: 60_000 }
  )
  await prisma.catalogItem.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.sucursal.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: ctx.usuario } })
  await prisma.company.deleteMany({ where: { id: { in: ids } } })
  await prisma.$disconnect()
})

// ── Armar un ledger con fechas ───────────────────────────────────────────────

const idsDeMovimientos = async (empresa: string, varianteId: string) => (await prisma.inventoryMovement.findMany({ where: { companyId: empresa, level: { catalogVariantId: varianteId } }, select: { id: true } })).map((m) => m.id)

/** Hace `fn` y deja lo que escribió en el ledger hace `dias` días (las operaciones se hacen de la más vieja a la más nueva). */
async function hace<T>(dias: number, empresa: string, varianteId: string, fn: () => Promise<T>): Promise<T> {
  const antes = new Set(await idsDeMovimientos(empresa, varianteId))
  const r = await fn()
  const nuevos = (await idsDeMovimientos(empresa, varianteId)).filter((id) => !antes.has(id))
  if (dias !== 0 && nuevos.length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      await tx.$executeRawUnsafe(`UPDATE "inventory_movements" SET "createdAt" = "createdAt" - interval '${dias} days' WHERE "id" IN (${nuevos.map((i) => `'${i}'`).join(',')})`)
    })
  }
  return r
}

/** El saldo (el renglón de la variante en la sucursal) nació hace `dias` días. */
async function saldoNacidoHace(varianteId: string, sucursalId: string, dias: number) {
  await prisma.$executeRawUnsafe(`UPDATE "inventory_levels" SET "createdAt" = "createdAt" - interval '${dias} days' WHERE "catalogVariantId" = '${varianteId}' AND "locationId" = '${sucursalId}'`)
}

const entradaA = (sucursalId: string, varianteId: string, cantidad: number, costoTexto?: string) =>
  enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId, lineas: [{ varianteId, cantidad, ...(costoTexto ? { costo: costoTexto } : {}) }] }, como(ctx.usuario)))
const venta = (sucursalId: string, varianteId: string, cantidad: number) => enA((tx) => venderEnTx(tx, ctx.a, { varianteId, sucursalId, cantidad }, como(ctx.usuario)))

const hoy = () => diaLocal(new Date(), ZONA)
const diasAtras = (n: number) => sumarDias(hoy(), -n)

const kardex = (varianteId: string, extra: { sucursalId?: string; desde?: string; hasta?: string } = {}, o: { conCostos?: boolean; limite?: number; empresa?: 'a' | 'b' } = {}): Promise<KardexVista | null> =>
  (o.empresa === 'b' ? enB : enA)((tx) => kardexEnTx(tx, o.empresa === 'b' ? ctx.b : ctx.a, { varianteId, ...extra }, { zonaHoraria: ZONA, conCostos: o.conCostos ?? true, limite: o.limite }))

// ── Kardex ───────────────────────────────────────────────────────────────────

/** El ledger de la prueba del kardex: 40 días de historia en dos sucursales. */
async function ledgerDelKardex() {
  const p = await producto('Kardex')
  const v = p.variante
  await hace(40, ctx.a, v, () => entradaA(ctx.sucA1, v, 20, '5'))
  await hace(35, ctx.a, v, () => entradaA(ctx.sucA2, v, 10, '7'))
  await hace(20, ctx.a, v, () => venta(ctx.sucA1, v, 8))
  await hace(15, ctx.a, v, () => enA((tx) => danarEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.sucA1, cantidad: 2, motivo: 'Se cayó la caja' }, como(ctx.usuario))))
  await hace(10, ctx.a, v, () => enA((tx) => resolverDanadoEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.sucA1, cantidad: 2, destino: 'BAJA', motivo: 'Irrecuperable' }, como(ctx.usuario))))
  await hace(8, ctx.a, v, () => enA((tx) => devolverEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.sucA1, cantidad: 1 }, como(ctx.usuario))))
  await hace(5, ctx.a, v, () => enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: v, origenId: ctx.sucA1, destinoId: ctx.sucA2, cantidad: 3 }, como(ctx.usuario))))
  await hace(3, ctx.a, v, () => enA((tx) => reservarEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.sucA1, cantidad: 2 }, como(ctx.usuario))))
  await enA((tx) => ajustarEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.sucA2, cambio: -1, motivo: 'Se perdió una' }, como(ctx.usuario)))
  return p
}

const fisicoDe = async (varianteId: string, sucursalId?: string) => {
  const a = await prisma.inventoryLevel.aggregate({ where: { catalogVariantId: varianteId, ...(sucursalId ? { locationId: sucursalId } : {}) }, _sum: { onHand: true, damaged: true } })
  return (a._sum.onHand ?? 0) + (a._sum.damaged ?? 0)
}

test('1 · el kardex de todas las sucursales: cada movimiento que entró o salió, sin las reservas, con su saldo, y el cierre es la existencia física de hoy', async () => {
  const p = await ledgerDelKardex()
  const k = (await kardex(p.variante, { desde: diasAtras(60) }))!
  assert.equal(k.variante.id, p.variante)
  assert.equal(k.variante.nombre, p.nombre)
  assert.equal(k.variante.sku, p.sku)
  assert.equal(k.sucursal, null)
  assert.equal(k.apertura, 0, 'no había nada antes de hace 40 días')
  assert.deepEqual(
    k.filas.map((f) => [f.tipo, f.sucursalNombre, f.entra, f.sale]),
    [
      ['PURCHASE', 'Principal', 20, 0],
      ['PURCHASE', 'Norte', 10, 0],
      ['SALE', 'Principal', 0, 8],
      ['DAMAGE', 'Principal', 0, 0],
      ['ADJUSTMENT', 'Principal', 0, 2],
      ['RETURN', 'Principal', 1, 0],
      ['TRANSFER_OUT', 'Principal', 0, 3],
      ['TRANSFER_IN', 'Norte', 3, 0],
      ['ADJUSTMENT', 'Norte', 0, 1],
    ],
    'sin la reserva; el daño no cambia la existencia física (sigue en la sucursal) y dar de baja sí'
  )
  assert.deepEqual(k.filas.map((f) => f.saldo), [20, 30, 22, 22, 20, 21, 18, 21, 20])
  assert.deepEqual([k.totales.entradas, k.totales.salidas], [34, 14])
  assert.equal(k.cierre, 20)
  assert.equal(k.cierre, k.apertura + k.totales.entradas - k.totales.salidas)
  assert.equal(k.filas.at(-1)!.saldo, k.cierre)
  assert.equal(k.cierre, await fisicoDe(p.variante), 'el cierre es lo que hay hoy: vendible + apartado + dañado')
  assert.equal(k.truncado, false)
  assert.equal(k.conCostos, true)
  // La baja y el daño dejan quién y por qué; la reserva no sale.
  const baja = k.filas.find((f) => f.tipo === 'ADJUSTMENT' && f.sucursalNombre === 'Principal')!
  assert.equal(baja.motivo, 'Irrecuperable')
  assert.equal(baja.usuarioNombre, 'Contadora')
  assert.equal(k.filas.some((f) => f.tipo === 'RESERVATION'), false)
  // El orden es el del tiempo.
  for (let i = 1; i < k.filas.length; i++) assert.ok(k.filas[i - 1].creadoEn.getTime() <= k.filas[i].creadoEn.getTime(), `fila ${i} fuera de orden`)
})

test('2 · el kardex valora lo que entra y lo que sale con el costo que congeló cada movimiento, y cuenta aparte lo que no tiene', async () => {
  const p = await ledgerDelKardex()
  const k = (await kardex(p.variante, { desde: diasAtras(60) }))!
  const entradaPrincipal = k.filas[0]
  assert.equal(entradaPrincipal.costo, costo('5'))
  assert.equal(entradaPrincipal.valor, costo('100'))
  assert.equal(k.filas[1].costo, costo('7'))
  assert.equal(k.filas[1].valor, costo('70'))
  const dano = k.filas.find((f) => f.tipo === 'DAMAGE')!
  assert.equal(dano.valor, null, 'dañar no saca nada de la existencia: no se valora aquí')
  // Las transferencias no se valoran: sus dos patas quedan «sin costo».
  const patas = k.filas.filter((f) => f.tipo === 'TRANSFER_OUT' || f.tipo === 'TRANSFER_IN')
  assert.equal(patas.length, 2)
  for (const f of patas) assert.deepEqual([f.costo, f.valor], [null, null])
  assert.equal(k.totales.entradasSinCosto, 3)
  assert.equal(k.totales.salidasSinCosto, 3)
  // Los totales son exactamente la suma de las filas con costo.
  let ent = BigInt(0)
  let sal = BigInt(0)
  for (const f of k.filas) {
    if (f.valor === null) continue
    if (f.sentido === 'ENTRA') ent += f.valor
    else sal += f.valor
  }
  assert.equal(k.totales.valorEntradas, ent)
  assert.equal(k.totales.valorSalidas, sal)
  assert.ok(k.totales.valorEntradas >= costo('175'), '100 + 70 + la devolución')
  // La venta salió al promedio del momento: (20 × 5 + 10 × 7) / 30 = 5.6667.
  const venta8 = k.filas.find((f) => f.tipo === 'SALE')!
  assert.equal(costoADecimal(venta8.costo!), '5.6667')
})

test('3 · quien no tiene la función de costos no recibe costo, valor ni la cuenta de lo que falta', async () => {
  const p = await ledgerDelKardex()
  const k = (await kardex(p.variante, { desde: diasAtras(60) }, { conCostos: false }))!
  assert.equal(k.conCostos, false)
  for (const f of k.filas) assert.deepEqual([f.costo, f.valor], [null, null], f.tipo)
  assert.deepEqual(k.totales, { entradas: 34, salidas: 14, valorEntradas: BigInt(0), valorSalidas: BigInt(0), entradasSinCosto: 0, salidasSinCosto: 0 })
  assert.equal(k.cierre, 20, 'las unidades salen igual')
})

test('4 · por sucursal: solo sus movimientos, y su cierre es SU existencia física', async () => {
  const p = await ledgerDelKardex()
  const principal = (await kardex(p.variante, { sucursalId: ctx.sucA1, desde: diasAtras(60) }))!
  assert.deepEqual(principal.sucursal, { id: ctx.sucA1, nombre: 'Principal' })
  assert.deepEqual(principal.filas.map((f) => f.tipo), ['PURCHASE', 'SALE', 'DAMAGE', 'ADJUSTMENT', 'RETURN', 'TRANSFER_OUT'])
  assert.equal(principal.cierre, await fisicoDe(p.variante, ctx.sucA1))
  assert.equal(principal.cierre, 8)
  const norte = (await kardex(p.variante, { sucursalId: ctx.sucA2, desde: diasAtras(60) }))!
  assert.deepEqual(norte.filas.map((f) => [f.tipo, f.saldo]), [['PURCHASE', 10], ['TRANSFER_IN', 13], ['ADJUSTMENT', 12]])
  assert.equal(norte.cierre, 12)
  assert.equal(principal.cierre + norte.cierre, 20)
  // Una sucursal que nunca tuvo el producto: vacío, no error.
  const cerrada = (await kardex(p.variante, { sucursalId: ctx.sucCerrada, desde: diasAtras(60) }))!
  assert.deepEqual([cerrada.filas.length, cerrada.apertura, cerrada.cierre], [0, 0, 0])
  assert.deepEqual(cerrada.sucursal, { id: ctx.sucCerrada, nombre: 'Cerrada' }, 'aunque no tenga saldo, la sucursal se llama como se llama')
  // Una sucursal que no es de la empresa no filtra: el kardex es el de todas.
  const ajena = (await kardex(p.variante, { sucursalId: ctx.sucB, desde: diasAtras(60) }))!
  assert.equal(ajena.sucursal, null)
  assert.equal(ajena.cierre, 20)
  assert.equal(ajena.filas.length, 9)
})

test('5 · el rango de días: la apertura y el cierre salen de lo que se movió después, y un día es un día LOCAL de la empresa', async () => {
  const p = await ledgerDelKardex()
  // Desde hace 12 días: lo anterior (entradas, venta, daño) ya estaba; la apertura es lo que había al empezar.
  const desde12 = (await kardex(p.variante, { sucursalId: ctx.sucA1, desde: diasAtras(12) }))!
  assert.equal(desde12.apertura, 12, '20 entradas − 8 vendidas; el daño no cambia la existencia física')
  assert.deepEqual(desde12.filas.map((f) => f.tipo), ['ADJUSTMENT', 'RETURN', 'TRANSFER_OUT'])
  assert.deepEqual(desde12.filas.map((f) => f.saldo), [10, 11, 8])
  assert.equal(desde12.cierre, 8)
  // Hasta hace 9 días: incluye la baja (de hace 10), no la devolución (de hace 8): el cierre es el de ese día.
  const hasta9 = (await kardex(p.variante, { sucursalId: ctx.sucA1, desde: diasAtras(12), hasta: diasAtras(9) }))!
  assert.deepEqual(hasta9.filas.map((f) => f.tipo), ['ADJUSTMENT'])
  assert.equal(hasta9.apertura, 12)
  assert.equal(hasta9.cierre, 10, 'el cierre de un día pasado no es la existencia de hoy')
  assert.equal(hasta9.cierre, hasta9.apertura + hasta9.totales.entradas - hasta9.totales.salidas)
  // Un día entero cuenta entero: el primer día del rango incluye lo que pasó ese día (la baja fue hace 10 días).
  const unDia = (await kardex(p.variante, { sucursalId: ctx.sucA1, desde: diasAtras(10), hasta: diasAtras(10) }))!
  assert.deepEqual(unDia.filas.map((f) => f.tipo), ['ADJUSTMENT'])
  assert.deepEqual([unDia.apertura, unDia.cierre], [12, 10])
  // Un rango sin movimientos: la apertura y el cierre son iguales.
  const sinNada = (await kardex(p.variante, { sucursalId: ctx.sucA1, desde: diasAtras(30), hasta: diasAtras(25) }))!
  assert.deepEqual([sinNada.filas.length, sinNada.apertura, sinNada.cierre], [0, 20, 20])
  // Un rango anterior a todo: apertura 0 y nada.
  const antes = (await kardex(p.variante, { desde: diasAtras(120), hasta: diasAtras(100) }))!
  assert.deepEqual([antes.filas.length, antes.apertura, antes.cierre], [0, 0, 0])
  // Sin rango, los últimos 30 días hasta hoy.
  const porDefecto = (await kardex(p.variante, { sucursalId: ctx.sucA1 }))!
  assert.equal(porDefecto.hasta, hoy())
  assert.equal(porDefecto.desde, diasAtras(29))
  assert.deepEqual(porDefecto.filas.map((f) => f.tipo), ['SALE', 'DAMAGE', 'ADJUSTMENT', 'RETURN', 'TRANSFER_OUT'], 'la venta (hace 20 días) y el daño (hace 15) caben en 30 días; las entradas (hace 40 y 35) no')
  assert.equal(porDefecto.apertura, 20, 'las 20 que entraron a Principal hace 40 días')
})

test('5b · lo dañado sigue siendo existencia física, las reservas y sus liberaciones no aparecen, y a la misma hora manda el id', async () => {
  const p = await producto('Kardex dañado')
  const v = p.variante
  await hace(5, ctx.a, v, () => entradaA(ctx.sucA1, v, 10, '5'))
  await hace(2, ctx.a, v, () => enA((tx) => danarEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.sucA1, cantidad: 3, motivo: 'Mojadas' }, como(ctx.usuario))))
  const r = await enA((tx) => reservarEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.sucA1, cantidad: 2 }, como(ctx.usuario)))
  await enA((tx) => liberarReservaEnTx(tx, ctx.a, r.reservaId, {}, como(ctx.usuario)))
  const nivel = await prisma.inventoryLevel.findFirstOrThrow({ where: { catalogVariantId: v, locationId: ctx.sucA1 } })
  assert.deepEqual([nivel.onHand, nivel.damaged, nivel.reserved], [7, 3, 0], '3 dañadas siguen en la sucursal, aparte de las 7 vendibles')
  const tipos = await prisma.inventoryMovement.findMany({ where: { companyId: ctx.a, level: { catalogVariantId: v } }, select: { type: true } })
  assert.ok(tipos.some((t) => t.type === 'RESERVATION') && tipos.some((t) => t.type === 'RESERVATION_RELEASE'), 'el ledger sí tiene la reserva y su liberación')
  const k = (await kardex(v, { desde: diasAtras(10) }))!
  assert.deepEqual(k.filas.map((f) => f.tipo), ['PURCHASE', 'DAMAGE'], 'ni la reserva ni su liberación son existencia que entre o salga')
  assert.deepEqual(k.filas.map((f) => f.saldo), [10, 10])
  assert.deepEqual([k.apertura, k.cierre], [0, 10], 'las 3 dañadas siguen contando: 7 vendibles + 3 dañadas')
  assert.equal(k.cierre, await fisicoDe(v))
  const reciente = (await kardex(v, { desde: diasAtras(1) }))!
  assert.deepEqual([reciente.apertura, reciente.cierre, reciente.filas.length], [10, 10, 0], 'la apertura también cuenta lo dañado')
  // Dos movimientos a la MISMA hora (una transferencia deja dos): siempre en el mismo orden, el del id.
  const movs = await prisma.inventoryMovement.findMany({ where: { companyId: ctx.a, level: { catalogVariantId: v }, type: { in: ['PURCHASE', 'DAMAGE'] } }, orderBy: { id: 'asc' }, select: { id: true } })
  assert.equal(movs.length, 2)
  const mismaHora = new Date(Date.now() - 3 * DIA)
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    // Se actualiza primero el de id mayor: su fila queda físicamente antes que la del menor.
    for (const m of [movs[1], movs[0]]) await tx.$executeRawUnsafe(`UPDATE "inventory_movements" SET "createdAt" = '${mismaHora.toISOString()}' WHERE "id" = '${m.id}'`)
  })
  const empatados = (await kardex(v, { desde: diasAtras(10) }))!
  assert.deepEqual(empatados.filas.map((f) => f.id), [movs[0].id, movs[1].id], 'a igual hora, por id')
})

test('6 · en cualquier rango: apertura + entradas − salidas = cierre, y el saldo de cada fila sigue a la anterior', async () => {
  const p = await ledgerDelKardex()
  for (const sucursalId of [undefined, ctx.sucA1, ctx.sucA2]) {
    for (let desde = 0; desde <= 45; desde += 5) {
      for (let hasta = 0; hasta <= desde; hasta += 5) {
        const k = (await kardex(p.variante, { sucursalId, desde: diasAtras(desde), hasta: diasAtras(hasta) }))!
        assert.equal(k.cierre, k.apertura + k.totales.entradas - k.totales.salidas, `${sucursalId ?? 'todas'} ${desde}→${hasta}`)
        let saldo = k.apertura
        for (const f of k.filas) {
          saldo += efectoFisico({ cantidad: f.cantidad, origen: f.origen as Cubeta | null, destino: f.destino as Cubeta | null })
          assert.equal(f.saldo, saldo)
        }
        assert.equal(saldo, k.cierre)
      }
    }
  }
})

test('7 · si hay más movimientos que filas se corta al principio del periodo, y el cierre sigue siendo el del periodo completo', async () => {
  const p = await ledgerDelKardex()
  const k = (await kardex(p.variante, { desde: diasAtras(60) }, { limite: 3 }))!
  assert.equal(k.truncado, true)
  assert.equal(k.filas.length, 3)
  assert.deepEqual(k.filas.map((f) => f.saldo), [20, 30, 22])
  assert.equal(k.cierre, 20, 'el cierre es el del periodo, no el de la última fila que cupo')
  const justo = (await kardex(p.variante, { desde: diasAtras(60) }, { limite: 9 }))!
  assert.equal(justo.truncado, false, 'exactamente el tope no es cortar')
  assert.equal(justo.filas.length, 9)
})

test('8 · un producto que no existe, es de otra empresa o no tiene saldo no da un kardex ajeno', async () => {
  const p = await ledgerDelKardex()
  assert.equal(await kardex('no-existe'), null)
  assert.equal(await kardex(ctx.varianteB), null, 'la empresa A no ve el producto de B')
  assert.equal(await kardex(p.variante, {}, { empresa: 'b' }), null, 'la empresa B no ve el de A')
  const sinSaldo = await producto('Sin saldo')
  const k = (await kardex(sinSaldo.variante))!
  assert.deepEqual([k.filas.length, k.apertura, k.cierre], [0, 0, 0])
  assert.equal(k.variante.nombre, sinSaldo.nombre)
})

// ── Stock sin ventas ─────────────────────────────────────────────────────────

const sinVentas = (f: { dias?: number; sucursalId?: string; q?: string; pagina?: number } = {}, o: { conCostos?: boolean; todas?: boolean } = {}): Promise<SinVentasVista> =>
  enA((tx) => sinVentasEnTx(tx, ctx.a, { dias: f.dias ?? 90, sucursalId: f.sucursalId, q: f.q, pagina: f.pagina ?? 1 }, { conCostos: o.conCostos ?? true, todas: o.todas }))

async function ledgerSinVentas() {
  const tag = `Quieta ${contador}`
  const s1 = await producto(`${tag} uno`)
  const s2 = await producto(`${tag} dos`)
  const s3 = await producto(`${tag} tres`)
  const s4 = await producto(`${tag} cuatro`)
  const s5 = await producto(`${tag} cinco`)
  const s6 = await producto(`${tag} seis`)
  const s7 = await producto(`${tag} siete`)
  // s1: llegó hace 200 días y se vendió hace 100.
  await hace(200, ctx.a, s1.variante, () => entradaA(ctx.sucA1, s1.variante, 10, '4'))
  await saldoNacidoHace(s1.variante, ctx.sucA1, 200)
  await hace(100, ctx.a, s1.variante, () => venta(ctx.sucA1, s1.variante, 1))
  // s2: se vendió hace 10 días.
  await hace(200, ctx.a, s2.variante, () => entradaA(ctx.sucA1, s2.variante, 10, '4'))
  await saldoNacidoHace(s2.variante, ctx.sucA1, 200)
  await hace(10, ctx.a, s2.variante, () => venta(ctx.sucA1, s2.variante, 1))
  // s3: nunca se ha vendido.
  await hace(200, ctx.a, s3.variante, () => entradaA(ctx.sucA1, s3.variante, 10, '4'))
  await saldoNacidoHace(s3.variante, ctx.sucA1, 200)
  // s4: llegó ayer y no se ha vendido: no ha tenido tiempo.
  await entradaA(ctx.sucA1, s4.variante, 10, '4')
  // s5: se vendió todo hace 150 días: sin existencia.
  await hace(200, ctx.a, s5.variante, () => entradaA(ctx.sucA1, s5.variante, 5, '4'))
  await saldoNacidoHace(s5.variante, ctx.sucA1, 200)
  await hace(150, ctx.a, s5.variante, () => venta(ctx.sucA1, s5.variante, 5))
  // s6: en otra sucursal, nunca vendido, con un costo distinto.
  await hace(200, ctx.a, s6.variante, () => entradaA(ctx.sucA2, s6.variante, 10, '2'))
  await saldoNacidoHace(s6.variante, ctx.sucA2, 200)
  // s7: un saldo en una sucursal cerrada.
  await prisma.inventoryLevel.create({ data: { companyId: ctx.a, catalogVariantId: s7.variante, locationId: ctx.sucCerrada, onHand: 4, createdAt: new Date(Date.now() - 200 * DIA) } })
  return { tag, s1, s2, s3, s4, s5, s6, s7 }
}

test('9 · stock sin ventas: los saldos con existencia que llevan N días sin venderse, por lo que inmovilizan; un saldo nuevo o vacío no cuenta', async () => {
  const { tag, s1, s2, s3, s4, s5, s6, s7 } = await ledgerSinVentas()
  const d90 = await sinVentas({ dias: 90, q: tag })
  assert.deepEqual(
    d90.filas.map((f) => f.varianteId),
    [s3.variante, s1.variante, s6.variante, s7.variante].filter(Boolean),
    'por valor: s3 (10 × 4), s1 (9 × 4), s6 (10 × 2); el de la sucursal cerrada tiene costo de referencia nulo y va al final'
  )
  const enLista = new Set(d90.filas.map((f) => f.varianteId))
  assert.equal(enLista.has(s2.variante), false, 's2 se vendió hace 10 días')
  assert.equal(enLista.has(s4.variante), false, 's4 llegó hace un día')
  assert.equal(enLista.has(s5.variante), false, 's5 no tiene existencia')
  const f1 = d90.filas.find((f) => f.varianteId === s1.variante)!
  assert.equal(f1.existencia, 9)
  assert.equal(f1.diasSinVender, 100)
  assert.equal(f1.costo, costo('4'))
  assert.equal(f1.valor, costo('36'))
  assert.equal(f1.sucursalNombre, 'Principal')
  assert.equal(f1.sucursalActiva, true)
  assert.ok(f1.ultimaEntrada && f1.ultimaEntrada.getTime() < Date.now() - 190 * DIA, 'la última entrada fue hace unos 200 días')
  const f3 = d90.filas.find((f) => f.varianteId === s3.variante)!
  assert.deepEqual([f3.ultimaVenta, f3.diasSinVender], [null, null], 'nunca se ha vendido')
  const f7 = d90.filas.find((f) => f.varianteId === s7.variante)!
  assert.deepEqual([f7.sucursalActiva, f7.existencia, f7.costo, f7.valor], [false, 4, null, null], 'un saldo en una sucursal cerrada también está parado')
  // El resumen cuenta lo mismo que la lista, con lo que no tiene costo aparte.
  assert.equal(d90.total, 4)
  assert.deepEqual([d90.resumen.saldos, d90.resumen.unidades], [4, 33])
  assert.equal(d90.resumen.valor, costo('96'), '40 + 36 + 20')
  assert.equal(d90.resumen.unidadesSinCosto, 4, 'las 4 unidades de la sucursal cerrada no tienen costo')
})

test('10 · stock sin ventas: los días cambian el corte, y una venta reciente saca el saldo de la lista', async () => {
  const { tag, s1, s2, s3, s6 } = await ledgerSinVentas()
  const ids = async (dias: number) => (await sinVentas({ dias, q: tag })).filas.map((f) => f.varianteId).sort()
  assert.equal((await ids(180)).includes(s1.variante), false, 'con 180 días, s1 (vendido hace 100) ya no está')
  assert.equal((await ids(180)).includes(s3.variante), true)
  assert.equal((await ids(180)).includes(s6.variante), true)
  assert.equal((await ids(90)).includes(s1.variante), true)
  assert.equal((await ids(30)).includes(s2.variante), false, 'vendido hace 10 días: no está ni con 30')
  assert.equal((await ids(365)).includes(s1.variante), false)
  // Con 365 días nada llegó hace tanto: los saldos nacieron hace 200.
  assert.equal((await sinVentas({ dias: 365, q: tag })).total, 0)
})

test('11 · stock sin ventas: sin la función de costos no se lee el costo, ordena por unidades y no suma valores', async () => {
  const { tag } = await ledgerSinVentas()
  const v = await sinVentas({ dias: 90, q: tag }, { conCostos: false })
  for (const f of v.filas) assert.deepEqual([f.costo, f.valor], [null, null])
  assert.deepEqual([v.resumen.valor, v.resumen.unidadesSinCosto], [null, null])
  assert.equal(v.resumen.unidades, 33, 'las unidades salen igual')
  const existencias = v.filas.map((f) => f.existencia)
  assert.deepEqual(existencias, [...existencias].sort((a, b) => b - a), 'de más a menos unidades')
})

test('12 · stock sin ventas: por sucursal, por búsqueda, por página y el archivo trae todo', async () => {
  const { tag, s6 } = await ledgerSinVentas()
  const norte = await sinVentas({ dias: 90, q: tag, sucursalId: ctx.sucA2 })
  assert.deepEqual(norte.filas.map((f) => f.varianteId), [s6.variante])
  assert.equal(norte.total, 1)
  const porSku = await sinVentas({ dias: 90, q: s6.sku.toLowerCase() })
  assert.deepEqual(porSku.filas.map((f) => f.varianteId), [s6.variante], 'el SKU busca sin importar mayúsculas')
  assert.equal((await sinVentas({ dias: 90, q: 'nada-que-coincida-xyz' })).total, 0)
  // Páginas: de una en una no se repite ni se pierde ninguna fila; el archivo trae todas.
  const todas = await sinVentas({ dias: 90, q: tag }, { todas: true })
  assert.equal(todas.filas.length, 4)
  assert.equal(todas.porPagina > 4, true)
  const p1 = await sinVentas({ dias: 90, q: tag, pagina: 1 })
  assert.equal(p1.pagina, 1)
  const fueraDeRango = await sinVentas({ dias: 90, q: tag, pagina: 99 })
  assert.deepEqual([fueraDeRango.filas.length, fueraDeRango.total], [0, 4], 'una página que no existe está vacía pero el total sigue')
  assert.equal(fueraDeRango.resumen.saldos, 4)
})

/** Los casos finos de «sin ventas»: costo de referencia, devoluciones y entradas que no son ventas, código de barras y transferencias. */
async function ledgerSinVentasFino() {
  const tag = `Fina ${contador}`
  const f1 = await producto(`${tag} referencia`)
  const f2 = await producto(`${tag} devuelto`)
  const f3 = await producto(`${tag} reabastecido`)
  const f4 = await producto(`${tag} transferido`)
  // f1: solo tiene el costo de referencia del catálogo (ninguna entrada trajo costo), y un código de barras.
  const barcode = `7${Date.now().toString().slice(-9)}${contador}`
  await prisma.catalogVariant.update({ where: { id: f1.variante }, data: { cost: '3', barcode } })
  await hace(200, ctx.a, f1.variante, () => entradaA(ctx.sucA2, f1.variante, 6))
  await saldoNacidoHace(f1.variante, ctx.sucA2, 200)
  // f2: una devolución reciente no es una venta.
  await hace(200, ctx.a, f2.variante, () => entradaA(ctx.sucA1, f2.variante, 10, '4'))
  await saldoNacidoHace(f2.variante, ctx.sucA1, 200)
  await hace(10, ctx.a, f2.variante, () => enA((tx) => devolverEnTx(tx, ctx.a, { varianteId: f2.variante, sucursalId: ctx.sucA1, cantidad: 1 }, como(ctx.usuario))))
  // f3: una entrada reciente tampoco.
  await hace(200, ctx.a, f3.variante, () => entradaA(ctx.sucA1, f3.variante, 10, '4'))
  await saldoNacidoHace(f3.variante, ctx.sucA1, 200)
  await hace(10, ctx.a, f3.variante, () => entradaA(ctx.sucA1, f3.variante, 5, '4'))
  // f4: llegó a Norte por una transferencia (su única «entrada»), sin ventas.
  await hace(200, ctx.a, f4.variante, () => entradaA(ctx.sucA1, f4.variante, 10, '4'))
  await saldoNacidoHace(f4.variante, ctx.sucA1, 200)
  await hace(100, ctx.a, f4.variante, () => enA((tx) => transferirEnTx(tx, ctx.a, { varianteId: f4.variante, origenId: ctx.sucA1, destinoId: ctx.sucA2, cantidad: 4 }, como(ctx.usuario))))
  await saldoNacidoHace(f4.variante, ctx.sucA2, 150)
  return { tag, f1, f2, f3, f4, barcode }
}

test('12b · stock sin ventas: el costo de referencia vale solo con la función de costos, una devolución o una entrada no son ventas, y la última entrada incluye las transferencias', async () => {
  const { tag, f1, f2, f3, f4, barcode } = await ledgerSinVentasFino()
  const con = await sinVentas({ dias: 90, q: tag })
  const por = new Map(con.filas.map((f) => [`${f.varianteId}:${f.sucursalNombre}`, f]))
  assert.equal(con.total, 5, 'f1 (Norte), f2, f3 y las dos patas de f4')
  const r1 = por.get(`${f1.variante}:Norte`)!
  assert.deepEqual([r1.costo, r1.valor], [costo('3'), costo('18')], 'sin promedio, vale el costo de referencia del catálogo: 6 × 3')
  assert.equal(por.get(`${f2.variante}:Principal`)!.existencia, 11, 'una devolución sube la existencia y no es una venta')
  assert.equal(por.get(`${f2.variante}:Principal`)!.ultimaVenta, null)
  const r3 = por.get(`${f3.variante}:Principal`)!
  assert.equal(r3.existencia, 15)
  assert.ok(r3.ultimaEntrada && Math.abs(r3.ultimaEntrada.getTime() - (Date.now() - 10 * DIA)) < DIA, 'la última entrada es la de hace 10 días')
  const llegada = por.get(`${f4.variante}:Norte`)!
  assert.ok(llegada.ultimaEntrada && Math.abs(llegada.ultimaEntrada.getTime() - (Date.now() - 100 * DIA)) < DIA, 'la transferencia recibida cuenta como entrada')
  assert.equal(llegada.existencia, 4)
  assert.equal(con.resumen.valor, costo('18') + costo('44') + costo('60') + costo('24') + costo('16'))
  assert.equal(con.resumen.unidadesSinCosto, 0)
  // Sin la función de costos: ni el costo de referencia sale.
  const sin = await sinVentas({ dias: 90, q: tag }, { conCostos: false })
  assert.equal(sin.total, 5)
  for (const f of sin.filas) assert.deepEqual([f.costo, f.valor], [null, null])
  assert.deepEqual([sin.resumen.valor, sin.resumen.unidadesSinCosto], [null, null])
  // El código de barras también busca.
  assert.deepEqual((await sinVentas({ dias: 90, q: barcode })).filas.map((f) => f.varianteId), [f1.variante])
})

test('12c · paginar no repite ni pierde saldos, y el archivo trae todos aunque pasen de una página', async () => {
  const tag = `Pagina ${contador}`
  const productos: Array<Awaited<ReturnType<typeof producto>>> = []
  for (let i = 0; i < 52; i++) productos.push(await producto(`${tag} ${String(i).padStart(2, '0')}`))
  await enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId: ctx.sucA1, lineas: productos.map((x) => ({ varianteId: x.variante, cantidad: 1 })) }, como(ctx.usuario)))
  await prisma.$executeRawUnsafe(`UPDATE "inventory_levels" SET "createdAt" = now() - interval '200 days' WHERE "catalogVariantId" IN (${productos.map((x) => `'${x.variante}'`).join(',')})`)
  const esperados = productos.map((x) => x.variante).sort()
  for (const informe of ['sin ventas', 'rotación'] as const) {
    const pagina = (n: number) =>
      informe === 'sin ventas' ? sinVentas({ dias: 90, q: tag, pagina: n }) : rotacion({ dias: 30, q: tag, pagina: n })
    const todas = informe === 'sin ventas' ? await sinVentas({ dias: 90, q: tag }, { todas: true }) : await rotacion({ dias: 30, q: tag }, { todas: true })
    const p1 = await pagina(1)
    const p2 = await pagina(2)
    assert.deepEqual([p1.filas.length, p2.filas.length, p1.total, p2.total, p1.pagina, p2.pagina], [50, 2, 52, 52, 1, 2], informe)
    assert.equal(todas.filas.length, 52, `${informe}: el archivo trae todo, no una página`)
    assert.equal(todas.pagina, 1)
    const ids = [...p1.filas, ...p2.filas].map((f) => f.varianteId)
    assert.deepEqual([...ids].sort(), esperados, `${informe}: las páginas suman todo sin repetir`)
    assert.deepEqual(todas.filas.map((f) => f.varianteId), ids, `${informe}: el archivo y las páginas van en el mismo orden`)
    // Pedir una página desde el archivo no la salta: `todas` siempre empieza en la primera.
    const salto = informe === 'sin ventas' ? await sinVentas({ dias: 90, q: tag, pagina: 2 }, { todas: true }) : await rotacion({ dias: 30, q: tag, pagina: 2 }, { todas: true })
    assert.equal(salto.filas.length, 52, `${informe}: el archivo ignora la página`)
  }
})

// ── Rotación y cobertura ─────────────────────────────────────────────────────

const rotacion = (f: { dias?: number; sucursalId?: string; q?: string; estado?: RotacionVista['filas'][number]['estado']; pagina?: number } = {}, o: { conCostos?: boolean; todas?: boolean; empresa?: 'a' | 'c' } = {}): Promise<RotacionVista> => {
  const run = o.empresa === 'c' ? enC : enA
  const id = o.empresa === 'c' ? ctx.c : ctx.a
  return run((tx) => rotacionEnTx(tx, id, { dias: f.dias ?? 30, sucursalId: f.sucursalId, q: f.q, estado: f.estado, pagina: f.pagina ?? 1 }, { conCostos: o.conCostos ?? true, todas: o.todas }))
}

async function ledgerDeRotacion() {
  const tag = `Rota ${contador}`
  const r1 = await producto(`${tag} uno`)
  const r2 = await producto(`${tag} dos`)
  const r3 = await producto(`${tag} tres`)
  const r4 = await producto(`${tag} cuatro`)
  const r5 = await producto(`${tag} cinco`)
  const r6 = await producto(`${tag} seis`)
  const r7 = await producto(`${tag} siete`)
  const r8 = await producto(`${tag} ocho`)
  // r1: 100 llegaron hace 60 días; 20 vendidas hace 40; 30 hace 10; 5 devueltas hace 5; 3 apartadas hoy.
  await hace(60, ctx.a, r1.variante, () => entradaA(ctx.sucA1, r1.variante, 100, '5'))
  await hace(40, ctx.a, r1.variante, () => venta(ctx.sucA1, r1.variante, 20))
  await hace(10, ctx.a, r1.variante, () => venta(ctx.sucA1, r1.variante, 30))
  await hace(5, ctx.a, r1.variante, () => enA((tx) => devolverEnTx(tx, ctx.a, { varianteId: r1.variante, sucursalId: ctx.sucA1, cantidad: 5 }, como(ctx.usuario))))
  await enA((tx) => reservarEnTx(tx, ctx.a, { varianteId: r1.variante, sucursalId: ctx.sucA1, cantidad: 3 }, como(ctx.usuario)))
  // r2: se agotó vendiendo.
  await hace(20, ctx.a, r2.variante, () => entradaA(ctx.sucA1, r2.variante, 10, '3'))
  await hace(5, ctx.a, r2.variante, () => venta(ctx.sucA1, r2.variante, 10))
  // r3: poca cobertura (queda para 10 días).
  await hace(20, ctx.a, r3.variante, () => entradaA(ctx.sucA1, r3.variante, 20, '2'))
  await hace(5, ctx.a, r3.variante, () => venta(ctx.sucA1, r3.variante, 15))
  // r4: exceso.
  await hace(20, ctx.a, r4.variante, () => entradaA(ctx.sucA1, r4.variante, 1000, '1'))
  await hace(5, ctx.a, r4.variante, () => venta(ctx.sucA1, r4.variante, 10))
  // r5: hay y no se vende.
  await hace(20, ctx.a, r5.variante, () => entradaA(ctx.sucA1, r5.variante, 10, '6'))
  // r6: sin existencia y sin ventas en el periodo (todo fue hace 100 días): no sale.
  await hace(120, ctx.a, r6.variante, () => entradaA(ctx.sucA1, r6.variante, 10, '6'))
  await hace(100, ctx.a, r6.variante, () => venta(ctx.sucA1, r6.variante, 10))
  // r7: solo en Norte.
  await hace(10, ctx.a, r7.variante, () => entradaA(ctx.sucA2, r7.variante, 8, '4'))
  await hace(2, ctx.a, r7.variante, () => venta(ctx.sucA2, r7.variante, 2))
  // r8: se vendió hace mucho, en el periodo solo hubo una devolución (ventas netas negativas) y luego se dio de baja todo: no hay nada que decir.
  await hace(100, ctx.a, r8.variante, () => entradaA(ctx.sucA1, r8.variante, 10, '5'))
  await hace(50, ctx.a, r8.variante, () => venta(ctx.sucA1, r8.variante, 5))
  await hace(10, ctx.a, r8.variante, () => enA((tx) => devolverEnTx(tx, ctx.a, { varianteId: r8.variante, sucursalId: ctx.sucA1, cantidad: 5 }, como(ctx.usuario))))
  await hace(5, ctx.a, r8.variante, () => enA((tx) => ajustarEnTx(tx, ctx.a, { varianteId: r8.variante, sucursalId: ctx.sucA1, cambio: -10, motivo: 'Se dio de baja todo' }, como(ctx.usuario))))
  return { tag, r1, r2, r3, r4, r5, r6, r7, r8 }
}

test('13 · rotación y cobertura: lo vendido (menos lo devuelto) en el periodo, la existencia con la que empezó y para cuántos días alcanza', async () => {
  const { tag, r1 } = await ledgerDeRotacion()
  const v = await rotacion({ dias: 30, q: tag })
  const f = v.filas.find((x) => x.varianteId === r1.variante)!
  assert.equal(f.vendidas, 25, '30 vendidas hace 10 días menos 5 devueltas; las 20 de hace 40 días quedan fuera')
  assert.equal(f.existencia, 55)
  assert.equal(f.disponible, 52, 'lo apartado no se puede vender')
  assert.equal(f.existenciaPromedio, 67.5, 'empezó con 80 (55 hoy + 25 que salieron) y terminó con 55')
  assert.equal(f.veces, 25 / 67.5)
  assert.equal(f.ventaDiaria, 25 / 30)
  assert.equal(f.coberturaDias, 52 / (25 / 30))
  assert.equal(f.estado, 'NORMAL')
  assert.ok(f.ultimaVenta && Math.abs(f.ultimaVenta.getTime() - (Date.now() - 10 * DIA)) < DIA, 'la última venta es la de hace 10 días, no la devolución de hace 5')
  // Con 90 días entran las 20 de hace 40 y la entrada de hace 60: se empezó con 0.
  const d90 = (await rotacion({ dias: 90, q: tag })).filas.find((x) => x.varianteId === r1.variante)!
  assert.equal(d90.vendidas, 45)
  assert.equal(d90.existenciaPromedio, 27.5, 'empezó sin nada: (0 + 55) / 2')
  assert.equal(d90.ventaDiaria, 0.5)
})

test('14 · rotación: cada estado de cobertura, el orden de lo urgente a lo que no vende, y lo que no tiene ni existencia ni ventas no sale', async () => {
  const { tag, r1, r2, r3, r4, r5, r6, r7, r8 } = await ledgerDeRotacion()
  const v = await rotacion({ dias: 30, q: tag })
  const estados = new Map(v.filas.map((f) => [f.varianteId, f.estado]))
  assert.equal(estados.has(r8.variante), false, 'sin existencia y con más devoluciones que ventas en el periodo: tampoco sale')
  assert.equal(estados.get(r2.variante), 'AGOTADO')
  assert.equal(estados.get(r3.variante), 'POCA')
  assert.equal(estados.get(r1.variante), 'NORMAL')
  assert.equal(estados.get(r7.variante), 'NORMAL')
  assert.equal(estados.get(r4.variante), 'EXCESO')
  assert.equal(estados.get(r5.variante), 'SIN_VENTAS')
  assert.equal(estados.has(r6.variante), false, 'sin existencia y sin ventas en el periodo')
  assert.deepEqual(v.filas.map((f) => f.varianteId), [r2.variante, r3.variante, r1.variante, r7.variante, r4.variante, r5.variante], 'agotado, poca, normal (por cobertura), exceso y sin ventas')
  assert.deepEqual(v.porEstado, { AGOTADO: 1, POCA: 1, NORMAL: 2, EXCESO: 1, SIN_VENTAS: 1 })
  assert.equal(v.unidadesVendidas, 25 + 10 + 15 + 10 + 0 + 2)
  assert.equal(v.total, 6)
  const r3f = v.filas.find((f) => f.varianteId === r3.variante)!
  assert.equal(r3f.coberturaDias, 10, '5 disponibles a 0.5 por día')
  const r4f = v.filas.find((f) => f.varianteId === r4.variante)!
  assert.equal(r4f.coberturaDias, 990 / (10 / 30))
  assert.equal(v.filas.find((f) => f.varianteId === r5.variante)!.coberturaDias, null)
  // Con 365 días, r6 sí tuvo ventas (hace 100): entra, sin existencia → agotado con ventas.
  const largo = await rotacion({ dias: 365, q: tag })
  assert.equal(largo.filas.find((f) => f.varianteId === r6.variante)?.estado, 'AGOTADO')
})

test('15 · rotación: filtrar por estado y por sucursal, y los conteos por estado ignoran el filtro de estado', async () => {
  const { tag, r3, r7 } = await ledgerDeRotacion()
  const poca = await rotacion({ dias: 30, q: tag, estado: 'POCA' })
  assert.deepEqual(poca.filas.map((f) => f.varianteId), [r3.variante])
  assert.equal(poca.total, 1)
  assert.deepEqual(poca.porEstado, { AGOTADO: 1, POCA: 1, NORMAL: 2, EXCESO: 1, SIN_VENTAS: 1 }, 'los chips cuentan todo, no solo lo filtrado')
  const norte = await rotacion({ dias: 30, q: tag, sucursalId: ctx.sucA2 })
  assert.deepEqual(norte.filas.map((f) => f.varianteId), [r7.variante])
  assert.equal(norte.filas[0].existencia, 6)
  assert.equal(norte.filas[0].vendidas, 2)
  assert.equal(norte.unidadesVendidas, 2)
  assert.equal((await rotacion({ dias: 30, q: tag, sucursalId: ctx.sucCerrada })).total, 0)
  assert.equal((await rotacion({ dias: 30, q: 'nada-que-coincida-xyz' })).total, 0)
})

test('15b · rotación: si hay más productos que el tope se leen primero los que más venden y lo dice', async () => {
  const { tag, r1, r3 } = await ledgerDeRotacion()
  const sinTope = await rotacion({ dias: 30, q: tag })
  const corte = (tope: number) => enA((tx) => rotacionEnTx(tx, ctx.a, { dias: 30, q: tag, pagina: 1 }, { conCostos: true, tope }))
  const justo = await corte(sinTope.total)
  assert.equal(justo.truncado, false, 'exactamente el tope no es cortar')
  assert.equal(justo.total, sinTope.total)
  const dos = await corte(2)
  assert.equal(dos.truncado, true)
  assert.equal(dos.total, 2)
  assert.deepEqual(dos.filas.map((f) => f.varianteId).sort(), [r1.variante, r3.variante].sort(), 'los dos que más vendieron: 25 y 15 unidades')
})

test('16 · rotación: páginas sin repetir ni perder, y el archivo trae todo', async () => {
  const { tag } = await ledgerDeRotacion()
  const todas = await rotacion({ dias: 30, q: tag }, { todas: true })
  assert.equal(todas.filas.length, 6)
  const p1 = await rotacion({ dias: 30, q: tag, pagina: 1 })
  assert.deepEqual(p1.filas.map((f) => f.varianteId), todas.filas.map((f) => f.varianteId), 'caben en una página')
  const lejos = await rotacion({ dias: 30, q: tag, pagina: 50 })
  assert.deepEqual([lejos.filas.length, lejos.total], [0, 6])
  assert.equal(lejos.truncado, false)
})

// ── Lo que cuesta lo vendido y lo que vale lo que hay ────────────────────────

/** La empresa C solo tiene lo de estas pruebas: sus totales se pueden comprobar al centavo. Se arma UNA vez (si no, cada prueba sumaría lo suyo). */
let valorArmado: ReturnType<typeof armarLedgerDeValor> | null = null
const ledgerDeValor = () => (valorArmado ??= armarLedgerDeValor())
async function armarLedgerDeValor() {
  const c1 = await producto('Valorado', 'c')
  const c2 = await producto('Sin costo', 'c')
  const entradaC = (varianteId: string, cantidad: number, costoTexto?: string) =>
    enC((tx) => registrarEntradaMultipleEnTx(tx, ctx.c, { sucursalId: ctx.sucC, lineas: [{ varianteId, cantidad, ...(costoTexto ? { costo: costoTexto } : {}) }] }, como(ctx.usuario)))
  const ventaC = (varianteId: string, cantidad: number) => enC((tx) => venderEnTx(tx, ctx.c, { varianteId, sucursalId: ctx.sucC, cantidad }, como(ctx.usuario)))
  await hace(50, ctx.c, c1.variante, () => entradaC(c1.variante, 100, '5'))
  await hace(10, ctx.c, c1.variante, () => ventaC(c1.variante, 30))
  await hace(40, ctx.c, c2.variante, () => entradaC(c2.variante, 10))
  await hace(3, ctx.c, c2.variante, () => ventaC(c2.variante, 4))
  return { c1, c2 }
}

test('17 · con costos: lo que costó lo vendido en el periodo, lo que vale todo el inventario y los días que cubre; lo que no tiene costo se cuenta aparte', async () => {
  await ledgerDeValor()
  const v = await rotacion({ dias: 30 }, { empresa: 'c' })
  assert.ok(v.valorado)
  assert.equal(v.valorado.costoDeVentas, costo('150'), '30 × 5; las 4 sin costo no suman')
  assert.equal(v.valorado.unidadesSinCosto, 4)
  assert.equal(v.valorado.valorInventario, costo('350'), '70 × 5; las 6 unidades sin costo no valen cero: no suman')
  assert.equal(v.valorado.diasDeInventario, 70, '350 de inventario sobre 5 de costo de ventas por día')
  assert.equal(v.unidadesVendidas, 34)
  // Con 90 días el ritmo diario baja: más días de cobertura.
  const d90 = await rotacion({ dias: 90 }, { empresa: 'c' })
  assert.equal(d90.valorado!.diasDeInventario, 210)
  // Con 5 días solo cuenta la venta de hace 3 (sin costo): la de hace 10 días ya no entra en el costo de ventas.
  const d5 = await rotacion({ dias: 5 }, { empresa: 'c' })
  assert.equal(d5.valorado!.costoDeVentas, BigInt(0))
  assert.equal(d5.valorado!.unidadesSinCosto, 4)
  assert.equal(d5.valorado!.diasDeInventario, null, 'sin costo de ventas no hay ritmo con que medirlo')
})

test('17b · la sucursal acota también el costo de ventas y el valor del inventario', async () => {
  await ledgerDelKardex()
  const todas = await rotacion({ dias: 30 })
  assert.ok(todas.valorado!.costoDeVentas > BigInt(0) && todas.valorado!.valorInventario > BigInt(0), 'la empresa tiene ventas y existencias valoradas')
  const cerrada = await rotacion({ dias: 30, sucursalId: ctx.sucCerrada })
  assert.deepEqual([cerrada.valorado!.costoDeVentas, cerrada.valorado!.valorInventario], [BigInt(0), BigInt(0)], 'en una sucursal sin ventas ni existencias valoradas, nada')
  const norte = await rotacion({ dias: 30, sucursalId: ctx.sucA2 })
  assert.ok(norte.valorado!.valorInventario < todas.valorado!.valorInventario, 'una sucursal vale menos que todas')
})

test('18 · sin la función de costos, la rotación no calcula ni devuelve nada valorado', async () => {
  await ledgerDeValor()
  const v = await rotacion({ dias: 30 }, { empresa: 'c', conCostos: false })
  assert.equal(v.valorado, null)
  assert.equal(v.unidadesVendidas, 34)
  assert.ok(v.filas.length >= 2)
})

test('19 · el costo de ventas de un rango incluye el comienzo y no el final, y el valor total puede ser de una sola sucursal', async () => {
  const { c1 } = await ledgerDeValor()
  const dia = async (hasta: Date, desde: Date) => enC((tx) => costoDeVentasEnRangoEnTx(tx, ctx.c, { gte: desde, lt: hasta }))
  const venta = (await prisma.inventoryMovement.findFirstOrThrow({ where: { companyId: ctx.c, type: 'SALE', level: { catalogVariantId: c1.variante } }, select: { createdAt: true } })).createdAt
  assert.equal((await dia(new Date(venta.getTime() + 1), venta)).costo, costo('150'), 'el comienzo del rango está incluido')
  assert.equal((await dia(venta, new Date(venta.getTime() - DIA))).costo, BigInt(0), 'el final del rango está excluido')
  const r = await dia(new Date(venta.getTime() + 1), venta)
  assert.deepEqual([r.unidadesVendidas, r.unidadesDevueltas, r.unidadesSinCosto], [30, 0, 0])
  const total = await enC((tx) => valorTotalEnTx(tx, ctx.c))
  assert.deepEqual([total.valor, total.unidades, total.unidadesSinCosto], [costo('350'), 76, 6])
  const sucursal = await enC((tx) => valorTotalEnTx(tx, ctx.c, ctx.sucC))
  assert.deepEqual([sucursal.valor, sucursal.unidades], [costo('350'), 76])
  const otra = await enC((tx) => valorTotalEnTx(tx, ctx.c, 'sucursal-que-no-existe'))
  assert.deepEqual([otra.valor, otra.unidades, otra.unidadesSinCosto], [BigInt(0), 0, 0])
})

test('19b · lo que vale todo el inventario cuenta lo dañado, usa el costo de referencia cuando no hay promedio y deja aparte lo que no tiene ninguno', async () => {
  const antes = await enA((tx) => valorTotalEnTx(tx, ctx.a, ctx.sucA2))
  const conPromedio = await producto('Valor promedio')
  const soloReferencia = await producto('Valor referencia')
  const sinNada = await producto('Valor sin costo')
  await prisma.catalogVariant.update({ where: { id: soloReferencia.variante }, data: { cost: '3' } })
  await entradaA(ctx.sucA2, conPromedio.variante, 10, '2')
  await enA((tx) => danarEnTx(tx, ctx.a, { varianteId: conPromedio.variante, sucursalId: ctx.sucA2, cantidad: 3, motivo: 'Mojadas' }, como(ctx.usuario)))
  await entradaA(ctx.sucA2, soloReferencia.variante, 4)
  await entradaA(ctx.sucA2, sinNada.variante, 5)
  const despues = await enA((tx) => valorTotalEnTx(tx, ctx.a, ctx.sucA2))
  assert.equal(despues.unidades - antes.unidades, 10 + 4 + 5, 'vendibles y dañadas: 7 + 3, 4 y 5')
  assert.equal(despues.valor - antes.valor, costo('20') + costo('12'), '10 × 2 (con las 3 dañadas) + 4 × 3 del costo de referencia; lo que no tiene costo no suma')
  assert.equal(despues.unidadesSinCosto - antes.unidadesSinCosto, 5, 'solo las 5 unidades sin promedio ni referencia')
})

test('20 · cada empresa ve solo lo suyo en los tres informes', async () => {
  const p = await ledgerDelKardex()
  const { tag, s3 } = await ledgerSinVentas()
  const ajeno = await enB((tx) => sinVentasEnTx(tx, ctx.b, { dias: 90, pagina: 1, q: tag }, { conCostos: true }))
  assert.equal(ajeno.total, 0)
  assert.equal(ajeno.filas.some((f) => f.varianteId === s3.variante), false)
  const rot = await enB((tx) => rotacionEnTx(tx, ctx.b, { dias: 30, pagina: 1 }, { conCostos: true }))
  assert.equal(rot.filas.some((f) => f.varianteId === p.variante), false)
  assert.equal(rot.valorado?.costoDeVentas, BigInt(0))
  assert.equal(rot.valorado?.valorInventario, BigInt(0))
})

test('21 · buscar el producto del kardex: lo exacto primero, solo lo que tiene (o tuvo) saldo, descontinuado incluido, de la empresa y con tope', async () => {
  const p1 = await producto('Zeta')
  const p2 = await producto(`Alfa ${p1.sku}`)
  const p3 = await producto(`Beta ${p1.sku}`) // sin saldo: nunca tuvo existencias
  await entradaA(ctx.sucA1, p1.variante, 3)
  await entradaA(ctx.sucA1, p2.variante, 4)
  await entradaA(ctx.sucA2, p2.variante, 2)
  await enA((tx) => danarEnTx(tx, ctx.a, { varianteId: p1.variante, sucursalId: ctx.sucA1, cantidad: 1, motivo: 'Rota' }, como(ctx.usuario)))
  const buscar = (q: string, empresa: 'a' | 'b' = 'a') => (empresa === 'a' ? enA : enB)((tx) => buscarProductosParaKardexEnTx(tx, empresa === 'a' ? ctx.a : ctx.b, q))

  const r = await buscar(p1.sku.toLowerCase())
  assert.deepEqual(r.map((x) => x.id), [p1.variante, p2.variante], 'el SKU exacto va antes que el nombre que solo lo contiene, aunque alfabéticamente vaya después')
  assert.deepEqual(r.map((x) => x.existencia), [3, 6], 'la existencia es la física de todas las sucursales, con lo dañado (2 vendibles + 1 dañada)')
  assert.equal(r[0].nombre, p1.nombre)
  assert.equal(r[0].sku, p1.sku)
  assert.equal(r.some((x) => x.id === p3.variante), false, 'sin saldo no hay kardex que ver')

  // Descontinuar no esconde su historia.
  await prisma.catalogVariant.update({ where: { id: p2.variante }, data: { status: 'DISCONTINUED' } })
  assert.equal((await buscar(p1.sku)).some((x) => x.id === p2.variante), true)

  // Texto vacío o en blanco no busca nada; la búsqueda por nombre no distingue mayúsculas.
  assert.deepEqual(await buscar(''), [])
  assert.deepEqual(await buscar('   '), [])
  assert.equal((await buscar(p1.nombre.toUpperCase())).some((x) => x.id === p1.variante), true)

  // Cada empresa busca solo entre lo suyo, y los comodines del texto no son comodines.
  await enB((tx) => registrarEntradaMultipleEnTx(tx, ctx.b, { sucursalId: ctx.sucB, lineas: [{ varianteId: ctx.varianteB, cantidad: 2 }] }, como(ctx.usuario)))
  assert.equal((await buscar(`Ajeno ${sufijo}`, 'b')).length, 1)
  assert.deepEqual(await buscar(`Ajeno ${sufijo}`), [], 'lo de otra empresa no aparece')
  assert.deepEqual(await buscar(p1.sku, 'b'), [])
  assert.deepEqual(await buscar('%'), [], 'un % no es «todo»')

  // El tope: nadie recibe cientos de resultados.
  const tag = `Tope ${contador}`
  let ultimo = ''
  for (let i = 0; i < TOPE_BUSQUEDA_KARDEX + 1; i++) {
    const x = await producto(tag)
    await entradaA(ctx.sucA1, x.variante, 1)
    ultimo = x.variante
  }
  assert.equal((await buscar(tag)).length, TOPE_BUSQUEDA_KARDEX)
  // Una coincidencia exacta de código de barras que alfabéticamente queda fuera de las primeras 15 suma 16: el tope manda igual.
  await prisma.catalogVariant.update({ where: { id: ultimo }, data: { barcode: tag } })
  const conExacta = await buscar(tag)
  assert.equal(conExacta.length, TOPE_BUSQUEDA_KARDEX, 'nunca más del tope')
  assert.equal(conExacta[0].id, ultimo, 'y lo exacto va primero')
})
