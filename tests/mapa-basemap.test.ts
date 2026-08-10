import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ATRIBUCION_MAPA, OPCIONES_TESELAS, urlTeselas } from '../src/modules/geo/mapa/teselas'

/**
 * UN SOLO BASEMAP PARA LOS TRES MAPAS.
 *
 * El producto tiene tres: "Cerca de mí", el selector de ubicación del perfil de
 * empresa y el de confirmar vivienda. Llegaron a tener tres aspectos distintos
 * —CARTO en uno, OpenStreetMap crudo en los otros dos— sin que nadie lo
 * decidiera: cada uno se escribió en su momento con lo que había a mano.
 *
 * Es el mismo defecto que la Fase 18 saldó con los degradados de cabecera, y
 * se arregla igual: un sitio donde se define, y una prueba que impide volver a
 * escribirlo a mano.
 */

const COMPONENTES = [
  join('src', 'components', 'geo', 'MapaCercaDeMi.tsx'),
  join('src', 'components', 'geo', 'MapaConfirmarVivienda.tsx'),
  join('src', 'components', 'admin', 'MapaUbicacion.tsx'),
]

function archivosTsx(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next') continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) archivosTsx(p, acc)
    else if (p.endsWith('.tsx')) acc.push(p)
  }
  return acc
}

test('ningún componente escribe su propia URL de teselas', () => {
  const infractores: string[] = []
  for (const archivo of archivosTsx('src')) {
    const src = readFileSync(archivo, 'utf8')
    // La única URL de teselas permitida vive en `modules/geo/mapa/teselas.ts`.
    if (/tile\.openstreetmap\.org|basemaps\.cartocdn\.com/.test(src)) {
      infractores.push(archivo)
    }
  }
  assert.deepEqual(
    infractores,
    [],
    'Usa `urlTeselas()` de @/modules/geo/mapa/teselas:\n' + infractores.join('\n')
  )
})

test('los tres mapas consumen el basemap compartido', () => {
  for (const archivo of COMPONENTES) {
    const src = readFileSync(archivo, 'utf8')
    assert.ok(
      src.includes('urlTeselas') && src.includes('OPCIONES_TESELAS'),
      `${archivo} no usa el basemap compartido`
    )
  }
})

test('el basemap claro tiene color y el oscuro sigue siendo oscuro', () => {
  // Positron (`light_all`) dejaba el país como una mancha blanca en cuanto se
  // alejaba el zoom: un mapa sin agua azul no se lee como un mapa, se lee como
  // un error de carga. Voyager mantiene el fondo tranquilo pero con color.
  assert.match(urlTeselas(false), /rastertiles\/voyager/)
  assert.ok(!urlTeselas(false).includes('light_all'), 'el claro volvió a Positron')
  assert.match(urlTeselas(true), /dark_all/)
})

test('las teselas piden la versión de alta densidad', () => {
  // `{r}` lo resuelve Leaflet como `@2x`. Sin él, el mapa se ve borroso en
  // móvil, que es donde más se usa.
  for (const oscuro of [false, true]) {
    assert.ok(urlTeselas(oscuro).includes('{r}'), 'falta el marcador {r} de densidad')
  }
})

test('la atribución cita a OpenStreetMap y a CARTO', () => {
  // Son datos de OSM servidos por CARTO: citar a los dos es la licencia, no
  // una cortesía. Es el tipo de cosa que se cae en una refactorización y nadie
  // echa de menos hasta que llega un aviso.
  assert.match(ATRIBUCION_MAPA, /openstreetmap/i)
  assert.match(ATRIBUCION_MAPA, /carto/i)
  assert.equal(OPCIONES_TESELAS.attribution, ATRIBUCION_MAPA)
})
