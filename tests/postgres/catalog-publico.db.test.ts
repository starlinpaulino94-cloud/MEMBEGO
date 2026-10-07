import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import { cambiarEstadoItemEnTx, crearItemEnTx, actualizarVarianteEnTx } from '../../src/modules/catalog/service'
import { catalogoPublicoDeEmpresa, catalogoPublicoGlobal, itemCatalogoPublico } from '../../src/modules/catalog/publico'
import {
  agregarVarianteABorrador,
  catalogoHabilitado,
  crearItemEnBorrador,
  listarItems,
  listarVariantes,
  obtenerItem,
  respuestaDeError,
} from '../../src/modules/plataforma/catalogo'
import { CatalogoError } from '../../src/modules/catalog/errores'

/**
 * COMMERCE CORE · catálogo — vitrina pública y API contra PostgreSQL (F1.3).
 *
 * Cuatro empresas: A (publicada, con la capacidad), B (publicada, SIN la
 * capacidad), C (con la capacidad pero NO publicada) y D (demo). Solo lo de A
 * puede verse. `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })
const ctx = { a: '', b: '', c: '', d: '', slugA: `pub-a-${sufijo}`, usuario: '' }
const COSTO_SECRETO = '777.77'
const SKU_SECRETO = `SECRETO-${sufijo.toUpperCase()}`

async function empresa(x: string, over: object, caps: boolean) {
  return (
    await prisma.company.create({
      data: {
        name: `Pública ${x} ${sufijo}`, slug: `pub-${x}-${sufijo}`, type: 'carwash', ciudad: 'Santo Domingo',
        ...(caps ? { capacidades: { overrides: { CATALOGO_UNIFICADO: true } } } : {}),
        ...over,
      },
      select: { id: true },
    })
  ).id
}

/** Ítem publicado, listo para verse. */
async function publicado(empresaId: string, nombre: string, extra: { price?: number; marketplace?: boolean; variants?: object[] } = {}) {
  const r = await conEmpresa(empresaId, async (tx) => {
    const it = await crearItemEnTx(
      tx,
      empresaId,
      {
        name: `${nombre} ${sufijo}`,
        type: 'SERVICE',
        capabilities: { availableMarketplace: extra.marketplace ?? true },
        ...(extra.variants ? { variants: extra.variants as never } : { price: extra.price ?? 100, cost: COSTO_SECRETO, sku: `${SKU_SECRETO}-${nombre.replace(/\W/g, '')}` }),
      },
      como(ctx.usuario)
    )
    await cambiarEstadoItemEnTx(tx, empresaId, it.id, 'ACTIVE', como(ctx.usuario))
    return it
  })
  return r
}

before(async () => {
  ctx.a = await empresa('a', { isPublished: true, isActive: true, esDemo: false }, true)
  ctx.b = await empresa('b', { isPublished: true, isActive: true, esDemo: false }, false)
  ctx.c = await empresa('c', { isPublished: false, isActive: true, esDemo: false }, true)
  ctx.d = await empresa('d', { isPublished: true, isActive: true, esDemo: true }, true)
  ctx.usuario = (
    await prisma.user.create({ data: { supabaseId: `sb-pub-${sufijo}`, email: `pub-${sufijo}@prueba.test`, name: 'Pub', role: 'SUPERADMIN' }, select: { id: true } })
  ).id
})

after(async () => {
  await prisma.catalogItem.deleteMany({ where: { companyId: { in: [ctx.a, ctx.b, ctx.c, ctx.d] } } })
})

// ── Vitrina de una empresa ───────────────────────────────────────────────────

test('1 · un ítem publicado de una empresa con la capacidad aparece, con precio y sin datos internos', async () => {
  const it = await publicado(ctx.a, 'Lavado visible', { price: 650.5 })
  const lista = await catalogoPublicoDeEmpresa(ctx.a)
  const x = lista.find((i) => i.id === it.id)
  assert.ok(x, 'no aparece')
  assert.equal(x.priceFrom, '650.50')
  assert.equal(x.company.slug, ctx.slugA.replace(`pub-a-${sufijo}`, `pub-a-${sufijo}`))
  const crudo = JSON.stringify(lista)
  assert.ok(!crudo.includes(COSTO_SECRETO) && !crudo.includes(SKU_SECRETO), 'el costo o el SKU salieron a la vitrina')
})

