import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { sinEmpresa, conEmpresa } from '../../src/lib/tenant'
import { actualizarItemEnTx, agregarVarianteEnTx, cambiarEstadoItemEnTx, eliminarVarianteEnTx } from '../../src/modules/catalog/service'
import { CatalogoError } from '../../src/modules/catalog/errores'
import { catalogoPublicoDeEmpresa, catalogoPublicoGlobal, itemCatalogoPublico } from '../../src/modules/catalog/publico'
import { archivarPuenteEnTx, casaMembegoEnTx, designarCasaEnTx, estadoDelPuenteEnTx, sincronizarOfertaEnTx } from '../../src/modules/supply-bridge/service'
import { PuenteError } from '../../src/modules/supply-bridge/errores'
import { barridoPuente } from '../../src/modules/supply-bridge/barrido'

/**
 * SUPPLY BRIDGE · el puente Supply V2 → catálogo unificado contra PostgreSQL de
 * verdad (Fase 2.5).
 *
 * Lo que solo se puede comprobar aquí:
 *
 *  · que la base exige `source = SUPPLY` ⇔ el ítem refleja una oferta, que una
 *    oferta tiene a lo sumo un ítem y que a lo sumo UNA empresa es «la casa»;
 *  · que sincronizar es idempotente y que 8 sincronizaciones simultáneas de la
 *    misma oferta nueva crean UN solo ítem;
 *  · que la empresa NO puede editar un ítem puente (Supply es el master);
 *  · que el público cruza el ítem con la oferta EN VIVO: pausada, vencida o aún
 *    no empezada deja de verse sin esperar a ninguna sincronización;
 *  · que el barrido reconcilia y que retirar la casa archiva lo puente.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })
const ctx = { casa: '', otra: '', usuario: '', proveedor: '', producto: '' }
let contador = 0
const creadas: string[] = []

const sync = (offerId: string) => sinEmpresa('prueba: sincronizar', (tx) => sincronizarOfertaEnTx(tx, offerId))

before(async () => {
  // Una casa que quedó viva de una corrida rota estorbaría al índice único parcial.
  await prisma.company.updateMany({ where: { esCasaMembego: true }, data: { esCasaMembego: false } })
  const mk = (x: string) =>
    prisma.company.create({
      data: {
        name: `Puente ${x} ${sufijo}`,
        slug: `puente-${x}-${sufijo}`,
        type: 'otro',
        ciudad: 'Santo Domingo',
        isPublished: true,
        isActive: true,
        // La capacidad se enciende por override, como en producción.
        capacidades: { overrides: { CATALOGO_UNIFICADO: true } },
      },
      select: { id: true },
    })
  ctx.casa = (await mk('casa')).id
  ctx.otra = (await mk('otra')).id
  const u = await prisma.user.create({ data: { supabaseId: `sb-pte-${sufijo}`, email: `pte-${sufijo}@prueba.test`, name: 'Puente', role: 'SUPERADMIN' }, select: { id: true } })
  ctx.usuario = u.id
  const p = await prisma.supplyV2Supplier.create({ data: { source: 'EXTERNAL', commercialName: `Car Town ${sufijo}` }, select: { id: true } })
  ctx.proveedor = p.id
  const i = await prisma.supplyV2CatalogItem.create({ data: { supplierId: p.id, type: 'SERVICE', name: `Lavado ${sufijo}`, slug: `lavado-${sufijo}` }, select: { id: true } })
  ctx.producto = i.id
})

after(async () => {
  const empresas = [ctx.casa, ctx.otra]
  await prisma.company.updateMany({ where: { id: { in: empresas } }, data: { esCasaMembego: false } })
  await prisma.catalogItem.deleteMany({ where: { companyId: { in: empresas } } })
  await prisma.supplyV2Offer.deleteMany({ where: { id: { in: creadas } } })
  await prisma.supplyV2Allocation.deleteMany({ where: { catalogItemId: ctx.producto } })
  await prisma.supplyV2CatalogItem.deleteMany({ where: { id: ctx.producto } })
  await prisma.supplyV2Supplier.deleteMany({ where: { id: ctx.proveedor } })
})

/**
 * Una oferta de supply precomprado con su asignación de 100 unidades libres (lo
 * mínimo para que Supply la dé por «con unidades»; sin lote, que aquí no importa).
 */
