import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  leerFiltroGlobal,
  paramsDeFiltroGlobal,
  ordenarEmpresas,
  totalPorMoneda,
  hayVariasMonedas,
  ORDEN_POR_DEFECTO,
  type FilaEmpresa,
} from '../src/modules/reportes/filtrosGlobales'
import { calcularInsights } from '../src/modules/reportes/insights'
import { armarCsv, armarCsvBloques, SEPARADOR_CSV } from '../src/lib/csv'

/**
 * REPORTES — lo que no puede volver a romperse.
 *
 * El motor viejo daba cifras que no se podían defender: el total y el desglose
 * fechaban los cobros con reglas distintas, «por vencer» era el largo de una
 * lista recortada, las empresas de práctica entraban en los totales de la
 * plataforma y el mes se cortaba en la zona horaria del servidor. Nada de eso
 * fallaba ruidosamente: se veía como un número.
 */

const leer = (...p: string[]) => readFileSync(join(...p), 'utf8')

/** Los comentarios CITAN el código viejo para explicar el fallo corregido. */
const sinComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:\/\/|\*).*$/gm, '')

const GLOBALES = leer('src', 'modules', 'reportes', 'globales.ts')
const PAGINA = leer('src', 'app', '(superadmin)', 'superadmin', 'reportes', 'page.tsx')
const IMPRIMIBLE = leer('packages', 'ui', 'src', 'ui', 'reporte-imprimible.tsx')

const fila = (p: Partial<FilaEmpresa> & { nombre: string }): FilaEmpresa => ({
  companyId: p.nombre,
  moneda: 'DOP',
  esDemo: false,
  ingresos: 0,
  activas: 0,
  usos: 0,
  porVencer: 0,
  ...p,
})

// ───────────── M118 · las empresas de práctica, fuera ─────────────

test('por defecto las empresas de práctica no cuentan', () => {
  // El Resumen ya las excluía. Reportes no, así que dos pantallas contiguas
  // daban dos ingresos distintos del mismo periodo.
  const f = leerFiltroGlobal({})
  assert.equal(f.incluirDemo, false)
  const filas = [fila({ nombre: 'Real', ingresos: 100 }), fila({ nombre: 'Práctica', esDemo: true, ingresos: 900 })]
  assert.deepEqual(ordenarEmpresas(filas, f).map((e) => e.nombre), ['Real'])
})

test('pero se pueden incluir a propósito', () => {
  // Durante un entrenamiento hace falta ver que los números se mueven; lo que
  // no puede pasar es que se mezclen sin decirlo.
  const f = leerFiltroGlobal({ demo: '1' })
  assert.equal(f.incluirDemo, true)
  const filas = [fila({ nombre: 'Real' }), fila({ nombre: 'Práctica', esDemo: true })]
  assert.equal(ordenarEmpresas(filas, f).length, 2)
})

// ───────────── M135 · buscar y ordenar ─────────────

test('el orden por defecto es por ingresos, de mayor a menor', () => {
  assert.equal(ORDEN_POR_DEFECTO, 'ingresos')
  const filas = [
    fila({ nombre: 'B', ingresos: 100 }),
    fila({ nombre: 'A', ingresos: 500 }),
    fila({ nombre: 'C', ingresos: 300 }),
  ]
  assert.deepEqual(
    ordenarEmpresas(filas, leerFiltroGlobal({})).map((e) => e.nombre),
    ['A', 'C', 'B']
  )
})

test('a igualdad de cifra, manda el nombre', () => {
  // Sin desempate, el orden cambia entre recargas y la lista «baila».
  const filas = [fila({ nombre: 'Zeta' }), fila({ nombre: 'Alfa' }), fila({ nombre: 'Mika' })]
  assert.deepEqual(
    ordenarEmpresas(filas, leerFiltroGlobal({})).map((e) => e.nombre),
    ['Alfa', 'Mika', 'Zeta']
  )
})

