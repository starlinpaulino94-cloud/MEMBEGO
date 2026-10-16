import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { crearItemEnTx } from '../../src/modules/catalog/service'
import { ajustarEnTx, contarEnTx, danarEnTx, registrarEntradaMultipleEnTx, resolverDanadoEnTx, venderEnTx } from '../../src/modules/inventory/service'
import { mermasEnTx, type MermasVista } from '../../src/modules/inventory/mermas-queries'
import { claseDeMovimiento, type CubetaDeMovimiento } from '../../src/modules/inventory/motivos'
import { FILTRO_SIN_MOTIVO, type FiltrosMermas } from '../../src/modules/inventory/mermas'
import { diaLocal, sumarDias } from '../../src/modules/reportes/rango'
import { parsearCosto, type Costo } from '../../src/modules/inventory/costos'

/**
 * INV-4b · INFORME DE MERMAS POR MOTIVO contra PostgreSQL de verdad.
 *
 * Lo que solo se puede comprobar aquí:
 *
 *  · qué cuenta como merma (faltantes y bajas), qué va aparte (sobrantes, daños) y qué no cuenta nunca (ventas, entradas,
 *    recuperar lo dañado, reservas);
 *  · que cada movimiento cae en el motivo con que se registró, que lo anterior a los motivos sale como «sin motivo codificado» y
 *    que los conteos ponen el suyo;
 *  · que la clase que calcula el SQL es la misma que calcula `claseDeMovimiento` en código;
 *  · los rangos de días (en el calendario de la empresa), los filtros (sucursal, motivo, producto), el orden, las páginas y el
 *    archivo; y que el costo no se LEE sin la función de costos;
 *  · que cada empresa ve solo lo suyo.
 *
 * Las fechas del ledger se mueven con `session_replication_role = replica` solo en estas pruebas.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })
const ZONA = 'America/Santo_Domingo'

const ctx = { a: '', b: '', usuario: '', suc1: '', suc2: '', sucB: '', varianteB: '' }
type Transaccion = Parameters<Parameters<typeof conEmpresa>[1]>[0]
const enA = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.a, fn)
const enB = <T,>(fn: (tx: Transaccion) => Promise<T>) => conEmpresa(ctx.b, fn)

const costo = (t: string): Costo => {
  const r = parsearCosto(t)
  assert.ok(r.ok, t)
  return r.valor
}

let contador = 0
async function producto(nombre: string): Promise<string> {
  const n = ++contador
  const r = await enA((tx) => crearItemEnTx(tx, ctx.a, { name: `${nombre} ${n} ${sufijo}`, type: 'PHYSICAL_PRODUCT', price: 100, sku: `MER-${n}-${sufijo}`.toUpperCase() }, como(ctx.usuario)))
  return (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })).id
}

before(async () => {
  const [a, b] = await Promise.all(['a', 'b'].map((x) => prisma.company.create({ data: { name: `Mermas ${x} ${sufijo}`, slug: `mermas-${x}-${sufijo}`, type: 'retail', ciudad: 'Santo Domingo', zonaHoraria: ZONA }, select: { id: true } })))
  ctx.a = a.id
  ctx.b = b.id
  ctx.usuario = (await prisma.user.create({ data: { supabaseId: `sb-mer-${sufijo}`, email: `mer-${sufijo}@prueba.test`, name: 'Encargada', role: 'SUPERADMIN' }, select: { id: true } })).id
  ctx.suc1 = (await prisma.sucursal.create({ data: { companyId: ctx.a, nombre: 'Principal' }, select: { id: true } })).id
  ctx.suc2 = (await prisma.sucursal.create({ data: { companyId: ctx.a, nombre: 'Norte' }, select: { id: true } })).id
  ctx.sucB = (await prisma.sucursal.create({ data: { companyId: ctx.b, nombre: 'De B' }, select: { id: true } })).id
  const r = await enB((tx) => crearItemEnTx(tx, ctx.b, { name: `Ajeno ${sufijo}`, type: 'PHYSICAL_PRODUCT', price: 100, sku: `MER-B-${sufijo}` }, como(ctx.usuario)))
  ctx.varianteB = (await prisma.catalogVariant.findFirstOrThrow({ where: { catalogItemId: r.id }, select: { id: true } })).id
})

after(async () => {
  const ids = [ctx.a, ctx.b]
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      for (const tabla of ['inventory_receipt_lines', 'inventory_receipts', 'inventory_variant_costs', 'inventory_movements', 'inventory_reservations', 'inventory_levels']) {
        await tx.$executeRawUnsafe(`DELETE FROM "${tabla}" WHERE "companyId" IN (${ids.map((i) => `'${i}'`).join(',')})`)
      }
    },
    { timeout: 60_000 }
  )
  await prisma.auditLog.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.catalogItem.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.sucursal.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: ctx.usuario } })
  await prisma.company.deleteMany({ where: { id: { in: ids } } })
  await prisma.$disconnect()
})

const idsDeMovimientos = async (v: string) => (await prisma.inventoryMovement.findMany({ where: { companyId: ctx.a, level: { catalogVariantId: v } }, select: { id: true } })).map((m) => m.id)

/** Hace `fn` y deja lo que escribió en el ledger hace `dias` días. */
async function hace<T>(dias: number, v: string, fn: () => Promise<T>): Promise<T> {
  const antes = new Set(await idsDeMovimientos(v))
  const r = await fn()
  const nuevos = (await idsDeMovimientos(v)).filter((id) => !antes.has(id))
  if (dias !== 0 && nuevos.length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      await tx.$executeRawUnsafe(`UPDATE "inventory_movements" SET "createdAt" = "createdAt" - interval '${dias} days' WHERE "id" IN (${nuevos.map((i) => `'${i}'`).join(',')})`)
    })
  }
  return r
}

