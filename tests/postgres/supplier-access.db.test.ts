import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { sinEmpresa } from '../../src/lib/tenant'
import { crearProveedorExternoEnTx, vincularEmpresaComoProveedorEnTx } from '../../src/modules/supply-v2/suppliers/service'
import { crearItemCatalogoEnTx } from '../../src/modules/supply-v2/catalog/service'
import { activarAcuerdoEnTx, crearAcuerdoEnTx } from '../../src/modules/supply-v2/agreements/service'
import {
  ORIGEN_INVITACION_PROVEEDOR,
  aceptarContratoDeProveedorEnTx,
  alAceptarInvitacionDeProveedorEnTx,
  codigoDePruebaEnTx,
  darDeBajaAccesoEnTx,
  dispensarPreparacionEnTx,
  invitarDuenoDeProveedorEnTx,
  invitarPersonalDeProveedorEnTx,
  preparacionDelProveedorEnTx,
  reactivarAccesoEnTx,
  registrarPruebaDeEscanerEnTx,
  relevarProveedoresEnTx,
  suspenderAccesoEnTx,
} from '../../src/modules/supply-v2/suppliers/acceso'
import { capacidadesDeEmpresa } from '../../src/modules/capacidades/catalogo'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · Slice 1 contra PostgreSQL de verdad.
 *
 *   A  invitar al dueño de un proveedor EXTERNO crea UNA empresa Supplier Lite
 *      (sin vitrina, solo la capacidad de proveedor), la vincula y deja la
 *      invitación; reinvitar reutiliza empresa e invitación
 *   B  aceptar la invitación → ACTIVATION_PENDING; la lista de preparación
 *      sabe qué falta; un acuerdo NUEVO no se activa hasta que esté lista
 *   C  contrato aceptado + prueba del escáner → ACTIVE, y el acuerdo se activa
 *   D  suspender cierra; reactivar abre; invitar personal con preset deja los
 *      permisos en la invitación
 *   E  proveedor histórico (empresa ya registrada) → DRAFT, sigue operando
 *      sin modo estricto; la dispensa lo deja ACTIVE con motivo
 *   F  dar de baja cancela las invitaciones vivas; la empresa y el historial
 *      se conservan; no se puede volver a invitar
 *
 * `npm run test:db`.
 */

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const DIA = 86_400_000
const como = (actorId: string | null) => ({ actorId, ipAddress: '127.0.0.1', userAgent: 'test' })

const ctx = { admin: '', supplierId: '', companyId: '', duenoId: '', agreementId: '', legacySupplierId: '', legacyCompanyId: '' }

const proveedor = (id: string) => prisma.supplyV2Supplier.findUniqueOrThrow({ where: { id } })

before(async () => {
  const admin = await prisma.user.create({ data: { supabaseId: `sb-sa-admin-${sufijo}`, email: `sa-admin-${sufijo}@prueba.test`, name: 'Admin', role: 'SUPERADMIN' }, select: { id: true } })
  ctx.admin = admin.id
  await sinEmpresa('prueba', async (tx) => {
    const p = await crearProveedorExternoEnTx(tx, { commercialName: `Café Central ${sufijo}`, email: `cafe-${sufijo}@prueba.test`, city: 'Higüey', phone: '809-000-0000' }, como(admin.id))
    ctx.supplierId = p.id
  })
})