async function oferta(o: { status?: string; salePrice?: number; publicPrice?: number; title?: string; startsAt?: Date; endsAt?: Date | null; description?: string | null } = {}) {
  contador++
  const code = `MBG-OF-${sufijo.toUpperCase()}-${String(contador).padStart(4, '0')}`
  const asignacion = await prisma.supplyV2Allocation.create({
    data: { catalogItemId: ctx.producto, quantity: 100, allocatedQuantity: 100, status: 'ACTIVE', createdById: ctx.usuario },
    select: { id: true },
  })
  const r = await prisma.supplyV2Offer.create({
    data: {
      supplierId: ctx.proveedor,
      catalogItemId: ctx.producto,
      allocationId: asignacion.id,
      code,
      slug: `lavado-${code.toLowerCase()}`,
      title: o.title ?? `Lavado completo ${contador}`,
      description: o.description === undefined ? 'Exterior e interior' : o.description,
      sourceType: 'PREPURCHASED_SUPPLY',
      publicPrice: o.publicPrice ?? 1000,
      salePrice: o.salePrice ?? 650.5,
      quantityLimit: 100,
      startsAt: o.startsAt ?? new Date(Date.now() - 3_600_000),
      endsAt: o.endsAt === undefined ? null : o.endsAt,
      status: (o.status ?? 'ACTIVE') as never,
      createdById: ctx.usuario,
    },
    select: { id: true, code: true, slug: true },
  })
  creadas.push(r.id)
  return r
}
const cambiarOferta = (id: string, data: Record<string, unknown>) => prisma.supplyV2Offer.update({ where: { id }, data: data as never })
const itemDe = (offerId: string) => prisma.catalogItem.findUnique({ where: { supplyV2OfferId: offerId }, include: { variants: true } })

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof CatalogoError || e instanceof PuenteError) return e.codigo
    throw e
  }
  assert.fail('se esperaba un error de dominio y no falló')
}

// ── Sin casa ─────────────────────────────────────────────────────────────────

test('1 · sin empresa de la casa el puente no sincroniza nada', async () => {
  const o = await oferta()
  assert.equal((await sync(o.id)).resultado, 'SIN_CASA')
  assert.equal(await itemDe(o.id), null)
  assert.equal(await sinEmpresa('prueba', (tx) => casaMembegoEnTx(tx)), null)
})

test('2 · designar la casa: solo una; una de demostración no vale; otra casa con ítems puente se rechaza', async () => {
  const demo = await prisma.company.create({ data: { name: `Demo ${sufijo}`, slug: `puente-demo-${sufijo}`, type: 'otro', esDemo: true }, select: { id: true } })
  assert.equal(await codigoDe(sinEmpresa('p', (tx) => designarCasaEnTx(tx, demo.id, como(ctx.usuario)))), 'EMPRESA_DEMO')
  assert.equal(await codigoDe(sinEmpresa('p', (tx) => designarCasaEnTx(tx, 'no-existe', como(ctx.usuario)))), 'EMPRESA_NO_ENCONTRADA')
  await prisma.company.delete({ where: { id: demo.id } })

  await sinEmpresa('p', (tx) => designarCasaEnTx(tx, ctx.casa, como(ctx.usuario)))
  assert.equal((await sinEmpresa('p', (tx) => casaMembegoEnTx(tx)))?.id, ctx.casa)
  // Pasar a otra empresa SIN ítems puente es posible; la base solo deja una.
  await sinEmpresa('p', (tx) => designarCasaEnTx(tx, ctx.otra, como(ctx.usuario)))
  assert.equal(await prisma.company.count({ where: { esCasaMembego: true } }), 1)
  assert.equal((await sinEmpresa('p', (tx) => casaMembegoEnTx(tx)))?.id, ctx.otra)
  await sinEmpresa('p', (tx) => designarCasaEnTx(tx, ctx.casa, como(ctx.usuario)))
  assert.ok(await prisma.auditLog.findFirst({ where: { accion: 'SUPPLY_BRIDGE_HOUSE_CHANGED', entidadId: ctx.casa } }))
})

test('3 · la base solo admite UNA empresa de la casa (índice único parcial)', async () => {
  await assert.rejects(prisma.company.update({ where: { id: ctx.otra }, data: { esCasaMembego: true } }), /Unique constraint|unique|companies_una_casa_membego/i)
  assert.equal((await prisma.company.findUniqueOrThrow({ where: { id: ctx.otra } })).esCasaMembego, false)
})

// ── Sincronización ───────────────────────────────────────────────────────────

