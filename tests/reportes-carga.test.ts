import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * EL REPORTE MIENTRAS CARGA (rediseño de reportes · Fase 6).
 *
 * Había un `loading.tsx` en `/admin`, así que Reportes no salía en blanco:
 * caía en el genérico de seis tarjetas iguales. Ese genérico promete una forma
 * que no llega, y cuando aparece el reporte de verdad TODO se mueve de sitio —
 * un esqueleto que no calca la página no reduce la espera, la hace más brusca.
 *
 * Lo que estas pruebas vigilan:
 *
 *  1. Que TODA pantalla de reportes tenga el suyo. Una nueva sin `loading.tsx`
 *     vuelve al genérico sin que nada falle.
 *  2. Que las cifras del esqueleto CUADREN con la vista real. Si un reporte
 *     gana un KPI o un gráfico y el esqueleto se queda atrás, vuelve el salto
 *     que esto viene a quitar. Se comprueba contando el código, no de memoria:
 *     la primera vez que lo conté a ojo, fallé en cinco de nueve.
 *  3. Que el esqueleto se anuncie a un lector de pantalla en vez de ser un
 *     montón de cajas grises en silencio.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

const RUTAS = join(raiz, 'src', 'app', '(admin)', 'admin', 'reportes')
const VISTAS = join(raiz, 'src', 'components', 'reportes')
const ESQUELETO = 'src/components/reportes/EsqueletoReporte.tsx'

/** Cada carpeta con `page.tsx` bajo `/admin/reportes` (menos las de export). */
function pantallas(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (!statSync(p).isDirectory()) continue
    if (e === 'export') continue
    if (existsSync(join(p, 'page.tsx'))) acc.push(p)
    pantallas(p, acc)
  }
  return acc
}

const cuantos = (src: string, aguja: string) => src.split(aguja).length - 1

test('todas las pantallas de reportes tienen su propio esqueleto', () => {
  const sinEsqueleto = [join(RUTAS), ...pantallas(RUTAS)].filter(
    (p) => !existsSync(join(p, 'loading.tsx'))
  )
  assert.deepEqual(
    sinEsqueleto.map((p) => p.replace(raiz + '/', '')),
    [],
    'estas pantallas caerían en el esqueleto genérico de /admin, que no se parece a un reporte'
  )
})

test('el esqueleto de cada reporte cuadra con las cifras de su vista', () => {
  // Contar el código y no fiarse de la memoria: la primera versión de estos
  // números falló en cinco de nueve pantallas.
  const pares: [string, string][] = [
    ['', 'Empresa'],
    ['finanzas', 'Finanzas'],
    ['membresias', 'Membresias'],
    ['clientes', 'Clientes'],
    ['operacion', 'Operacion'],
    ['citas', 'Citas'],
    ['crecimiento', 'Crecimiento'],
    ['promociones', 'Promociones'],
    ['regalos', 'Regalos'],
  ]
  for (const [ruta, vista] of pares) {
    const loading = readFileSync(join(RUTAS, ruta, 'loading.tsx'), 'utf8')
    const src = readFileSync(join(VISTAS, `Reporte${vista}Vista.tsx`), 'utf8')

    const kpisVista = cuantos(src, '<KpiReporte')
    const panelesVista = cuantos(src, '<PanelGrafico')
    const kpisEsq = Number(loading.match(/kpis=\{(\d+)\}/)?.[1])
    const panelesEsq = Number(loading.match(/paneles=\{(\d+)\}/)?.[1])

    assert.equal(
      kpisEsq,
      kpisVista,
      `${ruta || 'índice'}: el esqueleto pinta ${kpisEsq} cifras y la vista tiene ${kpisVista}`
    )
    assert.equal(
      panelesEsq,
      panelesVista,
      `${ruta || 'índice'}: el esqueleto pinta ${panelesEsq} gráficos y la vista tiene ${panelesVista}`
    )
  }
})

test('las pantallas de detalle usan el esqueleto de detalle, no el del resumen', () => {
  // Un detalle son pestañas y una tabla larga: prometer una fila de cifras que
  // nunca llega es el mismo error, al revés.
  for (const d of ['operacion/detalle', 'finanzas/detalle', 'membresias/detalle', 'citas/detalle']) {
    const loading = readFileSync(join(RUTAS, d, 'loading.tsx'), 'utf8')
    assert.match(loading, /EsqueletoDetalleReporte/, `${d} usa el esqueleto equivocado`)
  }
})

test('el esqueleto se anuncia a quien no lo ve', () => {
  const src = leer(ESQUELETO)
  assert.match(src, /role="status"/)
  assert.match(src, /aria-busy="true"/)
  assert.match(src, /sr-only">Cargando/, 'sin texto, un lector de pantalla solo oye silencio')
})

test('el esqueleto no consulta nada: es una pantalla muerta a propósito', () => {
  // Un `loading.tsx` que llamara a la base retrasaría justo lo que viene a
  // tapar, y se ejecutaría además de la consulta real.
  const src = leer(ESQUELETO)
  assert.ok(!/prisma|conEmpresa|await/.test(src), 'el esqueleto no puede tocar la base')
  for (const d of readdirSync(RUTAS)) {
    const f = join(RUTAS, d, 'loading.tsx')
    if (!existsSync(f)) continue
    assert.ok(
      !/await|prisma/.test(readFileSync(f, 'utf8')),
      `${d}/loading.tsx hace trabajo; debe ser solo el esqueleto`
    )
  }
})
