import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { etiquetaDia } from '../src/modules/citas/disponibilidad'

/**
 * `etiquetaDia` NO puede tumbar la agenda.
 *
 * EL BUG: la agenda del admin (`/admin/citas`) llamaba
 * `etiquetaDia(ymd, idioma, tz)` con los dos últimos argumentos INTERCAMBIADOS
 * —la firma es `(ymd, timeZone, idioma)`—, así que pasaba el idioma («es-DO»)
 * como zona horaria. `Intl.DateTimeFormat({ timeZone: 'es-DO' })` lanza
 * `RangeError: Invalid time zone`, y como esto corre dentro del render, tumbaba
 * la SECCIÓN ENTERA con «No se pudo cargar esta sección» — justo al abrir la
 * agenda desde la notificación de una cita nueva (la que garantiza que hay una
 * cita que pintar). Dos arreglos: el orden correcto en la llamada, y que el
 * helper degrade en vez de lanzar.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

test('con el orden correcto (ymd, tz, idioma) da la fecha esperada', () => {
  const s = etiquetaDia('2026-09-18', 'America/Santo_Domingo', 'es-DO')
  assert.match(s, /18/, `esperaba el día 18 en «${s}»`)
  assert.match(s.toLowerCase(), /sept|sep/, `esperaba septiembre en «${s}»`)
})

test('una zona horaria inválida NO lanza: degrada en vez de tumbar la pantalla', () => {
  // Reproduce el bug exacto: idioma pasado como zona. Antes lanzaba RangeError.
  let s: string | undefined
  assert.doesNotThrow(() => {
    s = etiquetaDia('2026-09-18', 'es-DO', 'America/Santo_Domingo')
  })
  assert.equal(typeof s, 'string')
  assert.ok(s && s.length > 0, 'devolvió algo vacío en vez de una fecha')
})

test('un ymd roto tampoco lanza: último recurso, el crudo', () => {
  assert.doesNotThrow(() => etiquetaDia('no-es-fecha', 'America/Santo_Domingo'))
})

test('la agenda del admin pasa la zona (no el idioma) como 2º argumento', () => {
  // Guardia contra un re-intercambio: los dos son strings, así que el compilador
  // no lo ve. Aquí sí.
  const src = leer('src/app/(admin)/admin/citas/page.tsx')
  assert.match(src, /etiquetaDia\(ymd, tz, idioma\)/, 'el 2º argumento debe ser la zona (tz)')
  assert.ok(
    !/etiquetaDia\(ymd, idioma, tz\)/.test(src),
    'volvió a intercambiar idioma y zona: Intl.DateTimeFormat lanzará con un idioma como zona'
  )
})
