import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { conEmpresa } from '../../src/lib/tenant'
import {
  actualizarItemEnTx,
  actualizarVarianteEnTx,
  agregarVarianteEnTx,
  cambiarEstadoItemEnTx,
  crearItemEnTx,
  eliminarVarianteEnTx,
} from '../../src/modules/catalog/service'
import { listarItemsEnTx, obtenerItemEnTx } from '../../src/modules/catalog/queries'
import { CatalogoError } from '../../src/modules/catalog/errores'

/**
 * COMMERCE CORE · catálogo unificado contra PostgreSQL de verdad (Fase 1).
 *
 * Lo que solo se puede comprobar aquí:
 *
 *  · que el invariante «todo ítem tiene al menos una variante» lo hace cumplir
 *    LA BASE, no solo el servicio (un script que escriba por otro camino no se
 *    lo salta);
 *  · que la FK compuesta (catalogItemId, companyId) impide colgar una variante
 *    de un ítem de otra empresa;
 *  · que el SKU automático no choca bajo concurrencia;
 *  · que una empresa no ve ni toca el catálogo de otra a través del servicio.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })
const ANIO = new Date().getFullYear()

const ctx = { a: '', b: '', usuario: '' }

before(async () => {
  const [a, b] = await Promise.all(
    ['a', 'b'].map((x) =>
      prisma.company.create({
        data: { name: `Catálogo ${x} ${sufijo}`, slug: `catalogo-${x}-${sufijo}`, type: 'restaurante', ciudad: 'Santo Domingo' },
        select: { id: true },
      })
    )
  )
  ctx.a = a.id
  ctx.b = b.id
  const u = await prisma.user.create({
    data: { supabaseId: `sb-cat-${sufijo}`, email: `cat-${sufijo}@prueba.test`, name: 'Catálogo', role: 'SUPERADMIN' },
    select: { id: true },
  })
  ctx.usuario = u.id
})

after(async () => {
  // Ítems primero: la cascada se lleva las variantes y el disparador diferido
  // no tiene nada que vigilar cuando el ítem ya no existe.
  await prisma.catalogItem.deleteMany({ where: { companyId: { in: [ctx.a, ctx.b] } } })
})

const enA = <T>(fn: (tx: Parameters<Parameters<typeof conEmpresa>[1]>[0]) => Promise<T>) => conEmpresa(ctx.a, fn)
const enB = <T>(fn: (tx: Parameters<Parameters<typeof conEmpresa>[1]>[0]) => Promise<T>) => conEmpresa(ctx.b, fn)

/** El error de dominio con su código, o falla la prueba si lo que pasó fue otra cosa. */
async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof CatalogoError) return e.codigo
    throw e
  }
  assert.fail('se esperaba un CatalogoError y no falló')
}

const itemSimple = (name: string, extra: object = {}) =>
  enA((tx) => crearItemEnTx(tx, ctx.a, { name, type: 'SERVICE', price: 500, ...extra }, como(ctx.usuario)))

// ── Creación ─────────────────────────────────────────────────────────────────

test('1 · un ítem simple nace en borrador con UNA variante default y su SKU automático', async () => {
  const r = await itemSimple(`Lavado básico ${sufijo}`)
  assert.equal(r.status, 'DRAFT')
  assert.match(r.slug, /^lavado-basico-/)
  assert.equal(r.variants.length, 1)
  assert.equal(r.variants[0].isDefault, true)
  assert.equal(r.variants[0].name, 'Default')
  assert.equal(r.variants[0].sku, `SKU-${ANIO}-000001`, 'primer SKU de la empresa')

  const guardada = await prisma.catalogVariant.findUniqueOrThrow({ where: { id: r.variants[0].id } })
  assert.equal(guardada.price.toFixed(2), '500.00')
  assert.equal(guardada.companyId, ctx.a, 'la variante lleva la empresa de su ítem')

  const audit = await prisma.auditLog.findFirst({ where: { accion: 'CATALOG_ITEM_CREATED', entidadId: r.id } })
  assert.ok(audit, 'bitácora CATALOG_ITEM_CREATED')
  assert.equal(audit.companyId, ctx.a)
  assert.equal(audit.userId, ctx.usuario)
})

