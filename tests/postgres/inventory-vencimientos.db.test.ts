import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { cambiarEstadoItemEnTx, crearItemEnTx } from '../../src/modules/catalog/service'
import { activarLotesEnTx, danarEnTx, registrarEntradaMultipleEnTx, reservarEnTx } from '../../src/modules/inventory/service'
import { barridoInventario } from '../../src/modules/inventory/barrido'
import { avisarVencimientos } from '../../src/modules/inventory/avisos'
import { resumenInventarioEmpresa } from '../../src/modules/inventory/dashboard'
import { costoDeDecimal } from '../../src/modules/inventory/costos'
import { resumenVencimientosEnTx, vencimientosEnTx, type VencimientosVista } from '../../src/modules/inventory/vencimientos-queries'
import { FILAS_POR_PAGINA_VENCIMIENTOS, type FiltrosVencimientos } from '../../src/modules/inventory/vencimientos'

/**
 * INV-5b1 · LO QUE VENCE PRONTO contra PostgreSQL de verdad, con el SERVICIO real (activar lotes, recibir con lotes, apartar, dañar) y los
 * informes y avisos encima: la ventana y su último día, el orden, lo vendible / apartado / dañado, la búsqueda y la sucursal, el día de
 * la empresa (no el del servidor), los costos (solo con la función), las páginas y el archivo, el aislamiento entre empresas, el
 * resumen de la tarjeta del dashboard y los avisos del barrido (una vez por semana y nivel, y una vez por día).
 *
 * Las fechas de las pruebas son SIEMPRE «hoy = 2027-06-15» para la empresa (`AHORA`): se pasa en cada lectura, así que nada depende del
 * reloj del día en que se corra.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const ZONA = 'America/Santo_Domingo'
/** 12:00 en Santo Domingo del 15-jun-2027 (semana ISO 2027-W24). */
const AHORA = new Date('2027-06-15T16:00:00.000Z')
const dia = (s: string) => new Date(`${s}T16:00:00.000Z`)

const ctx = { a: '', b: '', c: '', d: '', f: '', usuario: '', adminC: '', adminF: '', adminB: '', suc1: '', suc2: '', sucB: '', sucC1: '', sucC2: '', sucD: '', sucF: '' }
type Transaccion = Parameters<Parameters<typeof conEmpresa>[1]>[0]
const en = <T,>(empresa: string, fn: (tx: Transaccion) => Promise<T>) => conEmpresa(empresa, fn)
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

let contador = 0
/** Un producto físico ACTIVO de la empresa dada. Devuelve su variante y su SKU. */
async function producto(empresa: string, nombre = 'Vence'): Promise<{ id: string; sku: string }> {
  const n = ++contador
  const sku = `VP-${n}-${sufijo}`.toUpperCase()
  const r = await en(empresa, (tx) => crearItemEnTx(tx, empresa, { name: `${nombre} ${n} ${sufijo}`, type: 'PHYSICAL_PRODUCT', price: 10, sku }, como(ctx.usuario)))
  await en(empresa, (tx) => cambiarEstadoItemEnTx(tx, empresa, r.id, 'ACTIVE', como(ctx.usuario)))
  const v = await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })
  return { id: v.id, sku }
}

interface LoteEntrante {
  codigo: string
  vencimiento?: string | null
  cantidad: number
}

/** Activa los lotes del producto (si hace falta) y recibe estos lotes en la sucursal. */
async function recibir(empresa: string, sucursalId: string, v: string, lotes: LoteEntrante[], costo?: string): Promise<void> {
  if (!(await prisma.inventoryLotTracking.findUnique({ where: { catalogVariantId: v } }))) {
    await en(empresa, (tx) => activarLotesEnTx(tx, empresa, { varianteId: v, ahora: AHORA }, como(ctx.usuario)))
  }
  await en(empresa, (tx) =>
    registrarEntradaMultipleEnTx(
      tx,
      empresa,
      { sucursalId, lineas: [{ varianteId: v, cantidad: lotes.reduce((s, l) => s + l.cantidad, 0), lotes, ...(costo ? { costo } : {}) }], ahora: AHORA },
      como(ctx.usuario)
    )
  )
}

const apartar = (empresa: string, sucursalId: string, v: string, cantidad: number) =>
  en(empresa, (tx) => reservarEnTx(tx, empresa, { varianteId: v, sucursalId, cantidad, ttlMinutos: 7 * 24 * 60, ahora: AHORA }, como(ctx.usuario)))

