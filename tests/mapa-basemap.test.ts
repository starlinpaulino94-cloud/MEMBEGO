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

test('el basemap no exige API key', () => {
  // CARTO empezó a servir las teselas sin key con la marca de agua "API KEY
  // REQUIRED" en agosto de 2026. OpenStreetMap no pide ninguna llave. Si alguien
  // devuelve aquí una URL de cartocdn o con `key=`, el mapa vuelve a salir
  // marcado para todos.
  for (const oscuro of [false, true]) {
    const url = urlTeselas(oscuro)
    assert.match(url, /^https:\/\/tile\.openstreetmap\.org\//)
    assert.ok(!/cartocdn|apiKey|key=/i.test(url), url)
  }
})

test('las teselas claras se oscurecen con el tema', () => {
  // OpenStreetMap no publica un estilo oscuro; sin esto, el mapa claro dentro
  // de la app en oscuro repite el destello que la Fase 5 quitó.
  assert.match(OPCIONES_TESELAS.className, /dark:invert/)
})

test('el marcador nunca se queda sin nada que enseñar', () => {
  // El logo va como `background-image`: si la URL está pero falla —un logo
  // borrado del almacenamiento, un dominio caído— no pinta y NO avisa. Antes
  // eran excluyentes (logo O inicial) y eso dejaba un disco vacío. Ahora la
  // inicial va siempre debajo, así que el fallo degrada a la letra del negocio.
  const src = readFileSync(join('src', 'components', 'geo', 'MapaCercaDeMi.tsx'), 'utf8')
  assert.match(
    src,
    /const interior = url\s*\?\s*`\$\{inicial\}/,
    'la inicial debe ir SIEMPRE debajo del logo, no como alternativa'
  )

  const css = readFileSync(join('src', 'app', 'globals.css'), 'utf8')
  const bloque = css.slice(css.indexOf('.mg-pin__logo {'), css.indexOf('}', css.indexOf('.mg-pin__logo {')))
  assert.ok(bloque.includes('z-index'), 'el logo debe pintarse por encima de la inicial')
})

test('la atribución cita a OpenStreetMap', () => {
  // Son datos de OSM: citarlos es la licencia, no una cortesía. CARTO ya no se
  // usa, así que no debe seguir apareciendo como si sirviera las teselas.
  assert.match(ATRIBUCION_MAPA, /openstreetmap/i)
  assert.ok(!/carto/i.test(ATRIBUCION_MAPA), 'CARTO ya no sirve las teselas')
  assert.equal(OPCIONES_TESELAS.attribution, ATRIBUCION_MAPA)
})