test('2 · dos ítems con el mismo nombre reciben slugs distintos, y los SKU siguen la secuencia', async () => {
  const nombre = `Pizza ${sufijo}`
  const x = await itemSimple(nombre)
  const y = await itemSimple(nombre)
  assert.notEqual(x.slug, y.slug)
  assert.equal(y.slug, `${x.slug}-2`)
  assert.equal(x.variants[0].sku, `SKU-${ANIO}-000002`)
  assert.equal(y.variants[0].sku, `SKU-${ANIO}-000003`)
})

test('3 · el slug y el SKU son por EMPRESA: la otra empresa empieza de cero', async () => {
  const r = await enB((tx) => crearItemEnTx(tx, ctx.b, { name: `Lavado básico ${sufijo}`, type: 'SERVICE', price: 1 }, como(ctx.usuario)))
  assert.match(r.slug, /^lavado-basico-/)
  assert.ok(!r.slug.endsWith('-2'), 'el slug de A no ocupa el de B')
  assert.equal(r.variants[0].sku, `SKU-${ANIO}-000001`)
})

test('4 · ocho altas SIMULTÁNEAS del mismo nombre: ninguna falla y no hay SKU ni slug repetidos', async () => {
  const nombre = `Combo ${sufijo}`
  const rs = await Promise.all(Array.from({ length: 8 }, () => itemSimple(nombre)))
  assert.equal(new Set(rs.map((r) => r.slug)).size, 8)
  assert.equal(new Set(rs.map((r) => r.variants[0].sku)).size, 8)
})

test('5 · un SKU escrito a mano que se parece al automático no rompe la secuencia', async () => {
  // Ordenado como texto, «SKU-AAAA-ABC» ganaría al último numérico y el
  // siguiente saldría como …-000001, chocando. Se busca con regex, no con LIKE.
  await itemSimple(`Manual ${sufijo}`, { sku: `SKU-${ANIO}-ABC` })
  const alto = await itemSimple(`Manual alto ${sufijo}`, { sku: `SKU-${ANIO}-000500` })
  assert.equal(alto.variants[0].sku, `SKU-${ANIO}-000500`)
  const siguiente = await itemSimple(`Auto después ${sufijo}`)
  assert.equal(siguiente.variants[0].sku, `SKU-${ANIO}-000501`)
})

test('6 · un SKU repetido en la misma empresa da un mensaje claro; en otra empresa se permite', async () => {
  const sku = `DUP-${sufijo.toUpperCase()}`
  await itemSimple(`Con SKU ${sufijo}`, { sku })
  assert.equal(await codigoDe(itemSimple(`Con SKU otra vez ${sufijo}`, { sku })), 'SKU_DUPLICADO')
  const enOtra = await enB((tx) => crearItemEnTx(tx, ctx.b, { name: `Con SKU ${sufijo}`, type: 'SERVICE', price: 1, sku }, como(ctx.usuario)))
  assert.equal(enOtra.variants[0].sku, sku)
})

test('7 · el rechazo de un SKU repetido NO deja el ítem a medias (la transacción entera se deshace)', async () => {
  const sku = `ATOM-${sufijo.toUpperCase()}`
  await itemSimple(`Atómico base ${sufijo}`, { sku })
  const nombre = `Atómico ${sufijo}`
  await assert.rejects(itemSimple(nombre, { sku }))
  assert.equal(await prisma.catalogItem.count({ where: { companyId: ctx.a, name: nombre } }), 0)
})

test('8 · un ítem con variantes explícitas no lleva ninguna default', async () => {
  const r = await enA((tx) =>
    crearItemEnTx(
      tx,
      ctx.a,
      {
        name: `Camiseta ${sufijo}`,
        type: 'PHYSICAL_PRODUCT',
        variants: [
          { name: 'M', price: 800, attributes: { talla: 'M' } },
          { name: 'L', price: 850, cost: 400, compareAtPrice: 900, attributes: { talla: 'L' } },
        ],
      },
      como(ctx.usuario)
    )
  )
  assert.equal(r.variants.length, 2)
  assert.ok(r.variants.every((v) => !v.isDefault))
  const detalle = await enA((tx) => obtenerItemEnTx(tx, ctx.a, r.id))
  assert.equal(detalle.tieneVariantes, true)
  assert.equal(detalle.variants[1].compareAtPrice, '900.00')
  assert.deepEqual((detalle.capabilities as { trackInventory: boolean }).trackInventory, true, 'un producto físico lleva inventario')
})