const entrada = (v: string, cantidad: number, sucursalId = ctx.suc1, costoTexto?: string) =>
  enA((tx) => registrarEntradaMultipleEnTx(tx, ctx.a, { sucursalId, lineas: [{ varianteId: v, cantidad, ...(costoTexto ? { costo: costoTexto } : {}) }] }, como(ctx.usuario)))
const ajustar = (v: string, cambio: number, motivoCodigo: string | null, motivo?: string, sucursalId = ctx.suc1) =>
  enA((tx) => ajustarEnTx(tx, ctx.a, { varianteId: v, sucursalId, cambio, motivoCodigo, motivo }, como(ctx.usuario)))
const danar = (v: string, cantidad: number, motivoCodigo: string, sucursalId = ctx.suc1) =>
  enA((tx) => danarEnTx(tx, ctx.a, { varianteId: v, sucursalId, cantidad, motivoCodigo }, como(ctx.usuario)))
const resolver = (v: string, cantidad: number, destino: 'VENDIBLE' | 'BAJA', motivoCodigo: string | null, motivo?: string) =>
  enA((tx) => resolverDanadoEnTx(tx, ctx.a, { varianteId: v, sucursalId: ctx.suc1, cantidad, destino, motivoCodigo, motivo }, como(ctx.usuario)))

const hoy = () => diaLocal(new Date(), ZONA)
const diasAtras = (n: number) => sumarDias(hoy(), -n)

const mermas = (f: Partial<FiltrosMermas> = {}, o: { conCostos?: boolean; todas?: boolean; empresa?: 'a' | 'b' } = {}): Promise<MermasVista> =>
  (o.empresa === 'b' ? enB : enA)((tx) => mermasEnTx(tx, o.empresa === 'b' ? ctx.b : ctx.a, { pagina: 1, ...f }, { zonaHoraria: ZONA, conCostos: o.conCostos ?? true, todas: o.todas }))

/**
 * Una empresa con mermas de todo tipo, en sus fechas. Se arma UNA vez (cada prueba filtra por `q` o por el rango y no suma lo suyo
 * a lo de las demás).
 */
