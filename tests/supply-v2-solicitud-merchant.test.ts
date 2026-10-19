import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  capacidadesQueEnciendeLaAprobacion,
  ESTADOS_VIVOS_SOLICITUD,
  prellenarSolicitud,
  TRANSICIONES_SOLICITUD_MERCHANT,
  validarDecision,
  validarSolicitud,
} from '../src/modules/supply-v2/suppliers/solicitud-merchant-dominio'
import { CAPACIDADES_DE_COMERCIO_MERCHANT, tipoDeOrganizacion } from '../src/modules/supply-v2/suppliers/acceso-dominio'
import { visibleWorkspaces, type ContextoNav } from '../src/components/layout/nav-config'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · reglas puras de Supplier → Merchant (§39–§41).
 * Ejecutar: npm test
 */

test('la máquina de estados: enviada → revisión → aprobada/rechazada/más info; más info vuelve a enviada; retirar solo si está viva', () => {
  assert.deepEqual(TRANSICIONES_SOLICITUD_MERCHANT.SUBMITTED, ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'MORE_INFO_REQUIRED', 'WITHDRAWN'])
  assert.deepEqual(TRANSICIONES_SOLICITUD_MERCHANT.MORE_INFO_REQUIRED, ['SUBMITTED', 'WITHDRAWN'])
  assert.deepEqual(TRANSICIONES_SOLICITUD_MERCHANT.APPROVED, [])
  assert.deepEqual(TRANSICIONES_SOLICITUD_MERCHANT.REJECTED, [])
  assert.deepEqual(ESTADOS_VIVOS_SOLICITUD, ['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED'])
})

test('prellenado: toma el nombre del proveedor, el tipo de la empresa salvo «proveedor», y las sucursales', () => {
  const d = prellenarSolicitud({
    empresa: { name: 'Café Central', type: 'proveedor', description: null, telefono: null, direccion: 'Calle 1', ciudad: 'Bávaro' },
    proveedor: { commercialName: 'Café Central SRL', taxId: '131234567', phone: '809-555-0000', address: 'Calle 2' },
    sucursales: [{ nombre: 'Principal', direccion: null }],
  })
  assert.equal(d.nombreComercial, 'Café Central SRL')
  assert.equal(d.tipoNegocio, 'restaurante', 'una empresa nacida como Supplier Lite no tiene tipo propio: se propone uno')
  assert.equal(d.telefono, '809-555-0000')
  assert.equal(d.direccion, 'Calle 1', 'la dirección de la empresa manda sobre la del proveedor')
  assert.equal(d.rnc, '131234567')
  assert.deepEqual(d.sucursales, [{ nombre: 'Principal', direccion: '' }])
  assert.equal(prellenarSolicitud({ empresa: { name: 'X', type: 'carwash', description: null, telefono: null, direccion: null, ciudad: null }, proveedor: {}, sucursales: [] }).tipoNegocio, 'carwash')
})

test('validar: nombre, tipo, descripción, teléfono, dirección y «qué vende» son obligatorios; el RNC se comprueba si viene', () => {
  const base = { nombreComercial: 'Café Central', tipoNegocio: 'cafeteria', descripcion: 'Café de especialidad en Bávaro', telefono: '809-555-0000', direccion: 'Calle 1 #2', ciudad: 'Bávaro', rnc: '', sucursales: [{ nombre: 'Principal', direccion: 'Calle 1' }], queVende: 'Café, postres y desayunos', notas: '' }
  const ok = validarSolicitud(base)
  assert.ok('datos' in ok)
  assert.equal(ok.datos.v, 1)
  assert.equal(ok.datos.sucursales.length, 1)
  assert.match((validarSolicitud({ ...base, nombreComercial: 'A' }) as { error: string }).error, /nombre/)
  assert.match((validarSolicitud({ ...base, tipoNegocio: 'banco' }) as { error: string }).error, /tipo/)
  assert.match((validarSolicitud({ ...base, descripcion: 'corta' }) as { error: string }).error, /negocio/)
  assert.match((validarSolicitud({ ...base, telefono: '12' }) as { error: string }).error, /teléfono/)
  assert.match((validarSolicitud({ ...base, direccion: 'x' }) as { error: string }).error, /dirección/)
  assert.match((validarSolicitud({ ...base, queVende: '' }) as { error: string }).error, /vender/)
  assert.match((validarSolicitud({ ...base, rnc: '12' }) as { error: string }).error, /RNC/)
  assert.ok('datos' in validarSolicitud({ ...base, rnc: '131-234567' }))
  assert.ok('datos' in validarSolicitud({ ...base, rnc: '00112345678' }))
  // Sucursales sin nombre no entran; más de 20 se recortan.
  const muchas = validarSolicitud({ ...base, sucursales: [...Array.from({ length: 25 }, (_, i) => ({ nombre: `S${i}`, direccion: '' })), { nombre: '', direccion: 'x' }] })
  assert.ok('datos' in muchas)
  assert.equal(muchas.datos.sucursales.length, 20)
})

test('decisión: rechazar exige motivo; pedir información exige la petición; aprobar no exige nada', () => {
  assert.match((validarDecision({ decision: 'REJECTED', motivo: '', peticion: '' }) as { error: string }).error, /motivo/)
  assert.match((validarDecision({ decision: 'MORE_INFO_REQUIRED', motivo: '', peticion: '' }) as { error: string }).error, /información/)
  assert.deepEqual(validarDecision({ decision: 'APPROVED', motivo: '', peticion: '' }), { decision: 'APPROVED' })
  assert.deepEqual(validarDecision({ decision: 'UNDER_REVIEW', motivo: '', peticion: '' }), { decision: 'UNDER_REVIEW' })
  assert.match((validarDecision({ decision: 'WITHDRAWN', motivo: '', peticion: '' }) as { error: string }).error, /Elige/)
})

test('aprobar enciende las capacidades de comercio del Merchant; con ellas la MISMA empresa pasa a MERCHANT_SUPPLIER', () => {
  const caps = capacidadesQueEnciendeLaAprobacion()
  assert.deepEqual([...caps], [...CAPACIDADES_DE_COMERCIO_MERCHANT])
  assert.equal(tipoDeOrganizacion(['MEMBEGO_SUPPLIER'], true), 'SUPPLIER_ONLY')
  assert.equal(tipoDeOrganizacion(['MEMBEGO_SUPPLIER', ...caps], true), 'MERCHANT_SUPPLIER')
})

test('el portal del proveedor enlaza la solicitud en su espacio de organización', () => {
  const c: ContextoNav = { role: 'ADMINISTRADOR', scope: 'COMPANY', capacidades: ['MEMBEGO_SUPPLIER'], soloProveedor: true }
  const rutas = visibleWorkspaces(c).flatMap((w) => w.groups.flatMap((g) => g.items.map((i) => i.href)))
  assert.ok(rutas.includes('/admin/supply/solicitud-merchant'))
  assert.ok(rutas.includes('/admin/supply/ventas-adicionales'))
})