test('2 · borrador, pausado y archivado NO aparecen; al volver a publicarse, sí', async () => {
  const it = await publicado(ctx.a, 'Ciclo')
  const visible = async () => (await catalogoPublicoDeEmpresa(ctx.a, 48)).some((i) => i.id === it.id)
  assert.equal(await visible(), true)
  await conEmpresa(ctx.a, (tx) => cambiarEstadoItemEnTx(tx, ctx.a, it.id, 'PAUSED', como(ctx.usuario)))
  assert.equal(await visible(), false, 'pausado')
  await conEmpresa(ctx.a, (tx) => cambiarEstadoItemEnTx(tx, ctx.a, it.id, 'ACTIVE', como(ctx.usuario)))
  assert.equal(await visible(), true)
  await conEmpresa(ctx.a, (tx) => cambiarEstadoItemEnTx(tx, ctx.a, it.id, 'ARCHIVED', como(ctx.usuario)))
  assert.equal(await visible(), false, 'archivado')
  const borrador = await conEmpresa(ctx.a, (tx) => crearItemEnTx(tx, ctx.a, { name: `Borrador ${sufijo}`, type: 'SERVICE', price: 1 }, como(ctx.usuario)))
  assert.equal((await catalogoPublicoDeEmpresa(ctx.a, 48)).some((i) => i.id === borrador.id), false, 'borrador')
})

test('3 · un ítem que NO es visible en marketplace (solo caja) no se publica', async () => {
  const it = await publicado(ctx.a, 'Solo caja', { marketplace: false })
  assert.equal((await catalogoPublicoDeEmpresa(ctx.a, 48)).some((i) => i.id === it.id), false)
  assert.equal(await itemCatalogoPublico(`pub-a-${sufijo}`, it.slug), null)
})

test('4 · variantes: la descontinuada no se ve, la agotada sí (marcada), y el «desde» ignora la agotada', async () => {
  const it = await publicado(ctx.a, 'Con variantes', {
    variants: [{ name: 'Agotada barata', price: 10, status: 'OUT_OF_STOCK' }, { name: 'Normal', price: 300 }, { name: 'Vieja', price: 5, status: 'DISCONTINUED' }, { name: 'Cara', price: 900 }],
  })
  const d = await itemCatalogoPublico(`pub-a-${sufijo}`, it.slug)
  assert.ok(d)
  assert.deepEqual(d.variants.map((v) => v.name).sort(), ['Agotada barata', 'Cara', 'Normal'])
  assert.equal(d.variants.find((v) => v.name === 'Agotada barata')?.available, false)
  assert.equal(d.priceFrom, '300.00')
  assert.equal(d.hasVariants, true)
  const crudo = JSON.stringify(d)
  assert.ok(!crudo.includes('Vieja'), 'la descontinuada se coló')
})

test('5 · si se descontinúan TODAS las variantes visibles, el ítem desaparece de la vitrina', async () => {
  const it = await publicado(ctx.a, 'Se agota del todo', { variants: [{ name: 'Única', price: 1 }, { name: 'Otra', price: 2 }] })
  const d0 = await conEmpresa(ctx.a, (tx) => tx.catalogVariant.findMany({ where: { catalogItemId: it.id } }))
  // El ítem está ACTIVO: no se puede dejar sin variante activa. Se pausa, se descontinúa y se vuelve a ver que no aparece.
  await conEmpresa(ctx.a, (tx) => cambiarEstadoItemEnTx(tx, ctx.a, it.id, 'PAUSED', como(ctx.usuario)))
  for (const v of d0) await conEmpresa(ctx.a, (tx) => actualizarVarianteEnTx(tx, ctx.a, v.id, { status: 'DISCONTINUED' }, como(ctx.usuario)))
  assert.equal((await catalogoPublicoDeEmpresa(ctx.a, 48)).some((i) => i.id === it.id), false)
})

// ── Quién puede publicar ─────────────────────────────────────────────────────