let armado: ReturnType<typeof armarLedger> | null = null
const ledger = () => (armado ??= armarLedger())
async function armarLedger() {
  const m1 = await producto('Merma uno')
  const m2 = await producto('Merma dos')
  // m1: 100 a 5.00 hace 40 días.
  await hace(40, m1, () => entrada(m1, 100, ctx.suc1, '5'))
  await hace(10, m1, () => ajustar(m1, -4, 'EXPIRED'))
  await hace(9, m1, () => ajustar(m1, -2, 'THEFT', 'Se llevaron dos de la vitrina'))
  await hace(8, m1, () => ajustar(m1, -1, null, 'Faltante de la semana (sin motivo del catálogo)'))
  await hace(7, m1, () => ajustar(m1, 3, 'FOUND'))
  await hace(6, m1, () => danar(m1, 6, 'HANDLING'))
  await hace(5, m1, () => resolver(m1, 2, 'BAJA', 'EXPIRED'))
  await hace(4, m1, () => resolver(m1, 1, 'VENDIBLE', null, 'Resultó vendible'))
  await hace(3, m1, () => enA((tx) => contarEnTx(tx, ctx.a, { varianteId: m1, sucursalId: ctx.suc1, conteo: 89 }, como(ctx.usuario))))
  await hace(2, m1, () => enA((tx) => venderEnTx(tx, ctx.a, { varianteId: m1, sucursalId: ctx.suc1, cantidad: 2 }, como(ctx.usuario))))
  // Fuera del rango por defecto (hace 60 días), con otro motivo.
  await hace(70, m1, () => ajustar(m1, -1, 'LOST'))
  // m2: sin costo, en Norte.
  await hace(30, m2, () => entrada(m2, 50, ctx.suc2))
  await hace(12, m2, () => ajustar(m2, -5, 'LOST', undefined, ctx.suc2))
  return { m1, m2 }
}

// El contador del primer movimiento «hace 70 días» ocurre después de los demás: el orden de escritura no importa, las fechas sí.

test('1 · lo perdido son los faltantes y las bajas, cada uno en su motivo; los sobrantes y lo dañado van aparte; las ventas, entradas y recuperar no cuentan', async () => {
  const { m1, m2 } = await ledger()
  const v = await mermas({ q: 'Merma ' })
  const perdida = v.grupos.PERDIDA
  const por = new Map(perdida.filas.map((f) => [f.codigo, f]))
  assert.deepEqual([...por.keys()].sort(), ['COUNT_DIFFERENCE', 'EXPIRED', 'LOST', 'THEFT', null].sort(), 'los motivos de lo perdido en los últimos 30 días')
  assert.deepEqual([por.get('EXPIRED')!.movimientos, por.get('EXPIRED')!.unidades], [2, 6], 'el faltante (4) y la baja (2) con el mismo motivo se suman')
  assert.deepEqual([por.get('THEFT')!.movimientos, por.get('THEFT')!.unidades], [1, 2])
  assert.deepEqual([por.get('COUNT_DIFFERENCE')!.movimientos, por.get('COUNT_DIFFERENCE')!.unidades], [1, 2], 'el conteo (contó 89 en lugar de 91) puso su motivo solo')
  assert.deepEqual([por.get(null)!.movimientos, por.get(null)!.unidades], [1, 1], 'sin motivo del catálogo: sin motivo codificado')
  assert.deepEqual([por.get('LOST')!.movimientos, por.get('LOST')!.unidades], [1, 5], 'el de hace 70 días no entra en los últimos 30')
  assert.deepEqual([perdida.total.movimientos, perdida.total.unidades], [6, 16])
  assert.deepEqual([v.grupos.SOBRANTE.total.movimientos, v.grupos.SOBRANTE.total.unidades], [1, 3])
  assert.deepEqual(v.grupos.SOBRANTE.filas.map((f) => [f.codigo, f.unidades]), [['FOUND', 3]])
  assert.deepEqual([v.grupos.DANO.total.movimientos, v.grupos.DANO.total.unidades], [1, 6], 'lo dañado va aparte y no se suma a lo perdido')
  assert.deepEqual(v.grupos.DANO.filas.map((f) => [f.codigo, f.unidades]), [['HANDLING', 6]])
  assert.equal(v.total, 8, '6 pérdidas + 1 sobrante + 1 daño; ni la venta, ni la entrada, ni recuperar lo dañado')
  assert.equal(v.movimientos.length, 8)
  assert.equal(v.movimientos.some((m) => m.varianteId !== m1 && m.varianteId !== m2), false)
})