test('A · invitar al dueño crea UNA empresa Supplier Lite sin vitrina y la invitación; reinvitar no duplica nada', async () => {
  const inv = await sinEmpresa('prueba', (tx) => invitarDuenoDeProveedorEnTx(tx, { supplierId: ctx.supplierId, email: `Dueno-${sufijo}@Prueba.test` }, como(ctx.admin)))
  assert.equal(inv.empresaCreada, true)
  assert.equal(inv.reenviada, false)
  assert.equal(inv.email, `dueno-${sufijo}@prueba.test`)
  ctx.companyId = inv.companyId

  const p = await proveedor(ctx.supplierId)
  assert.equal(p.companyId, inv.companyId, 'el proveedor quedó vinculado a la empresa')
  assert.equal(p.accessStatus, 'INVITED')
  assert.equal(p.invitedEmail, inv.email)

  const empresa = await prisma.company.findUniqueOrThrow({ where: { id: inv.companyId }, include: { sucursales: true } })
  assert.equal(empresa.isPublished, false, 'Supplier Lite no tiene vitrina')
  assert.equal(empresa.isActive, true)
  assert.equal(empresa.sucursales.length, 1, 'una sucursal principal con lo que Membego ya sabía')
  const caps = capacidadesDeEmpresa({ type: empresa.type, capacidades: empresa.capacidades, tipoNegocioCodigo: empresa.tipoNegocioCodigo })
  assert.ok(caps.activas.has('MEMBEGO_SUPPLIER'))
  for (const c of ['CATALOGO_UNIFICADO', 'PEDIDOS_MEMBEGO', 'DEALS_MARKETPLACE', 'POS_CAJA', 'CITAS'] as const) {
    assert.ok(!caps.activas.has(c), `${c} no debería estar encendida en un Supplier Lite`)
  }

  const invitacion = await prisma.invitacion.findFirstOrThrow({ where: { companyId: inv.companyId, email: inv.email } })
  assert.equal(invitacion.estado, 'PENDIENTE')
  assert.equal(invitacion.rol, 'ADMINISTRADOR')
  assert.equal(invitacion.origen, ORIGEN_INVITACION_PROVEEDOR)
  assert.equal(invitacion.token, inv.token)

  // Reinvitar: misma empresa, misma invitación (reenviada), una sola Company con ese proveedor.
  const otraVez = await sinEmpresa('prueba', (tx) => invitarDuenoDeProveedorEnTx(tx, { supplierId: ctx.supplierId, email: inv.email }, como(ctx.admin)))
  assert.equal(otraVez.companyId, inv.companyId)
  assert.equal(otraVez.empresaCreada, false)
  assert.equal(otraVez.reenviada, true)
  assert.equal(await prisma.invitacion.count({ where: { companyId: inv.companyId, estado: 'PENDIENTE' } }), 1)
  assert.equal(await prisma.supplyV2Supplier.count({ where: { companyId: inv.companyId } }), 1)
})

test('B · aceptar la invitación → ACTIVATION_PENDING; la preparación nombra lo que falta; un acuerdo nuevo no se activa', async () => {
  const dueno = await prisma.user.create({ data: { supabaseId: `sb-sa-dueno-${sufijo}`, email: `dueno-${sufijo}@prueba.test`, name: 'Dueña', role: 'ADMINISTRADOR', companyId: ctx.companyId }, select: { id: true } })
  ctx.duenoId = dueno.id
  await prisma.invitacion.updateMany({ where: { companyId: ctx.companyId, estado: 'PENDIENTE' }, data: { estado: 'ACEPTADA', aceptadaEn: new Date() } })
  await sinEmpresa('prueba', (tx) => alAceptarInvitacionDeProveedorEnTx(tx, ctx.companyId, como(dueno.id)))

  const p = await proveedor(ctx.supplierId)
  assert.equal(p.accessStatus, 'ACTIVATION_PENDING')
  const prep = await sinEmpresa('prueba', (tx) => preparacionDelProveedorEnTx(tx, ctx.supplierId))
  assert.equal(prep.lista, false)
  assert.deepEqual(prep.pendientes, ['contratoAceptado', 'qrProbado'])

  // Un acuerdo NUEVO con un proveedor a medio activar no se activa (§8).
  const ahora = new Date()
  const agreementId = await sinEmpresa('prueba', async (tx) => {
    const item = await crearItemCatalogoEnTx(tx, { supplierId: ctx.supplierId, type: 'PRODUCT', name: 'Cappuccino grande', publicPrice: 250 }, como(ctx.admin))
    const a = await crearAcuerdoEnTx(tx, { supplierId: ctx.supplierId, type: 'PREPAID_PURCHASE', catalogItemId: item.id, negotiatedUnitCost: 120, startsAt: new Date(ahora.getTime() - DIA), endsAt: new Date(ahora.getTime() + 365 * DIA) }, como(ctx.admin))
    return a.id
  })
  ctx.agreementId = agreementId
  await assert.rejects(
    sinEmpresa('prueba', (tx) => activarAcuerdoEnTx(tx, agreementId, como(ctx.admin))),
    (e: Error) => /PROVEEDOR_NO_OPERATIVO|preparación/.test(String(e.message)) || /preparación/.test(String(e))
  )
  assert.equal((await prisma.supplyV2Agreement.findUniqueOrThrow({ where: { id: agreementId } })).status, 'DRAFT')
})