test('4 · un borrador no tiene ítem; una oferta activa crea UN ítem puente con su variante, sin costo', async () => {
  const borrador = await oferta({ status: 'DRAFT' })
  assert.equal((await sync(borrador.id)).resultado, 'OMITIDA')
  assert.equal(await itemDe(borrador.id), null)

  const o = await oferta({ salePrice: 650.5, publicPrice: 1000, title: '  Lavado completo  ' })
  const r = await sync(o.id)
  assert.equal(r.resultado, 'CREADO')
  const item = await itemDe(o.id)
  assert.ok(item)
  assert.equal(item.companyId, ctx.casa)
  assert.equal(item.source, 'SUPPLY')
  assert.equal(item.type, 'VOUCHER')
  assert.equal(item.status, 'ACTIVE')
  assert.equal(item.name, 'Lavado completo')
  assert.equal(item.slug, o.slug)
  assert.match(item.description ?? '', /Exterior e interior/)
  assert.match(item.description ?? '', new RegExp(`Ofrecido por Car Town ${sufijo}`))
  assert.ok(item.publishedAt)
  assert.deepEqual(item.capabilities, { trackInventory: false, requiresBooking: false, requiresRedemption: true, requiresPreparation: false, availableMarketplace: true, availablePOS: false })
  assert.equal(item.variants.length, 1)
  const v = item.variants[0]
  assert.equal(v.isDefault, true)
  assert.equal(v.sku, o.code)
  assert.equal(v.price.toFixed(2), '650.50')
  assert.equal(v.compareAtPrice?.toFixed(2), '1000.00')
  assert.equal(v.cost, null, 'el costo de Supply nunca entra al catálogo')
  assert.equal(v.status, 'ACTIVE')
  assert.ok(await prisma.auditLog.findFirst({ where: { entidadId: item.id, accion: 'CATALOG_ITEM_CREATED' } }))
})

test('5 · sincronizar es idempotente: la segunda vez no cambia nada ni deja rastro', async () => {
  const o = await oferta()
  await sync(o.id)
  const antes = await itemDe(o.id)
  const logs = await prisma.auditLog.count({ where: { entidadId: antes!.id } })
  const r = await sync(o.id)
  assert.equal(r.resultado, 'SIN_CAMBIOS')
  assert.deepEqual(r.cambios, [])
  const despues = await itemDe(o.id)
  assert.equal(despues!.updatedAt.getTime(), antes!.updatedAt.getTime())
  assert.equal(await prisma.auditLog.count({ where: { entidadId: antes!.id } }), logs)
})

test('6 · los cambios de la oferta se reflejan (precio, nombre, estado, agotada) y quedan anotados', async () => {
  const o = await oferta({ salePrice: 500, publicPrice: 800 })
  await sync(o.id)
  const id = (await itemDe(o.id))!.id

  await cambiarOferta(o.id, { salePrice: 450, title: 'Lavado renovado' })
  const r = await sync(o.id)
  assert.equal(r.resultado, 'ACTUALIZADO')
  assert.deepEqual(r.cambios.sort(), ['nombre', 'precio'])
  let item = (await itemDe(o.id))!
  assert.equal(item.variants[0].price.toFixed(2), '450.00')
  assert.equal(item.name, 'Lavado renovado')
  assert.ok(await prisma.auditLog.findFirst({ where: { entidadId: id, accion: 'CATALOG_ITEM_UPDATED' } }))

  // Sin descuento (lista = venta) no hay «precio anterior»: Supply ya impide que la lista sea menor.
  await cambiarOferta(o.id, { publicPrice: 450 })
  await sync(o.id)
  assert.equal((await itemDe(o.id))!.variants[0].compareAtPrice, null)

  await cambiarOferta(o.id, { status: 'PAUSED' })
  await sync(o.id)
  assert.equal((await itemDe(o.id))!.status, 'PAUSED')
  await cambiarOferta(o.id, { status: 'SOLD_OUT' })
  await sync(o.id)
  item = (await itemDe(o.id))!
  assert.equal(item.status, 'ACTIVE')
  assert.equal(item.variants[0].status, 'OUT_OF_STOCK')
  await cambiarOferta(o.id, { status: 'ACTIVE' })
  await sync(o.id)
  item = (await itemDe(o.id))!
  assert.equal(item.variants[0].status, 'ACTIVE')
  const publicadoEn = item.publishedAt
  await cambiarOferta(o.id, { status: 'ENDED' })
  await sync(o.id)
  assert.equal((await itemDe(o.id))!.status, 'ARCHIVED')
  await cambiarOferta(o.id, { status: 'ACTIVE' })
  await sync(o.id)
  item = (await itemDe(o.id))!
  assert.equal(item.status, 'ACTIVE')
  assert.equal(item.publishedAt?.getTime(), publicadoEn?.getTime(), 'republicar no reescribe la primera fecha de publicación')
})

