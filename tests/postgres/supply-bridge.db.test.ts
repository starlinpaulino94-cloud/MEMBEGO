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
import { envolverCompraEnTx, FUENTE_SUPPLY, reflejarReembolsoEnTx } from '../../src/modules/supply-bridge/pedido'
import { crearPedidoEnTx } from '../../src/modules/orders/service'
import { PedidoError } from '../../src/modules/orders/errores'

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
const ctx = { casa: '', otra: '', usuario: '', comprador: '', compradorSupabase: '', proveedor: '', producto: '' }
const comprasCreadas: string[] = []
// La base de pruebas guarda compras pagadas de otros tests: el barrido solo mira las de esta corrida.
const inicioDeLaCorrida = new Date(Date.now() - 1000)
// Para los tests que solo miran la sincronización de OFERTAS: nada de envolver compras (otros tests, en paralelo,
// crean compras pagadas sin parar y alargarían la pasada y sus conteos).
const SIN_COMPRAS = { comprasDesde: new Date(Date.now() + 3_600_000) }
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
  const comprador = await prisma.user.create({ data: { supabaseId: `sb-pte-comp-${sufijo}`, email: `pte-comp-${sufijo}@prueba.test`, name: 'Comprador de Supply', role: 'CLIENTE' }, select: { id: true } })
  ctx.comprador = comprador.id
  ctx.compradorSupabase = `sb-pte-comp-${sufijo}`
  const p = await prisma.supplyV2Supplier.create({ data: { source: 'EXTERNAL', commercialName: `Car Town ${sufijo}` }, select: { id: true } })
  ctx.proveedor = p.id
  const i = await prisma.supplyV2CatalogItem.create({ data: { supplierId: p.id, type: 'SERVICE', name: `Lavado ${sufijo}`, slug: `lavado-${sufijo}` }, select: { id: true } })
  ctx.producto = i.id
})

after(async () => {
  const empresas = [ctx.casa, ctx.otra]
  // Lo que cuelga de los pedidos no se borra con los disparadores puestos (líneas inmutables).
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    for (const t of ['payment_evidences', 'customer_confirmations', 'order_attributions', 'membego_order_lines', 'membego_orders']) {
      await tx.$executeRawUnsafe(`DELETE FROM "${t}" WHERE "companyId" IN ('${ctx.casa}', '${ctx.otra}')`)
    }
  })
  await prisma.supplyV2CustomerOrderLine.deleteMany({ where: { orderId: { in: comprasCreadas } } })
  await prisma.supplyV2CustomerOrder.deleteMany({ where: { id: { in: comprasCreadas } } })
  await prisma.cliente.deleteMany({ where: { companyId: { in: empresas } } })
  await prisma.sucursal.deleteMany({ where: { companyId: { in: empresas } } })
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
  const r = await barridoPuente(SIN_COMPRAS)
  assert.equal(r.hayCasa, true)
  assert.equal(r.errores, 0)
  assert.ok(r.creados >= 1)
  assert.ok(r.actualizados >= 1)
  assert.ok(await itemDe(nueva.id))
  assert.equal((await itemDe(vieja.id))!.variants[0].price.toFixed(2), '111.00')
  const otra = await barridoPuente(SIN_COMPRAS)
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
  const sinCasa = await barridoPuente(SIN_COMPRAS)
  assert.equal(sinCasa.hayCasa, false)
  assert.equal(await sinEmpresa('p', (tx) => archivarPuenteEnTx(tx)), 0, 'idempotente')

  await sinEmpresa('p', (tx) => designarCasaEnTx(tx, ctx.casa, como(ctx.usuario)))
  await barridoPuente(SIN_COMPRAS)
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

// ═════════════════════════════════════════════════════════════════════════════
// Fase 3 · el envoltorio de pedido de una compra de Supply
// ═════════════════════════════════════════════════════════════════════════════

const envolver = (compraId: string) => sinEmpresa('prueba: envolver una compra', (tx) => envolverCompraEnTx(tx, compraId))

/** Una compra de Supply YA pagada de una oferta, con el total y el estado de pago que se pidan. */
async function compra(offerId: string, o: { total?: number; status?: 'PAID' | 'PENDING' | 'REFUNDED'; paymentStatus?: 'CONFIRMED' | 'COVERED_BY_BENEFIT' | 'UNPAID'; cantidad?: number; metodo?: 'TRANSFER' | 'CASH' } = {}) {
  contador++
  const cantidad = o.cantidad ?? 1
  const unitario = 650.5
  const subtotal = unitario * cantidad
  const total = o.total ?? subtotal
  const c = await prisma.supplyV2CustomerOrder.create({
    data: {
      number: `MBG-SO-T${sufijo.toUpperCase()}${contador}`,
      customerId: ctx.comprador,
      subtotal: subtotal.toFixed(2),
      // Lo que Supply exige: contractual = subtotal − descuentos; total = contractual − subsidio de Membego.
      contractualValue: subtotal.toFixed(2),
      membegoSubsidyTotal: (subtotal - total).toFixed(2),
      total: total.toFixed(2),
      expiresAt: new Date(Date.now() + 3_600_000),
      status: o.status ?? 'PAID',
      paymentStatus: o.paymentStatus ?? 'CONFIRMED',
      paymentMethod: o.metodo ?? 'TRANSFER',
      paymentReference: 'TRF-9981',
      paymentAmountSeen: total.toFixed(2),
      paidAt: new Date(),
      lines: {
        create: [{ offerId, titleSnapshot: 'Oferta', quantity: cantidad, publicUnitPrice: '1000.00', saleUnitPrice: unitario.toFixed(2), subtotal: subtotal.toFixed(2), contractualValue: subtotal.toFixed(2), membegoSubsidyAmount: (subtotal - total).toFixed(2), total: total.toFixed(2) }],
      },
    },
    select: { id: true },
  })
  comprasCreadas.push(c.id)
  return c.id
}

