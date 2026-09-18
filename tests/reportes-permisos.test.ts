/**
 * REPORTES · Fase 2 — permisos y filtros.
 *
 * Lo que vigila, y por qué cada una:
 *
 *  · Que las funciones del catálogo estén CABLEADAS. La regla de honestidad de
 *    `funciones.ts` lo dice: listar una función sin su guardia es un
 *    interruptor pintado — el panel diría «negado» y la acción pasaría igual.
 *  · Que el filtro financiero viva en la CONSULTA y no en el componente. La
 *    ruta de exportación usa la misma función que la pantalla, así que
 *    esconder una columna en la vista dejaría el dato saliendo por el archivo.
 *    Ese fallo no se ve: se descarga.
 *  · Que los rangos nuevos den los días correctos, con un reloj fijo.
 *
 * Ejecutar: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { leerRango, PRESETS, COMPARACIONES } from '../src/modules/reportes/rango'
import { FUNCIONES_POR_SECCION } from '../src/lib/auth/funciones'

const TZ = 'America/Santo_Domingo'
/** Miércoles 16 de septiembre de 2026, 15:00 en Santo Domingo. */
const RELOJ = new Date('2026-09-16T19:00:00Z')

function fuente(...ruta: string[]): string {
  return readFileSync(join(__dirname, '..', ...ruta), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function rango(params: Record<string, string>) {
  return leerRango(params, TZ, RELOJ)
}

/** Todos los .ts/.tsx bajo `src`, para comprobar que una función está cableada. */
function archivos(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) archivos(p, acc)
    else if (/\.tsx?$/.test(p)) acc.push(p)
  }
  return acc
}

const FUENTES = archivos(join(__dirname, '..', 'src'))

// ── Permisos ─────────────────────────────────────────────────────────────────

test('la sección de reportes declara sus funciones', () => {
  // `ver_empleados` entró con el reporte de operación, que es el primero que
  // desglosa por persona; `ver_datos_personales` con el de clientes, que es el
  // primero que pone nombres de personas en una tabla.
  const codigos = (FUNCIONES_POR_SECCION.reportes ?? []).map((f) => f.codigo)
  assert.deepEqual(codigos, [
    'ver',
    'ver_financieros',
    'ver_empleados',
    'ver_datos_personales',
    'exportar',
  ])
})

test('TODA función declarada existe cableada de verdad', () => {
  // La regla de honestidad del catálogo: listar una función sin su guardia es
  // un interruptor pintado —el panel diría «negado» y la acción pasaría igual—.
  //
  // Antes esto era una lista a mano de las dos que faltaban por cablear, y
  // había que acordarse de tacharlas al estrenarlas. Ahora se comprueba la
  // regla entera: cada código declarado tiene que aparecer en una guardia real
  // en alguna parte de `src`, así que una función nueva sin cablear falla sola.
  const codigos = (FUNCIONES_POR_SECCION.reportes ?? []).map((f) => f.codigo)
  const src = FUENTES.map((f) => readFileSync(f, 'utf8')).join('\n')
  const pintadas = codigos.filter(
    (c) => !new RegExp(`(requireSection|puedeFuncion)\\(\\s*'reportes',\\s*'${c}'`).test(src)
  )
  assert.deepEqual(
    pintadas,
    [],
    'estas funciones están en el catálogo y ninguna guardia las hace cumplir:\n' +
      pintadas.map((c) => `  · ${c}`).join('\n')
  )
})

test('ver_auditoria sigue fuera hasta que tenga su reporte', () => {
  // La otra mitad de la regla: no se lista lo que todavía no existe. Cuando
  // llegue su reporte, esta prueba se da la vuelta como se dio la de
  // `ver_datos_personales`.
  const codigos = (FUNCIONES_POR_SECCION.reportes ?? []).map((f) => f.codigo)
  assert.ok(!codigos.includes('ver_auditoria'), 'ver_auditoria no está cableada todavía')
})

test('la pantalla de reportes exige la función, no solo el rol', () => {
  const src = fuente('src', 'app', '(admin)', 'admin', 'reportes', 'page.tsx')
  assert.match(src, /requireSection\('reportes', 'ver'\)/)
})

test('exportar es su propio permiso', () => {
  // Ver una cifra en pantalla y llevársela en un archivo que sale de la
  // oficina no son la misma decisión.
  const src = fuente('src', 'app', '(admin)', 'admin', 'reportes', 'export', 'route.ts')
  assert.match(src, /requireSection\('reportes', 'exportar'\)/)
})

test('el filtro financiero se aplica en la consulta, en la pantalla Y en la exportación', () => {
  for (const ruta of [
    ['src', 'app', '(admin)', 'admin', 'reportes', 'page.tsx'],
    ['src', 'app', '(admin)', 'admin', 'reportes', 'export', 'route.ts'],
  ]) {
    const src = fuente(...ruta)
    assert.match(src, /puedeFuncion\('reportes', 'ver_financieros'\)/, ruta.join('/'))
    assert.match(src, /\{ verFinancieros \}/, ruta.join('/'))
  }
})