// ── El invariante lo hace cumplir la base ────────────────────────────────────

test('9 · LA BASE rechaza un ítem sin variante al confirmar, aunque se escriba por fuera del servicio', async () => {
  await assert.rejects(
    prisma.catalogItem.create({
      data: { companyId: ctx.a, name: 'Huérfano', slug: `huerfano-${sufijo}`, type: 'SERVICE' },
    }),
    /catalog_item_sin_variante/
  )
  assert.equal(await prisma.catalogItem.count({ where: { slug: `huerfano-${sufijo}` } }), 0)
})

test('10 · LA BASE rechaza quitar la última variante, pero deja borrar el ítem entero', async () => {
  const r = await itemSimple(`Última ${sufijo}`)
  await assert.rejects(prisma.catalogVariant.delete({ where: { id: r.variants[0].id } }), /catalog_item_sin_variante/)
  await prisma.catalogItem.delete({ where: { id: r.id } })
  assert.equal(await prisma.catalogVariant.count({ where: { catalogItemId: r.id } }), 0, 'la cascada se llevó la variante')
})

test('11 · LA BASE rechaza una default que tenga hermanas', async () => {
  const r = await itemSimple(`Default con hermana ${sufijo}`)
  await assert.rejects(
    prisma.catalogVariant.create({
      data: { companyId: ctx.a, catalogItemId: r.id, name: 'Intrusa', sku: `HERM-${sufijo}`, price: 1 },
    }),
    /catalog_default_con_hermanas/
  )
})

test('12 · LA BASE rechaza dos defaults en el mismo ítem (índice único parcial)', async () => {
  const r = await enA((tx) =>
    crearItemEnTx(tx, ctx.a, { name: `Dos defaults ${sufijo}`, type: 'SERVICE', variants: [{ name: 'A', price: 1 }, { name: 'B', price: 1 }] }, como(ctx.usuario))
  )
  await assert.rejects(
    prisma.$transaction([
      prisma.catalogVariant.update({ where: { id: r.variants[0].id }, data: { isDefault: true } }),
      prisma.catalogVariant.update({ where: { id: r.variants[1].id }, data: { isDefault: true } }),
    ])
  )
})

test('13 · la FK compuesta impide colgar variante, imagen o categoría de un ítem de OTRA empresa', async () => {
  const deA = await itemSimple(`Ajeno ${sufijo}`)
  // La variante dice ser de B pero apunta a un ítem de A.
  await assert.rejects(
    prisma.catalogVariant.create({
      data: { companyId: ctx.b, catalogItemId: deA.id, name: 'X', sku: `FK-${sufijo}`, price: 1 },
    }),
    /catalog_variants_catalogItemId_companyId_fkey/
  )
  await assert.rejects(
    prisma.catalogItemImage.create({ data: { companyId: ctx.b, catalogItemId: deA.id, path: 'x/y.jpg' } }),
    /catalog_item_images_catalogItemId_companyId_fkey/
  )
  const catB = await prisma.catalogCategory.create({ data: { companyId: ctx.b, name: 'Cat B', slug: `cat-b-${sufijo}` } })
  await assert.rejects(
    prisma.catalogItemCategory.create({ data: { companyId: ctx.b, catalogItemId: deA.id, categoryId: catB.id } }),
    /catalog_item_categories_catalogItemId_companyId_fkey/
  )
  // Y la categoría de B no se puede asignar a un ítem de A tampoco.
  await assert.rejects(
    prisma.catalogItemCategory.create({ data: { companyId: ctx.a, catalogItemId: deA.id, categoryId: catB.id } }),
    /catalog_item_categories_categoryId_companyId_fkey/
  )
  // Lo legítimo sí pasa.
  const catA = await prisma.catalogCategory.create({ data: { companyId: ctx.a, name: 'Cat A', slug: `cat-a-${sufijo}` } })
  await prisma.catalogItemCategory.create({ data: { companyId: ctx.a, catalogItemId: deA.id, categoryId: catA.id } })
  await prisma.catalogItemImage.create({ data: { companyId: ctx.a, catalogItemId: deA.id, path: 'a/b.jpg', position: 0 } })
})