test('7 · una oferta programada o pausada nace pausada; una cancelada, archivada', async () => {
  const prog = await oferta({ status: 'SCHEDULED', startsAt: new Date(Date.now() + 86_400_000) })
  await sync(prog.id)
  assert.equal((await itemDe(prog.id))!.status, 'PAUSED')
  const canc = await oferta({ status: 'CANCELLED' })
  await sync(canc.id)
  assert.equal((await itemDe(canc.id))!.status, 'ARCHIVED')
})

test('8 · 8 sincronizaciones simultáneas de la misma oferta nueva crean UN solo ítem', async () => {
  const o = await oferta()
  const r = await Promise.all(Array.from({ length: 8 }, () => sync(o.id)))
  assert.equal(r.filter((x) => x.resultado === 'CREADO').length, 1)
  assert.equal(r.filter((x) => x.resultado === 'SIN_CAMBIOS').length, 7)
  assert.equal(await prisma.catalogItem.count({ where: { supplyV2OfferId: o.id } }), 1)
})

test('9 · un slug ocupado por otro ítem de la casa no rompe la sincronización', async () => {
  const o = await oferta()
  await prisma.$transaction(async (tx) => {
    const it = await tx.catalogItem.create({ data: { companyId: ctx.casa, name: 'Ocupa el slug', slug: o.slug, type: 'SERVICE', capabilities: {} }, select: { id: true } })
    await tx.catalogVariant.createMany({ data: [{ companyId: ctx.casa, catalogItemId: it.id, name: 'Default', sku: `OCUPA-${sufijo}`, price: 1, isDefault: true }] })
  })
  const r = await sync(o.id)
  assert.equal(r.resultado, 'CREADO')
  assert.equal((await itemDe(o.id))!.slug, `${o.slug}-${o.code.toLowerCase()}`)
})

// ── Reglas de la base ────────────────────────────────────────────────────────

test('10 · la base exige source = SUPPLY ⇔ ítem ligado a una oferta, y una oferta tiene un solo ítem', async () => {
  const o = await oferta()
  await sync(o.id)
  const insertar = (source: string, offerId: string | null, slug: string) =>
    prisma.$executeRawUnsafe(
      `INSERT INTO catalog_items (id,"companyId",name,slug,type,source,"supplyV2OfferId","updatedAt") VALUES ('chk-${slug}-${sufijo}','${ctx.casa}','x','${slug}','VOUCHER','${source}',${offerId ? `'${offerId}'` : 'NULL'},now())`
    )
  await assert.rejects(insertar('SUPPLY', null, 'sin-oferta'), /catalog_items_origen_oferta|check/i)
  const otraOferta = await oferta()
  await assert.rejects(insertar('MERCHANT', otraOferta.id, 'con-oferta'), /catalog_items_origen_oferta|check/i)
  await assert.rejects(insertar('SUPPLY', o.id, 'duplicado'), /unique|duplicate|already exists|23505/i)
})

test('11 · una oferta con ítem puente no se puede borrar (FK RESTRICT)', async () => {
  const o = await oferta()
  await sync(o.id)
  await assert.rejects(prisma.supplyV2Offer.delete({ where: { id: o.id } }), /foreign key|Foreign key|constraint/i)
})

// ── Supply es el master ──────────────────────────────────────────────────────

test('12 · la empresa no puede editar un ítem puente: ni datos, ni variantes, ni estado', async () => {
  const o = await oferta()
  await sync(o.id)
  const item = (await itemDe(o.id))!
  const c = ctx.casa
  assert.equal(await codigoDe(conEmpresa(c, (tx) => actualizarItemEnTx(tx, c, item.id, { name: 'Mío ahora' }, como(ctx.usuario)))), 'ITEM_SOLO_LECTURA')
  assert.equal(await codigoDe(conEmpresa(c, (tx) => agregarVarianteEnTx(tx, c, item.id, { name: 'Otra', price: 10 }, como(ctx.usuario)))), 'ITEM_SOLO_LECTURA')
  assert.equal(await codigoDe(conEmpresa(c, (tx) => eliminarVarianteEnTx(tx, c, item.variants[0].id, como(ctx.usuario)))), 'ITEM_SOLO_LECTURA')
  assert.equal(await codigoDe(conEmpresa(c, (tx) => cambiarEstadoItemEnTx(tx, c, item.id, 'PAUSED', como(ctx.usuario)))), 'ITEM_SOLO_LECTURA')
  assert.equal((await itemDe(o.id))!.name, item.name)
})