test('la búsqueda no distingue mayúsculas ni exige el nombre entero', () => {
  const filas = [fila({ nombre: 'Car Wash Bella Vista' }), fila({ nombre: 'Barbería El Corte' })]
  assert.deepEqual(
    ordenarEmpresas(filas, leerFiltroGlobal({ q: 'BELLA' })).map((e) => e.nombre),
    ['Car Wash Bella Vista']
  )
})

test('un orden inventado en la URL no rompe el reporte', () => {
  assert.equal(leerFiltroGlobal({ orden: 'lo-que-sea' }).orden, ORDEN_POR_DEFECTO)
})

test('la URL queda limpia con los valores por defecto', () => {
  assert.equal(paramsDeFiltroGlobal(leerFiltroGlobal({})).toString(), '')
  assert.equal(
    paramsDeFiltroGlobal(leerFiltroGlobal({ q: 'bella', demo: '1', orden: 'usos' })).toString(),
    'q=bella&demo=1&orden=usos'
  )
})

// ───────────── M123 · las monedas no se suman entre sí ─────────────

test('los ingresos se agrupan por moneda', () => {
  const filas = [
    fila({ nombre: 'A', moneda: 'DOP', ingresos: 100 }),
    fila({ nombre: 'B', moneda: 'USD', ingresos: 50 }),
    fila({ nombre: 'C', moneda: 'DOP', ingresos: 300 }),
  ]
  assert.deepEqual(totalPorMoneda(filas), [
    { moneda: 'DOP', total: 400 },
    { moneda: 'USD', total: 50 },
  ])
  assert.equal(hayVariasMonedas(filas), true)
})

test('una moneda sin cobros no convierte el reporte en multimoneda', () => {
  // Una empresa registrada en USD que aún no ha cobrado nada no obliga a
  // partir el total ni a enseñar un aviso.
  const filas = [
    fila({ nombre: 'A', moneda: 'DOP', ingresos: 400 }),
    fila({ nombre: 'B', moneda: 'USD', ingresos: 0 }),
  ]
  assert.equal(hayVariasMonedas(filas), false)
})

// ───────────── M116, M117, M119, M121, M122 · el motor ─────────────

test('los ingresos por empresa usan la MISMA regla que todo lo demás', () => {
  // El desglose fechaba por `updatedAt` y el total por `fechaPago`: las
  // columnas no sumaban al total, y editar una membresía vieja la movía de mes
  // solo en una de las dos.
  const src = sinComentarios(GLOBALES)
  assert.match(src, /whereCobrado\(rango\.desde, rango\.hasta, soloVisibles\)/)
  assert.ok(
    !/updatedAt/.test(src),
    'el fechado de cobros no puede volver a salir de `updatedAt`'
  )
})

test('«por vencer» se CUENTA, no se mide el largo de una lista', () => {
  // Era el `.length` de un `findMany` con `take: 100`: con 400 por vencer, la
  // tarjeta decía 100.
  const src = sinComentarios(GLOBALES)
  const bloque = src.slice(src.indexOf('fechaVencimiento: { gte: ahora'))
  assert.match(bloque.slice(0, 200), /_count: \{ _all: true \}/)
  assert.ok(
    !/take: \d+/.test(src),
    'ninguna cifra del reporte puede salir de una consulta recortada'
  )
})