test('14 · LA BASE rechaza precios negativos, un precio anterior menor y JSON que no sea objeto', async () => {
  const r = await itemSimple(`Checks ${sufijo}`)
  const id = r.variants[0].id
  await assert.rejects(prisma.catalogVariant.update({ where: { id }, data: { price: -1 } }), /catalog_variants_precios/)
  await assert.rejects(prisma.catalogVariant.update({ where: { id }, data: { compareAtPrice: 10 } }), /catalog_variants_precios/)
  await assert.rejects(prisma.catalogVariant.update({ where: { id }, data: { cost: -5 } }), /catalog_variants_precios/)
  await assert.rejects(prisma.catalogVariant.update({ where: { id }, data: { attributes: ['x'] } }), /attributes_objeto/)
  await assert.rejects(prisma.catalogItem.update({ where: { id: r.id }, data: { capabilities: [] } }), /capabilities_objeto/)
})

test('15 · el código de barras es único por empresa (y NULL no choca con NULL)', async () => {
  const barras = `750${Date.now()}`
  await itemSimple(`Barras 1 ${sufijo}`, { barcode: barras })
  await itemSimple(`Sin barras 1 ${sufijo}`)
  await itemSimple(`Sin barras 2 ${sufijo}`)
  assert.equal(await codigoDe(itemSimple(`Barras 2 ${sufijo}`, { barcode: barras })), 'BARCODE_DUPLICADO')
})

// ── Variantes ────────────────────────────────────────────────────────────────

test('16 · agregar una variante a un ítem simple baja la default y deja el selector visible', async () => {
  const r = await itemSimple(`Crece ${sufijo}`)
  const nueva = await enA((tx) => agregarVarianteEnTx(tx, ctx.a, r.id, { name: 'Premium', price: 900 }, como(ctx.usuario)))
  assert.match(nueva.sku, new RegExp(`^SKU-${ANIO}-\\d{6}$`), 'SKU automático por empresa')
  const d = await enA((tx) => obtenerItemEnTx(tx, ctx.a, r.id))
  assert.equal(d.variants.length, 2)
  assert.ok(d.variants.every((v) => !v.isDefault), 'la automática dejó de ser default')
  assert.equal(d.tieneVariantes, true)
  const audit = await prisma.auditLog.findFirst({ where: { accion: 'CATALOG_VARIANT_CHANGED', entidadId: nueva.id } })
  assert.equal((audit?.payload as { accion: string }).accion, 'creada')
})

test('17 · dos variantes agregadas a la vez al mismo ítem simple: las tres quedan sin default', async () => {
  const r = await itemSimple(`Concurrente ${sufijo}`)
  await Promise.all(
    ['S', 'M'].map((n) => enA((tx) => agregarVarianteEnTx(tx, ctx.a, r.id, { name: n, price: 10 }, como(ctx.usuario))))
  )
  const d = await enA((tx) => obtenerItemEnTx(tx, ctx.a, r.id))
  assert.equal(d.variants.length, 3)
  assert.ok(d.variants.every((v) => !v.isDefault))
  assert.equal(new Set(d.variants.map((v) => v.sku)).size, 3)
})

test('18 · no se repite el nombre de una variante dentro del ítem', async () => {
  const r = await itemSimple(`Nombres ${sufijo}`)
  await enA((tx) => agregarVarianteEnTx(tx, ctx.a, r.id, { name: 'Grande', price: 1 }, como(ctx.usuario)))
  assert.equal(
    await codigoDe(enA((tx) => agregarVarianteEnTx(tx, ctx.a, r.id, { name: 'grande', price: 2 }, como(ctx.usuario)))),
    'VARIANTE_INVALIDA'
  )
})

test('19 · editar el precio deja en la bitácora el antes y el después', async () => {
  const r = await itemSimple(`Precio ${sufijo}`)
  await enA((tx) => actualizarVarianteEnTx(tx, ctx.a, r.variants[0].id, { price: '650.50', cost: 300 }, como(ctx.usuario)))
  const v = await prisma.catalogVariant.findUniqueOrThrow({ where: { id: r.variants[0].id } })
  assert.equal(v.price.toFixed(2), '650.50')
  assert.equal(v.cost?.toFixed(2), '300.00')
  const audit = await prisma.auditLog.findFirst({
    where: { accion: 'CATALOG_VARIANT_CHANGED', entidadId: v.id },
    orderBy: { createdAt: 'desc' },
  })
  const p = audit?.payload as { antes: { price: string }; despues: { price: string } }
  assert.equal(p.antes.price, '500.00')
  assert.equal(p.despues.price, '650.50')
})

