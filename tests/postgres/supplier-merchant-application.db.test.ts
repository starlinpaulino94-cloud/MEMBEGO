import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../../src/lib/prisma'
import { sinEmpresa } from '../../src/lib/tenant'
import { capacidadesDeEmpresa } from '../../src/modules/capacidades/catalogo'
import { tipoDeOrganizacion } from '../../src/modules/supply-v2/suppliers/acceso-dominio'
import { validarSolicitud } from '../../src/modules/supply-v2/suppliers/solicitud-merchant-dominio'
import {
  enviarSolicitudMerchantEnTx,
  prellenadoDeSolicitudEnTx,
  retirarSolicitudMerchantEnTx,
  revisarSolicitudMerchantEnTx,
  solicitudVivaEnTx,
  ultimaSolicitudEnTx,
  yaEsMerchantEnTx,
} from '../../src/modules/supply-v2/suppliers/solicitud-merchant'
import { SupplyV2Error } from '../../src/modules/supply-v2/core/errores'
import { como, montarSupplierLite, type ArnesSupplierLite } from './supplier-lite-arnes'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · Slice 9 contra PostgreSQL: Supplier → Merchant (§39–§41, §80).
 *
 *   Café Central (Supplier Lite) pide ser empresa Membego → Membego pide más información →
 *   responde → aprobada: la MISMA empresa enciende catálogo, pedidos y ofertas; sigue siendo
 *   proveedora; sus acuerdos y ofertas de Membego no se tocan; NO nace una segunda Company.
 *
 * `npm run test:db`.
 */

let a: ArnesSupplierLite
let b: ArnesSupplierLite

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof SupplyV2Error) return e.codigo
    throw e
  }
  assert.fail('se esperaba un error de dominio')
}

function datosDe(x: ArnesSupplierLite, extra: Record<string, unknown> = {}) {
  const v = validarSolicitud({
    nombreComercial: `Café Central ${x.sufijo}`,
    tipoNegocio: 'cafeteria',
    descripcion: 'Café de especialidad frente a la playa.',
    telefono: '809-555-0100',
    direccion: 'Av. Alemania 12',
    ciudad: 'Bávaro',
    rnc: '131234567',
    sucursales: [{ nombre: 'Principal', direccion: 'Av. Alemania 12' }],
    queVende: 'Café, postres y desayunos.',
    notas: '',
    ...extra,
  })
  assert.ok('datos' in v, JSON.stringify(v))
  return v.datos
}

before(async () => {
  a = await montarSupplierLite({ prefijo: 'mapp', unidadesCompradas: 10, unidadesCliente: 1 })
  b = await montarSupplierLite({ prefijo: 'mapr', unidadesCompradas: 10, unidadesCliente: 1 })
})

test('1 · el formulario llega prellenado desde la empresa y el proveedor; sin solicitud viva no hay nada que retirar', async () => {
  const pre = await sinEmpresa('prueba', (tx) => prellenadoDeSolicitudEnTx(tx, a.supplierId))
  assert.ok(pre.nombreComercial.length > 1)
  assert.equal(pre.tipoNegocio, 'restaurante', 'la empresa nació como «proveedor»: se propone un tipo')
  assert.ok(pre.sucursales.some((s) => s.nombre === 'Principal'))
  assert.equal(await sinEmpresa('prueba', (tx) => solicitudVivaEnTx(tx, a.supplierId)), null)
  assert.equal(await sinEmpresa('prueba', (tx) => yaEsMerchantEnTx(tx, a.supplierId)), false)
})

