import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { anclaSistema } from '../src/modules/integraciones/diagnostico'

/**
 * PANEL DE INTEGRACIONES — lo que no puede volver a romperse.
 *
 * Es la pantalla desde la que se toca el sistema de un TERCERO: manda
 * peticiones a su dominio y pone en movimiento eventos de todas las empresas
 * que lo usan. Sus tres botones no dejaban rastro, uno de ellos disparaba de
 * más y el diagnóstico que enseñaba podía ser el de un problema ya resuelto.
 *
 * `panel.ts` y `panelActions.ts` importan Prisma, así que se leen como texto:
 * montarlos aquí construiría un PrismaClient sin base de datos detrás.
 */

const ruta = (...p: string[]) => join(...p)
const leer = (...p: string[]) => readFileSync(ruta(...p), 'utf8')

const PANEL = leer('src', 'modules', 'integraciones', 'panel.ts')
const ACCIONES = leer('src', 'modules', 'integraciones', 'panelActions.ts')
const DESPACHO = leer('src', 'modules', 'integraciones', 'despacho.ts')
const TARJETA = leer('src', 'components', 'superadmin', 'SistemaConectadoCard.tsx')
const PAGINA = leer('src', 'app', '(superadmin)', 'superadmin', 'integraciones', 'page.tsx')

/**
 * Los comentarios explican el fallo que se corrigió, así que CITAN el código
 * viejo. Sin quitarlos, media guardia pasaría leyendo su propia explicación.
 */
const sinComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:\/\/|\*).*$/gm, '')

// ───────────── M107 · el reintento es de UN sistema ─────────────

test('el botón de reenviar acota al sistema de su tarjeta', () => {
  assert.match(
    sinComentarios(ACCIONES),
    /reintentarPendientes\(\s*100\s*,\s*sistemaId\s*\)/,
    'sin acotar, pulsar en un satélite despacha también la cola de los demás'
  )
})

test('y el despacho de verdad filtra por ese sistema', () => {
  // Pasar el argumento no sirve de nada si la consulta lo ignora.
  assert.match(
    sinComentarios(DESPACHO),
    /estado: 'PENDIENTE',\s*\.\.\.\(sistemaId \? \{ sistemaId \} : \{\}\)/
  )
})

test('pero el cron sigue drenándolo TODO', () => {
  // El cron no tiene tarjeta ni sistema: si alguien le pasara uno, el resto de
  // las colas dejaría de salir y nadie se enteraría hasta que se llenaran.
  for (const cron of [
    ruta('src', 'app', 'api', 'cron', 'integraciones', 'route.ts'),
    ruta('src', 'app', 'api', 'cron', 'automatizaciones', 'route.ts'),
  ]) {
    const src = sinComentarios(readFileSync(cron, 'utf8'))
    const llamadas = [...src.matchAll(/reintentarPendientes\(([^)]*)\)/g)].map((m) => m[1].trim())
    for (const args of llamadas) {
      assert.ok(
        !/,/.test(args),
        `${cron} acota el reintento a un sistema; el cron tiene que despacharlos todos`
      )
    }
  }
})

// ───────────── M110 · el último error es el último ─────────────

test('el error sale del pendiente más castigado, no del más viejo', () => {
  const src = sinComentarios(PANEL)
  // Sin esto, revivir la cola deja el panel diciendo «sin error» justo cuando
  // los revividos (los más antiguos, con `intentos: 0`) aún no se han vuelto a
  // intentar. Por `intentos` descendente, esos caen al final.
  assert.match(src, /orderBy: \[\{ intentos: 'desc' \}, \{ createdAt: 'asc' \}\]/)
  assert.match(src, /filas\.find\(\(f\) => f\.ultimoError\)/)
})

test('los intentos y la espera los agrega la base, sin traer filas', () => {
  // Salían del mismo evento del que salía el error: el pendiente más viejo.
  const src = sinComentarios(PANEL)
  assert.match(src, /_max: \{ intentos: true \}/)
  assert.match(src, /_min: \{ createdAt: true \}/)
  assert.match(src, /esperandoDesde: pendientesDe\(s\.id\)\?\._min\.createdAt/)
  assert.match(src, /maxIntentos: pendientesDe\(s\.id\)\?\._max\.intentos/)
})