test('20 · editar con valores inválidos se rechaza y NO cambia nada; null vacía costo y precio anterior', async () => {
  const r = await itemSimple(`Validar ${sufijo}`)
  const id = r.variants[0].id
  assert.equal(await codigoDe(enA((tx) => actualizarVarianteEnTx(tx, ctx.a, id, { price: -5 }, como(ctx.usuario)))), 'VARIANTE_INVALIDA')
  assert.equal(await codigoDe(enA((tx) => actualizarVarianteEnTx(tx, ctx.a, id, { compareAtPrice: 100 }, como(ctx.usuario)))), 'VARIANTE_INVALIDA')
  assert.equal((await prisma.catalogVariant.findUniqueOrThrow({ where: { id } })).price.toFixed(2), '500.00')

  await enA((tx) => actualizarVarianteEnTx(tx, ctx.a, id, { cost: 100, compareAtPrice: 700 }, como(ctx.usuario)))
  await enA((tx) => actualizarVarianteEnTx(tx, ctx.a, id, { cost: null, compareAtPrice: null }, como(ctx.usuario)))
  const v = await prisma.catalogVariant.findUniqueOrThrow({ where: { id } })
  assert.equal(v.cost, null)
  assert.equal(v.compareAtPrice, null)
})

test('21 · quitar una de dos variantes funciona; quitar la última se rechaza con un mensaje claro', async () => {
  const r = await enA((tx) =>
    crearItemEnTx(tx, ctx.a, { name: `Quitar ${sufijo}`, type: 'SERVICE', variants: [{ name: 'A', price: 1 }, { name: 'B', price: 2 }] }, como(ctx.usuario))
  )
  await enA((tx) => eliminarVarianteEnTx(tx, ctx.a, r.variants[0].id, como(ctx.usuario)))
  assert.equal(await codigoDe(enA((tx) => eliminarVarianteEnTx(tx, ctx.a, r.variants[1].id, como(ctx.usuario)))), 'ULTIMA_VARIANTE')
  assert.equal(await prisma.catalogVariant.count({ where: { catalogItemId: r.id } }), 1)
})

// ── Estados ──────────────────────────────────────────────────────────────────

test('22 · publicar anota publishedAt la PRIMERA vez y pausar/reactivar no lo pisa', async () => {
  const r = await itemSimple(`Publicar ${sufijo}`)
  await enA((tx) => cambiarEstadoItemEnTx(tx, ctx.a, r.id, 'ACTIVE', como(ctx.usuario)))
  const primera = (await prisma.catalogItem.findUniqueOrThrow({ where: { id: r.id } })).publishedAt
  assert.ok(primera)
  await enA((tx) => cambiarEstadoItemEnTx(tx, ctx.a, r.id, 'PAUSED', como(ctx.usuario)))
  await enA((tx) => cambiarEstadoItemEnTx(tx, ctx.a, r.id, 'ACTIVE', como(ctx.usuario)))
  const despues = (await prisma.catalogItem.findUniqueOrThrow({ where: { id: r.id } })).publishedAt
  assert.equal(despues?.getTime(), primera.getTime())
  const audit = await prisma.auditLog.findMany({ where: { accion: 'CATALOG_ITEM_STATUS_CHANGED', entidadId: r.id }, orderBy: { createdAt: 'asc' } })
  assert.equal(audit.length, 3)
  assert.deepEqual((audit[0].payload as { antes: string; despues: string }).antes, 'DRAFT')
})

test('23 · una transición no declarada se rechaza (archivado → activo directo no existe)', async () => {
  const r = await itemSimple(`Transición ${sufijo}`)
  assert.equal(await codigoDe(enA((tx) => cambiarEstadoItemEnTx(tx, ctx.a, r.id, 'PAUSED', como(ctx.usuario)))), 'TRANSICION_INVALIDA')
  await enA((tx) => cambiarEstadoItemEnTx(tx, ctx.a, r.id, 'ARCHIVED', como(ctx.usuario)))
  assert.equal(await codigoDe(enA((tx) => cambiarEstadoItemEnTx(tx, ctx.a, r.id, 'ACTIVE', como(ctx.usuario)))), 'TRANSICION_INVALIDA')
  await enA((tx) => cambiarEstadoItemEnTx(tx, ctx.a, r.id, 'DRAFT', como(ctx.usuario)))
})