test('2 · enviar crea UNA solicitud (la segunda es la misma), audita y apunta el evento para Membego', async () => {
  const r1 = await sinEmpresa('prueba', (tx) => enviarSolicitudMerchantEnTx(tx, { supplierId: a.supplierId, companyId: a.companyId, userId: a.duenoId, datos: datosDe(a) }, como(a.duenoId)))
  assert.equal(r1.status, 'SUBMITTED')
  assert.equal(r1.repetida, false)
  const r2 = await sinEmpresa('prueba', (tx) => enviarSolicitudMerchantEnTx(tx, { supplierId: a.supplierId, companyId: a.companyId, userId: a.duenoId, datos: datosDe(a) }, como(a.duenoId)))
  assert.equal(r2.id, r1.id)
  assert.equal(r2.repetida, true)
  assert.equal(await prisma.supplyV2MerchantApplication.count({ where: { supplierId: a.supplierId } }), 1)
  assert.ok(await prisma.auditLog.findFirst({ where: { accion: 'SUPPLY_V2_MERCHANT_APPLICATION_SUBMITTED', entidadId: r1.id } }))
  assert.ok(await prisma.supplyV2OutboxEvent.findFirst({ where: { eventType: 'supplier.merchant_application_submitted', aggregateId: r1.id } }))
  // La base solo admite UNA viva por proveedor (índice único parcial).
  await assert.rejects(
    prisma.supplyV2MerchantApplication.create({ data: { supplierId: a.supplierId, companyId: a.companyId, status: 'SUBMITTED', datos: {}, submittedById: a.duenoId } }),
    /una_viva|Unique constraint|unique/i
  )
})

test('3 · otro proveedor no la ve como suya: ni la retira ni la responde', async () => {
  const viva = await sinEmpresa('prueba', (tx) => solicitudVivaEnTx(tx, a.supplierId))
  assert.ok(viva)
  assert.equal(await codigo(sinEmpresa('prueba', (tx) => retirarSolicitudMerchantEnTx(tx, { applicationId: viva.id, supplierId: b.supplierId }, como(b.duenoId)))), 'SOLICITUD_NO_ENCONTRADA')
  assert.equal(await codigo(sinEmpresa('prueba', (tx) => enviarSolicitudMerchantEnTx(tx, { supplierId: a.supplierId, companyId: b.companyId, userId: b.duenoId, datos: datosDe(a) }, como(b.duenoId)))), 'PROVEEDOR_AJENO')
})

test('4 · Membego la toma, pide más información (con petición obligatoria) y el proveedor responde: vuelve a la cola', async () => {
  const viva = (await sinEmpresa('prueba', (tx) => solicitudVivaEnTx(tx, a.supplierId)))!
  assert.equal(await codigo(sinEmpresa('prueba', (tx) => revisarSolicitudMerchantEnTx(tx, { applicationId: viva.id, decision: 'MORE_INFO_REQUIRED' }, como(a.admin)))), 'PETICION_OBLIGATORIA')
  const rev = await sinEmpresa('prueba', (tx) => revisarSolicitudMerchantEnTx(tx, { applicationId: viva.id, decision: 'UNDER_REVIEW', notasInternas: 'Llamar al dueño' }, como(a.admin)))
  assert.equal(rev.status, 'UNDER_REVIEW')
  const mas = await sinEmpresa('prueba', (tx) => revisarSolicitudMerchantEnTx(tx, { applicationId: viva.id, decision: 'MORE_INFO_REQUIRED', peticion: 'Manda el RNC actualizado.' }, como(a.admin)))
  assert.equal(mas.status, 'MORE_INFO_REQUIRED')
  const estado = (await sinEmpresa('prueba', (tx) => ultimaSolicitudEnTx(tx, a.supplierId)))!
  assert.equal(estado.moreInfoRequest, 'Manda el RNC actualizado.')
  assert.equal(estado.internalNotes, 'Llamar al dueño')
  // Responde con datos nuevos: misma solicitud, de vuelta a SUBMITTED.
  const resp = await sinEmpresa('prueba', (tx) => enviarSolicitudMerchantEnTx(tx, { supplierId: a.supplierId, companyId: a.companyId, userId: a.duenoId, datos: datosDe(a, { rnc: '131999999', notas: 'RNC actualizado adjunto.' }) }, como(a.duenoId)))
  assert.equal(resp.id, viva.id)
  assert.equal(resp.respondida, true)
  assert.equal(resp.status, 'SUBMITTED')
  const despues = (await sinEmpresa('prueba', (tx) => ultimaSolicitudEnTx(tx, a.supplierId)))!
  assert.equal(despues.datos.rnc, '131999999')
  assert.equal(despues.moreInfoResponse, 'RNC actualizado adjunto.')
  assert.equal(await prisma.supplyV2MerchantApplication.count({ where: { supplierId: a.supplierId } }), 1, 'responder no crea otra solicitud')
})

