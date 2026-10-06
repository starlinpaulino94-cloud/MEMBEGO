import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { esZonaValida, zonaSegura } from '../src/lib/zona-horaria'
import { diaLocal, leerRango, limiteDiaLocal } from '../src/modules/reportes/rango'
import { TZ_PLATAFORMA } from '../src/lib/format'
import { sinComentarios } from '../scripts/nucleo-sin-verticales.mjs'

/**
 * LA ZONA HORARIA QUE TUMBABA REPORTES ENTERO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ PASÓ
 *
 * `companies.zonaHoraria` se escribe en una caja de TEXTO LIBRE del perfil de
 * la empresa, y `Intl.DateTimeFormat` no tolera un valor que no reconozca:
 * LANZA `RangeError: Invalid time zone specified`.
 *
 * Reportes era el único módulo que metía esa cadena en `Intl` por su cuenta
 * —`rango.ts` corta el día en la hora del negocio— sin red debajo. Los demás
 * formatean por `lib/format.ts`, que degrada a la zona de plataforma desde
 * siempre. De ahí la forma exacta del fallo: «No se pudo cargar esta sección»
 * en las trece pantallas de Reportes, en cada carga, y en ningún otro sitio.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE VIGILA CADA PRUEBA
 *
 * Las de arriba son de comportamiento: el núcleo no puede lanzar por una
 * cadena. Las de abajo miran la CAUSA —que ningún sitio vuelva a pasar la zona
 * cruda, y que el formulario siga validando antes de guardar—, porque volver a
 * introducir el fallo no rompe ninguna prueba de comportamiento: rompe una
 * pantalla, en producción, semanas después.
 */

/** Lo que alguien teclea de verdad cuando la caja dice «Zona horaria». */
const BASURA = [
  'GMT-4',
  'UTC-4',
  'Santo Domingo',
  'America/Nueva_York',
  'República Dominicana',
  'america/santo domingo',
  'null',
  '   ',
]

const BUENAS = ['America/Santo_Domingo', 'America/New_York', 'Europe/Madrid', 'UTC']

/**
 * ICU —el motor de `Intl`— acepta ADEMÁS las abreviaturas de siempre. No
 * lanzan, así que no son el fallo de esta prueba, y por eso `esZonaValida` no
 * las rechaza: endurecerla por encima de `Intl` le quitaría la zona a una
 * empresa que hoy funciona.
 *
 * Pero no son IANA y no llevan horario de verano: `EST` y `-04:00` son un
 * desfase fijo los doce meses, y medio año cortan el día una hora antes de lo
 * que el negocio cree. La lista se midió contra este Node —no se recordó—:
 * `GMT-4` lanza y `Etc/GMT-4` no, y ninguna intuición acierta eso.
 */
const ABREVIATURAS = ['AST', 'EST', 'PST', 'CET', 'JST', '-04:00', '+04:00', 'Etc/GMT-4']

test('las abreviaturas y los desfases pasan el validador, y eso es a propósito', () => {
  for (const z of ABREVIATURAS) assert.equal(esZonaValida(z), true, z)
})

// ── El validador ────────────────────────────────────────────────────────────

test('esZonaValida acepta las zonas IANA de verdad', () => {
  for (const z of BUENAS) assert.equal(esZonaValida(z), true, z)
})

test('esZonaValida rechaza lo que alguien teclea a mano', () => {
  for (const z of BASURA) assert.equal(esZonaValida(z), false, z)
})

test('esZonaValida rechaza lo que ni siquiera es una cadena', () => {
  for (const v of [null, undefined, 0, 42, {}, [], true, NaN]) {
    assert.equal(esZonaValida(v), false, JSON.stringify(v))
  }
})

test('zonaSegura deja pasar la buena y degrada la mala', () => {
  assert.equal(zonaSegura('America/New_York'), 'America/New_York')
  for (const z of BASURA) assert.equal(zonaSegura(z), TZ_PLATAFORMA, z)
  assert.equal(zonaSegura(null), TZ_PLATAFORMA)
  assert.equal(zonaSegura(undefined), TZ_PLATAFORMA)
})

/**
 * Un respaldo también inválido no puede colarse: sería el mismo fallo movido
 * un renglón más abajo, y con menos sitios donde buscarlo.
 */
test('zonaSegura no se fía ni de su propio respaldo', () => {
  assert.equal(zonaSegura('GMT-4', 'Tambien/Mala'), TZ_PLATAFORMA)
  assert.equal(zonaSegura('GMT-4', 'America/New_York'), 'America/New_York')
})

/**
 * La memoria se vacía al llegar al tope. Se comprueba CONTANDO —mil quinientas
 * zonas distintas cruzan el tope de mil— y no leyendo el código: lo que
 * importa no es que exista el `clear()`, es que después siga contestando bien.
 */
test('la memoria del validador no crece sin límite ni se equivoca al vaciarse', () => {
  for (let i = 0; i < 1500; i++) assert.equal(esZonaValida(`Zona/Inventada_${i}`), false)
  assert.equal(esZonaValida('America/Santo_Domingo'), true)
  assert.equal(esZonaValida('GMT-4'), false)
})

// ── La regresión ────────────────────────────────────────────────────────────

/**
 * ESTA ES LA PRUEBA DEL FALLO.
 *
 * Antes del arreglo, `leerRango(sp, 'GMT-4')` lanzaba, y con ella se iba la
 * página entera. Ahora resuelve el mismo periodo que la zona de plataforma:
 * un reporte con el corte del día unas horas movido es un error acotado;
 * ninguno es un módulo caído.
 */