test('24 · no se publica un ítem sin variante activa, ni se deja sin ella uno ya publicado', async () => {
  const r = await itemSimple(`Sin activa ${sufijo}`)
  await enA((tx) => actualizarVarianteEnTx(tx, ctx.a, r.variants[0].id, { status: 'OUT_OF_STOCK' }, como(ctx.usuario)))
  assert.equal(await codigoDe(enA((tx) => cambiarEstadoItemEnTx(tx, ctx.a, r.id, 'ACTIVE', como(ctx.usuario)))), 'NO_SE_PUEDE_PUBLICAR')

  await enA((tx) => actualizarVarianteEnTx(tx, ctx.a, r.variants[0].id, { status: 'ACTIVE' }, como(ctx.usuario)))
  await enA((tx) => cambiarEstadoItemEnTx(tx, ctx.a, r.id, 'ACTIVE', como(ctx.usuario)))
  // Publicado con UNA activa: no se puede agotar ni quitar sin pausar antes.
  assert.equal(
    await codigoDe(enA((tx) => actualizarVarianteEnTx(tx, ctx.a, r.variants[0].id, { status: 'DISCONTINUED' }, como(ctx.usuario)))),
    'SIN_VARIANTE_ACTIVA'
  )
  const otra = await enA((tx) => agregarVarianteEnTx(tx, ctx.a, r.id, { name: 'Otra', price: 1 }, como(ctx.usuario)))
  await enA((tx) => actualizarVarianteEnTx(tx, ctx.a, r.variants[0].id, { status: 'DISCONTINUED' }, como(ctx.usuario)))
  assert.equal(await codigoDe(enA((tx) => eliminarVarianteEnTx(tx, ctx.a, otra.id, como(ctx.usuario)))), 'SIN_VARIANTE_ACTIVA')
})

test('25 · un ítem archivado no se edita ni recibe variantes hasta restaurarlo', async () => {
  const r = await itemSimple(`Archivado ${sufijo}`)
  await enA((tx) => cambiarEstadoItemEnTx(tx, ctx.a, r.id, 'ARCHIVED', como(ctx.usuario)))
  assert.equal(await codigoDe(enA((tx) => actualizarItemEnTx(tx, ctx.a, r.id, { name: 'Nuevo' }, como(ctx.usuario)))), 'ITEM_ARCHIVADO')
  assert.equal(await codigoDe(enA((tx) => agregarVarianteEnTx(tx, ctx.a, r.id, { name: 'V', price: 1 }, como(ctx.usuario)))), 'ITEM_ARCHIVADO')
  await enA((tx) => cambiarEstadoItemEnTx(tx, ctx.a, r.id, 'DRAFT', como(ctx.usuario)))
  await enA((tx) => actualizarItemEnTx(tx, ctx.a, r.id, { name: 'Restaurado' }, como(ctx.usuario)))
})

test('26 · editar un ítem cambia nombre y descripción pero NO el slug', async () => {
  const r = await itemSimple(`Renombrar ${sufijo}`)
  await enA((tx) => actualizarItemEnTx(tx, ctx.a, r.id, { name: `Nombre nuevo ${sufijo}`, description: ' Texto ', capabilities: { requiresBooking: true, hack: 1 } }, como(ctx.usuario)))
  const i = await prisma.catalogItem.findUniqueOrThrow({ where: { id: r.id } })
  assert.equal(i.name, `Nombre nuevo ${sufijo}`)
  assert.equal(i.description, 'Texto')
  assert.equal(i.slug, r.slug, 'el enlace compartido no muere')
  const caps = i.capabilities as Record<string, boolean>
  assert.equal(caps.requiresBooking, true)
  assert.ok(!('hack' in caps))
})