test('C · contrato aceptado y escáner probado → ACTIVE (eligibleForFulfillment); el acuerdo ya se activa', async () => {
  await sinEmpresa('prueba', (tx) => aceptarContratoDeProveedorEnTx(tx, { supplierId: ctx.supplierId, userId: ctx.duenoId }, como(ctx.duenoId)))
  let p = await proveedor(ctx.supplierId)
  assert.ok(p.termsAcceptedAt)
  assert.equal(p.accessStatus, 'ACTIVATION_PENDING', 'falta la prueba del escáner')

  const codigo = await sinEmpresa('prueba', (tx) => codigoDePruebaEnTx(tx, ctx.supplierId))
  assert.match(codigo, /^TEST-[0-9A-F]{12}$/)
  assert.equal(await sinEmpresa('prueba', (tx) => codigoDePruebaEnTx(tx, ctx.supplierId)), codigo, 'el código vigente se reutiliza')

  const mala = await sinEmpresa('prueba', (tx) => registrarPruebaDeEscanerEnTx(tx, { supplierId: ctx.supplierId, userId: ctx.duenoId, codigo: 'TEST-000000000000' }, como(ctx.duenoId)))
  assert.equal(mala?.ok, false)
  assert.equal(await sinEmpresa('prueba', (tx) => registrarPruebaDeEscanerEnTx(tx, { supplierId: ctx.supplierId, userId: ctx.duenoId, codigo: 'no-es-de-prueba' }, como(ctx.duenoId))), null)

  const buena = await sinEmpresa('prueba', (tx) => registrarPruebaDeEscanerEnTx(tx, { supplierId: ctx.supplierId, userId: ctx.duenoId, codigo: codigo.toLowerCase() }, como(ctx.duenoId)))
  assert.equal(buena?.ok, true)
  p = await proveedor(ctx.supplierId)
  assert.ok(p.qrTestedAt)
  assert.equal(p.qrTestCode, null, 'el código se consume')
  assert.ok(p.fulfillmentReadyAt, 'eligibleForFulfillment')
  assert.equal(p.accessStatus, 'ACTIVE')
  assert.ok(p.activatedAt)

  const a = await sinEmpresa('prueba', (tx) => activarAcuerdoEnTx(tx, ctx.agreementId, como(ctx.admin)))
  assert.equal(a.version, 1)

  const bitacora = await prisma.auditLog.findMany({ where: { entidadTipo: 'SupplyV2Supplier', entidadId: ctx.supplierId }, select: { accion: true } })
  const acciones = new Set(bitacora.map((b) => b.accion))
  for (const a of ['SUPPLY_V2_SUPPLIER_INVITED', 'SUPPLY_V2_SUPPLIER_ACCESS_CHANGED', 'SUPPLY_V2_SUPPLIER_TERMS_ACCEPTED', 'SUPPLY_V2_SUPPLIER_QR_TESTED'] as const) {
    assert.ok(acciones.has(a), `falta ${a} en la bitácora`)
  }
})

