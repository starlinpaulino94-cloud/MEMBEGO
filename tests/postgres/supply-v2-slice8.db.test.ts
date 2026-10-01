import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { sinEmpresa } from '../../src/lib/tenant'
import { vincularEmpresaComoProveedorEnTx } from '../../src/modules/supply-v2/suppliers/service'
import { crearItemCatalogoEnTx } from '../../src/modules/supply-v2/catalog/service'
import { activarAcuerdoEnTx, crearAcuerdoEnTx } from '../../src/modules/supply-v2/agreements/service'
import { crearOfertaComisionEnTx, publicarOfertaEnTx } from '../../src/modules/supply-v2/offers/service'
import { aprobarBeneficioEnTx, crearBeneficioEnTx } from '../../src/modules/supply-v2/benefits/service'
import { confirmarPagoEnTx, cancelarOrdenClienteEnTx, expirarOrdenEnTx } from '../../src/modules/supply-v2/commerce/checkout'
import { abrirOrdenClienteEnTx } from '../../src/modules/supply-v2/commerce/checkout'
import {
  ajustarPuntosEnTx,
  cuentaDePuntosEnTx,
  liberarPendientesEnTx,
  reservarPuntosEnTx,
  reversarPuntosDeCompraEnTx,
  saldoReconstruidoEnTx,
  vencerPuntosEnTx,
} from '../../src/modules/supply-v2/loyalty/points'
import {
  activarProgramadasEnTx,
  cancelarMembresiaEnTx,
  contratarMembresiaEnTx,
  otorgarMembresiaEnTx,
  vencerMembresiasEnTx,
} from '../../src/modules/supply-v2/loyalty/memberships'
import {
  actualizarPlanEnTx,
  adjuntarBeneficioAPlanEnTx,
  aprobarProgramaEnTx,
  archivarPlanEnTx,
  cancelarProgramaEnTx,
  crearPlanEnTx,
  crearProgramaEnTx,
  enviarProgramaARevisionEnTx,
  exigirPropiedadDePrograma,
  fijarSucursalesEnTx,
  pausarProgramaEnTx,
  publicarPlanEnTx,
  reanudarProgramaEnTx,
} from '../../src/modules/supply-v2/loyalty/programs'
import {
  aprobarRecompensaEnTx,
  conciliarEntregasEnTx,
  crearRecompensaEnTx,
  economiaDelProgramaEnTx,
  marcarEntregadaEnTx,
  reclamarRecompensaEnTx,
  reversarReclamacionEnTx,
} from '../../src/modules/supply-v2/loyalty/rewards'
import {
  anularReferidoEnTx,
  aprobarYConcederEnTx,
  atribuirRegistroEnTx,
  barridoReferidosEnTx,
  codigoDeReferidoEnTx,
  configurarReferidosEnTx,
  estadisticasDeReferidosEnTx,
  registrarAperturaEnTx,
} from '../../src/modules/supply-v2/loyalty/referrals'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 contra PostgreSQL de verdad (§45).
 *
 *   A  Membresía: compra confirmada → membresía activa → beneficios disponibles
 *   B  Aislamiento: un cliente con membresías en DOS empresas, sin mezclar
 *   C  Referidos: una primera compra válida genera EXACTAMENTE una recompensa
 *   D  Autorreferidos: el sistema rechaza un referido inválido
 *   E  Concurrencia: dos operaciones por los últimos puntos; solo una pasa
 *   F  Recompensa: reclamar consume puntos y genera el beneficio correcto
 *   G  Cancelación: una compra cancelada no concede puntos ni recompensas
 *   H  Vencimiento: puntos y membresías vencen sin tocar otros programas
 *   I  Finanzas: el costo de una recompensa no se duplica
 *   J  Regresión: ventas, bonos, campañas y cupones siguen funcionando
 *
 * Y, antes que todos, lo que sostiene la BASE: los CHECK y los índices únicos
 * parciales. Una regla que solo vive en TypeScript no protege nada si alguien
 * escribe por otro camino.
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const DIA = 86_400_000
const ahora = new Date()
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

const ctx = {
  compras: '',
  finanzas: '',
  cliente: '',
  cliente2: '',
  cliente3: '',
  // Empresa A (Car Town) y empresa B (Resto): el aislamiento se prueba con
  // dos negocios de verdad, no con uno fingiendo ser dos.
  empresaA: '',
  empresaB: '',
  sucursalA: '',
  sucursalB: '',
  supplierA: '',
  supplierB: '',
  itemA: '',
  itemB: '',
  offerA: '',
  offerB: '',
}

async function usuario(k: string, role: 'SUPERADMIN' | 'CLIENTE' | 'ADMINISTRADOR'): Promise<string> {
  const u = await prisma.user.create({
    data: { supabaseId: `sb-s8-${k}-${sufijo}`, email: `s8-${k}-${sufijo}@prueba.test`, name: `s8 ${k}`, role },
    select: { id: true },
  })
  return u.id
}

async function negocio(nombre: string, slug: string): Promise<{ companyId: string; sucursalId: string; supplierId: string; itemId: string; offerId: string }> {
  const empresa = await prisma.company.create({
    data: { name: `${nombre} ${sufijo}`, slug: `${slug}-${sufijo}`, type: 'carwash', capacidades: { overrides: { MEMBEGO_SUPPLIER: true } } },
    select: { id: true },
  })
  const sucursal = await prisma.sucursal.create({ data: { companyId: empresa.id, nombre: 'Principal' }, select: { id: true } })
  return sinEmpresa('prueba', async (tx) => {
    const p = await vincularEmpresaComoProveedorEnTx(tx, empresa.id, {}, como(ctx.compras))
    const item = await crearItemCatalogoEnTx(
      tx,
      { supplierId: p.id, type: 'SERVICE', name: `Lavado ${nombre} ${sufijo}`, category: `Lavados ${sufijo}`, publicPrice: 1200 },
      como(ctx.compras)
    )
    const a = await crearAcuerdoEnTx(
      tx,
      { supplierId: p.id, type: 'COMMISSION', scope: 'CATEGORY', category: `Lavados ${sufijo}`, commissionPercentage: 8, startsAt: new Date(ahora.getTime() - DIA) },
      como(ctx.compras)
    )
    await activarAcuerdoEnTx(tx, a.id, como(ctx.finanzas))
    const o = await crearOfertaComisionEnTx(
      tx,
      {
        catalogItemId: item.id,
        title: `Lavado ${nombre} Membego ${sufijo}`,
        publicPrice: 1200,
        salePrice: 1000,
        availabilityMode: 'UNLIMITED',
        perCustomerLimit: 5,
        startsAt: new Date(ahora.getTime() - 60_000),
        endsAt: new Date(ahora.getTime() + 30 * DIA),
      },
      como(ctx.compras)
    )
    await publicarOfertaEnTx(tx, o.id, como(ctx.compras))
    return { companyId: empresa.id, sucursalId: sucursal.id, supplierId: p.id, itemId: item.id, offerId: o.id }
  })
}

/** Programa ACTIVO del negocio indicado, con las modalidades que se pidan. */
async function programaActivo(d: {
  nombre: string
  supplierId: string | null
  owner: 'MEMBEGO' | 'SUPPLIER'
  modalidades?: ('MEMBERSHIPS' | 'REFERRALS' | 'POINTS' | 'REWARDS')[]
  presupuesto?: number | null
  puntosPorUnidad?: number | null
  importePorPunto?: number | null
  diasVencimiento?: number | null
  diasPendientes?: number | null
}): Promise<string> {
  return sinEmpresa('prueba', async (tx) => {
    const p = await crearProgramaEnTx(
      tx,
      {
        name: `${d.nombre} ${sufijo}`,
        owner: d.owner,
        supplierId: d.supplierId,
        funding: d.owner === 'SUPPLIER' ? 'SUPPLIER' : 'MEMBEGO',
        modalities: d.modalidades ?? ['MEMBERSHIPS', 'POINTS', 'REWARDS', 'REFERRALS'],
        budgetTotal: d.owner === 'MEMBEGO' ? (d.presupuesto ?? 100000) : null,
        pointsPerUnit: d.puntosPorUnidad === null ? null : (d.puntosPorUnidad ?? 1),
        amountPerPoint: d.importePorPunto === null ? null : (d.importePorPunto ?? 100),
        pointsExpireDays: d.diasVencimiento ?? null,
        pointsHoldDays: d.diasPendientes ?? 0,
        startsAt: new Date(ahora.getTime() - DIA),
      },
      como(ctx.compras)
    )
    // Hace falta algo que ofrecer para poder enviarlo a revisión.
    await crearPlanEnTx(tx, p.id, { name: `Base ${sufijo}`, kind: 'FREE', price: 0, durationDays: 30 }, como(ctx.compras))
    await enviarProgramaARevisionEnTx(tx, p.id, como(ctx.compras))
    // Aprueba OTRA persona: la segregación de funciones manda.
    await aprobarProgramaEnTx(tx, p.id, como(ctx.finanzas))
    return p.id
  })
}

before(async () => {
  ctx.compras = await usuario('compras', 'SUPERADMIN')
  ctx.finanzas = await usuario('finanzas', 'SUPERADMIN')
  ctx.cliente = await usuario('c1', 'CLIENTE')
  ctx.cliente2 = await usuario('c2', 'CLIENTE')
  ctx.cliente3 = await usuario('c3', 'CLIENTE')

  const a = await negocio('Car Town', 'car-town-s8')
  const b = await negocio('Resto', 'resto-s8')
  ctx.empresaA = a.companyId
  ctx.sucursalA = a.sucursalId
  ctx.supplierA = a.supplierId
  ctx.itemA = a.itemId
  ctx.offerA = a.offerId
  ctx.empresaB = b.companyId
  ctx.sucursalB = b.sucursalId
  ctx.supplierB = b.supplierId
  ctx.itemB = b.itemId
  ctx.offerB = b.offerId
})

// ════════════════════════════════════════════════════════════════════════════
// LO QUE SOSTIENE LA BASE
// ════════════════════════════════════════════════════════════════════════════

test('la base rechaza por su nombre las escrituras ilegales: los CHECK no son decorativos', async () => {
  const programId = await programaActivo({ nombre: 'Checks', supplierId: ctx.supplierA, owner: 'SUPPLIER' })

  const intentos: { que: string; sql: () => Promise<unknown>; constraint: RegExp }[] = [
    {
      que: 'un plan de PAGO con precio 0',
      sql: () =>
        prisma.$executeRaw`INSERT INTO "supply_v2_membership_plans" ("id","code","programId","name","kind","price","currency","durationDays","maxAdvanceRenewals","status","currentVersion","createdById","createdAt","updatedAt")
          VALUES (${`ilegal-1-${sufijo}`}, ${`MBG-MP-9999-${sufijo.slice(0, 6)}`}, ${programId}, ${`Ilegal1 ${sufijo}`}, 'PAID', 0, 'DOP', 30, 1, 'DRAFT', 1, ${ctx.compras}, now(), now())`,
      constraint: /supply_v2_membership_plans_shape/,
    },
    {
      que: 'un plan GRATUITO con precio',
      sql: () =>
        prisma.$executeRaw`INSERT INTO "supply_v2_membership_plans" ("id","code","programId","name","kind","price","currency","durationDays","maxAdvanceRenewals","status","currentVersion","createdById","createdAt","updatedAt")
          VALUES (${`ilegal-2-${sufijo}`}, ${`MBG-MP-9998-${sufijo.slice(0, 6)}`}, ${programId}, ${`Ilegal2 ${sufijo}`}, 'FREE', 500, 'DOP', 30, 1, 'DRAFT', 1, ${ctx.compras}, now(), now())`,
      constraint: /supply_v2_membership_plans_shape/,
    },
    {
      que: 'un AUTORREFERIDO escrito a mano',
      sql: () =>
        prisma.$executeRaw`INSERT INTO "supply_v2_referrals" ("id","programId","referralCodeId","referrerId","referredId","codeSnapshot","status","createdAt","updatedAt")
          VALUES (${`ilegal-3-${sufijo}`}, ${programId}, ${`x-${sufijo}`}, ${ctx.cliente}, ${ctx.cliente}, 'ABCD1234', 'SIGNED_UP', now(), now())`,
      constraint: /supply_v2_referrals_shape/,
    },
    {
      que: 'una cuenta de puntos en negativo',
      sql: () =>
        prisma.$executeRaw`INSERT INTO "supply_v2_points_accounts" ("id","programId","customerId","available","pending","reserved","redeemed","expired","createdAt","updatedAt")
          VALUES (${`ilegal-4-${sufijo}`}, ${programId}, ${ctx.cliente2}, -10, 0, 0, 0, 0, now(), now())`,
      constraint: /supply_v2_points_accounts_balances/,
    },
  ]

  for (const i of intentos) {
    await assert.rejects(i.sql, (e: Error) => {
      assert.match(e.message, i.constraint, `${i.que} debería morir por ${i.constraint}`)
      return true
    }, `la base debería rechazar: ${i.que}`)
  }

  // Un ajuste de puntos sin motivo tampoco pasa.
  const cuenta = await prisma.supplyV2PointsAccount.create({
    data: { programId, customerId: ctx.cliente3, available: 0, pending: 0, reserved: 0, redeemed: 0, expired: 0 },
    select: { id: true },
  })
  await assert.rejects(
    () =>
      prisma.$executeRaw`INSERT INTO "supply_v2_points_movements" ("id","accountId","type","source","points","availableDelta","availableAfter","pendingAfter","reservedAfter","createdAt")
        VALUES (${`ilegal-6-${sufijo}`}, ${cuenta.id}, 'ADMIN_ADJUSTMENT', 'ADMIN', 10, 10, 10, 0, 0, now())`,
    /supply_v2_points_movements_shape/,
    'un ajuste manual SIN motivo ni actor tiene que morir en la base'
  )

  // Y un pedido que dice ser de membresía sin decir de qué plan.
  await assert.rejects(
    () =>
      prisma.$executeRaw`INSERT INTO "supply_v2_customer_orders" ("id","number","customerId","currency","subtotal","total","status","paymentStatus","expiresAt","kind","createdAt","updatedAt")
        VALUES (${`ilegal-7-${sufijo}`}, ${`MBG-SO-9999-${sufijo.slice(0, 6)}`}, ${ctx.cliente}, 'DOP', 0, 0, 'PENDING', 'UNPAID', now(), 'MEMBERSHIP', now(), now())`,
    /supply_v2_customer_orders_kind/,
    'un pedido de membresía sin plan tiene que morir en la base'
  )
})