const danar = (empresa: string, sucursalId: string, v: string, cantidad: number) =>
  en(empresa, (tx) => danarEnTx(tx, empresa, { varianteId: v, sucursalId, cantidad, motivoCodigo: 'HANDLING', exigirMotivoCodificado: true }, como(ctx.usuario)))

/** El informe de la empresa dada con estos filtros (por omisión: la ventana de siempre, la primera página). */
function informe(empresa: string, f: Partial<FiltrosVencimientos> = {}, o: { conCostos?: boolean; todas?: boolean; ahora?: Date } = {}): Promise<VencimientosVista> {
  return en(empresa, (tx) => vencimientosEnTx(tx, empresa, { dias: 30, pagina: 1, ...f }, { zonaHoraria: ZONA, conCostos: o.conCostos ?? false, todas: o.todas, ahora: o.ahora ?? AHORA }))
}

const codigos = (v: VencimientosVista) => v.filas.map((f) => f.codigo)

before(async () => {
  const mk = (x: string) => prisma.company.create({ data: { name: `Vence ${x} ${sufijo}`, slug: `vence-${x}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo', zonaHoraria: ZONA }, select: { id: true } })
  const [a, b, c, d, f] = await Promise.all([mk('a'), mk('b'), mk('c'), mk('d'), mk('f')])
  ctx.a = a.id
  ctx.b = b.id
  ctx.c = c.id
  ctx.d = d.id
  ctx.f = f.id
  const usuario = (x: string, role: 'SUPERADMIN' | 'ADMINISTRADOR', companyId?: string) =>
    prisma.user.create({ data: { supabaseId: `sb-vp-${x}-${sufijo}`, email: `vp-${x}-${sufijo}@prueba.test`, name: `Vence ${x}`, role, ...(companyId ? { companyId } : {}) }, select: { id: true } }).then((u) => u.id)
  ctx.usuario = await usuario('actor', 'SUPERADMIN')
  ctx.adminC = await usuario('admin-c', 'ADMINISTRADOR', ctx.c)
  ctx.adminF = await usuario('admin-f', 'ADMINISTRADOR', ctx.f)
  ctx.adminB = await usuario('admin-b', 'ADMINISTRADOR', ctx.b)
  const suc = (companyId: string, nombre: string) => prisma.sucursal.create({ data: { companyId, nombre }, select: { id: true } }).then((s) => s.id)
  ctx.suc1 = await suc(ctx.a, 'Principal')
  ctx.suc2 = await suc(ctx.a, 'Norte')
  ctx.sucB = await suc(ctx.b, 'De B')
  ctx.sucC1 = await suc(ctx.c, 'Centro')
  ctx.sucC2 = await suc(ctx.c, 'Este')
  ctx.sucD = await suc(ctx.d, 'Sola')
  ctx.sucF = await suc(ctx.f, 'Única')
})

after(async () => {
  const ids = [ctx.a, ctx.b, ctx.c, ctx.d, ctx.f]
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      for (const tabla of [
        'inventory_movement_lots',
        'inventory_lot_openings',
        'inventory_lot_balances',
        'inventory_lots',
        'inventory_lot_tracking',
        'inventory_receipt_lines',
        'inventory_receipts',
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
  await prisma.notificacion.deleteMany({ where: { userId: { in: [ctx.adminC, ctx.adminF, ctx.adminB] } } })
  await prisma.auditLog.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.catalogItem.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.sucursal.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: [ctx.usuario, ctx.adminC, ctx.adminF, ctx.adminB] } } })
  await prisma.company.deleteMany({ where: { id: { in: ids } } })
  await prisma.$disconnect()
})

// ── El informe ───────────────────────────────────────────────────────────────

test('1 · la ventana: lo vencido y lo que vence en N días (el último día entra, el siguiente no), de lo que antes vence a lo que después; sin fecha y lejano nunca salen', async () => {
  const p = await producto(ctx.a)
  await recibir(ctx.a, ctx.suc1, p.id, [
    { codigo: 'VENCIDO-A', vencimiento: '2027-06-10', cantidad: 4 },
    { codigo: 'HOY', vencimiento: '2027-06-15', cantidad: 3 },
    { codigo: 'D5', vencimiento: '2027-06-20', cantidad: 5 },
    { codigo: 'D30', vencimiento: '2027-07-15', cantidad: 6 },
    { codigo: 'D31', vencimiento: '2027-07-16', cantidad: 7 },
    { codigo: 'SIN-FECHA', cantidad: 8 },
    { codigo: 'LEJANO', vencimiento: '2028-01-01', cantidad: 9 },
  ])
  const v = await informe(ctx.a, { q: p.sku })
  assert.deepEqual(codigos(v), ['VENCIDO-A', 'HOY', 'D5', 'D30'])
  assert.deepEqual(v.filas.map((f) => f.clase), ['VENCIDO', 'POR_VENCER', 'POR_VENCER', 'POR_VENCER'], 'vence hoy todavía se vende: por vencer, no vencido')
  assert.deepEqual(v.filas.map((f) => f.diasRestantes), [-5, 0, 5, 30])
  assert.deepEqual(v.filas.map((f) => f.urgencia), ['VENCIDO', 'URGENTE', 'URGENTE', 'PRONTO'])
  assert.deepEqual(v.filas.map((f) => f.texto), ['Venció hace 5 días', 'Vence hoy', 'Vence en 5 días', 'Vence en 30 días'])
  assert.deepEqual(v.filas.map((f) => f.vencimiento), ['2027-06-10', '2027-06-15', '2027-06-20', '2027-07-15'])
  assert.deepEqual(v.filas.map((f) => f.vendible), [4, 3, 5, 6])
  assert.equal(v.hoy, '2027-06-15')
  assert.deepEqual([v.total, v.resumen.lotes, v.resumen.lotesVencidos, v.resumen.unidades], [4, 4, 1, 18])
  assert.equal(v.filas[0].nombre.includes(sufijo), true)
  assert.equal(v.filas[0].sku, p.sku)

  assert.deepEqual(codigos(await informe(ctx.a, { q: p.sku, dias: 7 })), ['VENCIDO-A', 'HOY', 'D5'], 'con 7 días, sin el del día 30')
  assert.deepEqual(codigos(await informe(ctx.a, { q: p.sku, dias: 15 })), ['VENCIDO-A', 'HOY', 'D5'])
  assert.deepEqual(codigos(await informe(ctx.a, { q: p.sku, dias: 90 })), ['VENCIDO-A', 'HOY', 'D5', 'D30', 'D31'], 'con 90, el del día 31 sí; el de 2028 no')
  assert.deepEqual(codigos(await informe(ctx.a, { q: p.sku, clase: 'VENCIDO' })), ['VENCIDO-A'])
  assert.deepEqual(codigos(await informe(ctx.a, { q: p.sku, clase: 'POR_VENCER' })), ['HOY', 'D5', 'D30'])
  const sinAlgoQueVenza = await informe(ctx.a, { q: `${p.sku}-NO-EXISTE` })
  assert.deepEqual([sinAlgoQueVenza.filas.length, sinAlgoQueVenza.total, sinAlgoQueVenza.resumen.lotes, sinAlgoQueVenza.resumen.unidades], [0, 0, 0, 0])
})

test('2 · lo vendible es lo que hay menos lo apartado; lo apartado y lo dañado se enseñan aparte; un lote solo con dañado no sale y uno todo apartado sí', async () => {
  const p = await producto(ctx.a)
  // L3 queda solo con dañado (no sale); luego L2 (todo apartado) y L1 (parte apartada y parte dañada).
  await recibir(ctx.a, ctx.suc1, p.id, [{ codigo: 'L3', vencimiento: '2027-06-17', cantidad: 2 }])
  await danar(ctx.a, ctx.suc1, p.id, 2)
  await recibir(ctx.a, ctx.suc1, p.id, [
    { codigo: 'L2', vencimiento: '2027-06-18', cantidad: 3 },
    { codigo: 'L1', vencimiento: '2027-06-20', cantidad: 10 },
  ])
  await apartar(ctx.a, ctx.suc1, p.id, 3) // por FEFO: las 3 de L2
  await apartar(ctx.a, ctx.suc1, p.id, 4) // y 4 de L1
  await danar(ctx.a, ctx.suc1, p.id, 2) // 2 de L1 (lo único vendible que queda)
  const v = await informe(ctx.a, { q: p.sku })
  assert.deepEqual(codigos(v), ['L2', 'L1'], 'L3 solo tiene dañado: ya salió de lo vendible')
  assert.deepEqual(v.filas.map((f) => [f.vendible, f.apartado, f.danado]), [[0, 3, 0], [4, 4, 2]])
  assert.equal(v.resumen.unidades, 4, 'lo apartado no se cuenta como vendible')
  assert.deepEqual([v.total, v.resumen.lotes], [2, 2])
})

test('3 · la búsqueda (producto, SKU, código de barras, lote) y la sucursal; un lote en dos sucursales es UN lote distinto y dos filas; los comodines del texto no son comodines', async () => {
  const p = await producto(ctx.a, 'Busca')
  await prisma.catalogVariant.update({ where: { id: p.id }, data: { barcode: `BC-${sufijo}` } })
  await recibir(ctx.a, ctx.suc1, p.id, [{ codigo: 'BUS-1', vencimiento: '2027-06-25', cantidad: 5 }])
  await recibir(ctx.a, ctx.suc2, p.id, [{ codigo: 'BUS-1', vencimiento: '2027-06-25', cantidad: 2 }])
  const otro = await producto(ctx.a, 'Otro')
  await recibir(ctx.a, ctx.suc1, otro.id, [{ codigo: 'OTRO-9', vencimiento: '2027-06-26', cantidad: 1 }])

  const todos = await informe(ctx.a, { q: p.sku })
  assert.equal(todos.filas.length, 2)
  assert.deepEqual([todos.total, todos.resumen.lotes, todos.resumen.unidades], [2, 1, 7], 'dos filas, un lote distinto')
  assert.deepEqual(new Set(todos.filas.map((f) => f.sucursalNombre)), new Set(['Principal', 'Norte']))
  assert.equal(todos.filas[0].loteId, todos.filas[1].loteId)
  assert.deepEqual((await informe(ctx.a, { q: p.sku, sucursalId: ctx.suc2 })).filas.map((f) => f.sucursalNombre), ['Norte'])
  assert.equal((await informe(ctx.a, { q: p.sku, sucursalId: ctx.suc2 })).resumen.unidades, 2)

  for (const q of [`BC-${sufijo}`.toLowerCase(), 'bus-1', `Busca ${contador - 1}`, p.sku.slice(0, -2).toLowerCase()]) {
    const r = await informe(ctx.a, { q })
    assert.ok(r.filas.some((f) => f.varianteId === p.id), `«${q}» tiene que encontrarlo`)
  }
  assert.equal((await informe(ctx.a, { q: 'OTRO-9' })).filas.some((f) => f.varianteId === otro.id), true, 'el código de lote también busca')
  assert.equal((await informe(ctx.a, { q: 'bus-1' })).filas.some((f) => f.varianteId === otro.id), false)
  for (const comodin of ['%', '_', 'bus%1', '\\']) assert.equal((await informe(ctx.a, { q: comodin })).filas.length, 0, `«${comodin}» es texto, no un comodín`)
  // Una sucursal de otra empresa no cruza: no encuentra nada ni filtra las de esta.
  assert.equal((await informe(ctx.a, { q: p.sku, sucursalId: ctx.sucB })).filas.length, 0)
})

test('4 · «hoy» es el día de la EMPRESA: de noche en Santo Domingo ya es otro día en UTC, y el lote que vence ese día todavía se vende', async () => {
  const p = await producto(ctx.a, 'Zona')
  await recibir(ctx.a, ctx.suc1, p.id, [{ codigo: 'ZONA-15', vencimiento: '2027-06-15', cantidad: 3 }])
  // 02:00 UTC del 16-jun son las 22:00 del 15-jun allá: el lote del 15 vence HOY.
  const noche = await informe(ctx.a, { q: p.sku }, { ahora: new Date('2027-06-16T02:00:00Z') })
  assert.equal(noche.hoy, '2027-06-15')
  assert.deepEqual(noche.filas.map((f) => [f.clase, f.diasRestantes, f.texto]), [['POR_VENCER', 0, 'Vence hoy']])
  // A las 05:00 UTC (01:00 del 16-jun allá) ya venció.
  const madrugada = await informe(ctx.a, { q: p.sku }, { ahora: new Date('2027-06-16T05:00:00Z') })
  assert.equal(madrugada.hoy, '2027-06-16')
  assert.deepEqual(madrugada.filas.map((f) => [f.clase, f.diasRestantes, f.texto]), [['VENCIDO', -1, 'Venció ayer']])
  assert.equal(madrugada.resumen.lotesVencidos, 1)
})

test('5 · los costos solo con la función: con ella el valor de lo vendible y lo sin costo aparte; sin ella ni un costo, ni un valor, ni una cuenta de lo que falta', async () => {
  const marca = `Costos ${sufijo}`
  const p1 = await producto(ctx.a, marca)
  const p2 = await producto(ctx.a, marca)
  await recibir(ctx.a, ctx.suc1, p1.id, [{ codigo: 'C-1', vencimiento: '2027-06-20', cantidad: 6 }], '10')
  await apartar(ctx.a, ctx.suc1, p1.id, 1)
  await recibir(ctx.a, ctx.suc1, p2.id, [{ codigo: 'C-2', vencimiento: '2027-06-22', cantidad: 3 }]) // sin costo
  const con = await informe(ctx.a, { q: marca }, { conCostos: true })
  assert.equal(con.filas.length, 2)
  const f1 = con.filas.find((f) => f.varianteId === p1.id)!
  const f2 = con.filas.find((f) => f.varianteId === p2.id)!
  assert.deepEqual([f1.vendible, f1.apartado], [5, 1])
  assert.equal(f1.costo, costoDeDecimal('10'))
  assert.equal(f1.valor, costoDeDecimal('50'), 'el valor es lo VENDIBLE por el costo (5 × 10), sin lo apartado')
  assert.deepEqual([f2.costo, f2.valor], [null, null], 'sin costo no vale cero: no se sabe')
  assert.equal(con.resumen.valor, costoDeDecimal('50'))
  assert.equal(con.resumen.unidadesSinCosto, 3)
  assert.equal(con.resumen.unidades, 8)

  const sin = await informe(ctx.a, { q: marca }, { conCostos: false })
  assert.equal(sin.filas.length, 2)
  for (const f of sin.filas) assert.deepEqual([f.costo, f.valor], [null, null])
  assert.deepEqual([sin.resumen.valor, sin.resumen.unidadesSinCosto], [null, null])
  assert.equal(sin.resumen.unidades, 8, 'las unidades sí')
})

test('6 · páginas y archivo: 55 lotes en 50 por página, ni uno repetido ni uno perdido, en orden de vencimiento a través de las páginas; «todas» los trae todos', async () => {
  const p = await producto(ctx.a, 'Páginas')
  const lote = (i: number): LoteEntrante => ({ codigo: `PG-${String(i).padStart(2, '0')}`, vencimiento: `2027-06-${String(16 + (i % 14)).padStart(2, '0')}`, cantidad: 1 })
  await recibir(ctx.a, ctx.suc1, p.id, Array.from({ length: 20 }, (_, i) => lote(i)))
  await recibir(ctx.a, ctx.suc1, p.id, Array.from({ length: 20 }, (_, i) => lote(20 + i)))
  await recibir(ctx.a, ctx.suc1, p.id, Array.from({ length: 15 }, (_, i) => lote(40 + i)))
  assert.equal(FILAS_POR_PAGINA_VENCIMIENTOS, 50)
  const p1 = await informe(ctx.a, { q: p.sku, pagina: 1 })
  const p2 = await informe(ctx.a, { q: p.sku, pagina: 2 })
  const todas = await informe(ctx.a, { q: p.sku }, { todas: true })
  assert.deepEqual([p1.total, p2.total, todas.total], [55, 55, 55])
  assert.deepEqual([p1.filas.length, p2.filas.length, todas.filas.length], [50, 5, 55])
  assert.deepEqual([p1.pagina, p2.pagina, todas.pagina], [1, 2, 1])
  const juntas = [...p1.filas, ...p2.filas].map((f) => f.saldoPorLoteId)
  assert.equal(new Set(juntas).size, 55, 'ni repetidos ni perdidos')
  assert.deepEqual(juntas, todas.filas.map((f) => f.saldoPorLoteId), 'las páginas son el mismo orden del archivo')
  const fechas = todas.filas.map((f) => f.vencimiento)
  assert.deepEqual(fechas, [...fechas].sort(), 'de lo que antes vence a lo que después')
  assert.equal(p1.resumen.unidades, 55, 'el resumen es de todo lo que cumple los filtros, no de la página')
  assert.equal(p1.resumen.lotes, 55)
  assert.equal((await informe(ctx.a, { q: p.sku, pagina: 3 })).filas.length, 0, 'una página de más no revienta')
})

test('7 · otra empresa no se ve: ni sus lotes, ni su sucursal, ni en el resumen', async () => {
  const pa = await producto(ctx.a, 'Aislada')
  const pb = await producto(ctx.b, 'Aislada')
  await recibir(ctx.a, ctx.suc1, pa.id, [{ codigo: 'AIS-A', vencimiento: '2027-06-20', cantidad: 4 }])
  await recibir(ctx.b, ctx.sucB, pb.id, [{ codigo: 'AIS-B', vencimiento: '2027-06-20', cantidad: 9 }])
  const deA = await informe(ctx.a, { q: 'AIS-' })
  assert.deepEqual(codigos(deA).filter((c) => c.startsWith('AIS-')), ['AIS-A'])
  const deB = await informe(ctx.b, { q: 'AIS-' })
  assert.deepEqual(codigos(deB), ['AIS-B'])
  assert.equal(deB.resumen.unidades, 9)
  assert.equal((await informe(ctx.a, { q: 'AIS-B' })).filas.length, 0, 'el lote de B no se encuentra desde A, ni escribiendo su código')
  assert.equal((await informe(ctx.b, { sucursalId: ctx.suc1 })).filas.length, 0, 'la sucursal de A no filtra ni cruza en B')
})

// ── El resumen de la tarjeta y de los avisos ─────────────────────────────────

test('8 · el resumen: lotes DISTINTOS por vencer (un lote en dos sucursales cuenta una vez), cuántos urgentes, cuántos vencidos con existencias, y unidades vendibles; sin lotes no hay nada que vigilar', async () => {
  const p1 = await producto(ctx.c, 'Resumen')
  await recibir(ctx.c, ctx.sucC1, p1.id, [
    { codigo: 'X', vencimiento: '2027-06-18', cantidad: 5 },
    { codigo: 'Y', vencimiento: '2027-07-10', cantidad: 4 },
    { codigo: 'Z', vencimiento: '2027-06-10', cantidad: 3 },
    { codigo: 'W', vencimiento: '2027-09-01', cantidad: 6 },
    { codigo: 'N', cantidad: 7 },
  ])
  await recibir(ctx.c, ctx.sucC2, p1.id, [{ codigo: 'X', vencimiento: '2027-06-18', cantidad: 2 }])
  const r = await en(ctx.c, (tx) => resumenVencimientosEnTx(tx, ctx.c, { zonaHoraria: ZONA, ahora: AHORA }))
  assert.deepEqual(r, { hoy: '2027-06-15', dias: 30, llevaLotes: true, porVencer: { lotes: 2, urgentes: 1, unidades: 11 }, vencidos: { lotes: 1, unidades: 3 } })
  const corta = await en(ctx.c, (tx) => resumenVencimientosEnTx(tx, ctx.c, { zonaHoraria: ZONA, ahora: AHORA, dias: 7 }))
  assert.deepEqual([corta.dias, corta.porVencer.lotes, corta.porVencer.unidades], [7, 1, 7], 'con 7 días solo X (en sus dos sucursales)')
  // De noche en Santo Domingo sigue siendo el día de la empresa.
  const alba = await en(ctx.c, (tx) => resumenVencimientosEnTx(tx, ctx.c, { zonaHoraria: ZONA, ahora: new Date('2027-06-19T05:00:00Z') }))
  assert.equal(alba.hoy, '2027-06-19')
  assert.deepEqual([alba.porVencer.lotes, alba.vencidos.lotes], [1, 2], 'X (18-jun) ya venció el 19')
  // Una empresa sin lotes no tiene qué vigilar, aunque tenga existencias.
  const sinLotes = await producto(ctx.d, 'SinLotes')
  await en(ctx.d, (tx) => registrarEntradaMultipleEnTx(tx, ctx.d, { sucursalId: ctx.sucD, lineas: [{ varianteId: sinLotes.id, cantidad: 5 }], ahora: AHORA }, como(ctx.usuario)))
  const d = await en(ctx.d, (tx) => resumenVencimientosEnTx(tx, ctx.d, { zonaHoraria: ZONA, ahora: AHORA }))
  assert.deepEqual(d, { hoy: '2027-06-15', dias: 30, llevaLotes: false, porVencer: { lotes: 0, urgentes: 0, unidades: 0 }, vencidos: { lotes: 0, unidades: 0 } })
  // La tarjeta del dashboard trae exactamente este resumen, también sin la función de costos.
  const t = await resumenInventarioEmpresa(ctx.c, ZONA, { conCostos: false, ahora: AHORA })
  assert.deepEqual(t.vencimientos, r)
  const tCon = await resumenInventarioEmpresa(ctx.c, ZONA, { conCostos: true, ahora: AHORA })
  assert.deepEqual(tCon.vencimientos, r, 'el resumen no depende de los costos')
  assert.equal((await resumenInventarioEmpresa(ctx.d, ZONA, { conCostos: false, ahora: AHORA })).vencimientos.llevaLotes, false)
})

const avisosDe = (adminId: string, prefijo: string) => prisma.notificacion.findMany({ where: { userId: adminId, dedupeKey: { startsWith: prefijo } }, select: { titulo: true, mensaje: true, href: true, tipo: true, dedupeKey: true }, orderBy: { dedupeKey: 'asc' } })

test('9 · el aviso de lotes por vencer: una vez por semana y nivel de urgencia (la escalada a urgente avisa otra vez), solo a los administradores de SU empresa y nada a quien no lleva lotes', async () => {
  const por = `lotes-por-vencer:${ctx.c}:`
  // Martes 15-jun (semana 24): X vence en 3 días (urgente), Y en 25.
  assert.equal(await avisarVencimientos(ctx.c, { ahora: AHORA }), 1)
  const a1 = await avisosDe(ctx.adminC, por)
  assert.equal(a1.length, 1)
  assert.equal(a1[0].dedupeKey, `${por}2027-W24:urgente`)
  assert.equal(a1[0].titulo, 'Lotes por vencer: hay urgentes')
  assert.equal(a1[0].tipo, 'SISTEMA')
  assert.equal(a1[0].href, '/admin/inventario/reportes/vencimientos')
  assert.match(a1[0].mensaje, /^2 lotes vencen en los próximos 30 días, 1 de ellos dentro de 7 días, con 11 unidades vendibles\./)
  // Lo mismo otra vez, y otro día de la misma semana: ya está avisado.
  assert.equal(await avisarVencimientos(ctx.c, { ahora: AHORA }), 0)
  assert.equal(await avisarVencimientos(ctx.c, { ahora: dia('2027-06-17') }), 0)
  assert.equal((await avisosDe(ctx.adminC, por)).length, 1)
  // La semana siguiente (25): X ya venció; solo Y (a 19 días): nivel normal, otro aviso.
  assert.equal(await avisarVencimientos(ctx.c, { ahora: dia('2027-06-21') }), 1)
  assert.deepEqual((await avisosDe(ctx.adminC, por)).map((x) => x.dedupeKey), [`${por}2027-W24:urgente`, `${por}2027-W25:normal`])
  assert.match((await avisosDe(ctx.adminC, `${por}2027-W25`))[0].mensaje, /^1 lote vence en los próximos 30 días, con 4 unidades vendibles\./)
  assert.equal((await avisosDe(ctx.adminC, `${por}2027-W25`))[0].titulo, 'Lotes por vencer')
  // Escalada dentro de una misma semana (26): primero normal, luego aparece un lote urgente y avisa de nuevo, una sola vez.
  assert.equal(await avisarVencimientos(ctx.c, { ahora: dia('2027-07-01') }), 1)
  const e = await producto(ctx.c, 'Escalada')
  await recibir(ctx.c, ctx.sucC1, e.id, [{ codigo: 'E-URG', vencimiento: '2027-07-05', cantidad: 2 }])
  assert.equal(await avisarVencimientos(ctx.c, { ahora: dia('2027-07-01') }), 1)
  assert.equal(await avisarVencimientos(ctx.c, { ahora: dia('2027-07-01') }), 0)
  assert.deepEqual((await avisosDe(ctx.adminC, `${por}2027-W26`)).map((x) => x.dedupeKey), [`${por}2027-W26:normal`, `${por}2027-W26:urgente`])
  // Nada a quien no corresponde: ni los administradores de otra empresa, ni una empresa que no lleva lotes.
  assert.equal((await prisma.notificacion.count({ where: { userId: ctx.adminB, dedupeKey: { startsWith: 'lotes-' } } })), 0)
  assert.equal(await avisarVencimientos(ctx.d, { ahora: AHORA }), 0)
  assert.equal(await avisarVencimientos(ctx.d, { ahora: AHORA, vencidos: { lotes: 0, unidades: 0 } }), 0)
})

test('10 · el aviso de lo vencido: una vez por día y solo si el barrido sacó unidades', async () => {
  const venc = `lotes-vencidos:${ctx.c}:`
  const antes = (await avisosDe(ctx.adminC, venc)).length
  assert.equal(await avisarVencimientos(ctx.c, { ahora: dia('2027-06-16'), vencidos: { lotes: 0, unidades: 0 } }), 0, 'sin unidades no hay aviso')
  assert.equal(await avisarVencimientos(ctx.c, { ahora: dia('2027-06-16'), vencidos: { lotes: 2, unidades: 9 } }), 1)
  const a = await avisosDe(ctx.adminC, venc)
  assert.equal(a.length, antes + 1)
  const hoy = a.find((x) => x.dedupeKey === `${venc}2027-06-16`)!
  assert.equal(hoy.titulo, 'Mercancía vencida')
  assert.equal(hoy.href, '/admin/inventario/reportes/mermas?motivo=EXPIRED')
  assert.match(hoy.mensaje, /^Venció 2 lotes y 9 unidades pasaron de vendible a dañado \(motivo «Vencido»\)\./)
  assert.equal(await avisarVencimientos(ctx.c, { ahora: dia('2027-06-16'), vencidos: { lotes: 5, unidades: 40 } }), 0, 'el mismo día no se repite, aunque las cifras cambien')
  assert.equal(await avisarVencimientos(ctx.c, { ahora: dia('2027-06-17'), vencidos: { lotes: 1, unidades: 1 } }), 1, 'otro día, otro aviso')
  assert.equal((await avisosDe(ctx.adminC, venc)).length, antes + 2)
})

test('11 · el barrido avisa: lo vencido que sacó, y lo que vence pronto aunque nada haya vencido todavía; una segunda pasada no repite nada', async () => {
  // Empresa F: nada vencido, solo un lote que vence en 20 días (hoy 15-jun).
  const pf = await producto(ctx.f, 'Barrido')
  await recibir(ctx.f, ctx.sucF, pf.id, [{ codigo: 'F-20', vencimiento: '2027-07-05', cantidad: 6 }])
  // Empresa nueva con un lote vencido hace 2 días y existencias: el barrido lo saca y avisa.
  const g = await prisma.company.create({ data: { name: `Vence g ${sufijo}`, slug: `vence-g-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo', zonaHoraria: ZONA }, select: { id: true } })
  const adminG = await prisma.user.create({ data: { supabaseId: `sb-vp-g-${sufijo}`, email: `vp-g-${sufijo}@prueba.test`, name: 'Admin g', role: 'ADMINISTRADOR', companyId: g.id }, select: { id: true } })
  const sucG = await prisma.sucursal.create({ data: { companyId: g.id, nombre: 'G' }, select: { id: true } })
  try {
    const pg = await producto(g.id, 'Vencido')
    await recibir(g.id, sucG.id, pg.id, [{ codigo: 'G-VIEJO', vencimiento: '2027-06-13', cantidad: 4 }])
    const r1 = await barridoInventario(AHORA)
    assert.ok(r1.unidadesVencidas >= 4, 'sacó lo vencido')
    assert.ok(r1.avisosDeVencimiento >= 2, 'y avisó a las empresas con algo que decir')
    const deG = await avisosDe(adminG.id, 'lotes-')
    assert.deepEqual(deG.map((x) => x.dedupeKey), [`lotes-vencidos:${g.id}:2027-06-15`])
    assert.match(deG[0].mensaje, /^Venció 1 lote y 4 unidades pasaron de vendible a dañado/)
    const deF = await avisosDe(ctx.adminF, 'lotes-')
    assert.deepEqual(deF.map((x) => x.dedupeKey), [`lotes-por-vencer:${ctx.f}:2027-W24:normal`], 'por vencer, sin que nada haya vencido: el barrido también recorre estas empresas')
    assert.match(deF[0].mensaje, /^1 lote vence en los próximos 30 días, con 6 unidades vendibles\./)
    // La empresa C ya tenía su aviso de la semana (prueba 9) y el barrido de C sacó su lote vencido (Z).
    assert.equal((await avisosDe(ctx.adminC, `lotes-por-vencer:${ctx.c}:2027-W24`)).length, 1, 'no se repite')
    assert.ok((await avisosDe(ctx.adminC, `lotes-vencidos:${ctx.c}:2027-06-15`)).length === 1, 'y avisó de lo que sacó')
    // Segunda pasada el mismo día: nada que sacar y nada que avisar.
    const r2 = await barridoInventario(AHORA)
    assert.equal(r2.unidadesVencidas, 0)
    assert.equal(r2.avisosDeVencimiento, 0)
    assert.equal(r2.empresasConError, 0)
    assert.equal((await avisosDe(adminG.id, 'lotes-')).length, 1)
  } finally {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      for (const tabla of ['inventory_movement_lots', 'inventory_lot_openings', 'inventory_lot_balances', 'inventory_lots', 'inventory_lot_tracking', 'inventory_receipt_lines', 'inventory_receipts', 'inventory_movements', 'inventory_reservations', 'inventory_levels']) {
        await tx.$executeRawUnsafe(`DELETE FROM "${tabla}" WHERE "companyId" = '${g.id}'`)
      }
    })
    await prisma.notificacion.deleteMany({ where: { userId: adminG.id } })
    await prisma.auditLog.deleteMany({ where: { companyId: g.id } })
    await prisma.catalogItem.deleteMany({ where: { companyId: g.id } })
    await prisma.sucursal.deleteMany({ where: { companyId: g.id } })
    await prisma.user.deleteMany({ where: { id: adminG.id } })
    await prisma.company.delete({ where: { id: g.id } })
  }
})