test('D · suspender y reactivar; invitar personal con preset deja los permisos en la invitación', async () => {
  await assert.rejects(sinEmpresa('prueba', (tx) => suspenderAccesoEnTx(tx, { supplierId: ctx.supplierId, motivo: '  ' }, como(ctx.admin))), /motivo/)
  await sinEmpresa('prueba', (tx) => suspenderAccesoEnTx(tx, { supplierId: ctx.supplierId, motivo: 'Incidencias reiteradas' }, como(ctx.admin)))
  let p = await proveedor(ctx.supplierId)
  assert.equal(p.accessStatus, 'SUSPENDED')
  assert.equal(p.accessStatusReason, 'Incidencias reiteradas')
  // Suspendido: ni acuerdos nuevos ni personal nuevo.
  await assert.rejects(
    sinEmpresa('prueba', async (tx) => {
      const item = await crearItemCatalogoEnTx(tx, { supplierId: ctx.supplierId, type: 'SERVICE', name: 'Servicio extra', publicPrice: 100 }, como(ctx.admin))
      const a = await crearAcuerdoEnTx(tx, { supplierId: ctx.supplierId, type: 'PREPAID_PURCHASE', catalogItemId: item.id, negotiatedUnitCost: 50, startsAt: new Date(Date.now() - DIA) }, como(ctx.admin))
      await activarAcuerdoEnTx(tx, a.id, como(ctx.admin))
    }),
    /suspendido/
  )
  await assert.rejects(sinEmpresa('prueba', (tx) => invitarPersonalDeProveedorEnTx(tx, { supplierId: ctx.supplierId, companyId: ctx.companyId, email: `op-${sufijo}@prueba.test`, rol: 'SUPPLIER_OPERATOR' }, como(ctx.duenoId))), /no está operativo/)

  await sinEmpresa('prueba', (tx) => reactivarAccesoEnTx(tx, { supplierId: ctx.supplierId }, como(ctx.admin)))
  p = await proveedor(ctx.supplierId)
  assert.equal(p.accessStatus, 'ACTIVE', 'ya estaba preparado: vuelve a ACTIVE')
  assert.equal(p.accessStatusReason, null)

  const inv = await sinEmpresa('prueba', (tx) => invitarPersonalDeProveedorEnTx(tx, { supplierId: ctx.supplierId, companyId: ctx.companyId, email: `op-${sufijo}@prueba.test`, rol: 'SUPPLIER_OPERATOR' }, como(ctx.duenoId)))
  const fila = await prisma.invitacion.findFirstOrThrow({ where: { token: inv.token } })
  assert.equal(fila.rol, 'CAJERO')
  assert.equal(fila.origen, ORIGEN_INVITACION_PROVEEDOR)
  assert.deepEqual(fila.permisos, { v: 1, secciones: { supply: true }, funciones: { supply: { liquidaciones: false, personal: false, configuracion: false, solicitud_merchant: false } } })

  // Personal de OTRA empresa: el proveedor no es suyo.
  await assert.rejects(sinEmpresa('prueba', (tx) => invitarPersonalDeProveedorEnTx(tx, { supplierId: ctx.supplierId, companyId: 'otra-empresa', email: `x-${sufijo}@prueba.test`, rol: 'SUPPLIER_VIEWER' }, como(ctx.duenoId))), /no es el de tu empresa/)
})