test('el corte del periodo no usa la zona horaria del servidor', () => {
  // `new Date(año, mes, 1)` es medianoche del servidor, que en el despliegue es
  // UTC: un cobro del día 31 a las 9 de la noche caía en el mes siguiente.
  for (const [nombre, src] of [
    ['el motor', GLOBALES],
    ['la pantalla', PAGINA],
  ] as const) {
    assert.ok(
      !/new Date\(\s*\w+\.getFullYear\(\)/.test(sinComentarios(src)),
      `${nombre} vuelve a cortar el mes con el reloj del servidor`
    )
  }
  assert.match(sinComentarios(PAGINA), /leerRango\(sp, TZ_PLATAFORMA\)/)
})

test('un fallo de consulta se dice, no se enseña como cero', () => {
  const src = sinComentarios(GLOBALES)
  assert.match(src, /incompleto: fallos\.n > 0/)
  assert.match(sinComentarios(PAGINA), /r\.incompleto &&/)
})

test('todo el reporte va en UNA transacción', () => {
  // Abría seis a la vez: cinco `sinEmpresa` dentro de un `Promise.all` más la
  // de `getReportesAdmin`. Seis conexiones del pool retenidas en paralelo.
  const veces = [...sinComentarios(GLOBALES).matchAll(/sinEmpresa\(/g)].length
  assert.equal(veces, 1, `el motor abre ${veces} transacciones; con una basta`)
})

test('el alcance se decide una vez y lo heredan todas las agregaciones', () => {
  // Si cada consulta eligiera por su cuenta qué empresas cuentan, el total y el
  // desglose podrían volver a discrepar.
  const src = sinComentarios(GLOBALES)
  assert.match(src, /const soloVisibles = \{ companyId: \{ in: ids \} \}/)
  const usos = [...src.matchAll(/soloVisibles/g)].length
  assert.ok(usos >= 6, `solo ${usos} consultas heredan el alcance; deberían ser todas`)
})

test('el motor viejo se retiró, no se dejó «por si acaso»', () => {
  const admin = leer('src', 'modules', 'admin', 'queries.ts')
  for (const muerto of ['getReportesGlobales', 'getReportesAdmin', 'membresiasPorVencerQuery']) {
    assert.ok(!sinComentarios(admin).includes(muerto), `${muerto} sigue vivo y alguien lo llamará`)
  }
})

// ───────────── M124 · nada que se calcule y no se enseñe ─────────────

test('no se consultan clientes frecuentes que nadie pinta', () => {
  assert.ok(!sinComentarios(GLOBALES).includes('clientesFrecuentes'))
})

// ───────────── M133 · un solo dialecto de CSV ─────────────

test('el separador es el punto y coma, en todas partes', () => {
  // Excel en español espera `;`. Con `,` deja las diecinueve columnas en la
  // primera. Había dos dialectos conviviendo.
  assert.equal(SEPARADOR_CSV, ';')
  assert.equal(armarCsv(['A', 'B'], [[1, 2]]), '﻿A;B\n1;2')
})

test('un valor con punto y coma no parte la fila', () => {
  // El riesgo es real: los nombres de empresa y los asuntos de ticket los
  // escriben personas.
  assert.equal(armarCsv(['A'], [['x;y']]), '﻿A\n"x;y"')
  assert.equal(armarCsv(['A'], [['di "hola"']]), '﻿A\n"di ""hola"""')
})

test('el BOM va una sola vez, aunque haya varios bloques', () => {
  // Un BOM en medio del archivo aparece como basura en la celda.
  const csv = armarCsvBloques([
    { titulo: 'Uno', encabezados: ['A'], filas: [[1]] },
    { titulo: 'Dos', encabezados: ['B'], filas: [[2]] },
  ])
  assert.equal([...csv].filter((c) => c === '﻿').length, 1)
  assert.match(csv, /^﻿Uno\nA\n1\n\nDos\nB\n2$/)
})

/** Todos los `.ts`/`.tsx` de una carpeta. */
function fuentes(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada)
    if (statSync(ruta).isDirectory()) fuentes(ruta, acc)
    else if (/\.tsx?$/.test(ruta) && !ruta.endsWith('.d.ts')) acc.push(ruta)
  }
  return acc
}

