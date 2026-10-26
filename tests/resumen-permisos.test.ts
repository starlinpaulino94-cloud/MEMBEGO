import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { funcionPermitida, seccionPermitida } from '../src/lib/auth/permissions'

/**
 * EL RESUMEN NO ES UN PANEL DE ADMINISTRADORES (auditoría admin · D-01 y D-07; reescrita en la fase 5).
 *
 * Es la primera pantalla de todo el que entra al panel: Marketing, Supervisor, un cajero. Pintaba «Ingresos del mes»,
 * botones y atajos como si todos fueran administradores. Reportes sí pedía `reportes › ver_financieros`; el Resumen, no.
 *
 * Estas son las guardias de CONTRATO sobre el código. El comportamiento por rol (qué bloque ve cada uno) lo prueban
 * `resumen-bloques.test.ts` y `resumen-panel.test.ts`.
 */

const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const pagina = sinComentarios(readFileSync('src/app/(admin)/admin/dashboard/page.tsx', 'utf8'))
const motor = sinComentarios(readFileSync('src/modules/admin/resumen/consultas.ts', 'utf8'))
const panel = sinComentarios(readFileSync('src/components/admin/resumen/ResumenPanel.tsx', 'utf8'))

test('Marketing no trae el permiso que pide el dinero; el administrador sí', () => {
  // Es la regla real de `usuarioPuedeFuncion`: rol, ajuste del empleado y negación de la función.
  assert.equal(funcionPermitida('MARKETING', 'reportes', 'ver_financieros', null), false)
  assert.equal(funcionPermitida('ADMINISTRADOR', 'reportes', 'ver_financieros', null), true)
  // Y un administrador al que se le NIEGA la función tampoco ve dinero.
  const negada = { v: 1 as const, funciones: { reportes: { ver_financieros: false } } }
  assert.equal(funcionPermitida('GERENTE', 'reportes', 'ver_financieros', negada), false)
})

test('el Resumen pide las dos funciones y se las pasa al motor, que no consulta dinero sin ellas', () => {
  assert.match(pagina, /usuarioPuedeFuncion\(user,\s*'reportes',\s*'ver_financieros'\)/)
  assert.match(pagina, /usuarioPuedeFuncion\(user,\s*'reportes',\s*'ver_empleados'\)/)
  assert.match(pagina, /getResumen\([^)]*\{\s*conFinanzas,\s*conEmpleados\s*\}/)

  // El parámetro es obligatorio: sin valor por defecto, nadie olvida decidir.
  assert.match(motor, /permisos:\s*\{\s*conFinanzas:\s*boolean;\s*conEmpleados:\s*boolean\s*\}/)
  assert.doesNotMatch(motor, /permisos\s*=\s*\{/)
  assert.doesNotMatch(motor, /permisos\?:/)

  // Las consultas de dinero cuelgan del permiso: el monto de las transferencias y los ingresos.
  assert.match(motor, /permisos\.conFinanzas\s*\n?\s*\? tx\.membership\s*\n?\s*\.aggregate\(\{ where: whereTransferencias/)
  assert.match(motor, /m\.has\('ingresos'\) && permisos\.conFinanzas/)
  // El desglose por persona exige `ver_empleados`.
  assert.match(motor, /bloques\.mostrador\.canjes && permisos\.conEmpleados/)
})

test('sin permiso de finanzas el bloque NO existe: no hay un hueco que diga «Sin permiso»', () => {
  assert.doesNotMatch(panel, /Sin permiso/)
  assert.doesNotMatch(motor, /ingresos:\s*null/)
})

test('el Resumen no usa ya el motor de 40 consultas ni calcula lo que no se pinta', () => {
  assert.doesNotMatch(pagina, /dashboardQueries|getDashboardEjecutivo/)
  // Lo que la fase 5 sacó del Resumen (decisión 1 del prototipo aprobado): ni se consulta ni se pinta.
  for (const fuera of ['seguidores del mes', 'referidosCompletados', 'actividadRaw', 'Estado en App Móvil', 'getHomePublicada']) {
    assert.ok(!motor.includes(fuera) && !pagina.includes(fuera) && !panel.includes(fuera), `«${fuera}» no debe volver al Resumen`)
  }
})

test('ningún enlace del Resumen es un literal suelto: todos pasan por `enlace(…)`, que mira `ve(href)`', () => {
  // Un `href="/admin/..."` escrito en el JSX se pintaría aunque la persona no pueda abrir la sección.
  assert.doesNotMatch(panel, /href="\/admin/)
  assert.match(panel, /const enlace = \(href: string\) => \(ve\(href\) \? href : undefined\)/)
})

test('un rol acotado no recibe atajos hacia lo que su menú no tiene', () => {
  for (const seccion of ['pagos', 'catalogo', 'scanner', 'pedidos-membego', 'inventario', 'citas', 'registros', 'actividad'] as const) {
    assert.equal(seccionPermitida('MARKETING', seccion, null), false, `MARKETING no debería abrir ${seccion}`)
  }
  for (const seccion of ['promociones', 'notificaciones', 'riesgo'] as const) {
    assert.equal(seccionPermitida('MARKETING', seccion, null), true, `MARKETING sí abre ${seccion}`)
  }
})