test('sin permiso, el dinero se omite en la consulta — no se tapa en la vista', () => {
  const src = fuente('src', 'modules', 'reportes', 'queries.ts')
  assert.match(src, /verFinancieros \? kpi\(/)
})

test('sin permiso no se pinta un cero', () => {
  // Un cero afirma que el negocio no facturó. Es una mentira sobre el negocio,
  // no una restricción sobre quien mira.
  const src = fuente('src', 'components', 'reportes', 'KpiReporte.tsx')
  assert.match(src, /Sin permiso/)
})

test('el CSV dice que oculta las cifras en vez de callarlo', () => {
  const src = fuente('src', 'modules', 'reportes', 'queries.ts')
  assert.match(src, /OCULTAS - sin permiso financiero/)
})

// ── Rangos nuevos ────────────────────────────────────────────────────────────

test('ayer es un solo día, el anterior a hoy', () => {
  const r = rango({ rango: 'ayer' })
  assert.equal(r.desdeDia, '2026-09-15')
  assert.equal(r.hastaDia, '2026-09-15')
  assert.equal(r.dias, 1)
})

test('la semana empieza en lunes', () => {
  // El 16 de septiembre de 2026 es miércoles: su lunes es el 14.
  const r = rango({ rango: 'semana' })
  assert.equal(r.desdeDia, '2026-09-14')
  assert.equal(r.hastaDia, '2026-09-16')
})

test('la semana pasada son sus siete días completos', () => {
  const r = rango({ rango: 'semana-pasada' })
  assert.equal(r.desdeDia, '2026-09-07')
  assert.equal(r.hastaDia, '2026-09-13')
  assert.equal(r.dias, 7)
})

test('el trimestre arranca en su primer mes', () => {
  // Septiembre cae en julio-agosto-septiembre.
  const r = rango({ rango: 'trimestre' })
  assert.equal(r.desdeDia, '2026-07-01')
  assert.equal(r.hastaDia, '2026-09-16')
})

test('el trimestre pasado va completo, de principio a fin', () => {
  const r = rango({ rango: 'trimestre-pasado' })
  assert.equal(r.desdeDia, '2026-04-01')
  assert.equal(r.hastaDia, '2026-06-30')
})

test('el año pasado son sus 365 días, no lo que va de año', () => {
  const r = rango({ rango: 'ano-pasado' })
  assert.equal(r.desdeDia, '2025-01-01')
  assert.equal(r.hastaDia, '2025-12-31')
})

test('los últimos 90 y 365 días incluyen hoy', () => {
  assert.equal(rango({ rango: '90d' }).dias, 90)
  assert.equal(rango({ rango: '365d' }).dias, 365)
  assert.equal(rango({ rango: '365d' }).hastaDia, '2026-09-16')
})

// ── Comparación ──────────────────────────────────────────────────────────────

test('por defecto se compara con el periodo inmediatamente anterior', () => {
  const r = rango({ rango: '7d' })
  assert.equal(r.comparacion, 'periodo')
  assert.equal(r.hastaDia, '2026-09-16')
  assert.equal(r.desdeDia, '2026-09-10')
  assert.equal(r.anterior.hastaDia, '2026-09-09')
  assert.equal(r.anterior.desdeDia, '2026-09-03')
})

test('comparar contra el año pasado mueve el tramo, no lo recorta', () => {
  // En un negocio con temporada, un diciembre comparado contra noviembre
  // siempre gana y no significa nada.
  const r = rango({ rango: 'mes', comparar: 'ano' })
  assert.equal(r.comparacion, 'ano')
  assert.equal(r.desdeDia, '2026-09-01')
  assert.equal(r.anterior.desdeDia, '2025-09-01')
  assert.equal(r.anterior.hastaDia, '2025-09-16')
})

test('el 29 de febrero no se convierte en 1 de marzo', () => {
  // `new Date` lo haría en silencio. Se corta al 28, que es el último día real
  // equivalente del año anterior.
  const r = leerRango(
    { desde: '2028-02-29', hasta: '2028-02-29', comparar: 'ano' },
    TZ,
    new Date('2028-03-01T12:00:00Z')
  )
  assert.equal(r.anterior.desdeDia, '2027-02-28')
  assert.equal(r.anterior.hastaDia, '2027-02-28')
})

test('una comparación inventada cae en la de por defecto', () => {
  assert.equal(rango({ rango: '7d', comparar: 'inventada' }).comparacion, 'periodo')
})

test('los catálogos no tienen claves repetidas', () => {
  const presets = PRESETS.map((p) => p.clave)
  const comparaciones = COMPARACIONES.map((c) => c.clave)
  assert.equal(new Set(presets).size, presets.length)
  assert.equal(new Set(comparaciones).size, comparaciones.length)
})
