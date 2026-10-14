import { test } from 'node:test'
import assert from 'node:assert/strict'
import { visibleWorkspaces, workspaceLanding, type ContextoNav } from '../src/components/layout/nav-config'
import { adminSectionForPath } from '../src/lib/auth/permissions'
import { esSoloProveedora } from '../src/modules/navegacion/contexto'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · el menú del proveedor (Supplier Lite, §6).
 * Ejecutar: npm test
 */

const rutasDe = (c: ContextoNav) => visibleWorkspaces(c).flatMap((w) => w.groups.flatMap((g) => g.items.map((i) => i.href)))

test('una empresa SOLO proveedora ve únicamente el espacio del proveedor: nada del Business OS', () => {
  const c: ContextoNav = { role: 'ADMINISTRADOR', scope: 'COMPANY', capacidades: ['MEMBEGO_SUPPLIER'], soloProveedor: true }
  const espacios = visibleWorkspaces(c)
  assert.deepEqual(espacios.map((w) => w.id), ['proveedor'])
  const rutas = rutasDe(c)
  assert.ok(rutas.includes('/admin/supply'))
  assert.ok(rutas.includes('/admin/supply/escaner'))
  assert.ok(rutas.includes('/admin/supply/personal'))
  assert.ok(rutas.includes('/admin/supply/configuracion'))
  for (const r of rutas) assert.ok(r.startsWith('/admin/supply'), `${r} no es del portal del proveedor`)
  assert.equal(workspaceLanding(espacios[0]!, c), '/admin/supply')
})

test('una empresa Merchant + proveedora ve su panel Y el espacio del proveedor', () => {
  const c: ContextoNav = { role: 'ADMINISTRADOR', scope: 'COMPANY', capacidades: ['MEMBEGO_SUPPLIER', 'CATALOGO_UNIFICADO', 'PEDIDOS_MEMBEGO'], soloProveedor: false }
  const ids = visibleWorkspaces(c).map((w) => w.id)
  assert.ok(ids.includes('empresa'))
  assert.ok(ids.includes('proveedor'))
  assert.equal(ids[0], 'empresa', 'el panel de la empresa sigue primero')
  const rutas = rutasDe(c)
  assert.ok(rutas.includes('/admin/catalogo'))
  assert.ok(rutas.includes('/admin/supply/canjes'))
})

test('sin la capacidad MEMBEGO_SUPPLIER no hay espacio del proveedor', () => {
  const c: ContextoNav = { role: 'ADMINISTRADOR', scope: 'COMPANY', capacidades: ['CATALOGO_UNIFICADO'] }
  assert.ok(!visibleWorkspaces(c).some((w) => w.id === 'proveedor'))
  assert.ok(!rutasDe(c).some((r) => r.startsWith('/admin/supply')))
})

test('un operador del proveedor (CAJERO con supply concedida) entra al portal; sin la concesión, no', () => {
  const con: ContextoNav = { role: 'CAJERO', scope: 'COMPANY', capacidades: ['MEMBEGO_SUPPLIER'], soloProveedor: true, permisos: { v: 1, secciones: { supply: true } } }
  assert.ok(rutasDe(con).includes('/admin/supply/escaner'))
  const sin: ContextoNav = { role: 'CAJERO', scope: 'COMPANY', capacidades: ['MEMBEGO_SUPPLIER'], soloProveedor: true }
  assert.equal(rutasDe(sin).length, 0)
})

test('todas las pantallas del portal resuelven a la sección supply', () => {
  for (const r of ['/admin/supply', '/admin/supply/escaner', '/admin/supply/canjes', '/admin/supply/incidencias', '/admin/supply/liquidaciones', '/admin/supply/personal', '/admin/supply/configuracion']) {
    assert.equal(adminSectionForPath(r), 'supply', r)
  }
})

test('esSoloProveedora: proveedora sin comercio', () => {
  assert.equal(esSoloProveedora(['MEMBEGO_SUPPLIER', 'PAGO_TRANSFERENCIA']), true)
  assert.equal(esSoloProveedora(['MEMBEGO_SUPPLIER', 'CATALOGO_UNIFICADO']), false)
  assert.equal(esSoloProveedora(['CATALOGO_UNIFICADO']), false)
})