test('leerRango no lanza con ninguna zona inválida', () => {
  for (const rango of ['hoy', 'semana', 'mes', 'anio'] as const) {
    const bueno = leerRango({ rango }, TZ_PLATAFORMA)
    for (const z of BASURA) {
      const r = leerRango({ rango }, z)
      assert.equal(r.desde.getTime(), bueno.desde.getTime(), `${rango} · ${z}`)
      assert.equal(r.hasta.getTime(), bueno.hasta.getTime(), `${rango} · ${z}`)
    }
  }
})

test('diaLocal y limiteDiaLocal tampoco lanzan', () => {
  const fecha = new Date('2026-09-22T03:30:00Z')
  for (const z of BASURA) {
    assert.equal(diaLocal(fecha, z), diaLocal(fecha, TZ_PLATAFORMA), z)
    assert.equal(
      limiteDiaLocal('2026-09-22', z).getTime(),
      limiteDiaLocal('2026-09-22', TZ_PLATAFORMA).getTime(),
      z
    )
  }
})

// ── La causa ────────────────────────────────────────────────────────────────

/** Código, sin lo que explica el código. Ver `sinComentarios`. */
const codigoDe = (p: string): string => sinComentarios(readFileSync(p, 'utf8'))

function archivosDe(dir: string): string[] {
  const acc: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) acc.push(...archivosDe(p))
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) acc.push(p)
  }
  return acc
}

const RAIZ = join(import.meta.dirname, '..')
const PANTALLAS_REPORTES = [
  join(RAIZ, 'src/app/(admin)/admin/reportes'),
  join(RAIZ, 'src/app/(superadmin)/superadmin/reportes'),
].flatMap(archivosDe)

/**
 * LO QUE DE VERDAD IMPIDE QUE VUELVA.
 *
 * El fallo no estaba en `rango.ts`: estaba en veinticuatro pantallas que
 * escribían `empresa?.zonaHoraria || TZ_PLATAFORMA` y creían haber puesto una
 * red. Ese `||` solo cubre el vacío —`''` o `null`—, no lo inválido, que es el
 * caso que lanza. Una pantalla nueva copiada de una vieja traería el fallo
 * entera, y ninguna prueba de comportamiento se enteraría.
 */
test('ninguna pantalla de reportes resuelve la zona con un || pelado', () => {
  const culpables = PANTALLAS_REPORTES.filter((p) =>
    /\.zonaHoraria\s*(\|\||\?\?)/.test(codigoDe(p))
  )
  assert.deepEqual(
    culpables.map((p) => p.slice(RAIZ.length + 1)),
    [],
    'usa zonaSegura(empresa?.zonaHoraria): el || no cubre una zona inválida, solo una vacía'
  )
})

/**
 * Y que la red esté PUESTA, no solo que no esté la mala: una pantalla que
 * dejara de resolver la zona por su cuenta pasaría la prueba de arriba sin
 * hacer nada.
 */
test('cada pantalla de reportes que lee la zona la pasa por zonaSegura', () => {
  // `.zonaHoraria` y no `zonaHoraria`: el reporte global del superadmin cruza
  // TODAS las empresas, no tiene una de la que sacar la zona y corta en la de
  // plataforma. La escribe como CLAVE (`{ zonaHoraria: TZ_PLATAFORMA }`), no
  // la LEE de una empresa, y exigirle `zonaSegura` sería exigirle que resuelva
  // algo que no tiene.
  const lectoras = PANTALLAS_REPORTES.filter((p) => /\.zonaHoraria\b/.test(codigoDe(p)))
  assert.ok(lectoras.length >= 20, `solo ${lectoras.length} pantallas leen la zona: ¿se movieron?`)
  for (const p of lectoras) {
    assert.match(
      codigoDe(p),
      /zonaSegura\(/,
      `${p.slice(RAIZ.length + 1)} lee zonaHoraria sin pasarla por zonaSegura`
    )
  }
})

/**
 * UNA SOLA DEFINICIÓN. `periodos.ts` tenía su propia copia privada de esta
 * misma validación, y por eso el arreglo existía en la plataforma desde antes
 * y Reportes seguía cayéndose: dos copias de una regla son dos sitios donde
 * arreglarla, y solo uno se arregla.
 */
test('zonaSegura se define una sola vez en todo el código', () => {
  const definiciones = archivosDe(join(RAIZ, 'src')).filter((p) =>
    /(export\s+)?function\s+zonaSegura\b/.test(codigoDe(p))
  )
  assert.deepEqual(
    definiciones.map((p) => p.slice(RAIZ.length + 1)),
    ['src/lib/zona-horaria.ts']
  )
})

/**
 * El otro extremo: `zonaSegura` cubre lo que YA está guardado mal, pero solo
 * rechazar al guardar impide que entren valores nuevos. Se comprueba el ORDEN
 * —validar antes de escribir—, porque validar después no es validar.
 */
test('el perfil de empresa valida la zona antes de guardarla', () => {
  const src = codigoDe(join(RAIZ, 'src/modules/empresas/perfilActions.ts'))
  const valida = src.indexOf('esZonaValida(')
  const escribe = src.indexOf('company.update(')
  assert.notEqual(valida, -1, 'el perfil no valida la zona horaria')
  assert.notEqual(escribe, -1, 'no se encontró la escritura de la empresa')
  assert.ok(valida < escribe, 'la validación tiene que ir ANTES de la escritura')
})
