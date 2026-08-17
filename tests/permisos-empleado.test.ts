import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolverPermisosUsuario,
  seccionPermitida,
  funcionPermitida,
  permisosDesdeSeleccion,
  puedeEditarPermisos,
  canAccessAdminSection,
} from '../src/lib/auth/permissions'

/**
 * Módulo de PERMISOS por empleado (14-08-2026): el rol da la base y el
 * ajuste concede o niega encima. Estas pruebas fijan la resolución pura —
 * la misma que consumen el proxy (vista), el menú y requireSection (acciones).
 */

test('sin ajustes, manda el rol tal cual', () => {
  assert.equal(seccionPermitida('CAJERO', 'pagos', null), true)
  assert.equal(seccionPermitida('MARKETING', 'pagos', null), false)
  assert.equal(seccionPermitida('MARKETING', 'campanas', null), true)
})

test('negar una sección le gana al rol (el caso "quítale Pagos al cajero")', () => {
  const p = resolverPermisosUsuario({ v: 1, secciones: { pagos: false } })
  assert.equal(seccionPermitida('CAJERO', 'pagos', p), false)
  // Y el resto de sus secciones no se toca.
  assert.equal(seccionPermitida('CAJERO', 'clientes', p), true)
})

test('conceder una sección que el rol no trae (Marketing con Clientes)', () => {
  const p = resolverPermisosUsuario({ v: 1, secciones: { clientes: true } })
  assert.equal(canAccessAdminSection('MARKETING', 'clientes'), false)
  assert.equal(seccionPermitida('MARKETING', 'clientes', p), true)
})

test('el superadmin ignora cualquier ajuste; los ADMINISTRADORES ya no (control de plataforma)', () => {
  const p = resolverPermisosUsuario({ v: 1, secciones: { pagos: false, clientes: false } })
  assert.equal(seccionPermitida('SUPERADMIN', 'pagos', p), true)
  // Decisión de producto (15-08-2026): la plataforma puede restringir a los
  // administradores de una empresa — sus ajustes SÍ resuelven.
  assert.equal(seccionPermitida('ADMINISTRADOR', 'pagos', p), false)
  assert.equal(seccionPermitida('ADMIN_EMPRESA', 'clientes', p), false)
  assert.equal(seccionPermitida('ADMINISTRADOR', 'membresias', p), true)
})

test('quién edita a quién: superadmin a cualquiera (menos superadmin); admin solo a su equipo', () => {
  assert.equal(puedeEditarPermisos('SUPERADMIN', 'ADMINISTRADOR'), true)
  assert.equal(puedeEditarPermisos('SUPERADMIN', 'CAJERO'), true)
  assert.equal(puedeEditarPermisos('SUPERADMIN', 'SUPERADMIN'), false)
  assert.equal(puedeEditarPermisos('ADMINISTRADOR', 'CAJERO'), true)
  assert.equal(puedeEditarPermisos('ADMINISTRADOR', 'ADMINISTRADOR'), false)
  assert.equal(puedeEditarPermisos('ADMINISTRADOR', 'ADMIN_EMPRESA'), false)
  assert.equal(puedeEditarPermisos('ADMINISTRADOR', 'SUPERADMIN'), false)
  assert.equal(puedeEditarPermisos('CAJERO', 'EMPLEADO'), false)
})

test('el ejemplo de citas: módulo abierto, configurar negado', () => {
  const p = resolverPermisosUsuario({ v: 1, funciones: { citas: { configurar: false } } })
  assert.equal(seccionPermitida('CAJERO', 'citas', p), true)
  assert.equal(funcionPermitida('CAJERO', 'citas', 'gestionar', p), true)
  assert.equal(funcionPermitida('CAJERO', 'citas', 'configurar', p), false)
  // Y aplica también a un ADMINISTRADOR (puesto por la plataforma).
  assert.equal(funcionPermitida('ADMINISTRADOR', 'citas', 'configurar', p), false)
  assert.equal(funcionPermitida('ADMINISTRADOR', 'citas', 'gestionar', p), true)
})

test('negar una función bloquea esa función y solo esa', () => {
  const p = resolverPermisosUsuario({
    v: 1,
    funciones: { promociones: { eliminar: false } },
  })
  assert.equal(funcionPermitida('CAJERO', 'promociones', 'eliminar', p), false)
  assert.equal(funcionPermitida('CAJERO', 'promociones', 'crear', p), true)
  // La sección sigue abierta: la negación fue quirúrgica.
  assert.equal(seccionPermitida('CAJERO', 'promociones', p), true)
})

test('una sección negada cierra también todas sus funciones', () => {
  const p = resolverPermisosUsuario({ v: 1, secciones: { pagos: false } })
  assert.equal(funcionPermitida('CAJERO', 'pagos', 'confirmar_pago', p), false)
})

test('la basura no resuelve: secciones inventadas y valores raros se descartan', () => {
  assert.equal(resolverPermisosUsuario(null), null)
  assert.equal(resolverPermisosUsuario('x'), null)
  assert.equal(resolverPermisosUsuario({ secciones: { inventada: false, pagos: 'no' } }), null)
  const p = resolverPermisosUsuario({ funciones: { pagos: { x: true, y: false } } })
  // Solo las negaciones (false) cuentan en funciones.
  assert.deepEqual(p?.funciones, { pagos: { y: false } })
})

test('permisosDesdeSeleccion guarda SOLO diferencias contra el rol', () => {
  // Un cajero con todo igual a su rol → null (columna limpia).
  assert.equal(
    permisosDesdeSeleccion('CAJERO', { secciones: { pagos: true }, funcionesNegadas: {} }),
    null
  )
  // Negarle pagos sí es diferencia; concederle a Marketing clientes también.
  const p1 = permisosDesdeSeleccion('CAJERO', { secciones: { pagos: false }, funcionesNegadas: {} })
  assert.deepEqual(p1?.secciones, { pagos: false })
  const p2 = permisosDesdeSeleccion('MARKETING', {
    secciones: { clientes: true },
    funcionesNegadas: { promociones: ['eliminar'] },
  })
  assert.deepEqual(p2?.secciones, { clientes: true })
  assert.deepEqual(p2?.funciones, { promociones: { eliminar: false } })
})