test('2 · lo que vale lo perdido: unidades × el costo de ese momento; lo que no tiene costo se cuenta aparte, nunca como cero', async () => {
  await ledger()
  const v = await mermas({ q: 'Merma ' })
  const por = new Map(v.grupos.PERDIDA.filas.map((f) => [f.codigo, f]))
  assert.equal(por.get('EXPIRED')!.valor, costo('30'), '6 × 5.00')
  assert.equal(por.get('THEFT')!.valor, costo('10'))
  assert.equal(por.get('COUNT_DIFFERENCE')!.valor, costo('10'))
  assert.equal(por.get(null)!.valor, costo('5'))
  assert.deepEqual([por.get('LOST')!.valor, por.get('LOST')!.unidadesSinCosto], [BigInt(0), 5], 'sin costo: no suma al valor y se cuenta aparte')
  assert.equal(v.grupos.PERDIDA.total.valor, costo('55'))
  assert.equal(v.grupos.PERDIDA.total.unidadesSinCosto, 5)
  assert.equal(v.grupos.SOBRANTE.total.valor, costo('15'))
  assert.equal(v.grupos.DANO.total.valor, costo('30'))
  // El detalle trae el costo congelado de cada movimiento.
  const robo = v.movimientos.find((m) => m.codigo === 'THEFT')!
  assert.deepEqual([robo.unidades, robo.costo, robo.valor], [2, costo('5'), costo('10')])
  const sinCosto = v.movimientos.find((m) => m.codigo === 'LOST')!
  assert.deepEqual([sinCosto.costo, sinCosto.valor], [null, null])
})

test('3 · sin la función de costos no se lee ni un costo: ni valores, ni la cuenta de lo que falta, ni el costo del detalle; el orden es por unidades', async () => {
  await ledger()
  const v = await mermas({ q: 'Merma ' }, { conCostos: false })
  assert.equal(v.conCostos, false)
  for (const g of Object.values(v.grupos)) {
    assert.deepEqual([g.total.valor, g.total.unidadesSinCosto], [null, null])
    for (const f of g.filas) assert.deepEqual([f.valor, f.unidadesSinCosto], [null, null])
  }
  for (const m of v.movimientos) assert.deepEqual([m.costo, m.valor], [null, null])
  assert.equal(v.grupos.PERDIDA.total.unidades, 16, 'las unidades salen igual')
  const unidades = v.grupos.PERDIDA.filas.map((f) => f.unidades)
  assert.deepEqual(unidades, [...unidades].sort((a, b) => b - a), 'de más a menos unidades')
})

test('4 · el orden: de lo que más vale a lo que menos, y a igual valor por unidades y por nombre', async () => {
  await ledger()
  const v = await mermas({ q: 'Merma ' })
  assert.deepEqual(
    v.grupos.PERDIDA.filas.map((f) => f.codigo),
    ['EXPIRED', 'COUNT_DIFFERENCE', 'THEFT', null, 'LOST'],
    '30, luego 10 y 10 (por nombre: Diferencia de conteo antes que Robo), 5 y los 5 sin costo (valor 0)'
  )
})

test('5 · el rango: por defecto los últimos 30 días; un rango propio incluye el primer y el último día y se mide en el calendario de la empresa', async () => {
  await ledger()
  const porDefecto = await mermas({ q: 'Merma ' })
  assert.equal(porDefecto.hasta, hoy())
  assert.equal(porDefecto.desde, diasAtras(29))
  const largo = await mermas({ q: 'Merma ', desde: diasAtras(80) })
  const lost = largo.grupos.PERDIDA.filas.find((f) => f.codigo === 'LOST')!
  assert.deepEqual([lost.movimientos, lost.unidades], [2, 6], 'con 80 días entra también la de hace 70')
  // Un solo día: el de la baja (hace 5 días).
  const unDia = await mermas({ q: 'Merma ', desde: diasAtras(5), hasta: diasAtras(5) })
  assert.deepEqual(unDia.movimientos.map((m) => [m.clase, m.codigo, m.unidades]), [['BAJA', 'EXPIRED', 2]])
  // Un rango sin mermas.
  const vacio = await mermas({ q: 'Merma ', desde: diasAtras(2), hasta: diasAtras(1) })
  assert.equal(vacio.total, 0)
  for (const g of Object.values(vacio.grupos)) assert.deepEqual([g.filas.length, g.total.unidades], [0, 0])
})