test('5 · APROBAR: la MISMA empresa enciende comercio, sigue siendo proveedora, no se publica sola y no nace otra Company', async () => {
  const antes = await prisma.company.count()
  const empresaAntes = await prisma.company.findUniqueOrThrow({ where: { id: a.companyId }, select: { type: true, capacidades: true, tipoNegocioCodigo: true, isPublished: true, telefono: true, ciudad: true } })
  assert.equal(empresaAntes.type, 'proveedor')
  assert.equal(tipoDeOrganizacion([...capacidadesDeEmpresa(empresaAntes).activas], true), 'SUPPLIER_ONLY')
  const acuerdosAntes = await prisma.supplyV2Agreement.count({ where: { supplierId: a.supplierId, status: 'ACTIVE' } })
  const ofertasAntes = await prisma.supplyV2Offer.count({ where: { supplierId: a.supplierId, status: 'ACTIVE' } })

  const viva = (await sinEmpresa('prueba', (tx) => solicitudVivaEnTx(tx, a.supplierId)))!
  // Sin actor no hay decisión.
  assert.equal(await codigo(sinEmpresa('prueba', (tx) => revisarSolicitudMerchantEnTx(tx, { applicationId: viva.id, decision: 'APPROVED' }, como(null)))), 'SIN_ACTOR')
  const r = await sinEmpresa('prueba', (tx) => revisarSolicitudMerchantEnTx(tx, { applicationId: viva.id, decision: 'APPROVED', motivo: 'Bienvenidos.' }, como(a.admin)))
  assert.equal(r.status, 'APPROVED')
  assert.deepEqual([...r.capacidades].sort(), ['CATALOGO_UNIFICADO', 'DEALS_MARKETPLACE', 'PEDIDOS_MEMBEGO'])

  assert.equal(await prisma.company.count(), antes, 'NUNCA una segunda organización (§80)')
  const empresa = await prisma.company.findUniqueOrThrow({ where: { id: a.companyId }, select: { type: true, capacidades: true, tipoNegocioCodigo: true, isPublished: true, telefono: true, direccion: true, ciudad: true } })
  const caps = capacidadesDeEmpresa(empresa)
  assert.equal(tipoDeOrganizacion([...caps.activas], true), 'MERCHANT_SUPPLIER')
  assert.ok(caps.activas.has('MEMBEGO_SUPPLIER'), 'sigue siendo proveedora')
  assert.ok(caps.activas.has('CATALOGO_UNIFICADO') && caps.activas.has('PEDIDOS_MEMBEGO') && caps.activas.has('DEALS_MARKETPLACE'))
  assert.equal(empresa.type, 'cafeteria', 'el tipo elegido en la solicitud manda sobre «proveedor»')
  assert.equal(empresa.isPublished, false, 'la vitrina NO se publica sola: la publica la empresa cuando completa su onboarding')
  // El perfil se completa SOLO donde estaba vacío: lo que la empresa ya tenía no se pisa.
  assert.equal(empresa.telefono, empresaAntes.telefono ?? '809-555-0100')
  assert.equal(empresa.ciudad, empresaAntes.ciudad ?? 'Bávaro')

  // Lo que ya existía como proveedor sigue igual (§41): acuerdos y ofertas de Membego, mismo proveedor.
  assert.equal(await prisma.supplyV2Agreement.count({ where: { supplierId: a.supplierId, status: 'ACTIVE' } }), acuerdosAntes)
  assert.equal(await prisma.supplyV2Offer.count({ where: { supplierId: a.supplierId, status: 'ACTIVE' } }), ofertasAntes)
  assert.equal((await prisma.supplyV2Supplier.findUniqueOrThrow({ where: { id: a.supplierId }, select: { companyId: true } })).companyId, a.companyId)

  const final = (await sinEmpresa('prueba', (tx) => ultimaSolicitudEnTx(tx, a.supplierId)))!
  assert.equal(final.status, 'APPROVED')
  assert.equal(final.decisionReason, 'Bienvenidos.')
  assert.deepEqual([...(final.capabilitiesGranted ?? [])].sort(), ['CATALOGO_UNIFICADO', 'DEALS_MARKETPLACE', 'PEDIDOS_MEMBEGO'])
  assert.ok(await prisma.auditLog.findFirst({ where: { accion: 'SUPPLY_V2_MERCHANT_APPLICATION_APPROVED', entidadId: viva.id } }))
  assert.ok(await prisma.auditLog.findFirst({ where: { accion: 'CAPACIDADES_ACTUALIZADAS', entidadId: a.companyId } }))
  assert.ok(await prisma.supplyV2OutboxEvent.findFirst({ where: { eventType: 'supplier.merchant_approved', aggregateId: viva.id } }))

  // Ya es Merchant: no hay nada que volver a pedir; decidir de nuevo es idempotente.
  assert.equal(await sinEmpresa('prueba', (tx) => yaEsMerchantEnTx(tx, a.supplierId)), true)
  assert.equal(await codigo(sinEmpresa('prueba', (tx) => enviarSolicitudMerchantEnTx(tx, { supplierId: a.supplierId, companyId: a.companyId, userId: a.duenoId, datos: datosDe(a) }, como(a.duenoId)))), 'YA_ES_MERCHANT')
  assert.equal((await sinEmpresa('prueba', (tx) => revisarSolicitudMerchantEnTx(tx, { applicationId: viva.id, decision: 'APPROVED' }, como(a.admin)))).repetida, true)
  assert.equal(await codigo(sinEmpresa('prueba', (tx) => revisarSolicitudMerchantEnTx(tx, { applicationId: viva.id, decision: 'REJECTED', motivo: 'x' }, como(a.admin)))), 'SOLICITUD_CERRADA')
})

