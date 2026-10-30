/**
 * Tutoriales en video: el catálogo es coherente con el panel y la búsqueda encuentra lo que la gente escribe.
 *
 * Lo que se comprueba:
 * - Cada tutorial tiene un id único y al menos una ruta; toda ruta `/admin/...` resuelve a una sección conocida
 *   (si no, «¿Cómo se hace?» ofrecería videos de pantallas que no existen o cambiaron de sitio).
 * - La búsqueda ignora acentos y mayúsculas y pone primero lo que coincide con el título.
 * - Por ruta se devuelven los tutoriales de esa pantalla, primero los más específicos, ignorando la consulta.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buscarTutoriales,
  duracionLegible,
  tutorialesDeRuta,
  TUTORIALES,
  urlCartel,
  urlVideo,
} from '../src/modules/tutoriales/catalogo'
import { adminSectionForPath } from '../src/lib/auth/permissions'

test('el catálogo tiene ids únicos, rutas y duración en cada tutorial', () => {
  assert.ok(TUTORIALES.length >= 100, 'hay un tutorial por tarea del panel')
  const ids = new Set(TUTORIALES.map((t) => t.id))
  assert.equal(ids.size, TUTORIALES.length, 'ids repetidos')
  for (const t of TUTORIALES) {
    assert.match(t.id, /^[a-z0-9-]+$/, `${t.id}: el id es el nombre del archivo`)
    assert.ok(t.rutas.length > 0, `${t.id}: sin rutas`)
    assert.ok(t.duracionS > 3 && t.duracionS < 180, `${t.id}: duración rara (${t.duracionS} s)`)
    assert.ok(t.texto.length > 20, `${t.id}: sin texto de la voz`)
  }
})

test('toda ruta /admin de un tutorial resuelve a una sección del panel', () => {
  const sueltas = TUTORIALES.flatMap((t) =>
    t.rutas.filter((r) => r.startsWith('/admin/') && adminSectionForPath(r) === null).map((r) => `${t.id} → ${r}`)
  )
  assert.deepEqual(sueltas, [], 'rutas que no son de ninguna sección conocida')
})

test('la búsqueda ignora acentos y pone primero la coincidencia del título', () => {
  const r = buscarTutoriales('CREAR PROMOCION')
  assert.equal(r[0]?.id, 'beneficios-crear')
  assert.equal(buscarTutoriales('   ').length, TUTORIALES.length, 'sin consulta, todo')
  assert.deepEqual(buscarTutoriales('zzzzzz'), [])
  // Cada palabra tiene que aparecer: «validar transferencia» no trae los tutoriales de citas.
  const v = buscarTutoriales('validar transferencia')
  assert.ok(v.length > 0 && v.every((t) => t.modulo === 'Pagos' || t.modulo === 'Resumen'), v.map((t) => t.id).join(','))
})

test('por ruta: los de la pantalla, primero los más específicos, sin la consulta', () => {
  const conteos = tutorialesDeRuta('/admin/inventario/conteos?x=1')
  assert.equal(conteos[0]?.id, 'inventario-conteos')
  assert.ok(conteos.every((t) => t.modulo === 'Inventario'))
  const ofertas = tutorialesDeRuta('/admin/ofertas')
  assert.ok(ofertas.some((t) => t.id === 'beneficios-crear'))
  assert.deepEqual(tutorialesDeRuta('/admin/integraciones'), [], 'Integraciones no tiene tutoriales')
  assert.equal(tutorialesDeRuta('/empleado/caja')[0]?.id, 'caja-abrir')
})

test('direcciones públicas en Storage y duración legible', () => {
  assert.equal(urlVideo('planes', 'https://x.supabase.co/'), 'https://x.supabase.co/storage/v1/object/public/tutoriales/empresa/planes.mp4')
  assert.equal(urlCartel('planes', 'https://x.supabase.co'), 'https://x.supabase.co/storage/v1/object/public/tutoriales/empresa/planes.jpg')
  assert.equal(duracionLegible(45), '0:45')
  assert.equal(duracionLegible(92), '1:32')
})