test('6 · filtros: por motivo (también «sin motivo»), por sucursal y por producto; los totales siguen al filtro', async () => {
  const { m1, m2 } = await ledger()
  const expired = await mermas({ q: 'Merma ', motivo: 'EXPIRED' })
  assert.equal(expired.total, 2)
  assert.deepEqual(expired.movimientos.map((m) => m.codigo), ['EXPIRED', 'EXPIRED'])
  assert.equal(expired.grupos.PERDIDA.total.unidades, 6)
  assert.equal(expired.grupos.SOBRANTE.total.unidades, 0)
  const sin = await mermas({ q: 'Merma ', motivo: FILTRO_SIN_MOTIVO })
  assert.deepEqual(sin.movimientos.map((m) => [m.codigo, m.etiquetaMotivo, m.unidades]), [[null, 'Sin motivo codificado', 1]])
  const norte = await mermas({ q: 'Merma ', sucursalId: ctx.suc2 })
  assert.deepEqual(norte.movimientos.map((m) => [m.varianteId, m.sucursalNombre, m.codigo]), [[m2, 'Norte', 'LOST']])
  const principal = await mermas({ q: 'Merma ', sucursalId: ctx.suc1 })
  assert.equal(principal.movimientos.every((m) => m.varianteId === m1), true)
  assert.equal((await mermas({ q: 'nada-que-coincida-xyz' })).total, 0)
  const porSku = (await prisma.catalogVariant.findUniqueOrThrow({ where: { id: m2 }, select: { sku: true } })).sku
  assert.deepEqual((await mermas({ q: porSku.toLowerCase() })).movimientos.map((m) => m.varianteId), [m2], 'el SKU busca sin importar mayúsculas')
  const barcode = `8${Date.now().toString().slice(-9)}${sufijo.replace(/[^0-9]/g, '')}`.slice(0, 20)
  await prisma.catalogVariant.update({ where: { id: m2 }, data: { barcode } })
  assert.deepEqual((await mermas({ q: barcode })).movimientos.map((m) => m.varianteId), [m2], 'el código de barras también busca')
})

test('7 · el detalle: del más reciente al más antiguo, con el detalle escrito, quién y dónde; el texto que es la propia etiqueta no se repite', async () => {
  await ledger()
  const v = await mermas({ q: 'Merma ' })
  for (let i = 1; i < v.movimientos.length; i++) assert.ok(v.movimientos[i - 1].creadoEn.getTime() >= v.movimientos[i].creadoEn.getTime(), `fila ${i} fuera de orden`)
  const robo = v.movimientos.find((m) => m.codigo === 'THEFT')!
  assert.deepEqual([robo.clase, robo.grupo, robo.etiquetaMotivo, robo.detalle, robo.usuarioNombre, robo.sucursalNombre], ['FALTANTE', 'PERDIDA', 'Robo o hurto', 'Se llevaron dos de la vitrina', 'Encargada', 'Principal'])
  const vencido = v.movimientos.find((m) => m.codigo === 'EXPIRED' && m.clase === 'FALTANTE')!
  assert.equal(vencido.detalle, null, 'sin detalle se guardó la etiqueta, y no se repite al lado del motivo')
  const sinCodigo = v.movimientos.find((m) => m.codigo === null)!
  assert.equal(sinCodigo.detalle, 'Faltante de la semana (sin motivo del catálogo)', 'sin código, el texto sí se enseña')
  assert.equal(v.movimientos.find((m) => m.clase === 'BAJA')!.grupo, 'PERDIDA')
  assert.equal(v.movimientos.find((m) => m.clase === 'DANO')!.grupo, 'DANO')
  assert.equal(v.movimientos.find((m) => m.clase === 'SOBRANTE')!.grupo, 'SOBRANTE')
})

test('8 · la clase que calcula el SQL es la misma que calcula el código, para cada ajuste y daño del ledger', async () => {
  await ledger()
  const v = await mermas({ q: 'Merma ', desde: diasAtras(80) })
  const crudos = await prisma.inventoryMovement.findMany({ where: { id: { in: v.movimientos.map((m) => m.id) } }, select: { id: true, type: true, sourceBucket: true, destinationBucket: true } })
  assert.equal(crudos.length, v.movimientos.length)
  for (const c of crudos) {
    const esperada = claseDeMovimiento({ tipo: c.type, origen: c.sourceBucket as CubetaDeMovimiento | null, destino: c.destinationBucket as CubetaDeMovimiento | null })
    assert.equal(v.movimientos.find((m) => m.id === c.id)!.clase, esperada, c.id)
  }
  // Y lo que el código no explica con un motivo (la recuperación de lo dañado) no está en el informe.
  const recuperado = await prisma.inventoryMovement.findFirstOrThrow({ where: { companyId: ctx.a, type: 'ADJUSTMENT', sourceBucket: 'DAMAGED', destinationBucket: 'AVAILABLE' }, select: { id: true } })
  assert.equal(v.movimientos.some((m) => m.id === recuperado.id), false)
})