test('ninguna exportación arma su CSV a mano', () => {
  /**
   * Cada módulo que se escribía su propio `esc` y su propio `join` era un
   * dialecto más. `armarCsv` es la única puerta: escapa igual para todos y une
   * con el mismo separador.
   */
  const infractores = fuentes(join('src', 'modules'))
    .filter((f) => /csv|export|reporte|registros|auditoria|retencion/i.test(f))
    .filter((f) => {
      const src = sinComentarios(readFileSync(f, 'utf8'))
      return /\.join\(['"][,;]['"]\)/.test(src)
    })
    .map((f) => f.replaceAll('\\', '/'))

  assert.deepEqual(
    infractores,
    [],
    'usa `armarCsv`/`armarCsvBloques` de `@/lib/csv`:\n' + infractores.join('\n')
  )
})

// ───────────── M125 · un solo @media print ─────────────

test('el bloque de impresión está escrito una sola vez', () => {
  const copias = fuentes('src')
    .filter((f) => /@media print/.test(sinComentarios(readFileSync(f, 'utf8'))))
    // Los tickets de 80 mm son otra cosa: papel de rollo continuo con su ancho
    // y su lógica de reimpresión, no un reporte A4 con cabecera y tablas.
    .filter((f) => !/scanner|caja|facturas|ofertas/i.test(f))
    .map((f) => f.replaceAll('\\', '/'))

  assert.deepEqual(
    copias,
    [],
    'usa `ReporteImprimible` (@/components/ui/reporte-imprimible):\n' + copias.join('\n')
  )
})

test('en papel manda el papel, no el tema', () => {
  // Si la región heredara las variables del tema, quien tenga el panel en
  // oscuro imprimiría texto casi blanco sobre una hoja blanca. Se comprueba la
  // REGLA DEL CONTENEDOR, no que el hexadecimal aparezca en algún sitio.
  const regla = IMPRIMIBLE.slice(
    IMPRIMIBLE.indexOf('display: block !important'),
    IMPRIMIBLE.indexOf('.print\\\\:hidden')
  )
  assert.match(regla, /color: #000 !important/)
  assert.match(regla, /background: #fff !important/)
  assert.ok(!/var\(--/.test(regla), 'el color del papel no puede salir del tema')
})

test('los controles no salen en la hoja', () => {
  assert.match(IMPRIMIBLE, /\.print\\\\:hidden/)
  assert.match(IMPRIMIBLE, /className="print:hidden flex shrink-0/)
})

test('la hoja dice siempre cuándo se generó', () => {
  // Una hoja impresa sobrevive al dato que la produjo: sin fecha no hay forma
  // de saber si la que está sobre la mesa es de esta semana o del trimestre
  // pasado.
  assert.match(IMPRIMIBLE, /Generado el \{generadoEn\}/)
  for (const pantalla of [
    join('src', 'app', '(superadmin)', 'superadmin', 'reportes', 'page.tsx'),
    join('src', 'components', 'reportes', 'ReporteEmpresaVista.tsx'),
    join('src', 'app', '(admin)', 'admin', 'retencion', 'page.tsx'),
    join('src', 'app', '(admin)', 'admin', 'riesgo', 'page.tsx'),
    join('src', 'app', '(admin)', 'admin', 'app', 'carwash', 'reportes', 'page.tsx'),
  ]) {
    assert.match(readFileSync(pantalla, 'utf8'), /generadoEn=/, `${pantalla} no fecha la hoja`)
  }
})

// ───────────── M126-M132 · todo reporte se exporta y se imprime ─────────────

test('las pantallas de reportes tienen las dos salidas', () => {
  const CON_AMBAS: [string, string][] = [
    ['reportes de plataforma', join('src', 'app', '(superadmin)', 'superadmin', 'reportes', 'page.tsx')],
    ['reporte de empresa', join('src', 'components', 'reportes', 'ReporteEmpresaVista.tsx')],
    ['reporte de una empresa (superadmin)', join('src', 'app', '(superadmin)', 'superadmin', 'reportes', '[id]', 'page.tsx')],
    ['reportes operativos', join('src', 'app', '(admin)', 'admin', 'app', 'carwash', 'reportes', 'page.tsx')],
    ['retención', join('src', 'app', '(admin)', 'admin', 'retencion', 'page.tsx')],
    ['riesgo', join('src', 'app', '(admin)', 'admin', 'riesgo', 'page.tsx')],
    ['registros', join('src', 'app', '(admin)', 'admin', 'registros', 'page.tsx')],
  ]
  for (const [nombre, ruta] of CON_AMBAS) {
    const src = readFileSync(ruta, 'utf8')
    assert.match(src, /BotonImprimir|ReporteEmpresaVista/, `${nombre} no se puede imprimir`)
    assert.match(src, /export|Exportar|ReporteEmpresaVista/, `${nombre} no se puede exportar`)
  }
})

test('cada exportación tiene su ruta de servidor', () => {
  // En el navegador solo está la página que se está viendo: exportar ahí
  // descarga un trozo y no lo dice.
  for (const ruta of [
    join('src', 'app', '(superadmin)', 'superadmin', 'reportes', 'exportar', 'route.ts'),
    join('src', 'app', '(superadmin)', 'superadmin', 'reportes', '[id]', 'exportar', 'route.ts'),
    join('src', 'app', '(superadmin)', 'superadmin', 'auditoria', 'exportar', 'route.ts'),
    join('src', 'app', '(admin)', 'admin', 'reportes', 'export', 'route.ts'),
    join('src', 'app', '(admin)', 'admin', 'retencion', 'export', 'route.ts'),
  ]) {
    assert.ok(readFileSync(ruta, 'utf8').includes('export async function GET'), `falta ${ruta}`)
  }
})

test('la exportación usa el MISMO periodo y alcance que la pantalla', () => {
  // Un export que exporta otro corte que la vista es la forma más silenciosa de
  // dar un dato equivocado: el archivo no dice de qué es.
  const ruta = leer('src', 'app', '(superadmin)', 'superadmin', 'reportes', 'exportar', 'route.ts')
  assert.match(ruta, /leerRango\(sp, TZ_PLATAFORMA\)/)
  assert.match(ruta, /leerFiltroGlobal\(sp\)/)
})

test('el CSV del reporte de plataforma escribe su propio alcance', () => {
  const csv = leer('src', 'modules', 'reportes', 'csvGlobal.ts')
  assert.match(csv, /Empresas de practica/)
  assert.match(csv, /Datos completos/)
})

// ───────────── M134 · la gráfica también en papel ─────────────

test('la gráfica tiene una tabla equivalente para la hoja', () => {
  // `ResponsiveContainer` mide el contenedor al pintar; en `@media print` sale
  // en blanco. Y de paso la tabla es la alternativa textual que la gráfica no
  // tenía para un lector de pantalla.
  const vista = leer('src', 'components', 'reportes', 'ReporteEmpresaVista.tsx')
  assert.match(vista, /<div className="print:hidden">\s*<ReporteChart/)
  assert.match(vista, /<div className="hidden print:block">/)
})

// ───────────── Insights ─────────────

const base = {
  ingresosCaja: { variacion: null as number | null },
  clientesNuevos: { variacion: null as number | null },
  operaciones: { valor: 0 },
  entregas: { valor: 0 },
}

test('sin nada que decir, no se dice nada', () => {
  // Un insight que siempre está encendido es decoración, y la decoración en un
  // sitio donde se toman decisiones enseña a ignorar la sección entera.
  assert.deepEqual(calcularInsights(base), [])
  assert.deepEqual(calcularInsights({ ...base, ingresosCaja: { variacion: 4 } }), [])
})

test('una caída fuerte de ingresos sí se nombra, y como mala', () => {
  const [i] = calcularInsights({ ...base, ingresosCaja: { variacion: -25 } })
  assert.equal(i.tono, 'malo')
  assert.match(i.texto, /bajaron 25%/)
})

test('el porcentaje de entregas necesita una base mínima', () => {
  // Con tres operaciones, «100 % fueron entregas» no significa nada.
  assert.deepEqual(calcularInsights({ ...base, operaciones: { valor: 0 }, entregas: { valor: 3 } }), [])
  const salida = calcularInsights({ ...base, operaciones: { valor: 2 }, entregas: { valor: 18 } })
  assert.equal(salida.length, 1)
  assert.equal(salida[0].tono, 'neutro')
  assert.match(salida[0].texto, /90% de las operaciones/)
})