// ───────────── M109 · nada de una consulta por sistema porque sí ─────────────

test('los conteos de TODOS los sistemas salen de un solo groupBy', () => {
  const src = sinComentarios(PANEL)
  const cuerpo = src.slice(src.indexOf('export async function getPanelIntegraciones'))
  const trozo = cuerpo.slice(0, cuerpo.indexOf('async function tocar'))
  assert.equal(
    [...trozo.matchAll(/groupBy\(\{/g)].length,
    1,
    'el conteo por estado tiene que ser un groupBy único para todos'
  )
})

test('solo se lee la cola de los sistemas que de verdad la tienen', () => {
  // Con todo verde, el panel no hace ni una consulta de eventos más allá del
  // groupBy. El N+1 anterior las hacía siempre.
  assert.match(
    sinComentarios(PANEL),
    /if \(\(pendientesDe\(s\.id\)\?\._count\._all \?\? 0\) === 0\) continue/
  )
})

// ───────────── M112 · qué está atascado, no solo cuánto ─────────────

test('la muestra de atascados está acotada EN LA CONSULTA', () => {
  /**
   * El tope tiene que estar en el `take`, no al recorrer: leer los pendientes
   * enteros para quedarse con cinco haría esta pantalla lenta justo cuando un
   * satélite lleva una semana caído — que es cuando se abre.
   */
  const src = sinComentarios(PANEL)
  assert.match(src, /export const MUESTRA_ATASCADOS = \d+/)
  assert.match(src, /take: MUESTRA_ATASCADOS/)
  assert.ok(
    !/findMany\(\{\s*where: \{ sistemaId: \{ in: ids \}, estado: 'PENDIENTE' \}/.test(src),
    'volvió la lectura sin tope de todos los pendientes'
  )
})

test('los atascados salen con el nombre de la empresa, no con su id', () => {
  const src = sinComentarios(PANEL)
  assert.match(src, /nombres\.get\(p\.companyId\) \?\? p\.companyId/)
  assert.match(src, /empresaIds\.length > 0/, 'sin empresas en la muestra no hay que consultar')
})

test('la tarjeta enseña el tipo, la empresa y el error de cada uno', () => {
  const src = sinComentarios(TARJETA)
  for (const campo of ['ev.tipo', 'ev.empresa', 'ev.intentos', 'ev.ultimoError']) {
    assert.ok(src.includes(campo), `falta ${campo}: sin él la lista no distingue las dos causas`)
  }
})

// ───────────── M108, M115 · rastro de lo que sale hacia fuera ─────────────

test('las tres acciones del panel dejan línea en la bitácora', () => {
  const src = sinComentarios(ACCIONES)
  for (const accion of [
    'INTEGRACION_SONDEADA',
    'INTEGRACION_REINTENTADA',
    'INTEGRACION_REENCOLADA',
  ]) {
    assert.match(src, new RegExp(`auditarIntegracion\\('${accion}'`), `${accion} no se registra`)
  }
})

test('la bitácora de la sonda NO guarda el cuerpo de la respuesta', () => {
  /**
   * El cuerpo de un satélite puede traer una traza con datos de sus clientes o
   * una página de error con datos de sesión. La bitácora se consulta desde
   * Auditoría por más gente que este panel: ahí va el veredicto, no el volcado.
   */
  const src = sinComentarios(ACCIONES)
  const inicio = src.indexOf("auditarIntegracion('INTEGRACION_SONDEADA'")
  const payload = src.slice(inicio, src.indexOf('})', inicio))
  assert.ok(inicio > 0)
  assert.ok(!/cuerpo/.test(payload), 'el cuerpo crudo no puede acabar en la bitácora')
  assert.match(payload, /gravedad: res\.diagnostico\.gravedad/)
})

test('la acción de plataforma no se le cuelga a una empresa cualquiera', () => {
  // Los eventos movidos son de muchas empresas a la vez; elegir una sería peor
  // que no elegir ninguna.
  assert.match(
    sinComentarios(leer('src', 'modules', 'integraciones', 'auditoria.ts')),
    /companyId: null/
  )
})

test('la última sonda se lee dentro de la transacción de quien llama', () => {
  // Abrir otra desde dentro de `sinEmpresa` pediría una segunda conexión del
  // pool sosteniendo la primera.
  const src = sinComentarios(leer('src', 'modules', 'integraciones', 'auditoria.ts'))
  const inicio = src.indexOf('export async function ultimasSondas')
  assert.ok(inicio > 0)
  assert.ok(
    !/sinEmpresa\(/.test(src.slice(inicio)),
    'ultimasSondas recibe el `tx`: no puede abrir su propia transacción'
  )
})

test('la tarjeta enseña la última prueba guardada', () => {
  const src = sinComentarios(TARJETA)
  assert.match(src, /sistema\.ultimaSonda/)
  assert.match(src, /Última prueba/)
})

// ───────────── M111 · revivir se confirma ─────────────

test('devolver los agotados a la cola pregunta antes', () => {
  const src = sinComentarios(TARJETA)
  assert.match(src, /onSubmit=\{alRevivir\}/)
  assert.match(src, /<ConfirmDialog/)
  assert.match(src, /open=\{confirmarRevivir\}/)
  // Y la marca de «ya confirmado» es un ref: `requestSubmit()` dispara el
  // submit antes de que React aplique un setState del mismo manejador.
  assert.match(src, /revivirConfirmado\.current = true/)
  assert.match(src, /revivirRef\.current\?\.requestSubmit\(\)/)
})

test('los otros dos botones NO preguntan', () => {
  // Sondear y reenviar son reversibles y se usan en bucle mientras se
  // diagnostica: un diálogo ahí se despacharía con Enter sin leerlo, y ese
  // hábito es justo lo que vacía de sentido al que sí importa.
  const src = sinComentarios(TARJETA)
  assert.equal([...src.matchAll(/<ConfirmDialog/g)].length, 1)
  assert.equal([...src.matchAll(/onSubmit=/g)].length, 1)
})

// ───────────── M113 · el aviso dice CUÁLES ─────────────

test('el ancla se calcula en un solo sitio', () => {
  assert.equal(anclaSistema('carwash-pro'), 'sistema-carwash-pro')
  // Un slug con caracteres raros no puede romper el `id` del HTML.
  assert.equal(anclaSistema('a b/c'), 'sistema-a-b-c')
})

test('el aviso enlaza a la tarjeta de cada sistema afectado', () => {
  const src = sinComentarios(PAGINA)
  assert.match(src, /href=\{`#\$\{anclaSistema\(s\.slug\)\}`\}/)
  assert.match(src, /atascados\.map/)
})

test('y la tarjeta pone ese mismo ancla', () => {
  const src = sinComentarios(TARJETA)
  assert.match(src, /id=\{anclaSistema\(sistema\.slug\)\}/)
  // Escrito a mano en cualquiera de los dos lados, el enlace deja de llevar a
  // ningún sitio sin que nada falle.
  for (const [nombre, texto] of [
    ['la tarjeta', TARJETA],
    ['la página', PAGINA],
  ] as const) {
    assert.ok(
      !/["'`]#?sistema-\$\{/.test(sinComentarios(texto)),
      `${nombre} construye el ancla a mano en vez de usar anclaSistema`
    )
  }
})

// ───────────── M114 · plurales ─────────────

test('no quedan plurales escritos a mano en el panel', () => {
  for (const [nombre, texto] of [
    ['la tarjeta', TARJETA],
    ['la página', PAGINA],
    ['las acciones', ACCIONES],
  ] as const) {
    const src = sinComentarios(texto)
    assert.ok(
      !/=== 1 \? '/.test(src),
      `${nombre} decide el plural a mano; usa plural()/soloPlural() de @/lib/plural`
    )
    // Pegado a una palabra: «registro(s)». `map((s) =>` lleva un paréntesis
    // delante y no es lo que se busca.
    assert.ok(!/[a-záéíóúñ]\(s\)/i.test(src), `${nombre} usa «(s)»`)
  }
})
