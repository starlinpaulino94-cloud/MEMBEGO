import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { sinEmpresa } from '../../src/lib/tenant'
import { vincularEmpresaComoProveedorEnTx } from '../../src/modules/supply-v2/suppliers/service'
import { crearItemCatalogoEnTx } from '../../src/modules/supply-v2/catalog/service'
import { activarAcuerdoEnTx, crearAcuerdoEnTx } from '../../src/modules/supply-v2/agreements/service'
import { crearOfertaComisionEnTx, publicarOfertaEnTx } from '../../src/modules/supply-v2/offers/service'
import { aprobarBeneficioEnTx, asignarBeneficioEnTx, crearBeneficioEnTx } from '../../src/modules/supply-v2/benefits/service'
import { misBeneficios } from '../../src/modules/supply-v2/benefits/queries'

/**
 * CORRECCIÓN PREVIA AL SLICE 7 · «MIS BONOS» DEJABA DE VER SU OFERTA CUANDO EL
 * CATÁLOGO CRECÍA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL FALLO
 *
 * `misBeneficios` (pantalla `/cliente/bonos`, Slice 6) pedía UNA PÁGINA de 300
 * ofertas activas —sin orden y sin filtrar por el alcance del beneficio— y
 * después cruzaba en memoria. Con menos de 300 ofertas vivas funcionaba. Al
 * pasar de 300, la oferta del bono podía quedar fuera de esa página y la
 * tarjeta del cliente mostraba «Ahora mismo no hay ofertas activas donde
 * usarlo» teniéndolas, sin enlace para usarlo.
 *
 * No mueve dinero por sí mismo, pero esconde un beneficio ya concedido: el
 * cliente no puede gastar lo que Membego le dio y el bono se vence solo. Se vio
 * al correr la regresión del Slice 6 contra una base con 573 ofertas activas.
 *
 * LA CORRECCIÓN: filtra la BASE, no el servidor. Se consulta solo por lo que
 * los beneficios del cliente pueden cubrir —la oferta concreta, el producto o
 * el proveedor, los tres alcances del §9— y el orden es explícito.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const DIA = 86_400_000
const ahora = new Date()
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })
/** Por encima del `take` de la consulta: con menos, el fallo no se reproduce. */
const RELLENO = 320

const ctx = { compras: '', finanzas: '', cliente: '', supplierId: '', itemId: '', offerId: '' }

before(async () => {
  const [compras, finanzas, cliente] = await Promise.all(
    (
      [
        ['compras', 'SUPERADMIN'],
        ['finanzas', 'SUPERADMIN'],
        ['cliente', 'CLIENTE'],
      ] as const
    ).map(([k, role]) => prisma.user.create({ data: { supabaseId: `sb-mb-${k}-${sufijo}`, email: `mb-${k}-${sufijo}@prueba.test`, name: `mb ${k}`, role }, select: { id: true } }))
  )
  ctx.compras = compras.id
  ctx.finanzas = finanzas.id
  ctx.cliente = cliente.id
  const empresa = await prisma.company.create({ data: { name: `Resto MB ${sufijo}`, slug: `resto-mb-${sufijo}`, type: 'restaurante', capacidades: { overrides: { MEMBEGO_SUPPLIER: true } } }, select: { id: true } })

  await sinEmpresa('prueba', async (tx) => {
    const p = await vincularEmpresaComoProveedorEnTx(tx, empresa.id, {}, como(ctx.compras))
    ctx.supplierId = p.id
    ctx.itemId = (await crearItemCatalogoEnTx(tx, { supplierId: p.id, type: 'PRODUCT', name: `Pizza MB ${sufijo}`, category: 'Pizzas', publicPrice: 1200 }, como(ctx.compras))).id
    const a = await crearAcuerdoEnTx(tx, { supplierId: p.id, type: 'COMMISSION', scope: 'CATEGORY', category: 'Pizzas', commissionPercentage: 8, startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))
    await activarAcuerdoEnTx(tx, a.id, como(ctx.finanzas))
  })

  ctx.offerId = await sinEmpresa('prueba', async (tx) => {
    const o = await crearOfertaComisionEnTx(
      tx,
      { catalogItemId: ctx.itemId, title: `Pizza Membego MB ${sufijo}`, publicPrice: 1200, salePrice: 1000, availabilityMode: 'UNLIMITED', perCustomerLimit: 5, startsAt: new Date(ahora.getTime() - 60_000), endsAt: new Date(ahora.getTime() + 30 * DIA) },
      como(ctx.compras)
    )
    await publicarOfertaEnTx(tx, o.id, como(ctx.compras))
    return o.id
  })

  /**
   * Relleno: ofertas activas de las que al cliente no le sirve ninguna. Se
   * insertan directas porque aquí solo importa que la base tenga MÁS de las
   * que caben en una página; pasar por el servicio 320 veces no añadiría nada
   * y tardaría minutos.
   */
  await prisma.supplyV2Offer.createMany({
    data: Array.from({ length: RELLENO }, (_, i) => ({
      supplierId: ctx.supplierId,
      catalogItemId: ctx.itemId,
      code: `MBG-OF-RELLENO-${sufijo}-${i}`,
      slug: `relleno-${sufijo}-${i}`,
      title: `Relleno ${sufijo} ${i}`,
      sourceType: 'PREPURCHASED_SUPPLY' as const,
      publicPrice: 1200,
      salePrice: 1000,
      quantityLimit: 1,
      startsAt: new Date(ahora.getTime() - 60_000),
      endsAt: new Date(ahora.getTime() + 30 * DIA),
      status: 'ACTIVE' as const,
      createdById: ctx.compras,
    })),
  })
})