test('9 · páginas y archivo: no se repite ni se pierde ninguno, y el archivo trae todos aunque pasen de una página', async () => {
  const v = await producto('Muchas mermas')
  await hace(0, v, () => entrada(v, 400, ctx.suc1, '2'))
  for (let i = 0; i < 52; i++) await ajustar(v, -1, i % 2 === 0 ? 'LOST' : 'THEFT')
  const p1 = await mermas({ q: 'Muchas mermas', pagina: 1 })
  const p2 = await mermas({ q: 'Muchas mermas', pagina: 2 })
  assert.deepEqual([p1.movimientos.length, p2.movimientos.length, p1.total, p2.total, p1.pagina, p2.pagina], [50, 2, 52, 52, 1, 2])
  const todas = await mermas({ q: 'Muchas mermas', pagina: 2 }, { todas: true })
  assert.equal(todas.movimientos.length, 52, 'el archivo trae todo y no salta a la página pedida')
  assert.equal(todas.pagina, 1)
  const ids = [...p1.movimientos, ...p2.movimientos].map((m) => m.id)
  assert.equal(new Set(ids).size, 52)
  assert.deepEqual(todas.movimientos.map((m) => m.id), ids, 'el archivo y las páginas van en el mismo orden')
  assert.deepEqual([p1.grupos.PERDIDA.total.movimientos, p1.grupos.PERDIDA.total.unidades], [52, 52], 'los totales son de TODO el rango, no de la página')
  assert.equal(p1.grupos.PERDIDA.total.valor, costo('104'))
  assert.equal((await mermas({ q: 'Muchas mermas', pagina: 99 })).movimientos.length, 0)
})

test('9b · a la misma hora el detalle sigue un orden fijo (id de mayor a menor), así que las páginas no repiten ni pierden', async () => {
  const v = await producto('Empate')
  await hace(0, v, () => entrada(v, 100, ctx.suc1, '2'))
  for (let i = 0; i < 8; i++) await ajustar(v, -1, 'LOST')
  const ids = (await prisma.inventoryMovement.findMany({ where: { companyId: ctx.a, type: 'ADJUSTMENT', level: { catalogVariantId: v } }, select: { id: true } })).map((m) => m.id)
  const mismaHora = new Date(Date.now() - 5 * 24 * 3600 * 1000)
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.$executeRawUnsafe(`UPDATE "inventory_movements" SET "createdAt" = '${mismaHora.toISOString()}' WHERE "id" IN (${ids.map((i) => `'${i}'`).join(',')})`)
  })
  // El orden que pide el informe, calculado por la propia base (sin depender de cómo ordene el código las cadenas).
  const esperado = (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "inventory_movements" WHERE "id" IN (${ids.map((i) => `'${i}'`).join(',')}) ORDER BY "id" DESC`)).map((x) => x.id)
  const r = await mermas({ q: 'Empate' })
  assert.deepEqual(r.movimientos.map((m) => m.id), esperado)
})

test('10 · cada empresa ve solo lo suyo', async () => {
  await ledger()
  await enB((tx) => registrarEntradaMultipleEnTx(tx, ctx.b, { sucursalId: ctx.sucB, lineas: [{ varianteId: ctx.varianteB, cantidad: 10, costo: '3' }] }, como(ctx.usuario)))
  await enB((tx) => ajustarEnTx(tx, ctx.b, { varianteId: ctx.varianteB, sucursalId: ctx.sucB, cambio: -2, motivoCodigo: 'SAMPLE' }, como(ctx.usuario)))
  const b = await mermas({}, { empresa: 'b' })
  assert.deepEqual(b.movimientos.map((m) => [m.varianteId, m.codigo, m.unidades]), [[ctx.varianteB, 'SAMPLE', 2]])
  assert.equal(b.grupos.PERDIDA.total.valor, costo('6'))
  const a = await mermas({ q: 'Ajeno' })
  assert.equal(a.total, 0, 'lo de B no aparece en A')
  const aSucursalAjena = await mermas({ q: 'Merma ', sucursalId: ctx.sucB })
  assert.equal(aSucursalAjena.total, 0, 'una sucursal de otra empresa no devuelve nada (ni de la de A)')
})