// ── Lo que ve el público ─────────────────────────────────────────────────────

const visibles = async () => (await catalogoPublicoDeEmpresa(ctx.casa, 48)).map((i) => i.slug)

test('13 · el público ve el ítem puente con su origen y el slug de la oferta', async () => {
  const o = await oferta({ title: `Visible ${sufijo}` })
  await sync(o.id)
  const lista = await catalogoPublicoDeEmpresa(ctx.casa, 48)
  const mio = lista.find((i) => i.slug === o.slug)
  assert.ok(mio)
  assert.equal(mio.origen, 'SUPPLY')
  assert.equal(mio.ofertaSlug, o.slug)
  assert.equal(mio.priceFrom, '650.50')
  const detalle = await itemCatalogoPublico(`puente-casa-${sufijo}`, o.slug)
  assert.equal(detalle?.origen, 'SUPPLY')
  assert.equal(detalle?.variants[0].compareAtPrice, '1000.00')
  assert.doesNotMatch(JSON.stringify(detalle), /MBG-OF|supplyV2OfferId|"cost"/)
})

test('14 · la oferta EN VIVO manda: pausada, vencida o sin empezar deja de verse SIN sincronizar; agotada se ve agotada', async () => {
  const o = await oferta()
  await sync(o.id)
  assert.ok((await visibles()).includes(o.slug))

  // Se pausa en Supply y NO se sincroniza: el ítem sigue diciendo ACTIVE, pero ya no se ve.
  await cambiarOferta(o.id, { status: 'PAUSED' })
  assert.equal((await itemDe(o.id))!.status, 'ACTIVE')
  assert.ok(!(await visibles()).includes(o.slug))
  assert.equal(await itemCatalogoPublico(`puente-casa-${sufijo}`, o.slug), null)

  await cambiarOferta(o.id, { status: 'ACTIVE', endsAt: new Date(Date.now() - 1000) })
  assert.ok(!(await visibles()).includes(o.slug), 'vencida')
  await cambiarOferta(o.id, { endsAt: null, startsAt: new Date(Date.now() + 3_600_000) })
  assert.ok(!(await visibles()).includes(o.slug), 'aún no empieza')
  await cambiarOferta(o.id, { startsAt: new Date(Date.now() - 1000) })
  assert.ok((await visibles()).includes(o.slug))

  await cambiarOferta(o.id, { status: 'SOLD_OUT' })
  const agotada = (await catalogoPublicoDeEmpresa(ctx.casa, 48)).find((i) => i.slug === o.slug)
  assert.ok(agotada, 'agotada se enseña')
  const d = await itemCatalogoPublico(`puente-casa-${sufijo}`, o.slug)
  assert.deepEqual(d?.variants.map((v) => v.available), [false], 'aunque la copia sincronizada diga ACTIVE')
})

test('15 · el descubrimiento filtra por origen', async () => {
  const o = await oferta({ title: `Origen ${sufijo}` })
  await sync(o.id)
  const propio = await prisma.$transaction(async (tx) => {
    const it = await tx.catalogItem.create({ data: { companyId: ctx.casa, name: `Propio ${sufijo}`, slug: `propio-${sufijo}`, type: 'SERVICE', status: 'ACTIVE', capabilities: { availableMarketplace: true } }, select: { id: true } })
    await tx.catalogVariant.createMany({ data: [{ companyId: ctx.casa, catalogItemId: it.id, name: 'Default', sku: `PROP-${sufijo}`, price: 5, isDefault: true }] })
    return it
  })
  assert.ok(propio)
  const supply = await catalogoPublicoGlobal({ origen: 'SUPPLY', q: sufijo })
  assert.ok(supply.items.some((i) => i.slug === o.slug))
  assert.ok(supply.items.every((i) => i.origen === 'SUPPLY'))
  const empresas = await catalogoPublicoGlobal({ origen: 'EMPRESAS', q: sufijo })
  assert.ok(empresas.items.some((i) => i.slug === `propio-${sufijo}`))
  assert.ok(empresas.items.every((i) => i.origen === 'EMPRESA'))
  const todo = await catalogoPublicoGlobal({ q: sufijo })
  assert.ok(todo.items.some((i) => i.slug === o.slug) && todo.items.some((i) => i.slug === `propio-${sufijo}`))
})