/**
 * El relleno se borra al terminar: son ofertas ACTIVAS y, si quedaran, el
 * marketplace y las pantallas del proveedor las enseñarían en las demás
 * suites. Una prueba no puede dejar basura visible en la base compartida.
 */
after(async () => {
  await prisma.supplyV2Offer.deleteMany({ where: { code: { startsWith: `MBG-OF-RELLENO-${sufijo}-` } } })
})

test('el bono del cliente sigue enseñando SU oferta aunque haya más ofertas activas que las que caben en una página', async () => {
  const activas = await prisma.supplyV2Offer.count({ where: { status: 'ACTIVE', startsAt: { lte: ahora }, OR: [{ endsAt: null }, { endsAt: { gt: ahora } }] } })
  assert.ok(activas > 300, `la prueba necesita más de 300 ofertas activas para valer; hay ${activas}`)

  const b = await sinEmpresa('prueba', async (tx) => {
    const creado = await crearBeneficioEnTx(
      tx,
      {
        name: `Bono MB ${sufijo}`,
        funding: 'MEMBEGO',
        valueType: 'FIXED_AMOUNT',
        membegoValue: 500,
        scope: 'SPECIFIC_OFFER',
        offerId: ctx.offerId,
        perCustomerLimit: 1,
        budgetTotal: 5000,
        startsAt: new Date(ahora.getTime() - DIA),
        endsAt: new Date(ahora.getTime() + 30 * DIA),
      },
      como(ctx.compras)
    )
    await aprobarBeneficioEnTx(tx, creado.id, como(ctx.finanzas))
    await asignarBeneficioEnTx(tx, { benefitId: creado.id, customerId: ctx.cliente }, como(ctx.compras))
    return creado
  })

  const mios = await misBeneficios(ctx.cliente)
  const mio = mios.find((x) => x.benefitId === b.id)
  assert.ok(mio, 'el bono asignado aparece en «Mis bonos»')
  assert.equal(mio.valor, '500.00')
  // Lo que fallaba: la oferta donde vale, con su enlace.
  assert.equal(mio.ofertas.length, 1, 'solo su oferta, no las 320 de relleno')
  assert.equal(mio.ofertas[0]!.title, `Pizza Membego MB ${sufijo}`)
  assert.ok(mio.usable, 'y por tanto se puede usar, no «no hay ofertas donde usarlo»')
  assert.equal(mio.motivo, null)
})

test('un beneficio por PROVEEDOR ve las ofertas de ese proveedor y ninguna de otro', async () => {
  const otra = await prisma.company.create({ data: { name: `Otro MB ${sufijo}`, slug: `otro-mb-${sufijo}`, type: 'restaurante', capacidades: { overrides: { MEMBEGO_SUPPLIER: true } } }, select: { id: true } })
  const ajeno = await sinEmpresa('prueba', async (tx) => {
    const p = await vincularEmpresaComoProveedorEnTx(tx, otra.id, {}, como(ctx.compras))
    const item = await crearItemCatalogoEnTx(tx, { supplierId: p.id, type: 'PRODUCT', name: `Pasta MB ${sufijo}`, category: 'Pastas', publicPrice: 900 }, como(ctx.compras))
    const a = await crearAcuerdoEnTx(tx, { supplierId: p.id, type: 'COMMISSION', scope: 'CATALOG', commissionPercentage: 10, startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))
    await activarAcuerdoEnTx(tx, a.id, como(ctx.finanzas))
    const o = await crearOfertaComisionEnTx(
      tx,
      { catalogItemId: item.id, title: `Pasta Membego MB ${sufijo}`, publicPrice: 900, salePrice: 800, availabilityMode: 'UNLIMITED', perCustomerLimit: 5, startsAt: new Date(ahora.getTime() - 60_000), endsAt: new Date(ahora.getTime() + 30 * DIA) },
      como(ctx.compras)
    )
    await publicarOfertaEnTx(tx, o.id, como(ctx.compras))
    return { supplierId: p.id, offerId: o.id }
  })

  const b = await sinEmpresa('prueba', async (tx) => {
    const creado = await crearBeneficioEnTx(
      tx,
      {
        name: `Bono proveedor MB ${sufijo}`,
        funding: 'SUPPLIER',
        valueType: 'FIXED_AMOUNT',
        supplierValue: 100,
        scope: 'SUPPLIER',
        supplierId: ajeno.supplierId,
        perCustomerLimit: 1,
        startsAt: new Date(ahora.getTime() - DIA),
        endsAt: new Date(ahora.getTime() + 30 * DIA),
      },
      como(ctx.compras)
    )
    await aprobarBeneficioEnTx(tx, creado.id, como(ctx.finanzas))
    await asignarBeneficioEnTx(tx, { benefitId: creado.id, customerId: ctx.cliente }, como(ctx.compras))
    return creado
  })

  const mios = await misBeneficios(ctx.cliente)
  const mio = mios.find((x) => x.benefitId === b.id)
  assert.ok(mio, 'el bono de proveedor aparece')
  assert.ok(
    mio.ofertas.every((o) => o.title.startsWith(`Pasta Membego MB ${sufijo}`)),
    `solo ofertas de ese proveedor; vino ${JSON.stringify(mio.ofertas.map((o) => o.title))}`
  )
  assert.ok(mio.ofertas.length >= 1, 'y al menos la suya')
})