test('los índices únicos parciales existen de verdad, no solo en la migración', async () => {
  const filas = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE indexname IN (
      'supply_v2_membresia_activa_por_plan',
      'supply_v2_membresia_sin_pagar_por_plan',
      'supply_v2_reclamacion_viva_por_cliente',
      'supply_v2_referral_codes_code_upper'
    )`
  assert.equal(filas.length, 4, 'faltan índices: las carreras no perderían de verdad')
  const porNombre = Object.fromEntries(filas.map((f) => [f.indexname, f.indexdef]))
  assert.match(porNombre['supply_v2_membresia_activa_por_plan']!, /WHERE .*ACTIVE/)
  assert.match(porNombre['supply_v2_membresia_sin_pagar_por_plan']!, /WHERE .*PENDING_PAYMENT/)
  assert.match(porNombre['supply_v2_reclamacion_viva_por_cliente']!, /WHERE .*RESERVED/)
  assert.match(porNombre['supply_v2_referral_codes_code_upper']!, /upper/i)
})

// ════════════════════════════════════════════════════════════════════════════
// PROGRAMAS Y PLANES
// ════════════════════════════════════════════════════════════════════════════

test('ciclo del programa: borrador → revisión → aprobación de OTRA persona → activo', async () => {
  const creado = await sinEmpresa('prueba', async (tx) => {
    const p = await crearProgramaEnTx(
      tx,
      {
        name: `Ciclo ${sufijo}`,
        owner: 'SUPPLIER',
        supplierId: ctx.supplierA,
        funding: 'SUPPLIER',
        modalities: ['MEMBERSHIPS'],
        startsAt: new Date(ahora.getTime() - DIA),
      },
      como(ctx.compras)
    )
    return p
  })
  assert.equal(creado.status, 'DRAFT', 'nace borrador, siempre')
  assert.match(creado.code, /^MBG-FD-\d{4}-\d{6}$/)

  // Un programa que no ofrece NADA no se puede enviar a revisión.
  await assert.rejects(
    () => sinEmpresa('prueba', (tx) => enviarProgramaARevisionEnTx(tx, creado.id, como(ctx.compras))),
    /todavía no ofrece nada/
  )

  await sinEmpresa('prueba', (tx) => crearPlanEnTx(tx, creado.id, { name: `Gold ${sufijo}`, kind: 'PAID', price: 1499, durationDays: 30 }, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => enviarProgramaARevisionEnTx(tx, creado.id, como(ctx.compras)))

  // Quien lo creó NO lo aprueba: hay dos superadmins de verdad.
  await assert.rejects(
    () => sinEmpresa('prueba', (tx) => aprobarProgramaEnTx(tx, creado.id, como(ctx.compras))),
    /no lo aprueba la misma persona/
  )
  const ok = await sinEmpresa('prueba', (tx) => aprobarProgramaEnTx(tx, creado.id, como(ctx.finanzas)))
  assert.equal(ok.status, 'ACTIVE')

  // Reaprobar es idempotente, no un error.
  const otra = await sinEmpresa('prueba', (tx) => aprobarProgramaEnTx(tx, creado.id, como(ctx.finanzas)))
  assert.equal(otra.repetido, true)

  // Pausar y reanudar.
  await sinEmpresa('prueba', (tx) => pausarProgramaEnTx(tx, creado.id, como(ctx.finanzas)))
  assert.equal((await prisma.supplyV2LoyaltyProgram.findUniqueOrThrow({ where: { id: creado.id }, select: { status: true } })).status, 'PAUSED')
  await sinEmpresa('prueba', (tx) => reanudarProgramaEnTx(tx, creado.id, como(ctx.finanzas)))

  // Y todo queda en la bitácora propia del programa.
  const eventos = await prisma.supplyV2LoyaltyEvent.findMany({ where: { programId: creado.id }, select: { type: true }, orderBy: { createdAt: 'asc' } })
  assert.deepEqual(
    eventos.map((e) => e.type),
    ['PROGRAM_CREATED', 'PLAN_CREATED', 'PROGRAM_SUBMITTED', 'PROGRAM_APPROVED', 'PROGRAM_PAUSED', 'PROGRAM_RESUMED']
  )
})

test('§17 · un programa que compromete dinero de Membego exige techo; sin él, la autorización queda escrita', async () => {
  await assert.rejects(
    () =>
      sinEmpresa('prueba', (tx) =>
        crearProgramaEnTx(
          tx,
          { name: `SinTope ${sufijo}`, owner: 'MEMBEGO', supplierId: null, funding: 'MEMBEGO', modalities: ['REWARDS'], budgetTotal: null, startsAt: new Date() },
          como(ctx.compras)
        )
      ),
    /presupuesto máximo/
  )

  const conAutorizacion = await sinEmpresa('prueba', (tx) =>
    crearProgramaEnTx(
      tx,
      {
        name: `SinTopeOK ${sufijo}`,
        owner: 'MEMBEGO',
        supplierId: null,
        funding: 'MEMBEGO',
        modalities: ['REWARDS'],
        budgetTotal: null,
        budgetWaiverById: ctx.finanzas,
        budgetWaiverReason: 'Piloto de dos semanas aprobado en comité del 01/10',
        startsAt: new Date(),
      },
      como(ctx.compras)
    )
  )
  const fila = await prisma.supplyV2LoyaltyProgram.findUniqueOrThrow({
    where: { id: conAutorizacion.id },
    select: { budgetTotal: true, budgetWaiverById: true, budgetWaiverReason: true, budgetWaiverAt: true },
  })
  assert.equal(fila.budgetTotal, null)
  assert.equal(fila.budgetWaiverById, ctx.finanzas)
  assert.ok(fila.budgetWaiverAt, 'queda cuándo se autorizó')
  const evento = await prisma.supplyV2LoyaltyEvent.count({ where: { programId: conAutorizacion.id, type: 'BUDGET_WAIVED' } })
  assert.equal(evento, 1, 'la autorización no ocurre en silencio')

  // Y SQL sobre toda la base: ni un programa sin techo sin autorización.
  const [{ sin_autorizacion }] = await prisma.$queryRaw<{ sin_autorizacion: bigint }[]>`
    SELECT count(*) AS sin_autorizacion FROM "supply_v2_loyalty_programs"
    WHERE "budgetTotal" IS NULL AND "funding" <> 'SUPPLIER'
      AND ("budgetWaiverById" IS NULL OR "budgetWaiverReason" IS NULL)`
  assert.equal(Number(sin_autorizacion), 0)
})

test('AISLAMIENTO · un negocio solo administra SUS programas', async () => {
  const deA = await programaActivo({ nombre: 'Solo A', supplierId: ctx.supplierA, owner: 'SUPPLIER' })
  const fila = await prisma.supplyV2LoyaltyProgram.findUniqueOrThrow({ where: { id: deA }, select: { owner: true, supplierId: true } })

  // El dueño sí.
  exigirPropiedadDePrograma(fila, { esPlataforma: false, supplierId: ctx.supplierA })
  // El otro negocio NO, aunque conozca el id.
  assert.throws(() => exigirPropiedadDePrograma(fila, { esPlataforma: false, supplierId: ctx.supplierB }), /de otro negocio/)
  // La plataforma supervisa.
  exigirPropiedadDePrograma(fila, { esPlataforma: true, supplierId: null })

  // Un programa de Membego no lo administra un proveedor que participe.
  const global = await programaActivo({ nombre: 'Global', supplierId: null, owner: 'MEMBEGO' })
  const filaGlobal = await prisma.supplyV2LoyaltyProgram.findUniqueOrThrow({ where: { id: global }, select: { owner: true, supplierId: true } })
  assert.throws(() => exigirPropiedadDePrograma(filaGlobal, { esPlataforma: false, supplierId: ctx.supplierA }), /de otro negocio/)
})

test('las sucursales participantes son las del negocio, y fijarlas es idempotente', async () => {
  const programId = await programaActivo({ nombre: 'Sucursales', supplierId: ctx.supplierA, owner: 'SUPPLIER' })

  await sinEmpresa('prueba', (tx) => fijarSucursalesEnTx(tx, programId, [ctx.sucursalA], como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => fijarSucursalesEnTx(tx, programId, [ctx.sucursalA], como(ctx.compras)))
  assert.equal(await prisma.supplyV2LoyaltyProgramBranch.count({ where: { programId } }), 1, 'repetir no duplica')

  // Una sucursal de OTRO negocio se rechaza.
  await assert.rejects(
    () => sinEmpresa('prueba', (tx) => fijarSucursalesEnTx(tx, programId, [ctx.sucursalB], como(ctx.compras))),
    /no son de este negocio/
  )
  // Y la lista anterior sigue intacta tras el rechazo.
  assert.equal(await prisma.supplyV2LoyaltyProgramBranch.count({ where: { programId } }), 1)
})

test('§14 · cambiar el precio sube la versión del plan; cambiar la descripción, no', async () => {
  const programId = await programaActivo({ nombre: 'Versiones', supplierId: ctx.supplierA, owner: 'SUPPLIER' })
  const plan = await sinEmpresa('prueba', (tx) =>
    crearPlanEnTx(tx, programId, { name: `Gold ${sufijo}`, kind: 'PAID', price: 1499, durationDays: 30 }, como(ctx.compras))
  )

  // Solo la descripción: NO sube versión.
  const r1 = await sinEmpresa('prueba', (tx) =>
    actualizarPlanEnTx(tx, plan.id, { name: `Gold ${sufijo}`, description: 'Ahora con secado a mano', kind: 'PAID', price: 1499, durationDays: 30 }, como(ctx.compras))
  )
  assert.equal(r1.versionNueva, false)
  assert.equal(r1.version, 1)

  // El precio sí.
  const r2 = await sinEmpresa('prueba', (tx) =>
    actualizarPlanEnTx(tx, plan.id, { name: `Gold ${sufijo}`, kind: 'PAID', price: 1799, durationDays: 30 }, como(ctx.compras))
  )
  assert.equal(r2.versionNueva, true)
  assert.equal(r2.version, 2)

  const versiones = await prisma.supplyV2MembershipPlanVersion.findMany({ where: { planId: plan.id }, orderBy: { version: 'asc' }, select: { version: true, price: true } })
  assert.deepEqual(versiones.map((v) => [v.version, v.price.toFixed(2)]), [[1, '1499.00'], [2, '1799.00']])

  // El tipo del plan NO se cambia: alteraría lo ya contratado.
  await assert.rejects(
    () => sinEmpresa('prueba', (tx) => actualizarPlanEnTx(tx, plan.id, { name: `Gold ${sufijo}`, kind: 'FREE', price: 0, durationDays: 30 }, como(ctx.compras))),
    /no se cambia/
  )
})

test('un plan no se publica si su programa no está activo, y dos planes no comparten nombre', async () => {
  const borrador = await sinEmpresa('prueba', (tx) =>
    crearProgramaEnTx(
      tx,
      { name: `Borrador ${sufijo}`, owner: 'SUPPLIER', supplierId: ctx.supplierA, funding: 'SUPPLIER', modalities: ['MEMBERSHIPS'], startsAt: new Date(ahora.getTime() - DIA) },
      como(ctx.compras)
    )
  )
  const plan = await sinEmpresa('prueba', (tx) => crearPlanEnTx(tx, borrador.id, { name: `Silver ${sufijo}`, kind: 'PAID', price: 999, durationDays: 30 }, como(ctx.compras)))
  await assert.rejects(() => sinEmpresa('prueba', (tx) => publicarPlanEnTx(tx, plan.id, como(ctx.compras))), /tiene que estar activo/)

  // Mismo nombre dentro del mismo programa: rechazado por el índice único.
  await assert.rejects(
    () => sinEmpresa('prueba', (tx) => crearPlanEnTx(tx, borrador.id, { name: `Silver ${sufijo}`, kind: 'FREE', price: 0, durationDays: 15 }, como(ctx.compras))),
    /ya tiene un plan llamado/
  )
})

test('los tres planes del enunciado conviven en un programa, y solo se publica el que se publica', async () => {
  const programId = await programaActivo({ nombre: 'Car Town Planes', supplierId: ctx.supplierA, owner: 'SUPPLIER' })
  const creados = await sinEmpresa('prueba', async (tx) => {
    const silver = await crearPlanEnTx(tx, programId, { name: `Silver ${sufijo}`, kind: 'PAID', price: 999, durationDays: 30 }, como(ctx.compras))
    const gold = await crearPlanEnTx(tx, programId, { name: `Gold ${sufijo}`, kind: 'PAID', price: 1499, durationDays: 30 }, como(ctx.compras))
    const platinum = await crearPlanEnTx(tx, programId, { name: `Platinum ${sufijo}`, kind: 'PAID', price: 2499, durationDays: 30 }, como(ctx.compras))
    await publicarPlanEnTx(tx, gold.id, como(ctx.compras))
    return { silver, gold, platinum }
  })

  const filas = await prisma.supplyV2MembershipPlan.findMany({
    where: { id: { in: [creados.silver.id, creados.gold.id, creados.platinum.id] } },
    select: { name: true, price: true, status: true },
    orderBy: { price: 'asc' },
  })
  assert.deepEqual(
    filas.map((f) => [f.price.toFixed(2), f.status]),
    [['999.00', 'DRAFT'], ['1499.00', 'PUBLISHED'], ['2499.00', 'DRAFT']]
  )
})

test('archivar un plan lo quita del escaparate pero NO cancela lo ya vendido', async () => {
  const programId = await programaActivo({ nombre: 'Archivar', supplierId: ctx.supplierA, owner: 'SUPPLIER' })
  const plan = await sinEmpresa('prueba', async (tx) => {
    const p = await crearPlanEnTx(tx, programId, { name: `Gold ${sufijo}`, kind: 'FREE', price: 0, durationDays: 30 }, como(ctx.compras))
    await publicarPlanEnTx(tx, p.id, como(ctx.compras))
    return p
  })
  // Una membresía viva escrita directamente, para comprobar que archivar no la toca.
  const m = await prisma.supplyV2CustomerMembership.create({
    data: {
      code: `MBG-MS-9000-${sufijo.slice(0, 6)}`,
      programId,
      planId: plan.id,
      planVersion: 1,
      customerId: ctx.cliente,
      status: 'ACTIVE',
      activatedAt: new Date(ahora.getTime() - DIA),
      expiresAt: new Date(ahora.getTime() + 20 * DIA),
    },
    select: { id: true },
  })

  const r = await sinEmpresa('prueba', (tx) => archivarPlanEnTx(tx, plan.id, como(ctx.compras)))
  assert.equal(r.miembrosVivos, 1, 'avisa de a cuánta gente afecta')
  const despues = await prisma.supplyV2CustomerMembership.findUniqueOrThrow({ where: { id: m.id }, select: { status: true, expiresAt: true } })
  assert.equal(despues.status, 'ACTIVE', 'archivar el plan NO cancela la membresía de quien ya pagó')
})

test('cancelar un programa archiva sus planes pero no toca las membresías vivas', async () => {
  const programId = await programaActivo({ nombre: 'Cancelar', supplierId: ctx.supplierA, owner: 'SUPPLIER' })
  const plan = await sinEmpresa('prueba', async (tx) => {
    const p = await crearPlanEnTx(tx, programId, { name: `Gold ${sufijo}`, kind: 'FREE', price: 0, durationDays: 30 }, como(ctx.compras))
    await publicarPlanEnTx(tx, p.id, como(ctx.compras))
    return p
  })
  const m = await prisma.supplyV2CustomerMembership.create({
    data: {
      code: `MBG-MS-9001-${sufijo.slice(0, 6)}`,
      programId,
      planId: plan.id,
      planVersion: 1,
      customerId: ctx.cliente2,
      status: 'ACTIVE',
      activatedAt: new Date(ahora.getTime() - DIA),
      expiresAt: new Date(ahora.getTime() + 20 * DIA),
    },
    select: { id: true },
  })

  await assert.rejects(() => sinEmpresa('prueba', (tx) => cancelarProgramaEnTx(tx, programId, '', como(ctx.finanzas))), /necesita un motivo/)
  const r = await sinEmpresa('prueba', (tx) => cancelarProgramaEnTx(tx, programId, 'Se cierra la prueba piloto', como(ctx.finanzas)))
  assert.ok(r.planesArchivados >= 1)

  assert.equal((await prisma.supplyV2MembershipPlan.findUniqueOrThrow({ where: { id: plan.id }, select: { status: true } })).status, 'ARCHIVED')
  assert.equal(
    (await prisma.supplyV2CustomerMembership.findUniqueOrThrow({ where: { id: m.id }, select: { status: true } })).status,
    'ACTIVE',
    'cancelar el programa no es una forma de quitarle a la gente lo que ya pagó'
  )
})

test('un beneficio de plan tiene que ser de los que se ASIGNAN, y no se repite', async () => {
  const programId = await programaActivo({ nombre: 'BenefPlan', supplierId: ctx.supplierA, owner: 'SUPPLIER' })
  const plan = await sinEmpresa('prueba', (tx) => crearPlanEnTx(tx, programId, { name: `Gold ${sufijo}`, kind: 'PAID', price: 1499, durationDays: 30 }, como(ctx.compras)))

  // Un beneficio ABIERTO (sin asignación) no sirve: lo tendría todo el mundo.
  const abierto = await sinEmpresa('prueba', async (tx) => {
    const b = await crearBeneficioEnTx(
      tx,
      { name: `Abierto ${sufijo}`, funding: 'SUPPLIER', valueType: 'FIXED_AMOUNT', supplierValue: 100, scope: 'SUPPLIER', supplierId: ctx.supplierA, requiresAssignment: false, startsAt: new Date(ahora.getTime() - DIA) },
      como(ctx.compras)
    )
    await aprobarBeneficioEnTx(tx, b.id, como(ctx.finanzas))
    return b
  })
  await assert.rejects(
    () => sinEmpresa('prueba', (tx) => adjuntarBeneficioAPlanEnTx(tx, plan.id, { kind: 'BENEFIT', benefitId: abierto.id }, como(ctx.compras))),
    /abierto a todo el mundo/
  )

  const exclusivo = await sinEmpresa('prueba', async (tx) => {
    const b = await crearBeneficioEnTx(
      tx,
      { name: `Exclusivo Gold ${sufijo}`, funding: 'SUPPLIER', valueType: 'FIXED_AMOUNT', supplierValue: 200, scope: 'SUPPLIER', supplierId: ctx.supplierA, requiresAssignment: true, perCustomerLimit: 4, startsAt: new Date(ahora.getTime() - DIA) },
      como(ctx.compras)
    )
    await aprobarBeneficioEnTx(tx, b.id, como(ctx.finanzas))
    return b
  })
  await sinEmpresa('prueba', (tx) => adjuntarBeneficioAPlanEnTx(tx, plan.id, { kind: 'BENEFIT', benefitId: exclusivo.id, usesPerPeriod: 4 }, como(ctx.compras)))
  await assert.rejects(
    () => sinEmpresa('prueba', (tx) => adjuntarBeneficioAPlanEnTx(tx, plan.id, { kind: 'BENEFIT', benefitId: exclusivo.id }, como(ctx.compras))),
    /ya está incluido/
  )

  // Un multiplicador de puntos que no multiplica nada se rechaza.
  await assert.rejects(
    () => sinEmpresa('prueba', (tx) => adjuntarBeneficioAPlanEnTx(tx, plan.id, { kind: 'POINTS_MULTIPLIER', pointsMultiplier: 1 }, como(ctx.compras))),
    /mayor que 1/
  )
  await sinEmpresa('prueba', (tx) => adjuntarBeneficioAPlanEnTx(tx, plan.id, { kind: 'POINTS_MULTIPLIER', pointsMultiplier: 2 }, como(ctx.compras)))
  assert.equal(await prisma.supplyV2MembershipBenefit.count({ where: { planId: plan.id } }), 2)
})

// ════════════════════════════════════════════════════════════════════════════
// A · MEMBRESÍA: compra confirmada → activa → beneficios disponibles
// ════════════════════════════════════════════════════════════════════════════

/** Plan de pago publicado con un beneficio exclusivo del Slice 6. */
async function planConBeneficio(d: { supplierId: string; nombre: string; precio: number; dias?: number; usos?: number }) {
  const programId = await programaActivo({ nombre: `Prog ${d.nombre}`, supplierId: d.supplierId, owner: 'SUPPLIER' })
  return sinEmpresa('prueba', async (tx) => {
    const b = await crearBeneficioEnTx(
      tx,
      {
        name: `Bono ${d.nombre} ${sufijo}`,
        funding: 'SUPPLIER',
        valueType: 'FIXED_AMOUNT',
        supplierValue: 200,
        scope: 'SUPPLIER',
        supplierId: d.supplierId,
        requiresAssignment: true,
        perCustomerLimit: 4,
        startsAt: new Date(ahora.getTime() - DIA),
      },
      como(ctx.compras)
    )
    await aprobarBeneficioEnTx(tx, b.id, como(ctx.finanzas))
    const plan = await crearPlanEnTx(tx, programId, { name: `${d.nombre} ${sufijo}`, kind: 'PAID', price: d.precio, durationDays: d.dias ?? 30 }, como(ctx.compras))
    await adjuntarBeneficioAPlanEnTx(tx, plan.id, { kind: 'BENEFIT', benefitId: b.id, usesPerPeriod: d.usos ?? 4 }, como(ctx.compras))
    await publicarPlanEnTx(tx, plan.id, como(ctx.compras))
    return { programId, planId: plan.id, benefitId: b.id }
  })
}

test('A · comprar una membresía: el pago la activa y los beneficios quedan en la cuenta del cliente', async () => {
  const { programId, planId, benefitId } = await planConBeneficio({ supplierId: ctx.supplierA, nombre: 'Gold', precio: 1499 })

  const compra = await sinEmpresa('prueba', (tx) => contratarMembresiaEnTx(tx, { planId, customerId: ctx.cliente }, como(ctx.cliente)))
  assert.equal(compra.status, 'PENDING_PAYMENT', 'NO se activa antes de cobrarla')
  assert.equal(compra.total, '1499.00')
  assert.ok(compra.orderId)

  // El pedido es de membresía, sin líneas, sin lote y sin allocation.
  const orden = await prisma.supplyV2CustomerOrder.findUniqueOrThrow({
    where: { id: compra.orderId! },
    select: { kind: true, membershipPlanId: true, total: true, contractualValue: true, _count: { select: { lines: true } } },
  })
  assert.equal(orden.kind, 'MEMBERSHIP')
  assert.equal(orden.membershipPlanId, planId)
  assert.equal(orden._count.lines, 0, 'no se simula con inventario ficticio')
  assert.equal(orden.total.toFixed(2), '1499.00')

  // Antes de pagar, el cliente NO tiene el beneficio.
  assert.equal(await prisma.supplyV2CustomerBenefit.count({ where: { benefitId, customerId: ctx.cliente } }), 0)

  await sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: compra.orderId!, amountSeen: 1499, method: 'TRANSFER' }, como(ctx.finanzas)))

  const m = await prisma.supplyV2CustomerMembership.findUniqueOrThrow({
    where: { id: compra.id },
    select: { status: true, activatedAt: true, expiresAt: true, pricePaid: true, planVersion: true },
  })
  assert.equal(m.status, 'ACTIVE')
  assert.equal(m.pricePaid.toFixed(2), '1499.00')
  assert.ok(m.activatedAt && m.expiresAt && m.expiresAt > m.activatedAt)
  assert.equal(Math.round((m.expiresAt!.getTime() - m.activatedAt!.getTime()) / DIA), 30, 'dura los 30 días del plan')

  // Y ahora SÍ tiene su beneficio, con los usos del plan y sin pasar del vencimiento.
  const cb = await prisma.supplyV2CustomerBenefit.findFirstOrThrow({
    where: { benefitId, customerId: ctx.cliente },
    select: { usesAllowed: true, status: true, expiresAt: true, membershipId: true },
  })
  assert.equal(cb.usesAllowed, 4)
  assert.equal(cb.status, 'AVAILABLE')
  assert.equal(cb.membershipId, compra.id, 'queda de qué membresía vino')
  assert.ok(cb.expiresAt && cb.expiresAt <= m.expiresAt!, 'el beneficio no dura más que la membresía')

  // Confirmar dos veces no duplica nada.
  await sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: compra.orderId!, amountSeen: 1499, method: 'TRANSFER' }, como(ctx.finanzas)))
  assert.equal(await prisma.supplyV2CustomerBenefit.count({ where: { benefitId, customerId: ctx.cliente } }), 1)
  assert.equal(await prisma.supplyV2CustomerMembership.count({ where: { programId, customerId: ctx.cliente } }), 1)
})

test('A2 · la clave de idempotencia impide que el doble clic compre dos membresías', async () => {
  const { planId } = await planConBeneficio({ supplierId: ctx.supplierA, nombre: 'Idem', precio: 999 })
  const clave = `idem-${sufijo}`
  const a = await sinEmpresa('prueba', (tx) => contratarMembresiaEnTx(tx, { planId, customerId: ctx.cliente2, idempotencyKey: clave }, como(ctx.cliente2)))
  const b = await sinEmpresa('prueba', (tx) => contratarMembresiaEnTx(tx, { planId, customerId: ctx.cliente2, idempotencyKey: clave }, como(ctx.cliente2)))
  assert.equal(b.repetida, true)
  assert.equal(a.id, b.id)
  assert.equal(await prisma.supplyV2CustomerMembership.count({ where: { planId, customerId: ctx.cliente2 } }), 1)

  // Y la clave de otro no se puede reutilizar.
  await assert.rejects(
    () => sinEmpresa('prueba', (tx) => contratarMembresiaEnTx(tx, { planId, customerId: ctx.cliente3, idempotencyKey: clave }, como(ctx.cliente3))),
    /no es tuya/
  )
})

test('A3 · una compra sin pagar bloquea la siguiente, y al caerse la desbloquea', async () => {
  const { planId } = await planConBeneficio({ supplierId: ctx.supplierA, nombre: 'Bloqueo', precio: 500 })
  const primera = await sinEmpresa('prueba', (tx) => contratarMembresiaEnTx(tx, { planId, customerId: ctx.cliente3 }, como(ctx.cliente3)))

  await assert.rejects(
    () => sinEmpresa('prueba', (tx) => contratarMembresiaEnTx(tx, { planId, customerId: ctx.cliente3 }, como(ctx.cliente3))),
    /pendiente de pago/
  )

  // Al cancelar el pedido, la membresía sin pagar se suelta con él.
  await sinEmpresa('prueba', (tx) => cancelarOrdenClienteEnTx(tx, primera.orderId!, ctx.cliente3, como(ctx.cliente3)))
  assert.equal((await prisma.supplyV2CustomerMembership.findUniqueOrThrow({ where: { id: primera.id }, select: { status: true } })).status, 'CANCELLED')

  // Y ahora sí se puede volver a intentar.
  const segunda = await sinEmpresa('prueba', (tx) => contratarMembresiaEnTx(tx, { planId, customerId: ctx.cliente3 }, como(ctx.cliente3)))
  assert.equal(segunda.status, 'PENDING_PAYMENT')
  assert.notEqual(segunda.id, primera.id)
})

test('A4 · un checkout de membresía vencido suelta la membresía, sin tocar nada más', async () => {
  const { planId } = await planConBeneficio({ supplierId: ctx.supplierA, nombre: 'Vence', precio: 700 })
  const compra = await sinEmpresa('prueba', (tx) => contratarMembresiaEnTx(tx, { planId, customerId: ctx.cliente }, como(ctx.cliente)))
  // Se fuerza el vencimiento de la reserva, como haría el paso del tiempo.
  await prisma.supplyV2CustomerOrder.update({ where: { id: compra.orderId! }, data: { expiresAt: new Date(ahora.getTime() - 60_000) } })
  const expirada = await sinEmpresa('prueba', (tx) => expirarOrdenEnTx(tx, compra.orderId!, como(null)))
  assert.equal(expirada, true)
  assert.equal((await prisma.supplyV2CustomerMembership.findUniqueOrThrow({ where: { id: compra.id }, select: { status: true } })).status, 'CANCELLED')
})

test('A5 · membresía GRATUITA: se activa en el acto; OTORGADA: exige motivo', async () => {
  const programId = await programaActivo({ nombre: 'Gratis', supplierId: ctx.supplierA, owner: 'SUPPLIER' })
  const gratis = await sinEmpresa('prueba', async (tx) => {
    const p = await crearPlanEnTx(tx, programId, { name: `Free ${sufijo}`, kind: 'FREE', price: 0, durationDays: 15 }, como(ctx.compras))
    await publicarPlanEnTx(tx, p.id, como(ctx.compras))
    return p
  })
  const m = await sinEmpresa('prueba', (tx) => contratarMembresiaEnTx(tx, { planId: gratis.id, customerId: ctx.cliente2 }, como(ctx.cliente2)))
  assert.equal(m.status, 'ACTIVE', 'una gratuita no espera ningún pago')
  assert.equal(m.orderId, null, 'y no genera pedido: no hay nada que cobrar')
  assert.equal(m.total, '0.00')

  const otorgado = await sinEmpresa('prueba', async (tx) => {
    const p = await crearPlanEnTx(tx, programId, { name: `Cortesia ${sufijo}`, kind: 'GRANTED', price: 0, durationDays: 90 }, como(ctx.compras))
    await publicarPlanEnTx(tx, p.id, como(ctx.compras))
    return p
  })
  // Una membresía otorgada NO se compra.
  await assert.rejects(
    () => sinEmpresa('prueba', (tx) => contratarMembresiaEnTx(tx, { planId: otorgado.id, customerId: ctx.cliente3 }, como(ctx.cliente3))),
    /la concede el negocio/
  )
  await assert.rejects(
    () => sinEmpresa('prueba', (tx) => otorgarMembresiaEnTx(tx, { planId: otorgado.id, customerId: ctx.cliente3, motivo: '' }, como(ctx.compras))),
    /motivo escrito/
  )
  const dada = await sinEmpresa('prueba', (tx) =>
    otorgarMembresiaEnTx(tx, { planId: otorgado.id, customerId: ctx.cliente3, motivo: 'Cliente histórico, cortesía aprobada por gerencia' }, como(ctx.compras))
  )
  assert.equal(dada.status, 'ACTIVE')
  const fila = await prisma.supplyV2CustomerMembership.findUniqueOrThrow({ where: { id: dada.id }, select: { grantedById: true, grantReason: true, pricePaid: true } })
  assert.equal(fila.grantedById, ctx.compras)
  assert.match(fila.grantReason!, /cortesía/i)
  assert.equal(fila.pricePaid.toFixed(2), '0.00', 'una otorgada no la paga el cliente')
})

test('A6 · renovar NO solapa: el período nuevo nace SCHEDULED y el barrido lo activa', async () => {
  const { planId } = await planConBeneficio({ supplierId: ctx.supplierA, nombre: 'Renueva', precio: 1000, dias: 10 })
  const primera = await sinEmpresa('prueba', (tx) => contratarMembresiaEnTx(tx, { planId, customerId: ctx.cliente }, como(ctx.cliente)))
  await sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: primera.orderId!, amountSeen: 1000, method: 'TRANSFER' }, como(ctx.finanzas)))
  const m1 = await prisma.supplyV2CustomerMembership.findUniqueOrThrow({ where: { id: primera.id }, select: { expiresAt: true, status: true } })
  assert.equal(m1.status, 'ACTIVE')

  // Renovación: se compra el siguiente período mientras el primero corre.
  const segunda = await sinEmpresa('prueba', (tx) => contratarMembresiaEnTx(tx, { planId, customerId: ctx.cliente }, como(ctx.cliente)))
  await sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: segunda.orderId!, amountSeen: 1000, method: 'TRANSFER' }, como(ctx.finanzas)))
  const m2 = await prisma.supplyV2CustomerMembership.findUniqueOrThrow({ where: { id: segunda.id }, select: { status: true, activatedAt: true, expiresAt: true, renewalCount: true } })
  assert.equal(m2.status, 'SCHEDULED', 'el período nuevo espera su turno')
  assert.equal(m2.renewalCount, 1)
  assert.equal(m2.activatedAt!.toISOString(), m1.expiresAt!.toISOString(), 'empieza EXACTAMENTE cuando acaba el anterior')
  assert.equal(Math.round((m2.expiresAt!.getTime() - m2.activatedAt!.getTime()) / DIA), 10, 'y dura sus 10 días completos')

  // Un tercer período pasaría del tope de adelanto (1 por defecto).
  await assert.rejects(
    () => sinEmpresa('prueba', (tx) => contratarMembresiaEnTx(tx, { planId, customerId: ctx.cliente }, como(ctx.cliente))),
    /se pueden adelantar/
  )

  // Cuando llega la fecha, el barrido vence la primera y activa la segunda.
  const despues = new Date(m1.expiresAt!.getTime() + 60_000)
  // El mismo orden que el cron: vencer y después activar.
  await sinEmpresa('prueba', (tx) => vencerMembresiasEnTx(tx, como(null), despues))
  await sinEmpresa('prueba', (tx) => activarProgramadasEnTx(tx, como(null), despues))
  assert.equal((await prisma.supplyV2CustomerMembership.findUniqueOrThrow({ where: { id: primera.id }, select: { status: true } })).status, 'EXPIRED')
  assert.equal((await prisma.supplyV2CustomerMembership.findUniqueOrThrow({ where: { id: segunda.id }, select: { status: true } })).status, 'ACTIVE')
})

// ════════════════════════════════════════════════════════════════════════════
// B · AISLAMIENTO: el mismo cliente, dos empresas, sin mezclar
// ════════════════════════════════════════════════════════════════════════════

test('B · un cliente con membresía en DOS empresas: cada una con sus beneficios, sin mezclarse', async () => {
  const a = await planConBeneficio({ supplierId: ctx.supplierA, nombre: 'CarTownGold', precio: 1499 })
  const b = await planConBeneficio({ supplierId: ctx.supplierB, nombre: 'RestoGold', precio: 899 })

  for (const { planId, precio } of [{ planId: a.planId, precio: 1499 }, { planId: b.planId, precio: 899 }]) {
    const c = await sinEmpresa('prueba', (tx) => contratarMembresiaEnTx(tx, { planId, customerId: ctx.cliente2 }, como(ctx.cliente2)))
    await sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: c.orderId!, amountSeen: precio, method: 'TRANSFER' }, como(ctx.finanzas)))
  }

  // Dos membresías vivas, una por programa, cada una en su empresa.
  const suyas = await prisma.supplyV2CustomerMembership.findMany({
    where: { customerId: ctx.cliente2, status: 'ACTIVE', programId: { in: [a.programId, b.programId] } },
    select: { programId: true, planId: true, pricePaid: true },
  })
  assert.equal(suyas.length, 2)
  assert.deepEqual(new Set(suyas.map((s) => s.programId)), new Set([a.programId, b.programId]))

  // Y los beneficios NO se mezclan: el bono de Car Town no vale en Resto.
  const bonoA = await prisma.supplyV2CustomerBenefit.findFirstOrThrow({ where: { benefitId: a.benefitId, customerId: ctx.cliente2 }, select: { id: true, benefit: { select: { supplierId: true } } } })
  const bonoB = await prisma.supplyV2CustomerBenefit.findFirstOrThrow({ where: { benefitId: b.benefitId, customerId: ctx.cliente2 }, select: { id: true, benefit: { select: { supplierId: true } } } })
  assert.equal(bonoA.benefit.supplierId, ctx.supplierA)
  assert.equal(bonoB.benefit.supplierId, ctx.supplierB)
  assert.notEqual(bonoA.id, bonoB.id)

  // SQL: ninguna asignación de un programa apunta a un beneficio de otro negocio.
  const [{ cruzados }] = await prisma.$queryRaw<{ cruzados: bigint }[]>`
    SELECT count(*) AS cruzados
    FROM "supply_v2_customer_benefits" cb
    JOIN "supply_v2_customer_memberships" m ON m."id" = cb."membershipId"
    JOIN "supply_v2_loyalty_programs" p ON p."id" = m."programId"
    JOIN "supply_v2_benefits" b ON b."id" = cb."benefitId"
    WHERE p."supplierId" IS NOT NULL AND b."supplierId" IS NOT NULL AND b."supplierId" <> p."supplierId"`
  assert.equal(Number(cruzados), 0, 'un beneficio de membresía nunca es de otro negocio que el del programa')
})

// ════════════════════════════════════════════════════════════════════════════
// H (membresías) · vencer una no toca las de otros programas
// ════════════════════════════════════════════════════════════════════════════

test('H1 · vencer la membresía de un programa no toca la del otro', async () => {
  const a = await planConBeneficio({ supplierId: ctx.supplierA, nombre: 'VenceA', precio: 100, dias: 1 })
  const b = await planConBeneficio({ supplierId: ctx.supplierB, nombre: 'VenceB', precio: 100, dias: 60 })
  const ma = await sinEmpresa('prueba', (tx) => contratarMembresiaEnTx(tx, { planId: a.planId, customerId: ctx.cliente3 }, como(ctx.cliente3)))
  await sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: ma.orderId!, amountSeen: 100, method: 'TRANSFER' }, como(ctx.finanzas)))
  const mb = await sinEmpresa('prueba', (tx) => contratarMembresiaEnTx(tx, { planId: b.planId, customerId: ctx.cliente3 }, como(ctx.cliente3)))
  await sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: mb.orderId!, amountSeen: 100, method: 'TRANSFER' }, como(ctx.finanzas)))

  const dentroDeDosDias = new Date(ahora.getTime() + 2 * DIA)
  const vencidas = await sinEmpresa('prueba', (tx) => vencerMembresiasEnTx(tx, como(null), dentroDeDosDias))
  assert.ok(vencidas >= 1)
  assert.equal((await prisma.supplyV2CustomerMembership.findUniqueOrThrow({ where: { id: ma.id }, select: { status: true } })).status, 'EXPIRED')
  assert.equal((await prisma.supplyV2CustomerMembership.findUniqueOrThrow({ where: { id: mb.id }, select: { status: true } })).status, 'ACTIVE', 'la del otro programa sigue viva')
})

test('cancelar una membresía exige motivo y es idempotente', async () => {
  const { planId } = await planConBeneficio({ supplierId: ctx.supplierB, nombre: 'Cancelable', precio: 300 })
  const m = await sinEmpresa('prueba', (tx) => contratarMembresiaEnTx(tx, { planId, customerId: ctx.cliente }, como(ctx.cliente)))
  await sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId: m.orderId!, amountSeen: 300, method: 'TRANSFER' }, como(ctx.finanzas)))
  await assert.rejects(() => sinEmpresa('prueba', (tx) => cancelarMembresiaEnTx(tx, m.id, '  ', como(ctx.compras))), /necesita un motivo/)
  await sinEmpresa('prueba', (tx) => cancelarMembresiaEnTx(tx, m.id, 'El cliente lo pidió por soporte', como(ctx.compras)))
  const otra = await sinEmpresa('prueba', (tx) => cancelarMembresiaEnTx(tx, m.id, 'El cliente lo pidió por soporte', como(ctx.compras)))
  assert.equal(otra.repetida, true)
})

// ════════════════════════════════════════════════════════════════════════════
// PUNTOS (§24–§29)
// ════════════════════════════════════════════════════════════════════════════

/** Compra una oferta de 1.000 y confirma el pago. Devuelve el pedido. */
async function compraConfirmada(offerId: string, customerId: string, cantidad = 1): Promise<string> {
  return sinEmpresa('prueba', async (tx) => {
    const o = await abrirOrdenClienteEnTx(tx, { customerId, offerId, quantity: cantidad }, como(customerId))
    await confirmarPagoEnTx(tx, { orderId: o.id, amountSeen: o.total, method: 'TRANSFER' }, como(ctx.finanzas))
    return o.id
  })
}

test('13 · una compra de 1.000 da 10 puntos con la regla «1 por cada 100», y la regla queda CONGELADA', async () => {
  const programId = await programaActivo({ nombre: 'Puntos', supplierId: ctx.supplierA, owner: 'SUPPLIER', puntosPorUnidad: 1, importePorPunto: 100 })
  const orderId = await compraConfirmada(ctx.offerA, ctx.cliente)

  const cuenta = await prisma.supplyV2PointsAccount.findUniqueOrThrow({
    where: { programId_customerId: { programId, customerId: ctx.cliente } },
    select: { id: true, available: true, pending: true },
  })
  assert.equal(cuenta.available, 10)
  assert.equal(cuenta.pending, 0)

  const mov = await prisma.supplyV2PointsMovement.findFirstOrThrow({
    where: { accountId: cuenta.id, orderId },
    select: { type: true, points: true, availableDelta: true, availableAfter: true, ruleSnapshot: true, idempotencyKey: true },
  })
  assert.equal(mov.type, 'EARNED')
  assert.equal(mov.points, 10)
  assert.equal(mov.availableAfter, 10)
  const foto = mov.ruleSnapshot as Record<string, unknown>
  assert.equal(foto.pointsPerUnit, 1)
  assert.equal(foto.amountPerPoint, '100.00')
  assert.equal(foto.basis, 'CONTRACTUAL_VALUE')
  assert.equal(foto.baseUsada, '1000.00')
  assert.equal(mov.idempotencyKey, `compra:${orderId}:programa:${programId}`)

  // La caché coincide EXACTAMENTE con lo reconstruido desde los movimientos.
  const reconstruido = await sinEmpresa('prueba', (tx) => saldoReconstruidoEnTx(tx, cuenta.id))
  assert.equal(reconstruido.available, 10)

  // Cambiar la regla NO reescribe lo ya ganado.
  await prisma.supplyV2LoyaltyProgram.update({ where: { id: programId }, data: { pointsPerUnit: 5 } })
  const despues = await prisma.supplyV2PointsMovement.findFirstOrThrow({ where: { accountId: cuenta.id, orderId }, select: { points: true, ruleSnapshot: true } })
  assert.equal(despues.points, 10, 'lo ganado no cambia porque cambie la regla')
  assert.equal((despues.ruleSnapshot as Record<string, unknown>).pointsPerUnit, 1)
})

test('23 · IDEMPOTENCIA: confirmar el pago dos veces no suma los puntos dos veces', async () => {
  const programId = await programaActivo({ nombre: 'Idem puntos', supplierId: ctx.supplierA, owner: 'SUPPLIER' })
  const orderId = await sinEmpresa('prueba', async (tx) => {
    const o = await abrirOrdenClienteEnTx(tx, { customerId: ctx.cliente2, offerId: ctx.offerA, quantity: 1 }, como(ctx.cliente2))
    await confirmarPagoEnTx(tx, { orderId: o.id, amountSeen: o.total, method: 'TRANSFER' }, como(ctx.finanzas))
    return o.id
  })
  // Segunda confirmación: idempotente aguas arriba y aguas abajo.
  await sinEmpresa('prueba', (tx) => confirmarPagoEnTx(tx, { orderId, amountSeen: 1000, method: 'TRANSFER' }, como(ctx.finanzas)))

  const cuenta = await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { programId_customerId: { programId, customerId: ctx.cliente2 } }, select: { id: true, available: true } })
  assert.equal(cuenta.available, 10, 'diez, no veinte')
  assert.equal(await prisma.supplyV2PointsMovement.count({ where: { accountId: cuenta.id, orderId } }), 1, 'un solo movimiento')
})

test('14 · el multiplicador de la membresía se aplica, y siempre hacia abajo', async () => {
  const programId = await programaActivo({ nombre: 'Multi', supplierId: ctx.supplierA, owner: 'SUPPLIER' })
  const plan = await sinEmpresa('prueba', async (tx) => {
    const p = await crearPlanEnTx(tx, programId, { name: `Gold multi ${sufijo}`, kind: 'FREE', price: 0, durationDays: 60 }, como(ctx.compras))
    await adjuntarBeneficioAPlanEnTx(tx, p.id, { kind: 'POINTS_MULTIPLIER', pointsMultiplier: '1.5' }, como(ctx.compras))
    await publicarPlanEnTx(tx, p.id, como(ctx.compras))
    return p
  })
  await sinEmpresa('prueba', (tx) => contratarMembresiaEnTx(tx, { planId: plan.id, customerId: ctx.cliente3 }, como(ctx.cliente3)))

  await compraConfirmada(ctx.offerA, ctx.cliente3)
  const cuenta = await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { programId_customerId: { programId, customerId: ctx.cliente3 } }, select: { available: true } })
  // 1 000 / 100 = 10 puntos × 1,5 = 15.
  assert.equal(cuenta.available, 15)
})

test('15 · puntos PENDIENTES: no son gastables hasta que maduran', async () => {
  const programId = await programaActivo({ nombre: 'Pendientes', supplierId: ctx.supplierB, owner: 'SUPPLIER', diasPendientes: 7 })
  await compraConfirmada(ctx.offerB, ctx.cliente)

  const cuenta = await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { programId_customerId: { programId, customerId: ctx.cliente } }, select: { id: true, available: true, pending: true } })
  assert.equal(cuenta.pending, 10)
  assert.equal(cuenta.available, 0, 'pendiente no es gastable')

  // Antes de tiempo el barrido no los suelta.
  await sinEmpresa('prueba', (tx) => liberarPendientesEnTx(tx, como(null), ahora))
  assert.equal((await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { id: cuenta.id }, select: { available: true } })).available, 0)

  // Pasados los 7 días, sí.
  await sinEmpresa('prueba', (tx) => liberarPendientesEnTx(tx, como(null), new Date(ahora.getTime() + 8 * DIA)))
  const despues = await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { id: cuenta.id }, select: { available: true, pending: true } })
  assert.equal(despues.available, 10)
  assert.equal(despues.pending, 0)

  // Y una segunda pasada no vuelve a soltarlos.
  await sinEmpresa('prueba', (tx) => liberarPendientesEnTx(tx, como(null), new Date(ahora.getTime() + 9 * DIA)))
  assert.equal((await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { id: cuenta.id }, select: { available: true } })).available, 10)
})

test('G · una compra CANCELADA no deja puntos disponibles (§28)', async () => {
  const programId = await programaActivo({ nombre: 'Cancelada', supplierId: ctx.supplierA, owner: 'SUPPLIER' })
  const orderId = await compraConfirmada(ctx.offerA, ctx.cliente2)
  const cuenta = await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { programId_customerId: { programId, customerId: ctx.cliente2 } }, select: { id: true, available: true } })
  const antes = cuenta.available
  assert.ok(antes >= 10)

  // Una misma compra acumula en TODOS los programas de puntos que la cubren
  // (el del negocio y los globales de Membego), así que la reversa total
  // abarca todos ellos. Lo que se comprueba aquí es la cuenta de ESTE.
  const reversados = await sinEmpresa('prueba', (tx) => reversarPuntosDeCompraEnTx(tx, orderId, 'La compra se canceló', como(ctx.finanzas)))
  assert.ok(reversados >= 10, `se esperaban al menos 10 puntos reversados, hubo ${reversados}`)
  const despues = await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { id: cuenta.id }, select: { available: true } })
  assert.equal(despues.available, antes - 10)

  // Reversar dos veces no quita el doble.
  const otra = await sinEmpresa('prueba', (tx) => reversarPuntosDeCompraEnTx(tx, orderId, 'reintento', como(ctx.finanzas)))
  assert.equal(otra, 0)
  assert.equal((await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { id: cuenta.id }, select: { available: true } })).available, antes - 10)

  // El movimiento de reversa NO borra el original: el ledger no se reescribe.
  assert.equal(await prisma.supplyV2PointsMovement.count({ where: { accountId: cuenta.id, orderId } }), 2)
})

test('H2 · VENCIMIENTO: se consume primero lo que vence antes y vencer no toca otros programas', async () => {
  const conVencimiento = await programaActivo({ nombre: 'Vencen', supplierId: ctx.supplierA, owner: 'SUPPLIER', diasVencimiento: 30 })
  const sinVencimiento = await programaActivo({ nombre: 'NoVencen', supplierId: ctx.supplierB, owner: 'SUPPLIER', diasVencimiento: null })

  await compraConfirmada(ctx.offerA, ctx.cliente3)
  await compraConfirmada(ctx.offerB, ctx.cliente3)

  const cA = await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { programId_customerId: { programId: conVencimiento, customerId: ctx.cliente3 } }, select: { id: true, available: true } })
  const cB = await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { programId_customerId: { programId: sinVencimiento, customerId: ctx.cliente3 } }, select: { id: true, available: true } })
  assert.equal(cA.available, 10)
  assert.equal(cB.available, 10)

  const dentroDe40Dias = new Date(ahora.getTime() + 40 * DIA)
  const vencidos = await sinEmpresa('prueba', (tx) => vencerPuntosEnTx(tx, como(null), dentroDe40Dias))
  assert.ok(vencidos >= 10)

  const despuesA = await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { id: cA.id }, select: { available: true, expired: true } })
  assert.equal(despuesA.available, 0, 'los de 30 días vencieron')
  assert.equal(despuesA.expired, 10)
  assert.equal((await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { id: cB.id }, select: { available: true } })).available, 10, 'los del otro programa, intactos')

  // Y la caché sigue coincidiendo con el ledger.
  const r = await sinEmpresa('prueba', (tx) => saldoReconstruidoEnTx(tx, cA.id))
  assert.equal(r.available, 0)
  assert.equal(r.expired, 10)
})

test('H3 · el lote que vence ANTES se gasta primero', async () => {
  const programId = await programaActivo({ nombre: 'FIFO', supplierId: ctx.supplierA, owner: 'SUPPLIER', diasVencimiento: 10 })
  const cuenta = await sinEmpresa('prueba', async (tx) => {
    const c = await cuentaDePuntosEnTx(tx, programId, ctx.cliente)
    // Dos lotes a mano, con vencimientos distintos: el ajuste exige motivo.
    await ajustarPuntosEnTx(tx, { programId, customerId: ctx.cliente, puntos: 50, motivo: 'Lote que vence pronto, carga inicial' }, como(ctx.compras), ahora)
    return c
  })
  // El segundo lote vence mucho más tarde.
  await prisma.supplyV2LoyaltyProgram.update({ where: { id: programId }, data: { pointsExpireDays: 300 } })
  await sinEmpresa('prueba', (tx) => ajustarPuntosEnTx(tx, { programId, customerId: ctx.cliente, puntos: 50, motivo: 'Lote que vence tarde, carga posterior' }, como(ctx.compras), ahora))

  const lotes = await prisma.supplyV2PointsMovement.findMany({ where: { accountId: cuenta.id, type: 'ADMIN_ADJUSTMENT' }, select: { id: true, expiresAt: true }, orderBy: { createdAt: 'asc' } })
  assert.equal(lotes.length, 2)
  const pronto = lotes[0]!

  // Se reservan 30: tienen que salir del que vence antes.
  await sinEmpresa('prueba', async (tx) => {
    const c = await cuentaDePuntosEnTx(tx, programId, ctx.cliente)
    await reservarPuntosEnTx(tx, c, { puntos: 30, reason: 'prueba FIFO' }, como(ctx.cliente))
  })
  const loteP = await prisma.supplyV2PointsMovement.findUniqueOrThrow({ where: { id: pronto.id }, select: { consumedFromLot: true } })
  assert.equal(loteP.consumedFromLot, 30, 'se gastó del que caduca antes, no del otro')
})

test('E · CONCURRENCIA: dos reservas por los últimos puntos; solo una pasa', async () => {
  const programId = await programaActivo({ nombre: 'Carrera', supplierId: ctx.supplierA, owner: 'SUPPLIER' })
  await sinEmpresa('prueba', (tx) => ajustarPuntosEnTx(tx, { programId, customerId: ctx.cliente2, puntos: 100, motivo: 'Saldo inicial para la prueba de concurrencia' }, como(ctx.compras)))

  const intento = () =>
    sinEmpresa('prueba', async (tx) => {
      const c = await cuentaDePuntosEnTx(tx, programId, ctx.cliente2)
      return reservarPuntosEnTx(tx, c, { puntos: 100, reason: 'carrera' }, como(ctx.cliente2))
    })

  const r = await Promise.allSettled([intento(), intento()])
  const ok = r.filter((x) => x.status === 'fulfilled')
  const ko = r.filter((x): x is PromiseRejectedResult => x.status === 'rejected')
  assert.equal(ok.length, 1, 'el candado de la cuenta serializa las dos reservas')
  assert.equal(ko.length, 1)
  assert.match(String((ko[0]!.reason as Error).message), /No alcanzan los puntos/)

  const cuenta = await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { programId_customerId: { programId, customerId: ctx.cliente2 } }, select: { id: true, available: true, reserved: true } })
  assert.equal(cuenta.available, 0)
  assert.equal(cuenta.reserved, 100, 'ni 200 reservados ni saldo negativo')
  const rec = await sinEmpresa('prueba', (tx) => saldoReconstruidoEnTx(tx, cuenta.id))
  assert.deepEqual([rec.available, rec.reserved], [0, 100])
})

test('24 · un ajuste a mano exige motivo, y quitar no deja la cuenta negativa', async () => {
  const programId = await programaActivo({ nombre: 'Ajustes', supplierId: ctx.supplierA, owner: 'SUPPLIER' })
  await assert.rejects(
    () => sinEmpresa('prueba', (tx) => ajustarPuntosEnTx(tx, { programId, customerId: ctx.cliente, puntos: 10, motivo: 'no' }, como(ctx.compras))),
    /demasiado corto/
  )
  await assert.rejects(
    () => sinEmpresa('prueba', (tx) => ajustarPuntosEnTx(tx, { programId, customerId: ctx.cliente, puntos: 10, motivo: 'Motivo suficientemente largo' }, como(null))),
    /quién lo hace/
  )
  await sinEmpresa('prueba', (tx) => ajustarPuntosEnTx(tx, { programId, customerId: ctx.cliente, puntos: 40, motivo: 'Compensación por el incidente del 12/06' }, como(ctx.compras)))
  const r = await sinEmpresa('prueba', (tx) => ajustarPuntosEnTx(tx, { programId, customerId: ctx.cliente, puntos: -100, motivo: 'Reverso del ajuste duplicado 881' }, como(ctx.compras)))
  assert.equal(r.saldo, 0, 'quita como mucho lo que hay: la cuenta no queda negativa')

  // Y el motivo queda escrito en el movimiento, no solo en la bitácora.
  const mov = await prisma.supplyV2PointsMovement.findUniqueOrThrow({ where: { id: r.movimientoId }, select: { reason: true, actorId: true, type: true } })
  assert.match(mov.reason!, /Reverso del ajuste duplicado/)
  assert.equal(mov.actorId, ctx.compras)
  assert.equal(mov.type, 'ADMIN_ADJUSTMENT')
})

test('22 · los puntos de dos programas NO se mezclan', async () => {
  const pA = await programaActivo({ nombre: 'MixA', supplierId: ctx.supplierA, owner: 'SUPPLIER' })
  const pB = await programaActivo({ nombre: 'MixB', supplierId: ctx.supplierB, owner: 'SUPPLIER' })
  await sinEmpresa('prueba', (tx) => ajustarPuntosEnTx(tx, { programId: pA, customerId: ctx.cliente3, puntos: 700, motivo: 'Carga de prueba del programa A' }, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => ajustarPuntosEnTx(tx, { programId: pB, customerId: ctx.cliente3, puntos: 100, motivo: 'Carga de prueba del programa B' }, como(ctx.compras)))

  const a = await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { programId_customerId: { programId: pA, customerId: ctx.cliente3 } }, select: { id: true, available: true } })
  const b = await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { programId_customerId: { programId: pB, customerId: ctx.cliente3 } }, select: { id: true, available: true } })
  assert.equal(a.available, 700)
  assert.equal(b.available, 100)
  assert.notEqual(a.id, b.id)

  // Gastar en A no toca B.
  await sinEmpresa('prueba', async (tx) => {
    const c = await cuentaDePuntosEnTx(tx, pA, ctx.cliente3)
    await reservarPuntosEnTx(tx, c, { puntos: 700, reason: 'todo A' }, como(ctx.cliente3))
  })
  assert.equal((await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { id: a.id }, select: { available: true } })).available, 0)
  assert.equal((await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { id: b.id }, select: { available: true } })).available, 100, 'el otro programa, intacto')

  // SQL sobre toda la base: la caché de cada cuenta coincide con su ledger.
  const descuadradas = await prisma.$queryRaw<{ id: string }[]>`
    SELECT a."id" FROM "supply_v2_points_accounts" a
    LEFT JOIN (
      SELECT "accountId",
             COALESCE(sum("availableDelta"),0) AS av,
             COALESCE(sum("pendingDelta"),0)   AS pe,
             COALESCE(sum("reservedDelta"),0)  AS re,
             COALESCE(sum("redeemedDelta"),0)  AS rd,
             COALESCE(sum("expiredDelta"),0)   AS ex
      FROM "supply_v2_points_movements" GROUP BY "accountId"
    ) m ON m."accountId" = a."id"
    WHERE a."available" <> COALESCE(m.av,0) OR a."pending" <> COALESCE(m.pe,0)
       OR a."reserved" <> COALESCE(m.re,0) OR a."redeemed" <> COALESCE(m.rd,0)
       OR a."expired" <> COALESCE(m.ex,0)`
  assert.equal(descuadradas.length, 0, 'ninguna cuenta de puntos miente respecto a su ledger')
})

// ════════════════════════════════════════════════════════════════════════════
// F · RECOMPENSAS (§30–§35)
// ════════════════════════════════════════════════════════════════════════════

/** Programa con una recompensa ACTIVA que cuesta puntos y paga con un bono. */
async function programaConRecompensa(d: { nombre: string; costoPuntos: number; costoUnidad?: number; presupuesto?: number | null; maxClaims?: number | null }) {
  const programId = await programaActivo({ nombre: d.nombre, supplierId: ctx.supplierA, owner: 'SUPPLIER' })
  return sinEmpresa('prueba', async (tx) => {
    const b = await crearBeneficioEnTx(
      tx,
      {
        name: `Premio ${d.nombre} ${sufijo}`,
        funding: 'SUPPLIER',
        valueType: 'FIXED_AMOUNT',
        supplierValue: d.costoUnidad ?? 200,
        scope: 'SPECIFIC_OFFER',
        offerId: ctx.offerA,
        supplierId: ctx.supplierA,
        requiresAssignment: true,
        perCustomerLimit: 1,
        startsAt: new Date(ahora.getTime() - DIA),
      },
      como(ctx.compras)
    )
    await aprobarBeneficioEnTx(tx, b.id, como(ctx.finanzas))
    const r = await crearRecompensaEnTx(
      tx,
      programId,
      {
        name: `Recompensa ${d.nombre} ${sufijo}`,
        kind: 'FREE_PRODUCT',
        pointsCost: d.costoPuntos,
        benefitId: b.id,
        offerId: ctx.offerA,
        unitCost: d.costoUnidad ?? 200,
        budgetTotal: d.presupuesto === null ? null : (d.presupuesto ?? 10000),
        maxClaims: d.maxClaims ?? null,
        maxPerCustomer: 1,
        startsAt: new Date(ahora.getTime() - DIA),
      },
      como(ctx.compras)
    )
    await aprobarRecompensaEnTx(tx, r.id, como(ctx.finanzas))
    return { programId, rewardId: r.id, benefitId: b.id, code: r.code }
  })
}

test('19c-db · una recompensa necesita SU BENEFICIO: sin él no se crea, ni por SQL', async () => {
  const programId = await programaActivo({ nombre: 'SinBenef', supplierId: ctx.supplierA, owner: 'SUPPLIER' })
  await assert.rejects(
    () =>
      sinEmpresa('prueba', (tx) =>
        crearRecompensaEnTx(tx, programId, { name: `Vacía ${sufijo}`, kind: 'FREE_PRODUCT', pointsCost: 100, offerId: ctx.offerA, startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))
      ),
    /necesita el beneficio/
  )
  // Y la base lo sostiene aunque alguien escriba directo.
  await assert.rejects(
    () =>
      prisma.$executeRaw`INSERT INTO "supply_v2_rewards" ("id","code","programId","name","kind","pointsCost","funding","maxPerCustomer","timesClaimed","requiresMembership","startsAt","status","createdById","createdAt","updatedAt")
        VALUES (${`ilegal-rw-${sufijo}`}, ${`MBG-RW-9999-${sufijo.slice(0, 6)}`}, ${programId}, ${`Ilegal ${sufijo}`}, 'BENEFIT', 10, 'MEMBEGO', 1, 0, false, now(), 'DRAFT', ${ctx.compras}, now(), now())`,
    /supply_v2_rewards_shape/
  )
})

test('F · reclamar consume puntos y crea el beneficio correcto, en una sola transacción', async () => {
  const { programId, rewardId, benefitId, code } = await programaConRecompensa({ nombre: 'Lavado', costoPuntos: 300 })
  await sinEmpresa('prueba', (tx) => ajustarPuntosEnTx(tx, { programId, customerId: ctx.cliente, puntos: 500, motivo: 'Carga inicial para la prueba de canje' }, como(ctx.compras)))

  const r = await sinEmpresa('prueba', (tx) => reclamarRecompensaEnTx(tx, { rewardId, customerId: ctx.cliente }, como(ctx.cliente)))
  assert.equal(r.status, 'CLAIMED')
  assert.equal(r.puntosConsumidos, 300)
  assert.ok(r.customerBenefitId, 'la reclamación crea el beneficio del cliente')
  assert.match(r.code, /^MBG-RK-\d{4}-\d{6}$/)
  assert.ok(code.startsWith('MBG-RW-'))

  // Los puntos: 500 − 300 = 200 disponibles, 300 canjeados, 0 reservados.
  const cuenta = await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { programId_customerId: { programId, customerId: ctx.cliente } }, select: { id: true, available: true, reserved: true, redeemed: true } })
  assert.deepEqual([cuenta.available, cuenta.reserved, cuenta.redeemed], [200, 0, 300])
  const rec = await sinEmpresa('prueba', (tx) => saldoReconstruidoEnTx(tx, cuenta.id))
  assert.deepEqual([rec.available, rec.reserved, rec.redeemed], [200, 0, 300])

  // Y el beneficio es el de la recompensa, asignado a ESTE cliente.
  const cb = await prisma.supplyV2CustomerBenefit.findUniqueOrThrow({ where: { id: r.customerBenefitId! }, select: { benefitId: true, customerId: true, usesAllowed: true, status: true } })
  assert.equal(cb.benefitId, benefitId)
  assert.equal(cb.customerId, ctx.cliente)
  assert.equal(cb.usesAllowed, 1)
  assert.equal(cb.status, 'AVAILABLE')

  // La reclamación NO está entregada todavía: entregar es usarla.
  assert.equal((await prisma.supplyV2RewardClaim.findUniqueOrThrow({ where: { id: r.id }, select: { status: true, cost: true } })).status, 'CLAIMED')
})

test('18-db · SALDO INSUFICIENTE: sin puntos no hay recompensa, y no se gasta nada', async () => {
  const { programId, rewardId } = await programaConRecompensa({ nombre: 'Cara', costoPuntos: 1000 })
  await sinEmpresa('prueba', (tx) => ajustarPuntosEnTx(tx, { programId, customerId: ctx.cliente2, puntos: 100, motivo: 'Saldo corto a propósito para la prueba' }, como(ctx.compras)))
  await assert.rejects(
    () => sinEmpresa('prueba', (tx) => reclamarRecompensaEnTx(tx, { rewardId, customerId: ctx.cliente2 }, como(ctx.cliente2))),
    /No te alcanzan los puntos/
  )
  const cuenta = await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { programId_customerId: { programId, customerId: ctx.cliente2 } }, select: { available: true, reserved: true } })
  assert.deepEqual([cuenta.available, cuenta.reserved], [100, 0], 'nada quedó apartado en el limbo')
  assert.equal(await prisma.supplyV2RewardClaim.count({ where: { rewardId } }), 0, 'ni una reclamación a medias')
})

test('F2 · entregar la recompensa es USARLA: ahí, y no antes, se reconoce el costo (§35)', async () => {
  const { programId, rewardId } = await programaConRecompensa({ nombre: 'Entrega', costoPuntos: 100, costoUnidad: 250 })
  await sinEmpresa('prueba', (tx) => ajustarPuntosEnTx(tx, { programId, customerId: ctx.cliente3, puntos: 100, motivo: 'Saldo justo para canjear la recompensa' }, como(ctx.compras)))
  const r = await sinEmpresa('prueba', (tx) => reclamarRecompensaEnTx(tx, { rewardId, customerId: ctx.cliente3 }, como(ctx.cliente3)))

  // Al reclamar, el costo todavía NO es dinero gastado.
  const e1 = await sinEmpresa('prueba', (tx) => economiaDelProgramaEnTx(tx, programId))
  assert.equal(e1.costoRealizado.toFixed(2), '0.00', 'reclamar no es entregar')
  assert.equal(e1.costoPendiente.toFixed(2), '250.00', 'queda como compromiso, no como gasto')

  // El cliente usa el beneficio: el checkout lo aplica y el uso se consume.
  await sinEmpresa('prueba', async (tx) => {
    const o = await abrirOrdenClienteEnTx(tx, { customerId: ctx.cliente3, offerId: ctx.offerA, quantity: 1, customerBenefitId: r.customerBenefitId! }, como(ctx.cliente3))
    await confirmarPagoEnTx(tx, { orderId: o.id, amountSeen: o.total, method: 'TRANSFER' }, como(ctx.finanzas))
  })
  const usos = await prisma.supplyV2CustomerBenefit.findUniqueOrThrow({ where: { id: r.customerBenefitId! }, select: { usesConsumed: true } })
  assert.equal(usos.usesConsumed, 1, 'el beneficio se usó de verdad, por el checkout de siempre')

  // El barrido lo concilia: la reclamación pasa a ENTREGADA con su costo.
  const entregadas = await sinEmpresa('prueba', (tx) => conciliarEntregasEnTx(tx, como(null)))
  assert.ok(entregadas >= 1)
  const claim = await prisma.supplyV2RewardClaim.findUniqueOrThrow({ where: { id: r.id }, select: { status: true, cost: true, deliveredAt: true } })
  assert.equal(claim.status, 'DELIVERED')
  assert.equal(claim.cost!.toFixed(2), '250.00')
  assert.ok(claim.deliveredAt)

  // Y AHORA sí es costo realizado.
  const e2 = await sinEmpresa('prueba', (tx) => economiaDelProgramaEnTx(tx, programId))
  assert.equal(e2.costoRealizado.toFixed(2), '250.00')
  assert.equal(e2.costoPendiente.toFixed(2), '0.00')

  // Conciliar dos veces no entrega dos veces.
  await sinEmpresa('prueba', (tx) => conciliarEntregasEnTx(tx, como(null)))
  const e3 = await sinEmpresa('prueba', (tx) => economiaDelProgramaEnTx(tx, programId))
  assert.equal(e3.costoRealizado.toFixed(2), '250.00', 'el costo no se duplica')
})

test('I · el costo de una recompensa NO se duplica, ni al reclamar ni al reversar', async () => {
  const { programId, rewardId } = await programaConRecompensa({ nombre: 'NoDuplica', costoPuntos: 50, costoUnidad: 400 })
  await sinEmpresa('prueba', (tx) => ajustarPuntosEnTx(tx, { programId, customerId: ctx.cliente, puntos: 50, motivo: 'Saldo justo para la prueba de costos' }, como(ctx.compras)))
  const r = await sinEmpresa('prueba', (tx) => reclamarRecompensaEnTx(tx, { rewardId, customerId: ctx.cliente }, como(ctx.cliente)))
  await sinEmpresa('prueba', (tx) => marcarEntregadaEnTx(tx, r.id, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => marcarEntregadaEnTx(tx, r.id, como(ctx.compras)))

  const [{ veces }] = await prisma.$queryRaw<{ veces: bigint }[]>`
    SELECT count(*) AS veces FROM "supply_v2_reward_claims" WHERE "id" = ${r.id} AND "status" = 'DELIVERED'`
  assert.equal(Number(veces), 1)
  const e = await sinEmpresa('prueba', (tx) => economiaDelProgramaEnTx(tx, programId))
  assert.equal(e.costoRealizado.toFixed(2), '400.00', 'una entrega, un costo')
})

test('20-db · REVERSA: lo no usado devuelve puntos; lo ya entregado, no (§34)', async () => {
  // a) Reclamada y SIN usar: los puntos vuelven.
  const a = await programaConRecompensa({ nombre: 'RevA', costoPuntos: 200 })
  await sinEmpresa('prueba', (tx) => ajustarPuntosEnTx(tx, { programId: a.programId, customerId: ctx.cliente2, puntos: 200, motivo: 'Saldo para la prueba de reversa sin usar' }, como(ctx.compras)))
  const ra = await sinEmpresa('prueba', (tx) => reclamarRecompensaEnTx(tx, { rewardId: a.rewardId, customerId: ctx.cliente2 }, como(ctx.cliente2)))
  await assert.rejects(() => sinEmpresa('prueba', (tx) => reversarReclamacionEnTx(tx, ra.id, '', como(ctx.compras))), /necesita un motivo/)
  const va = await sinEmpresa('prueba', (tx) => reversarReclamacionEnTx(tx, ra.id, 'El cliente se arrepintió antes de usarla', como(ctx.compras)))
  assert.equal(va.puntosDevueltos, 200)
  const cA = await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { programId_customerId: { programId: a.programId, customerId: ctx.cliente2 } }, select: { id: true, available: true, redeemed: true } })
  assert.equal(cA.available, 200, 'los puntos volvieron')
  assert.equal(cA.redeemed, 0)
  // Y el beneficio queda cancelado: no se puede usar después de reversar.
  assert.equal((await prisma.supplyV2CustomerBenefit.findUniqueOrThrow({ where: { id: ra.customerBenefitId! }, select: { status: true } })).status, 'CANCELLED')

  // b) Ya ENTREGADA: los puntos NO vuelven.
  const b = await programaConRecompensa({ nombre: 'RevB', costoPuntos: 200 })
  await sinEmpresa('prueba', (tx) => ajustarPuntosEnTx(tx, { programId: b.programId, customerId: ctx.cliente3, puntos: 200, motivo: 'Saldo para la prueba de reversa ya entregada' }, como(ctx.compras)))
  const rb = await sinEmpresa('prueba', (tx) => reclamarRecompensaEnTx(tx, { rewardId: b.rewardId, customerId: ctx.cliente3 }, como(ctx.cliente3)))
  await sinEmpresa('prueba', (tx) => marcarEntregadaEnTx(tx, rb.id, como(ctx.compras)))
  const vb = await sinEmpresa('prueba', (tx) => reversarReclamacionEnTx(tx, rb.id, 'Incidencia: se entregó por error', como(ctx.compras)))
  assert.equal(vb.puntosDevueltos, 0, 'lo ya consumido no se regala dos veces')
  const cB = await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { programId_customerId: { programId: b.programId, customerId: ctx.cliente3 } }, select: { available: true, redeemed: true } })
  assert.equal(cB.available, 0)
  assert.equal(cB.redeemed, 200, 'siguen contando como canjeados')

  // En los dos casos queda historial con su motivo.
  for (const id of [ra.id, rb.id]) {
    const c = await prisma.supplyV2RewardClaim.findUniqueOrThrow({ where: { id }, select: { status: true, reverseReason: true, reversedAt: true } })
    assert.equal(c.status, 'REVERSED')
    assert.ok(c.reverseReason && c.reversedAt)
  }
})

test('19a-db · dos reclamaciones en curso de la misma recompensa: la base lo impide', async () => {
  const { programId, rewardId } = await programaConRecompensa({ nombre: 'UnaSola', costoPuntos: 10 })
  await sinEmpresa('prueba', (tx) => ajustarPuntosEnTx(tx, { programId, customerId: ctx.cliente, puntos: 100, motivo: 'Saldo para la prueba del tope por cliente' }, como(ctx.compras)))
  await sinEmpresa('prueba', (tx) => reclamarRecompensaEnTx(tx, { rewardId, customerId: ctx.cliente }, como(ctx.cliente)))
  // maxPerCustomer = 1.
  await assert.rejects(
    () => sinEmpresa('prueba', (tx) => reclamarRecompensaEnTx(tx, { rewardId, customerId: ctx.cliente }, como(ctx.cliente))),
    /máximo de veces/
  )
})

test('21-db · PRESUPUESTO: el techo del programa manda sobre sus recompensas', async () => {
  const programId = await programaActivo({ nombre: 'Techo', supplierId: null, owner: 'MEMBEGO', presupuesto: 1000 })
  const benefitId = await sinEmpresa('prueba', async (tx) => {
    const b = await crearBeneficioEnTx(
      tx,
      { name: `BonoTecho ${sufijo}`, funding: 'MEMBEGO', valueType: 'FIXED_AMOUNT', membegoValue: 100, scope: 'SPECIFIC_OFFER', offerId: ctx.offerA, requiresAssignment: true, startsAt: new Date(ahora.getTime() - DIA) },
      como(ctx.compras)
    )
    await aprobarBeneficioEnTx(tx, b.id, como(ctx.finanzas))
    return b.id
  })
  const nueva = (nombre: string, techo: number) =>
    sinEmpresa('prueba', (tx) =>
      crearRecompensaEnTx(tx, programId, { name: `${nombre} ${sufijo}`, kind: 'BENEFIT', pointsCost: 10, benefitId, unitCost: 100, budgetTotal: techo, startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))
    )
  await nueva('R1', 700)
  // 700 + 500 = 1 200 > 1 000.
  await assert.rejects(() => nueva('R2', 500), /sumarían 1200\.00 y el presupuesto aprobado es 1000\.00/)
  await nueva('R3', 300)

  const e = await sinEmpresa('prueba', (tx) => economiaDelProgramaEnTx(tx, programId))
  assert.equal(e.comprometido.toFixed(2), '1000.00')
  assert.equal(e.aprobado!.toFixed(2), '1000.00')
  assert.equal(e.algunaRecompensaSinTope, false)
})

test('una recompensa pide aprobación de OTRA persona antes de repartir nada', async () => {
  const programId = await programaActivo({ nombre: 'AprobRec', supplierId: ctx.supplierA, owner: 'SUPPLIER' })
  const creada = await sinEmpresa('prueba', async (tx) => {
    const b = await crearBeneficioEnTx(
      tx,
      { name: `BonoAprob ${sufijo}`, funding: 'SUPPLIER', valueType: 'FIXED_AMOUNT', supplierValue: 100, scope: 'SPECIFIC_OFFER', offerId: ctx.offerA, supplierId: ctx.supplierA, requiresAssignment: true, startsAt: new Date(ahora.getTime() - DIA) },
      como(ctx.compras)
    )
    await aprobarBeneficioEnTx(tx, b.id, como(ctx.finanzas))
    return crearRecompensaEnTx(tx, programId, { name: `PorAprobar ${sufijo}`, kind: 'BENEFIT', pointsCost: 10, benefitId: b.id, unitCost: 100, startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.compras))
  })
  // En DRAFT no se puede reclamar.
  await assert.rejects(
    () => sinEmpresa('prueba', (tx) => reclamarRecompensaEnTx(tx, { rewardId: creada.id, customerId: ctx.cliente }, como(ctx.cliente))),
    /no está disponible/
  )
  await assert.rejects(() => sinEmpresa('prueba', (tx) => aprobarRecompensaEnTx(tx, creada.id, como(ctx.compras))), /no la aprueba la misma persona/)
  const ok = await sinEmpresa('prueba', (tx) => aprobarRecompensaEnTx(tx, creada.id, como(ctx.finanzas)))
  assert.equal(ok.repetido, false)
})

// ════════════════════════════════════════════════════════════════════════════
// C y D · REFERIDOS (§18–§23)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Un cliente RECIÉN creado, sin ninguna compra previa. Los referidos exigen
 * la PRIMERA compra del invitado, y los clientes compartidos de este archivo
 * ya han comprado en pruebas anteriores: reutilizarlos probaría otra cosa.
 */
let invitados = 0
async function clienteNuevo(): Promise<string> {
  invitados++
  return usuario(`inv${invitados}`, 'CLIENTE')
}

/** Programa con referidos que pagan en puntos. */
async function programaConReferidos(d: { nombre: string; puntos?: number; espera?: number; maxPorReferidor?: number | null; minCompra?: number | null }) {
  const programId = await programaActivo({ nombre: d.nombre, supplierId: ctx.supplierA, owner: 'SUPPLIER' })
  await sinEmpresa('prueba', (tx) =>
    configurarReferidosEnTx(
      tx,
      programId,
      {
        rewardKind: 'POINTS',
        rewardPoints: d.puntos ?? 500,
        requiresFirstPurchase: true,
        minPurchaseAmount: d.minCompra ?? null,
        requiresPaymentConfirmed: true,
        waitingPeriodDays: d.espera ?? 0,
        maxPerReferrer: d.maxPorReferidor === null ? null : (d.maxPorReferidor ?? 10),
      },
      como(ctx.compras)
    )
  )
  return programId
}

test('19 · el código de invitación es seguro y estable: no es un id interno', async () => {
  const programId = await programaConReferidos({ nombre: 'Codigos' })
  const a = await sinEmpresa('prueba', (tx) => codigoDeReferidoEnTx(tx, programId, ctx.cliente))
  const b = await sinEmpresa('prueba', (tx) => codigoDeReferidoEnTx(tx, programId, ctx.cliente))
  assert.equal(a.code, b.code, 'la misma persona recibe siempre el suyo')
  assert.equal(b.repetido, true)
  assert.equal(a.code.length, 10)
  assert.match(a.code, /^[ACDEFGHJKMNPQRTVWXY34679]{10}$/, 'alfabeto sin caracteres que se confundan al dictarlos')
  assert.ok(!a.code.includes(ctx.cliente.slice(0, 4)), 'no sale de ningún id interno')

  // Dos personas, dos códigos distintos.
  const otro = await sinEmpresa('prueba', (tx) => codigoDeReferidoEnTx(tx, programId, ctx.cliente2))
  assert.notEqual(a.code, otro.code)

  // Un código que no existe no dice si no existe o si no vale: mensaje opaco.
  await assert.rejects(() => sinEmpresa('prueba', (tx) => registrarAperturaEnTx(tx, 'XXXXXXXXXX')), /no existe o no se puede usar/)
  await assert.rejects(() => sinEmpresa('prueba', (tx) => registrarAperturaEnTx(tx, 'ab')), /no existe o no se puede usar/)

  // Y resolverlo NO distingue mayúsculas: el índice sobre upper(code) manda.
  const abierto = await sinEmpresa('prueba', (tx) => registrarAperturaEnTx(tx, a.code.toLowerCase()))
  assert.equal(abierto.ownerId, ctx.cliente)
})

test('D · AUTORREFERIDO rechazado, y nadie entra por dos invitaciones', async () => {
  const programId = await programaConReferidos({ nombre: 'Fraude' })
  const juan = await sinEmpresa('prueba', (tx) => codigoDeReferidoEnTx(tx, programId, ctx.cliente))

  // Juan con su propio código: NO.
  await assert.rejects(
    () => sinEmpresa('prueba', (tx) => atribuirRegistroEnTx(tx, { codigo: juan.code, referredId: ctx.cliente }, como(ctx.cliente))),
    /No puedes recomendarte a ti mismo/
  )
  assert.equal(await prisma.supplyV2Referral.count({ where: { programId, referredId: ctx.cliente } }), 0)

  // María sí.
  const r = await sinEmpresa('prueba', (tx) => atribuirRegistroEnTx(tx, { codigo: juan.code, referredId: ctx.cliente2 }, como(ctx.cliente2)))
  assert.equal(r.status, 'SIGNED_UP')
  // Repetir el mismo enlace es un reintento, no un referido nuevo.
  const otra = await sinEmpresa('prueba', (tx) => atribuirRegistroEnTx(tx, { codigo: juan.code, referredId: ctx.cliente2 }, como(ctx.cliente2)))
  assert.equal(otra.repetido, true)
  assert.equal(otra.id, r.id)

  // Y con el enlace de OTRA persona tampoco: no se cambia de padrino.
  const luis = await sinEmpresa('prueba', (tx) => codigoDeReferidoEnTx(tx, programId, ctx.cliente3))
  await assert.rejects(
    () => sinEmpresa('prueba', (tx) => atribuirRegistroEnTx(tx, { codigo: luis.code, referredId: ctx.cliente2 }, como(ctx.cliente2))),
    /ya entró por otra invitación/
  )
  assert.equal(await prisma.supplyV2Referral.count({ where: { programId, referredId: ctx.cliente2 } }), 1)
})

test('C · una primera compra válida genera EXACTAMENTE una recompensa', async () => {
  const programId = await programaConReferidos({ nombre: 'UnaSolaVez', puntos: 500 })
  const juan = await sinEmpresa('prueba', (tx) => codigoDeReferidoEnTx(tx, programId, ctx.cliente))
  const maria = await clienteNuevo()
  const ref = await sinEmpresa('prueba', (tx) => atribuirRegistroEnTx(tx, { codigo: juan.code, referredId: maria }, como(maria)))

  // Antes de comprar, Juan no ha cobrado nada.
  const antes = await prisma.supplyV2PointsAccount.findUnique({ where: { programId_customerId: { programId, customerId: ctx.cliente } }, select: { available: true } })
  assert.equal(antes?.available ?? 0, 0, 'abrir el enlace y registrarse no paga')

  // María compra. La confirmación del pago dispara la evaluación.
  await compraConfirmada(ctx.offerA, maria)

  const r = await prisma.supplyV2Referral.findUniqueOrThrow({ where: { id: ref.id }, select: { status: true, rewardPoints: true, eligibleOrderId: true, rewardGrantedAt: true } })
  assert.equal(r.status, 'REWARD_GRANTED')
  assert.equal(r.rewardPoints, 500)
  assert.ok(r.eligibleOrderId && r.rewardGrantedAt)

  const juanCuenta = await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { programId_customerId: { programId, customerId: ctx.cliente } }, select: { id: true, available: true } })
  assert.equal(juanCuenta.available, 500, 'Juan cobró su recompensa')

  // EXACTAMENTE UNA: una segunda compra de María no vuelve a pagar.
  await compraConfirmada(ctx.offerA, maria)
  assert.equal(
    (await prisma.supplyV2PointsAccount.findUniqueOrThrow({ where: { id: juanCuenta.id }, select: { available: true } })).available,
    500,
    'la segunda compra de la misma persona no paga otra vez'
  )
  // Ni volver a llamar a conceder a mano.
  const otra = await sinEmpresa('prueba', (tx) => aprobarYConcederEnTx(tx, ref.id, como(ctx.compras)))
  assert.equal(otra.concedida, false)
  assert.equal(otra.motivo, 'YA_RECOMPENSADO')
  assert.equal(await prisma.supplyV2PointsMovement.count({ where: { referralId: ref.id, type: 'EARNED' } }), 1, 'un solo movimiento de puntos por invitación')

  // Y el contador del código lo refleja.
  const stats = await sinEmpresa('prueba', (tx) => estadisticasDeReferidosEnTx(tx, programId, ctx.cliente))
  assert.equal(stats!.validos, 1)
  assert.equal(stats!.recompensados, 1)
})

test('C2 · si no es la PRIMERA compra, no hay recompensa', async () => {
  const programId = await programaConReferidos({ nombre: 'PrimeraCompra' })
  // El cliente3 ya compró antes de que lo invitaran.
  await compraConfirmada(ctx.offerA, ctx.cliente3)

  const juan = await sinEmpresa('prueba', (tx) => codigoDeReferidoEnTx(tx, programId, ctx.cliente))
  const ref = await sinEmpresa('prueba', (tx) => atribuirRegistroEnTx(tx, { codigo: juan.code, referredId: ctx.cliente3 }, como(ctx.cliente3)))
  await compraConfirmada(ctx.offerA, ctx.cliente3)

  const r = await prisma.supplyV2Referral.findUniqueOrThrow({ where: { id: ref.id }, select: { status: true } })
  assert.notEqual(r.status, 'REWARD_GRANTED', 'ya había comprado: no es su primera compra')
})

test('C3 · la compra mínima se respeta', async () => {
  const programId = await programaConReferidos({ nombre: 'Minima', minCompra: 5000 })
  const juan = await sinEmpresa('prueba', (tx) => codigoDeReferidoEnTx(tx, programId, ctx.cliente2))
  const maria = await clienteNuevo()
  const ref = await sinEmpresa('prueba', (tx) => atribuirRegistroEnTx(tx, { codigo: juan.code, referredId: maria }, como(maria)))
  // La oferta vale 1 000: no llega al mínimo de 5 000.
  await compraConfirmada(ctx.offerA, maria)
  assert.notEqual((await prisma.supplyV2Referral.findUniqueOrThrow({ where: { id: ref.id }, select: { status: true } })).status, 'REWARD_GRANTED')
})

test('C4 · PERÍODO DE ESPERA: la recompensa aguanta, y una cancelación dentro del plazo la anula', async () => {
  const programId = await programaConReferidos({ nombre: 'Espera', espera: 7 })
  const juan = await sinEmpresa('prueba', (tx) => codigoDeReferidoEnTx(tx, programId, ctx.cliente))
  const maria = await clienteNuevo()
  const ref = await sinEmpresa('prueba', (tx) => atribuirRegistroEnTx(tx, { codigo: juan.code, referredId: maria }, como(maria)))
  const orderId = await compraConfirmada(ctx.offerA, maria)

  // Dentro del plazo no se paga.
  let r = await prisma.supplyV2Referral.findUniqueOrThrow({ where: { id: ref.id }, select: { status: true, voidReason: true } })
  assert.equal(r.status, 'REWARD_PENDING', 'espera a que pase el plazo')
  await sinEmpresa('prueba', (tx) => barridoReferidosEnTx(tx, como(null), ahora))
  assert.equal((await prisma.supplyV2Referral.findUniqueOrThrow({ where: { id: ref.id }, select: { status: true } })).status, 'REWARD_PENDING')

  // La compra se cae DENTRO del plazo: la invitación se anula con su motivo.
  await prisma.supplyV2CustomerOrder.update({ where: { id: orderId }, data: { status: 'CANCELLED' } })
  await sinEmpresa('prueba', (tx) => barridoReferidosEnTx(tx, como(null), new Date(ahora.getTime() + 8 * DIA)))
  r = await prisma.supplyV2Referral.findUniqueOrThrow({ where: { id: ref.id }, select: { status: true, voidReason: true } })
  assert.equal(r.status, 'REWARD_VOIDED', 'una compra caída no paga recompensa')
  assert.match(r.voidReason!, /canceló|devolvió/i)

  const cuenta = await prisma.supplyV2PointsAccount.findUnique({ where: { programId_customerId: { programId, customerId: ctx.cliente } }, select: { available: true } })
  assert.equal(cuenta?.available ?? 0, 0, 'y Juan no cobró nada')
})

test('C5 · el tope por participante se respeta', async () => {
  const programId = await programaConReferidos({ nombre: 'Tope', maxPorReferidor: 1 })
  const juan = await sinEmpresa('prueba', (tx) => codigoDeReferidoEnTx(tx, programId, ctx.cliente3))
  // Primer invitado: cobra.
  const uno = await clienteNuevo()
  await sinEmpresa('prueba', (tx) => atribuirRegistroEnTx(tx, { codigo: juan.code, referredId: uno }, como(uno)))
  await compraConfirmada(ctx.offerA, uno)
  const tras1 = await prisma.supplyV2Referral.count({ where: { programId, referrerId: ctx.cliente3, status: 'REWARD_GRANTED' } })

  // Segundo invitado: ya alcanzó el tope.
  const dos = await clienteNuevo()
  const ref2 = await sinEmpresa('prueba', (tx) => atribuirRegistroEnTx(tx, { codigo: juan.code, referredId: dos }, como(dos)))
  await compraConfirmada(ctx.offerA, dos)
  const r2 = await prisma.supplyV2Referral.findUniqueOrThrow({ where: { id: ref2.id }, select: { status: true } })
  assert.equal(tras1, 1)
  assert.notEqual(r2.status, 'REWARD_GRANTED', 'el tope por participante manda')
})

test('C6 · anular una invitación exige motivo y es definitivo', async () => {
  const programId = await programaConReferidos({ nombre: 'Anular' })
  const juan = await sinEmpresa('prueba', (tx) => codigoDeReferidoEnTx(tx, programId, ctx.cliente))
  const maria = await clienteNuevo()
  const ref = await sinEmpresa('prueba', (tx) => atribuirRegistroEnTx(tx, { codigo: juan.code, referredId: maria }, como(maria)))
  await assert.rejects(() => sinEmpresa('prueba', (tx) => anularReferidoEnTx(tx, ref.id, ' ', como(ctx.compras))), /necesita un motivo/)
  await sinEmpresa('prueba', (tx) => anularReferidoEnTx(tx, ref.id, 'Cuenta duplicada detectada por soporte', como(ctx.compras)))
  const r = await prisma.supplyV2Referral.findUniqueOrThrow({ where: { id: ref.id }, select: { status: true, voidReason: true } })
  assert.equal(r.status, 'REWARD_VOIDED')
  assert.match(r.voidReason!, /duplicada/)

  // Una compra posterior ya no lo resucita.
  await compraConfirmada(ctx.offerA, maria)
  assert.equal((await prisma.supplyV2Referral.findUniqueOrThrow({ where: { id: ref.id }, select: { status: true } })).status, 'REWARD_VOIDED')
})

test('SQL · ninguna invitación paga dos veces, y ningún autorreferido existe', async () => {
  const [{ dobles }] = await prisma.$queryRaw<{ dobles: bigint }[]>`
    SELECT count(*) AS dobles FROM (
      SELECT "referralId" FROM "supply_v2_points_movements"
      WHERE "referralId" IS NOT NULL AND "type" = 'EARNED'
      GROUP BY "referralId" HAVING count(*) > 1
    ) t`
  assert.equal(Number(dobles), 0, 'una invitación, como mucho un pago en puntos')

  const [{ autos }] = await prisma.$queryRaw<{ autos: bigint }[]>`
    SELECT count(*) AS autos FROM "supply_v2_referrals" WHERE "referredId" = "referrerId"`
  assert.equal(Number(autos), 0)

  const [{ concedidosSinFecha }] = await prisma.$queryRaw<{ concedidosSinFecha: bigint }[]>`
    SELECT count(*) AS "concedidosSinFecha" FROM "supply_v2_referrals"
    WHERE "status" = 'REWARD_GRANTED' AND "rewardGrantedAt" IS NULL`
  assert.equal(Number(concedidosSinFecha), 0)

  const [{ reclamacionesDobles }] = await prisma.$queryRaw<{ reclamacionesDobles: bigint }[]>`
    SELECT count(*) AS "reclamacionesDobles" FROM (
      SELECT "referralId" FROM "supply_v2_reward_claims"
      WHERE "referralId" IS NOT NULL GROUP BY "referralId" HAVING count(*) > 1
    ) t`
  assert.equal(Number(reclamacionesDobles), 0, 'una invitación, como mucho una reclamación')
})
