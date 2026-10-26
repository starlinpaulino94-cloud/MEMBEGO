import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'

/**
 * LAS TRES LIBRERÍAS PESADAS NO ENTRAN POR DONDE NO DEBEN (docs/auditoria-admin/07 · FE-08, fase 4 · tarea 4.9).
 *
 * `recharts`, `leaflet` y `html5-qrcode` pesan cientos de kilobytes. El panel ya carga el mapa y el lector QR de forma
 * diferida (`import('leaflet')`), pero `recharts` entra ESTÁTICO en tres archivos que las vistas de Reportes importan sin
 * `next/dynamic`: cada reporte lo descarga aunque el usuario solo mire cifras. El JavaScript de una aplicación solo crece, y
 * nunca por una decisión: crece por cien importaciones pequeñas que nadie mide.
 *
 * LA REGLA: quién puede importarlas, y cómo, es una LISTA CERRADA, y la prueba la exige en los dos sentidos.
 *   · Un archivo NUEVO que las importa falla: hay que decidir (y pasar por esta lista, a la vista de la revisión).
 *   · Un archivo de la lista que YA NO las importa también falla: hay que quitarlo. Así la lista solo puede ENCOGERSE, igual
 *     que los techos de `deuda-diseno.test.ts`. La fase 5 (`ReporteChart.lazy.tsx`) vacía la de `recharts`.
 *
 * `import type` no cuenta (se borra al compilar) y tampoco las hojas de estilo `*.css` de `leaflet`.
 */

const RAIZ = join(import.meta.dirname, '..')

/** Importaciones ESTÁTICAS de valor: entran en el paquete de la página que las importe. */
const ESTATICAS: Record<string, readonly string[]> = {
  recharts: [
    'src/components/charts/ReporteChart.tsx',
    'src/components/reportes/graficos/GraficoDistribucion.tsx',
    'src/components/reportes/graficos/GraficoTendencia.tsx',
  ],
  leaflet: [],
  'html5-qrcode': [],
}

/** Importaciones DINÁMICAS (`import('…')`): se descargan cuando el componente las pide. */
const DINAMICAS: Record<string, readonly string[]> = {
  recharts: [],
  leaflet: [
    'src/components/admin/MapaUbicacion.tsx',
    'src/components/geo/MapaCercaDeMi.tsx',
    'src/components/geo/MapaConfirmarVivienda.tsx',
  ],
  'html5-qrcode': ['src/components/scanner/QRScanner.tsx'],
}

function archivos(dir: string): string[] {
  const acc: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) acc.push(...archivos(p))
    else if (/\.tsx?$/.test(p)) acc.push(p)
  }
  return acc
}
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const rel = (p: string) => p.slice(RAIZ.length + 1).split(sep).join('/')

const FUENTES = [...archivos(join(RAIZ, 'src')), ...archivos(join(RAIZ, 'packages/ui/src'))]
  .filter((p) => !/\.test\.tsx?$/.test(p))
  .map((p) => ({ ruta: rel(p), src: sinComentarios(readFileSync(p, 'utf8')) }))

/** `leaflet` incluye sus complementos (`leaflet.markercluster`). */
const nombre = (lib: string) => (lib === 'leaflet' ? 'leaflet(?:\\.[\\w-]+)?' : lib.replace(/[-/]/g, '\\$&'))

function quienImporta(lib: string, forma: 'estatica' | 'dinamica'): string[] {
  const re =
    forma === 'estatica'
      ? // `import x from 'lib'` / `import { a, b } from 'lib'`; sin `type`, sin hojas de estilo, sin cruzar sentencias.
        new RegExp(String.raw`\bimport\s+(?!type\b)[\w*{}\s,$]+?\s+from\s+['"]${nombre(lib)}(?:/[^'"]*)?['"]`)
      : new RegExp(String.raw`\bimport\(\s*['"]${nombre(lib)}(?:/[^'"]*)?['"]\s*\)`)
  return FUENTES.filter((f) => re.test(f.src)).map((f) => f.ruta).sort()
}

for (const lib of Object.keys(ESTATICAS)) {
  test(`${lib}: importaciones ESTÁTICAS solo en la lista cerrada (y la lista solo se encoge)`, () => {
    assert.deepEqual(
      quienImporta(lib, 'estatica'),
      [...ESTATICAS[lib]].sort(),
      `«${lib}» se importa de forma estática fuera de la lista (o un archivo de la lista ya no la importa). ` +
        'Cárgala con `next/dynamic` o con `import()`; si un archivo dejó de importarla, quítalo de ESTATICAS.'
    )
  })

  test(`${lib}: importaciones DINÁMICAS solo en la lista cerrada`, () => {
    assert.deepEqual(
      quienImporta(lib, 'dinamica'),
      [...DINAMICAS[lib]].sort(),
      `«${lib}» se carga con import() desde un archivo que no está en DINAMICAS (o uno de la lista ya no lo hace).`
    )
  })
}

test('la regla sabe distinguir: una importación de tipo no cuenta y una estática de valor sí', () => {
  const re = (s: string) => new RegExp(String.raw`\bimport\s+(?!type\b)[\w*{}\s,$]+?\s+from\s+['"]${nombre('leaflet')}(?:/[^'"]*)?['"]`).test(s)
  assert.equal(re(`import type { Map } from 'leaflet'`), false)
  assert.equal(re(`import L from 'leaflet'`), true)
  assert.equal(re(`import { map,\n  tileLayer } from 'leaflet'`), true)
  assert.equal(re(`import 'leaflet/dist/leaflet.css'`), false, 'la hoja de estilos no es código')
  assert.equal(re(`import a from './a'\nimport type { M } from 'leaflet'`), false, 'una sentencia no se «contagia» a la siguiente')
})