test('6 · sin la capacidad, nada se publica (aunque los ítems estén ACTIVOS); con ella, sí', async () => {
  // La empresa B tiene ítems activos pero NO la capacidad.
  const it = await publicado(ctx.b, 'De B')
  assert.deepEqual(await catalogoPublicoDeEmpresa(ctx.b), [])
  assert.equal(await itemCatalogoPublico(`pub-b-${sufijo}`, it.slug), null)
  assert.equal((await catalogoPublicoGlobal({ q: `De B ${sufijo}` })).items.length, 0)
  // Se le enciende y aparece; se le apaga y desaparece (los datos no se tocan).
  await prisma.company.update({ where: { id: ctx.b }, data: { capacidades: { overrides: { CATALOGO_UNIFICADO: true } } } })
  assert.equal((await catalogoPublicoDeEmpresa(ctx.b)).some((i) => i.id === it.id), true)
  await prisma.company.update({ where: { id: ctx.b }, data: { capacidades: { overrides: { CATALOGO_UNIFICADO: false } } } })
  assert.deepEqual(await catalogoPublicoDeEmpresa(ctx.b), [])
  assert.equal(await prisma.catalogItem.count({ where: { id: it.id } }), 1, 'apagar la capacidad no borra datos')
})

test('7 · una empresa NO publicada y una DEMO no aparecen en ninguna parte', async () => {
  const c = await publicado(ctx.c, 'De C')
  const d = await publicado(ctx.d, 'De D')
  assert.deepEqual(await catalogoPublicoDeEmpresa(ctx.c), [])
  assert.equal(await itemCatalogoPublico(`pub-c-${sufijo}`, c.slug), null)
  const g = await catalogoPublicoGlobal({ q: sufijo, limite: 48 })
  assert.ok(!g.items.some((i) => i.id === c.id || i.id === d.id), 'una empresa que no debe verse llegó al descubrimiento')
})

test('8 · el detalle exige el par (empresa, ítem): el slug de un ítem con la empresa equivocada es «no existe»', async () => {
  const it = await publicado(ctx.a, 'Par exacto')
  assert.ok(await itemCatalogoPublico(`pub-a-${sufijo}`, it.slug))
  assert.equal(await itemCatalogoPublico(`pub-b-${sufijo}`, it.slug), null)
  assert.equal(await itemCatalogoPublico('', it.slug), null)
  assert.equal(await itemCatalogoPublico(`pub-a-${sufijo}`, 'no-existe'), null)
})

// ── Descubrimiento ───────────────────────────────────────────────────────────

test('9 · el descubrimiento busca por texto y pagina sin huecos ni repetidos', async () => {
  const nombres = ['Alfa', 'Beta', 'Gamma', 'Delta', 'Epsilon']
  const ids: string[] = []
  for (const n of nombres) ids.push((await publicado(ctx.a, `Pagina ${n}`)).id)
  const p0 = await catalogoPublicoGlobal({ q: `Pagina`, limite: 2, pagina: 0 })
  const p1 = await catalogoPublicoGlobal({ q: `Pagina`, limite: 2, pagina: 1 })
  const p2 = await catalogoPublicoGlobal({ q: `Pagina`, limite: 2, pagina: 2 })
  const vistos = [...p0.items, ...p1.items, ...p2.items].map((i) => i.id).filter((id) => ids.includes(id))
  assert.equal(new Set(vistos).size, 5, 'se repite o falta alguno')
  assert.equal(p0.hayMas, true)
  assert.equal(p2.hayMas, false)
  assert.equal((await catalogoPublicoGlobal({ q: 'ALFA', limite: 48 })).items.some((i) => i.id === ids[0]), true, 'insensible a mayúsculas')
})

test('10 · filtro por categoría (por slug) entre empresas', async () => {
  const it = await publicado(ctx.a, 'Con categoría')
  const cat = await conEmpresa(ctx.a, (tx) => tx.catalogCategory.create({ data: { companyId: ctx.a, name: 'Detallado', slug: `detallado-${sufijo}` } }))
  await prisma.catalogItemCategory.create({ data: { companyId: ctx.a, catalogItemId: it.id, categoryId: cat.id } })
  const r = await catalogoPublicoGlobal({ categoria: `detallado-${sufijo}`, limite: 48 })
  assert.deepEqual(r.items.map((i) => i.id), [it.id])
  const d = await itemCatalogoPublico(`pub-a-${sufijo}`, it.slug)
  assert.deepEqual(d?.categories, [{ name: 'Detallado', slug: `detallado-${sufijo}` }])
})

// ── API ──────────────────────────────────────────────────────────────────────