const pedidoDeCompra = (compraId: string) => prisma.membegoOrder.findFirst({ where: { sourceType: FUENTE_SUPPLY, sourceId: compraId }, include: { lines: true, attribution: true, confirmation: true, payment: true, customer: true } })

test('21 · sin sucursal en la casa la compra no se envuelve (y lo dice); con una, nace COMPLETED con atribución SUPPLY_OFFER', async () => {
  const o = await oferta({ salePrice: 650.5 })
  await sync(o.id)
  const c = await compra(o.id)
  assert.equal((await envolver(c)).estado, 'SIN_SUCURSAL')
  assert.equal(await pedidoDeCompra(c), null)

  await prisma.sucursal.create({ data: { companyId: ctx.casa, nombre: 'Casa Membego' } })
  const r = await envolver(c)
  assert.equal(r.estado, 'CREADO')
  const p = await pedidoDeCompra(c)
  assert.ok(p)
  assert.equal(p.companyId, ctx.casa)
  assert.equal(p.origin, 'SUPPLY')
  assert.equal(p.status, 'COMPLETED')
  assert.equal(p.total.toFixed(2), '650.50')
  assert.equal(p.attribution?.channel, 'SUPPLY_OFFER')
  assert.equal(p.attribution?.supplyV2OfferId, o.id)
  assert.equal(p.lines.length, 1)
  assert.equal(p.lines[0].unitPrice.toFixed(2), '650.50')
  assert.equal(p.lines[0].catalogVariantId, (await itemDe(o.id))!.variants[0].id, 'la línea apunta a la variante del ítem puente')
  assert.equal(p.customer.supabaseId, ctx.compradorSupabase, 'el comprador tiene su ficha en la casa')
  assert.equal(p.qrToken, null, 'el QR interno no sobrevive al cierre')
  // La plata la verificó Membego (transferencia confirmada con referencia) y el cliente aceptó el precio al comprar.
  assert.equal(p.verificationLevel, 'PAYMENT_VERIFIED')
  assert.equal(p.confirmation?.confirmedTotal.toFixed(2), '650.50')
  assert.equal(p.payment?.method, 'TRANSFER')
  assert.equal(p.payment?.reference, 'TRF-9981')
})

test('22 · envolver es idempotente: la misma compra devuelve el mismo pedido', async () => {
  const o = await oferta()
  await sync(o.id)
  const c = await compra(o.id)
  const a = await envolver(c)
  const b = await envolver(c)
  assert.equal(a.estado, 'CREADO')
  assert.equal(b.estado, 'YA_ENVUELTA')
  assert.equal(b.pedidoId, a.pedidoId)
  assert.equal(await prisma.membegoOrder.count({ where: { sourceType: FUENTE_SUPPLY, sourceId: c } }), 1)
})

test('23 · una compra cubierta por un beneficio (total 0) no tiene pago que verificar: queda CUSTOMER_VERIFIED', async () => {
  const o = await oferta()
  await sync(o.id)
  const c = await compra(o.id, { total: 0, paymentStatus: 'COVERED_BY_BENEFIT' })
  assert.equal((await envolver(c)).estado, 'CREADO')
  const p = (await pedidoDeCompra(c))!
  assert.equal(p.total.toFixed(2), '0.00')
  assert.equal(p.lines[0].discount.toFixed(2), '650.50', 'lo que se rebajó queda como descuento de la línea')
  assert.equal(p.payment, null)
  assert.equal(p.verificationLevel, 'CUSTOMER_VERIFIED')
})

test('24 · efectivo o un pago sin confirmar no verifican: la evidencia es la que Membego comprobó', async () => {
  const o = await oferta()
  await sync(o.id)
  const efectivo = await compra(o.id, { metodo: 'CASH' })
  await envolver(efectivo)
  assert.equal((await pedidoDeCompra(efectivo))!.verificationLevel, 'CUSTOMER_VERIFIED', 'efectivo deja constancia pero no verifica')
  assert.equal((await pedidoDeCompra(efectivo))!.payment?.method, 'CASH')
})