test('27 · un ítem de origen SUPPLY es de solo lectura para la empresa', async () => {
  const r = await itemSimple(`Supply ${sufijo}`)
  await prisma.catalogItem.update({ where: { id: r.id }, data: { source: 'SUPPLY' } })
  assert.equal(await codigoDe(enA((tx) => actualizarItemEnTx(tx, ctx.a, r.id, { name: 'X' }, como(ctx.usuario)))), 'ITEM_SOLO_LECTURA')
  assert.equal(await codigoDe(enA((tx) => cambiarEstadoItemEnTx(tx, ctx.a, r.id, 'ACTIVE', como(ctx.usuario)))), 'ITEM_SOLO_LECTURA')
  assert.equal(await codigoDe(enA((tx) => agregarVarianteEnTx(tx, ctx.a, r.id, { name: 'V', price: 1 }, como(ctx.usuario)))), 'ITEM_SOLO_LECTURA')
  assert.equal(
    await codigoDe(enA((tx) => actualizarVarianteEnTx(tx, ctx.a, r.variants[0].id, { price: 1 }, como(ctx.usuario)))),
    'ITEM_SOLO_LECTURA'
  )
})

// ── Aislamiento entre empresas, a través del servicio ────────────────────────

test('28 · una empresa no puede leer, editar, publicar ni borrar el catálogo de otra', async () => {
  const r = await itemSimple(`Privado ${sufijo}`)
  assert.equal(await codigoDe(enB((tx) => obtenerItemEnTx(tx, ctx.b, r.id))), 'ITEM_NO_ENCONTRADO')
  assert.equal(await codigoDe(enB((tx) => actualizarItemEnTx(tx, ctx.b, r.id, { name: 'Robado' }, como(ctx.usuario)))), 'ITEM_NO_ENCONTRADO')
  assert.equal(await codigoDe(enB((tx) => cambiarEstadoItemEnTx(tx, ctx.b, r.id, 'ACTIVE', como(ctx.usuario)))), 'ITEM_NO_ENCONTRADO')
  assert.equal(await codigoDe(enB((tx) => agregarVarianteEnTx(tx, ctx.b, r.id, { name: 'V', price: 1 }, como(ctx.usuario)))), 'ITEM_NO_ENCONTRADO')
  assert.equal(
    await codigoDe(enB((tx) => actualizarVarianteEnTx(tx, ctx.b, r.variants[0].id, { price: 1 }, como(ctx.usuario)))),
    'VARIANTE_NO_ENCONTRADA'
  )
  assert.equal(await codigoDe(enB((tx) => eliminarVarianteEnTx(tx, ctx.b, r.variants[0].id, como(ctx.usuario)))), 'VARIANTE_NO_ENCONTRADA')
  const listaB = await enB((tx) => listarItemsEnTx(tx, ctx.b, { q: `Privado ${sufijo}` }))
  assert.equal(listaB.length, 0)
  const intacto = await prisma.catalogItem.findUniqueOrThrow({ where: { id: r.id } })
  assert.equal(intacto.name, `Privado ${sufijo}`)
})

// ── Lecturas ─────────────────────────────────────────────────────────────────

test('29 · el listado trae el precio «desde» entre las variantes activas y filtra por estado y texto', async () => {
  const nombre = `Listado ${sufijo}`
  const r = await enA((tx) =>
    crearItemEnTx(
      tx,
      ctx.a,
      {
        name: nombre,
        type: 'PHYSICAL_PRODUCT',
        variants: [
          { name: 'Agotada barata', price: 10, status: 'OUT_OF_STOCK' },
          { name: 'Normal', price: 300 },
          { name: 'Cara', price: 900 },
        ],
      },
      como(ctx.usuario)
    )
  )
  const lista = await enA((tx) => listarItemsEnTx(tx, ctx.a, { q: nombre }))
  assert.equal(lista.length, 1)
  assert.equal(lista[0].id, r.id)
  assert.equal(lista[0].variantes, 3)
  assert.equal(lista[0].desde, '300.00', 'la agotada no cuenta para el «desde»')
  assert.equal(lista[0].tieneVariantes, true)
  assert.equal((await enA((tx) => listarItemsEnTx(tx, ctx.a, { q: nombre, estado: 'ACTIVE' }))).length, 0)
  assert.equal((await enA((tx) => listarItemsEnTx(tx, ctx.a, { q: nombre.toUpperCase(), estado: 'DRAFT', tipo: 'PHYSICAL_PRODUCT' }))).length, 1)
})