test('6 · RECHAZAR exige motivo y no toca capacidades; después se puede volver a solicitar; retirar cierra la viva', async () => {
  const r1 = await sinEmpresa('prueba', (tx) => enviarSolicitudMerchantEnTx(tx, { supplierId: b.supplierId, companyId: b.companyId, userId: b.duenoId, datos: datosDe(b) }, como(b.duenoId)))
  assert.equal(await codigo(sinEmpresa('prueba', (tx) => revisarSolicitudMerchantEnTx(tx, { applicationId: r1.id, decision: 'REJECTED' }, como(b.admin)))), 'MOTIVO_OBLIGATORIO')
  const antes = await prisma.company.findUniqueOrThrow({ where: { id: b.companyId }, select: { type: true, capacidades: true, tipoNegocioCodigo: true } })
  const rej = await sinEmpresa('prueba', (tx) => revisarSolicitudMerchantEnTx(tx, { applicationId: r1.id, decision: 'REJECTED', motivo: 'Faltan permisos sanitarios.' }, como(b.admin)))
  assert.equal(rej.status, 'REJECTED')
  const despues = await prisma.company.findUniqueOrThrow({ where: { id: b.companyId }, select: { type: true, capacidades: true, tipoNegocioCodigo: true } })
  assert.deepEqual(despues, antes, 'rechazar no cambia nada de la empresa')
  assert.equal(tipoDeOrganizacion([...capacidadesDeEmpresa(despues).activas], true), 'SUPPLIER_ONLY')
  assert.ok(await prisma.supplyV2OutboxEvent.findFirst({ where: { eventType: 'supplier.merchant_rejected', aggregateId: r1.id } }))

  const r2 = await sinEmpresa('prueba', (tx) => enviarSolicitudMerchantEnTx(tx, { supplierId: b.supplierId, companyId: b.companyId, userId: b.duenoId, datos: datosDe(b) }, como(b.duenoId)))
  assert.notEqual(r2.id, r1.id, 'tras un rechazo nace una solicitud nueva')
  assert.equal(await prisma.supplyV2MerchantApplication.count({ where: { supplierId: b.supplierId } }), 2)
  const ret = await sinEmpresa('prueba', (tx) => retirarSolicitudMerchantEnTx(tx, { applicationId: r2.id, supplierId: b.supplierId }, como(b.duenoId)))
  assert.equal(ret.repetida, false)
  assert.equal(await sinEmpresa('prueba', (tx) => solicitudVivaEnTx(tx, b.supplierId)), null)
  assert.equal((await sinEmpresa('prueba', (tx) => retirarSolicitudMerchantEnTx(tx, { applicationId: r2.id, supplierId: b.supplierId }, como(b.duenoId)))).repetida, true)
})