test('E · proveedor histórico (empresa registrada) nace en DRAFT, sigue operando y la dispensa lo deja ACTIVE con motivo', async () => {
  const empresa = await prisma.company.create({ data: { name: `Litre Pizza ${sufijo}`, slug: `litre-pizza-${sufijo}`, type: 'restaurante', capacidades: { overrides: { MEMBEGO_SUPPLIER: true } } }, select: { id: true } })
  ctx.legacyCompanyId = empresa.id
  const ahora = new Date()
  await sinEmpresa('prueba', async (tx) => {
    const p = await vincularEmpresaComoProveedorEnTx(tx, empresa.id, {}, como(ctx.admin))
    ctx.legacySupplierId = p.id
    const item = await crearItemCatalogoEnTx(tx, { supplierId: p.id, type: 'PRODUCT', name: 'Pizza Pepperoni', publicPrice: 700 }, como(ctx.admin))
    const a = await crearAcuerdoEnTx(tx, { supplierId: p.id, type: 'PREPAID_PURCHASE', catalogItemId: item.id, negotiatedUnitCost: 300, startsAt: new Date(ahora.getTime() - DIA) }, como(ctx.admin))
    // Sin modo estricto, un proveedor DRAFT (nunca invitado) sigue recibiendo acuerdos: compatibilidad de la migración.
    await activarAcuerdoEnTx(tx, a.id, como(ctx.admin))
  })
  let p = await proveedor(ctx.legacySupplierId)
  assert.equal(p.accessStatus, 'DRAFT')

  const relevamiento = await sinEmpresa('prueba', (tx) => relevarProveedoresEnTx(tx))
  const fila = relevamiento.find((r) => r.id === ctx.legacySupplierId)
  assert.equal(fila?.clase, 'ACTIVE_WITHOUT_ACCESS')
  assert.equal(fila?.acuerdosActivos, 1)
  assert.equal(relevamiento.find((r) => r.id === ctx.supplierId)?.clase, 'ACTIVE_WITH_ACCESS')

  await assert.rejects(sinEmpresa('prueba', (tx) => dispensarPreparacionEnTx(tx, { supplierId: ctx.legacySupplierId, motivo: 'x' }, como(ctx.admin))), /motivo/)
  await sinEmpresa('prueba', (tx) => dispensarPreparacionEnTx(tx, { supplierId: ctx.legacySupplierId, motivo: 'Proveedor histórico con acuerdos vivos; se invita después.' }, como(ctx.admin)))
  p = await proveedor(ctx.legacySupplierId)
  assert.equal(p.accessStatus, 'ACTIVE')
  assert.ok(p.readinessWaivedAt)
  assert.equal(p.fulfillmentReadyAt, null)
  assert.equal((await sinEmpresa('prueba', (tx) => relevarProveedoresEnTx(tx))).find((r) => r.id === ctx.legacySupplierId)?.clase, 'LEGACY')
  // La regla de la base: ACTIVE sin preparación ni dispensa es imposible.
  await assert.rejects(prisma.supplyV2Supplier.update({ where: { id: ctx.legacySupplierId }, data: { readinessWaivedAt: null, readinessWaivedReason: null } }), /acceso_activo_preparado|check/i)
  // Y ser proveedor NO le quitó nada a la empresa: sigue siendo Merchant + Supplier en la misma `Company`.
  assert.equal(await prisma.supplyV2Supplier.count({ where: { companyId: empresa.id } }), 1)
})

test('F · dar de baja cancela las invitaciones vivas, conserva empresa e historial y no admite reinvitar', async () => {
  await sinEmpresa('prueba', (tx) => darDeBajaAccesoEnTx(tx, { supplierId: ctx.supplierId, motivo: 'Fin de la relación operativa' }, como(ctx.admin)))
  const p = await proveedor(ctx.supplierId)
  assert.equal(p.accessStatus, 'TERMINATED')
  assert.equal(await prisma.invitacion.count({ where: { companyId: ctx.companyId, estado: 'PENDIENTE' } }), 0)
  assert.equal(await prisma.invitacion.count({ where: { companyId: ctx.companyId, estado: 'CANCELADA' } }), 1)
  assert.ok(await prisma.company.findUnique({ where: { id: ctx.companyId } }), 'la empresa sigue')
  assert.equal(await prisma.supplyV2Agreement.count({ where: { supplierId: ctx.supplierId } }), 1, 'los acuerdos siguen (el de D se deshizo con su transacción)')
  await assert.rejects(sinEmpresa('prueba', (tx) => invitarDuenoDeProveedorEnTx(tx, { supplierId: ctx.supplierId, email: `otro-${sufijo}@prueba.test` }, como(ctx.admin))), /baja/)
  await assert.rejects(sinEmpresa('prueba', (tx) => reactivarAccesoEnTx(tx, { supplierId: ctx.supplierId }, como(ctx.admin))), /suspendido/)
})
