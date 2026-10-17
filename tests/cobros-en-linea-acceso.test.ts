/**
 * Quién ve el DETALLE de los cobros en línea (cliente, plan, autorización) en la caja.
 *
 * El detalle es el mismo dato que el historial de Comprobantes (`/admin/facturas`). Recepción y Empleado entran a la caja pero
 * no a ese historial, y la caja se lo enseñaba igual —y la acción del cuadre del día lo entregaba de TODA la empresa y de
 * CUALQUIER fecha—. Ahora lo ve quien puede abrir Comprobantes (con permisos vivos); los demás reciben el resumen, que basta
 * para el cuadre. Estas pruebas leen la fuente: lo que importa es que NINGÚN camino pida el detalle sin comprobar el permiso.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canAccessAdminSection, seccionPermitida } from '../src/lib/auth/permissions'

const leer = (...ruta: string[]) => readFileSync(join(...ruta), 'utf8')

test('quienes entran a la caja pero no a Comprobantes son Recepción y Empleado; cajero, gerente y administradores sí', () => {
  for (const rol of ['ADMINISTRADOR', 'GERENTE', 'CAJERO', 'ADMIN_EMPRESA', 'SUPERADMIN'] as const) {
    assert.equal(canAccessAdminSection(rol, 'facturas'), true, rol)
  }
  for (const rol of ['RECEPCION', 'EMPLEADO'] as const) {
    assert.equal(canAccessAdminSection(rol, 'facturas'), false, rol)
  }
})

test('negarle Comprobantes a un cajero concreto le quita el detalle, y concedérselo a un empleado se lo da', () => {
  assert.equal(seccionPermitida('CAJERO', 'facturas', { v: 1, secciones: { facturas: false } }), false)
  assert.equal(seccionPermitida('EMPLEADO', 'facturas', { v: 1, secciones: { facturas: true } }), true)
})

test('el detalle es negado por defecto en los datos: hay que pedirlo con conDetalle', () => {
  const datos = leer('src', 'modules', 'pagos', 'cobros-en-linea.ts')
  assert.match(datos, /const conDetalle = opciones\.conDetalle === true/)
  assert.match(datos, /items: conDetalle \? lectura\.items : \[\]/)
  const reporte = leer('src', 'modules', 'caja', 'queries.ts')
  assert.match(reporte, /conDetalle: opciones\.conDetalleEnLinea === true/)
})

test('los dos caminos que enseñan el detalle a personal de caja lo piden solo tras comprobar Comprobantes', () => {
  const pagina = leer('src', 'app', '(empleado)', 'empleado', 'caja', 'page.tsx')
  assert.match(pagina, /puedeSeccion\('facturas'\)\s*\.then\(\(conDetalle\) => getCobrosEnLineaDelDia\(/)
  const accion = leer('src', 'modules', 'caja', 'actions.ts')
  assert.match(accion, /conDetalleEnLinea: await puedeSeccion\('facturas'\)/)
})

test('nadie más en el código pide el detalle con un `true` suelto', () => {
  // Cada llamada a las funciones con detalle debe llevar una condición, no un literal `true`.
  for (const archivo of [
    join('src', 'app', '(empleado)', 'empleado', 'caja', 'page.tsx'),
    join('src', 'modules', 'caja', 'actions.ts'),
    join('src', 'modules', 'caja', 'queries.ts'),
  ]) {
    assert.doesNotMatch(leer(archivo), /conDetalle(EnLinea)?: true/, archivo)
  }
})

test('la pantalla y el cuadre impreso enseñan el resumen cuando el detalle está oculto', () => {
  assert.match(leer('src', 'components', 'caja', 'CobrosEnLineaDelDia.tsx'), /datos\.detalleOculto/)
  assert.match(leer('src', 'components', 'caja', 'ReporteDiaDialog.tsx'), /r\.enLinea\.detalleOculto/)
})