// ── Barrido, estado y retiro de la casa ──────────────────────────────────────

test('16 · el barrido reconcilia lo que no se sincronizó y es idempotente', async () => {
  const nueva = await oferta({ title: `Barrido ${sufijo}` })
  const vieja = await oferta()
  await sync(vieja.id)
  await cambiarOferta(vieja.id, { salePrice: 111 })
  const r = await barridoPuente()
  assert.equal(r.hayCasa, true)
  assert.equal(r.errores, 0)
  assert.ok(r.creados >= 1)
  assert.ok(r.actualizados >= 1)
  assert.ok(await itemDe(nueva.id))
  assert.equal((await itemDe(vieja.id))!.variants[0].price.toFixed(2), '111.00')
  const otra = await barridoPuente()
  assert.equal(otra.creados + otra.actualizados, 0)
  assert.equal(otra.errores, 0)
})

test('17 · el estado del puente cuenta ítems por estado y ofertas pendientes', async () => {
  const pendiente = await oferta()
  const e = await sinEmpresa('p', (tx) => estadoDelPuenteEnTx(tx))
  assert.equal(e.casa?.id, ctx.casa)
  assert.ok(e.items.ACTIVE > 0)
  assert.ok(e.pendientes >= 1)
  await sync(pendiente.id)
})

test('18 · retirar la casa archiva todo lo puente y nada queda público; volver a designarla lo reactiva', async () => {
  const o = await oferta({ title: `Retiro ${sufijo}` })
  await sync(o.id)
  assert.ok((await visibles()).includes(o.slug))
  const { archivados } = await sinEmpresa('p', (tx) => designarCasaEnTx(tx, null, como(ctx.usuario)))
  assert.ok(archivados > 0)
  assert.equal(await prisma.catalogItem.count({ where: { source: 'SUPPLY', status: { not: 'ARCHIVED' } } }), 0)
  assert.equal((await catalogoPublicoGlobal({ origen: 'SUPPLY' })).items.length, 0, 'ninguna oferta se enseña sin casa')
  assert.ok(!(await visibles()).includes(o.slug))
  // Sin casa, el barrido sigue sin crear nada y lo dice.
  const sinCasa = await barridoPuente()
  assert.equal(sinCasa.hayCasa, false)
  assert.equal(await sinEmpresa('p', (tx) => archivarPuenteEnTx(tx)), 0, 'idempotente')

  await sinEmpresa('p', (tx) => designarCasaEnTx(tx, ctx.casa, como(ctx.usuario)))
  await barridoPuente()
  assert.equal((await itemDe(o.id))!.status, 'ACTIVE')
  assert.ok((await visibles()).includes(o.slug))
})

test('19 · cambiar de casa con ítems puente colgando de la anterior se rechaza', async () => {
  assert.equal(await codigoDe(sinEmpresa('p', (tx) => designarCasaEnTx(tx, ctx.otra, como(ctx.usuario)))), 'CASA_CON_ITEMS')
  assert.equal((await sinEmpresa('p', (tx) => casaMembegoEnTx(tx)))?.id, ctx.casa)
})

test('20 · si la casa cambió con ítems ya sincronizados, la oferta se marca CONFLICTO y no se mueve', async () => {
  const o = await oferta()
  await sync(o.id)
  // Se fuerza lo que el servicio no permite: mover la casa por debajo.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`UPDATE companies SET "esCasaMembego" = false WHERE id = '${ctx.casa}'`)
    await tx.$executeRawUnsafe(`UPDATE companies SET "esCasaMembego" = true WHERE id = '${ctx.otra}'`)
  })
  try {
    assert.equal((await sync(o.id)).resultado, 'CONFLICTO')
    assert.equal((await itemDe(o.id))!.companyId, ctx.casa)
  } finally {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`UPDATE companies SET "esCasaMembego" = false WHERE id = '${ctx.otra}'`)
      await tx.$executeRawUnsafe(`UPDATE companies SET "esCasaMembego" = true WHERE id = '${ctx.casa}'`)
    })
  }
})