test('25 · no se envuelve lo que no es una compra pagada de una oferta, ni una oferta que aún no está en el catálogo de la casa', async () => {
  const o = await oferta()
  await sync(o.id)
  const pendiente = await compra(o.id, { status: 'PENDING', paymentStatus: 'UNPAID' })
  assert.equal((await envolver(pendiente)).estado, 'NO_APLICA')
  assert.equal((await envolver('no-existe')).estado, 'NO_APLICA')
  const sinItem = await oferta()
  const c = await compra(sinItem.id)
  assert.equal((await envolver(c)).estado, 'SIN_ITEM', 'la oferta nunca se sincronizó')
  assert.equal(await pedidoDeCompra(c), null)
})

test('26 · una oferta pausada DESPUÉS de la compra se envuelve igual: es un hecho consumado', async () => {
  const o = await oferta()
  await sync(o.id)
  const c = await compra(o.id)
  await cambiarOferta(o.id, { status: 'PAUSED' })
  await sync(o.id)
  assert.equal((await itemDe(o.id))!.status, 'PAUSED')
  assert.equal((await envolver(c)).estado, 'CREADO')
  assert.equal((await pedidoDeCompra(c))!.status, 'COMPLETED')
})

test('27 · el barrido envuelve las compras pendientes, es idempotente y refleja los reembolsos', async () => {
  const o = await oferta()
  await sync(o.id)
  const c1 = await compra(o.id)
  const c2 = await compra(o.id)
  // Otros tests, en paralelo, crean compras pagadas: se mira lo de ESTE test, no los conteos globales.
  const r1 = await barridoPuente({ comprasDesde: inicioDeLaCorrida })
  assert.ok(r1.pedidosCreados >= 2, `esperaba envolver al menos 2, envolvió ${r1.pedidosCreados}`)
  assert.equal(r1.errores, 0)
  const p1 = await pedidoDeCompra(c1)
  assert.ok(p1)
  assert.ok(await pedidoDeCompra(c2))
  await barridoPuente({ comprasDesde: inicioDeLaCorrida })
  assert.equal(await prisma.membegoOrder.count({ where: { sourceType: FUENTE_SUPPLY, sourceId: c1 } }), 1, 'una segunda pasada no envuelve la misma compra otra vez')
  assert.equal((await pedidoDeCompra(c1))!.id, p1.id)

  await prisma.supplyV2CustomerOrder.update({ where: { id: c1 }, data: { status: 'REFUNDED' } })
  const r3 = await barridoPuente({ comprasDesde: inicioDeLaCorrida })
  assert.ok(r3.pedidosReembolsados >= 1)
  assert.equal((await pedidoDeCompra(c1))!.status, 'REFUNDED')
  assert.equal((await pedidoDeCompra(c2))!.status, 'COMPLETED', 'la otra compra no se toca')
  assert.equal(await sinEmpresa('prueba: reflejar otra vez', (tx) => reflejarReembolsoEnTx(tx, c1)), false, 'el reembolso no se repite')
})

test('28 · el precio de un pedido solo lo fija el sistema; y un ítem de Supply solo entra con origen SUPPLY', async () => {
  const o = await oferta()
  await sync(o.id)
  const variante = (await itemDe(o.id))!.variants[0].id
  const cli = await prisma.cliente.findFirstOrThrow({ where: { companyId: ctx.casa, supabaseId: ctx.compradorSupabase } })
  const sucursal = await prisma.sucursal.findFirstOrThrow({ where: { companyId: ctx.casa } })
  const base = { customerId: cli.id, locationId: sucursal.id, atribucion: { channel: 'SUPPLY_OFFER' as const, supplyV2OfferId: o.id } }
  const intento = (parcial: { origin: 'SUPPLY' | 'MARKETPLACE'; actor: 'CLIENTE' | 'SISTEMA'; precio?: string }) =>
    sinEmpresa('prueba', (tx) =>
      crearPedidoEnTx(
        tx,
        ctx.casa,
        { ...base, origin: parcial.origin, lineas: [{ varianteId: variante, cantidad: 1, ...(parcial.precio ? { precioUnitario: parcial.precio } : {}) }], atribucion: parcial.origin === 'SUPPLY' ? base.atribucion : { channel: 'DIRECT' } },
        { actor: parcial.actor, actorId: null }
      )
    )
  const codigo = async (p: Promise<unknown>) => {
    try {
      await p
    } catch (e) {
      if (e instanceof PedidoError) return e.codigo
      throw e
    }
    return 'NO FALLÓ'
  }
  assert.equal(await codigo(intento({ origin: 'SUPPLY', actor: 'CLIENTE', precio: '1.00' })), 'PRECIO_NO_PERMITIDO', 'un cliente no fija el precio')
  assert.equal(await codigo(intento({ origin: 'MARKETPLACE', actor: 'CLIENTE' })), 'ITEM_DE_SUPPLY', 'una oferta no se pide por la vitrina')
})
