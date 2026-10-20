import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { adminSectionForPath, funcionPermitida, seccionPermitida } from '../src/lib/auth/permissions'

/**
 * EL RESUMEN NO ES UN PANEL DE ADMINISTRADORES (auditoría admin · D-01 y D-07).
 *
 * Es la primera pantalla de todo el que entra al panel: Marketing, Supervisor,
 * un cajero. Pintaba «Ingresos del mes», «Recurrente esperado», botones y
 * atajos como si todos fueran administradores. Reportes sí pedía
 * `reportes › ver_financieros`; el Resumen, no.
 */

const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const pagina = sinComentarios(readFileSync('src/app/(admin)/admin/dashboard/page.tsx', 'utf8'))
const motor = sinComentarios(readFileSync('src/modules/admin/dashboardQueries.ts', 'utf8'))

test('Marketing no trae el permiso que pide el dinero; el administrador sí', () => {
  // Es la regla real de `usuarioPuedeFuncion`: rol, ajuste del empleado y negación de la función.
  assert.equal(funcionPermitida('MARKETING', 'reportes', 'ver_financieros', null), false)
  assert.equal(funcionPermitida('ADMINISTRADOR', 'reportes', 'ver_financieros', null), true)
  // Y un administrador al que se le NIEGA la función tampoco ve dinero.
  const negada = { v: 1 as const, funciones: { reportes: { ver_financieros: false } } }
  assert.equal(funcionPermitida('GERENTE', 'reportes', 'ver_financieros', negada), false)
})

test('el Resumen pide ver_financieros y se lo pasa al motor, que no calcula dinero sin él', () => {
  assert.match(pagina, /usuarioPuedeFuncion\(user,\s*'reportes',\s*'ver_financieros'\)/)
  assert.match(pagina, /getDashboardEjecutivo\([^)]*\{\s*conFinanzas,\s*conPagos\s*\}/)

  // El parámetro es obligatorio: sin valor por defecto, nadie olvida decidir.
  assert.match(motor, /permisos:\s*\{\s*conFinanzas:\s*boolean/)
  assert.doesNotMatch(motor, /permisos\s*=\s*\{/)
  assert.doesNotMatch(motor, /permisos\?:/)

  // Las cinco cifras de dinero son `null` sin permiso y las consultas ni se lanzan.
  for (const campo of ['ingresosCobradosMes', 'recurrenteEsperado', 'ingresosMesAnterior', 'transferenciasMonto']) {
    assert.match(motor, new RegExp(`${campo}:\\s*number\\s*\\|\\s*null`), `${campo} debe poder ser null`)
  }
  assert.ok((motor.match(/permisos\.conFinanzas/g) ?? []).length >= 5, 'cada consulta de dinero cuelga de conFinanzas')
})

test('sin permiso de finanzas el Resumen escribe «Sin permiso», no una cifra', () => {
  assert.match(pagina, /d\.ingresosCobradosMes\s*!==\s*null/)
  assert.match(pagina, /valor="Sin permiso"/)
  // Ninguna cifra de dinero se formatea sin pasar por esa rama o por conFinanzas.
  assert.match(pagina, /conFinanzas\s*\?\s*\(\s*<div[^>]*>\s*<dt[^>]*>Ventas Membego del mes/)
})

test('cada sección a la que el Resumen enlaza pasa por la visibilidad de atajos', () => {
  const enlazadas = new Set<string>()
  for (const m of pagina.matchAll(/href=(?:\{`|["'])\/admin\/([a-z-]+)/g)) {
    const seccion = adminSectionForPath(`/admin/${m[1]}`)
    if (seccion && seccion !== 'dashboard') enlazadas.add(seccion)
  }
  const resueltas = new Set<string>()
  for (const m of pagina.matchAll(/ve\(\s*['"`]\/admin\/([a-z-]+)/g)) {
    const seccion = adminSectionForPath(`/admin/${m[1]}`)
    if (seccion) resueltas.add(seccion)
  }
  assert.ok(enlazadas.size >= 8, 'esperaba los atajos conocidos del Resumen')
  const sinGuardia = [...enlazadas].filter((s) => !resueltas.has(s))
  assert.deepEqual(sinGuardia, [], `secciones enlazadas sin comprobar si se pueden abrir: ${sinGuardia.join(', ')}`)
})

test('un rol acotado no recibe atajos hacia lo que su menú no tiene', () => {
  // Lo que antes se pintaba a Marketing aunque su menú no lo incluyera.
  for (const seccion of ['pagos', 'catalogo', 'scanner', 'pedidos-membego', 'inventario', 'citas', 'registros', 'actividad'] as const) {
    assert.equal(seccionPermitida('MARKETING', seccion, null), false, `MARKETING no debería abrir ${seccion}`)
  }
  // Y sí las suyas.
  for (const seccion of ['promociones', 'notificaciones', 'riesgo'] as const) {
    assert.equal(seccionPermitida('MARKETING', seccion, null), true, `MARKETING sí abre ${seccion}`)
  }
})