test('11 · API: crear deja el ítem en BORRADOR con su variante, y el costo solo sale con includeCost', async () => {
  assert.equal(await catalogoHabilitado(ctx.a), true)
  assert.equal(await catalogoHabilitado(ctx.b), false)
  const id = await crearItemEnBorrador(ctx.a, { name: `Por API ${sufijo}`, type: 'SERVICE', price: 250, cost: 100, sku: `API-${sufijo.toUpperCase()}` })
  const propio = await obtenerItem(ctx.a, id, true)
  assert.equal(propio?.status, 'DRAFT')
  assert.equal(propio?.variants.length, 1)
  assert.equal(propio?.variants[0].cost, '100.00')
  const deSatelite = await obtenerItem(ctx.a, id, false)
  assert.ok(!JSON.stringify(deSatelite).includes('"cost"'))
  assert.equal(await obtenerItem(ctx.b, id, true), null, 'otra empresa no lo ve')
  const audit = await prisma.auditLog.findFirst({ where: { accion: 'CATALOG_ITEM_CREATED', entidadId: id } })
  assert.equal(audit?.userAgent, 'platform-api')
})

test('12 · API: un SKU repetido se contesta como «duplicate» (no duplica el ítem)', async () => {
  const sku = `DUPAPI-${sufijo.toUpperCase()}`
  await crearItemEnBorrador(ctx.a, { name: `Dup 1 ${sufijo}`, type: 'SERVICE', price: 1, sku })
  let error: unknown
  try {
    await crearItemEnBorrador(ctx.a, { name: `Dup 2 ${sufijo}`, type: 'SERVICE', price: 1, sku })
  } catch (e) {
    error = e
  }
  assert.ok(error instanceof CatalogoError)
  const resp = respuestaDeError(error, 'req_x')!
  assert.equal(resp.status, 400)
  const cuerpo = await resp.json()
  assert.equal(cuerpo.error.reason, 'duplicate')
  assert.equal(await prisma.catalogItem.count({ where: { companyId: ctx.a, name: `Dup 2 ${sufijo}` } }), 0)
})

test('13 · API: solo se agregan variantes a BORRADORES; a un ítem publicado, no', async () => {
  const borrador = await crearItemEnBorrador(ctx.a, { name: `Borrador API ${sufijo}`, type: 'SERVICE', price: 1 })
  const vid = await agregarVarianteABorrador(ctx.a, borrador, { name: 'Grande', price: 5 })
  assert.ok(vid)
  const vivo = await publicado(ctx.a, 'Vivo')
  await assert.rejects(agregarVarianteABorrador(ctx.a, vivo.id, { name: 'Intrusa', price: 1 }), (e: unknown) => e instanceof CatalogoError && e.codigo === 'ITEM_NO_ES_BORRADOR')
  await assert.rejects(agregarVarianteABorrador(ctx.b, borrador, { name: 'Ajena', price: 1 }), (e: unknown) => e instanceof CatalogoError && e.codigo === 'ITEM_NO_ENCONTRADO')
  const d = await obtenerItem(ctx.a, vivo.id, true)
  assert.equal(d?.variants.length, 1, 'el precio publicado no cambió')
})

test('14 · API: las listas están aisladas por empresa, paginan por cursor y filtran por estado', async () => {
  const ids: string[] = []
  for (let i = 0; i < 3; i++) ids.push(await crearItemEnBorrador(ctx.a, { name: `Lista ${i} ${sufijo}`, type: 'PHYSICAL_PRODUCT', price: 1 }))
  const p1 = await listarItems(ctx.a, { take: 3, cursor: {} , type: 'PHYSICAL_PRODUCT' }, false)
  assert.equal(p1.length, 3)
  const siguiente = await listarItems(ctx.a, { take: 3, cursor: { cursor: { id: p1[2].id }, skip: 1 }, type: 'PHYSICAL_PRODUCT' }, false)
  assert.ok(!siguiente.some((x) => p1.some((y) => y.id === x.id)), 'el cursor repite')
  assert.equal((await listarItems(ctx.b, { take: 50, cursor: {}, type: 'PHYSICAL_PRODUCT' }, false)).filter((x) => ids.includes(x.id)).length, 0)
  assert.ok((await listarItems(ctx.a, { take: 50, cursor: {}, status: 'ACTIVE' }, false)).every((x) => x.status === 'ACTIVE'))
  const vars = await listarVariantes(ctx.a, { take: 50, cursor: {}, itemId: ids[0] }, true)
  assert.equal(vars.length, 1)
  assert.equal(vars[0].itemId, ids[0])
  assert.equal((await listarVariantes(ctx.b, { take: 50, cursor: {}, itemId: ids[0] }, true)).length, 0)
})
