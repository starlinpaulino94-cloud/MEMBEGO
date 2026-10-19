import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ADMIN_SECTIONS, FUNCIONES_NEGADAS_POR_ROL, canAccessAdminSection, funcionPermitida, seccionPermitida, type PermisosUsuario } from '../src/lib/auth/permissions'
import { FUNCIONES_POR_SECCION } from '../src/lib/auth/funciones'
import { ADMIN_ROLES, FULL_ADMIN_ROLES, INVITABLE_ROLES, ROLE_HOME, ROLES_APP, SCANNER_ROLES } from '../src/types'

/**
 * INV-5e · el rol de BODEGA: mueve existencias y nada más. Entra al inventario, no ve costos ni compra, y no alcanza ninguna otra sección
 * del panel (ni siquiera el inicio, que muestra dinero).
 */

test('BODEGA es un rol conocido, del panel, invitable y aterriza en el inventario', () => {
  assert.ok((ROLES_APP as readonly string[]).includes('BODEGA'))
  assert.ok(ADMIN_ROLES.includes('BODEGA'))
  assert.ok(INVITABLE_ROLES.includes('BODEGA'))
  assert.equal(ROLE_HOME.BODEGA, '/admin/inventario')
})

test('BODEGA no es admin pleno ni entra al escáner: su acceso es el de su paquete', () => {
  assert.equal(FULL_ADMIN_ROLES.includes('BODEGA'), false)
  assert.equal(SCANNER_ROLES.includes('BODEGA'), false)
})

test('BODEGA solo tiene la sección de inventario; todas las demás se le cierran', () => {
  for (const s of ADMIN_SECTIONS) assert.equal(canAccessAdminSection('BODEGA', s), s === 'inventario', s)
  assert.equal(seccionPermitida('BODEGA', 'inventario', null), true)
  for (const s of ['dashboard', 'catalogo', 'pagos', 'facturas', 'reportes', 'empleados', 'integraciones'] as const) assert.equal(seccionPermitida('BODEGA', s, null), false, s)
})

test('BODEGA mueve existencias (ajustar, transferir) pero no ve costos ni compra, con o sin ajustes por empleado', () => {
  assert.equal(funcionPermitida('BODEGA', 'inventario', 'ajustar', null), true)
  assert.equal(funcionPermitida('BODEGA', 'inventario', 'transferir', null), true)
  assert.equal(funcionPermitida('BODEGA', 'inventario', 'costos', null), false)
  assert.equal(funcionPermitida('BODEGA', 'inventario', 'comprar', null), false)
  // Un ajuste por empleado solo puede negar: nada de lo que se guarde le devuelve los costos.
  const conAjuste: PermisosUsuario = { v: 1, funciones: { inventario: { costos: true as never, comprar: true as never } } }
  assert.equal(funcionPermitida('BODEGA', 'inventario', 'costos', conAjuste), false)
  assert.equal(funcionPermitida('BODEGA', 'inventario', 'comprar', conAjuste), false)
  // Y se le puede quitar además lo que sí trae.
  const sinAjustar: PermisosUsuario = { v: 1, funciones: { inventario: { ajustar: false } } }
  assert.equal(funcionPermitida('BODEGA', 'inventario', 'ajustar', sinAjustar), false)
})

test('el catálogo de inventario trae las cuatro funciones que se dan por sentadas', () => {
  assert.deepEqual((FUNCIONES_POR_SECCION.inventario ?? []).map((f) => f.codigo).sort(), ['ajustar', 'comprar', 'costos', 'transferir'])
})

test('el administrador y el gerente conservan todas las funciones de inventario', () => {
  for (const rol of ['ADMINISTRADOR', 'GERENTE', 'SUPERADMIN'] as const) for (const { codigo: f } of FUNCIONES_POR_SECCION.inventario ?? []) assert.equal(funcionPermitida(rol, 'inventario', f, null), true, `${rol} ${f}`)
})

test('lo que un rol no trae de serie son funciones que existen en el catálogo de funciones', () => {
  for (const [rol, porSeccion] of Object.entries(FUNCIONES_NEGADAS_POR_ROL)) {
    for (const [seccion, funciones] of Object.entries(porSeccion ?? {})) {
      const codigos = (FUNCIONES_POR_SECCION[seccion as keyof typeof FUNCIONES_POR_SECCION] ?? []).map((f) => f.codigo)
      for (const f of funciones ?? []) assert.ok(codigos.includes(f), `${rol}/${seccion}/${f} no está en funciones.ts`)
    }
  }
})

test('el enum de la base y la migración 20261073 traen el rol, y la migración es idempotente', () => {
  assert.match(readFileSync('prisma/schema/identidad.prisma', 'utf8'), /enum AppRole \{[\s\S]*?\n  BODEGA\b/)
  assert.match(readFileSync('prisma/migrations/20261073_rol_bodega/migration.sql', 'utf8'), /ALTER TYPE "AppRole" ADD VALUE IF NOT EXISTS 'BODEGA'/)
})

test('la ficha de accesos dice qué le falta a la bodega: costos y compras, sin que nadie se lo haya negado a mano', async () => {
  const { accesoASeccion } = await import('../src/modules/permisos/accesos')
  const a = accesoASeccion('BODEGA', null, 'inventario', () => true)
  assert.equal(a.puede, true)
  assert.equal(a.origen, 'rol')
  assert.equal(a.funcionesNegadas.length, 2)
  assert.deepEqual(accesoASeccion('GERENTE', null, 'inventario', () => true).funcionesNegadas, [])
})

test('el editor de permisos no deja conceder desde la pantalla lo que el rol no trae', () => {
  const f = readFileSync('src/components/admin/PermisosEmpleadoForm.tsx', 'utf8')
  assert.match(f, /FUNCIONES_NEGADAS_POR_ROL\[rol\]\?\.\[sec\]\?\.includes\(f\.codigo\)/)
  assert.match(f, /checked=\{!negada\}\s+disabled=\{delRol\}/, 'la casilla de una función que el rol no trae tiene que estar deshabilitada')
})
