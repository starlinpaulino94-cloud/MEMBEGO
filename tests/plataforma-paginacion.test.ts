import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  LIMITE_DEFECTO,
  LIMITE_MAXIMO,
  codificarCursor,
  construirPagina,
  decodificarCursor,
  parsearLimite,
} from '../src/modules/plataforma/paginacionNucleo'
import { INVENTARIO_API } from '@membego/contracts'

/**
 * PAGINACIÓN POR CURSOR · hallazgo B-6 de la auditoría.
 *
 * El fallo que corrige es silencioso: un listado con tope fijo devolvía 500
 * filas y no decía que hubiera más. Lo que más se prueba aquí es que «hay más»
 * se responde bien y que el cursor no salta ni repite una fila en un empate.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const codigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

// ─── El límite ───────────────────────────────────────────────────────────────

test('sin limite se usa el defecto; se acota al máximo', () => {
  assert.deepEqual(parsearLimite(null), { ok: true, limite: LIMITE_DEFECTO })
  assert.deepEqual(parsearLimite(''), { ok: true, limite: LIMITE_DEFECTO })
  assert.deepEqual(parsearLimite('10'), { ok: true, limite: 10 })
  assert.deepEqual(parsearLimite(String(LIMITE_MAXIMO + 500)), { ok: true, limite: LIMITE_MAXIMO })
})

test('un limite absurdo es un ERROR, no un defecto en silencio', () => {
  // Quien manda `limit=0` o `limit=abc` se equivocó, y prefiere saberlo a
  // recibir una página que no pidió.
  for (const malo of ['0', '-5', 'abc', '3.5', '1e3']) {
    assert.deepEqual(parsearLimite(malo), { ok: false }, malo)
  }
})

// ─── El cursor ───────────────────────────────────────────────────────────────

test('el cursor va y vuelve', () => {
  const c = codificarCursor('cli_abc123')
  assert.deepEqual(decodificarCursor(c), { presente: true, ok: true, id: 'cli_abc123' })
})

test('el cursor es OPACO: un id pelado no cuela', () => {
  // Sin la marca de versión, quien lo construya a mano se ata a un formato que
  // cambiará. Un id suelto no es un cursor válido.
  assert.deepEqual(decodificarCursor('cli_abc123'), { presente: true, ok: false })
  assert.deepEqual(decodificarCursor(Buffer.from('cli_abc123').toString('base64url')), {
    presente: true,
    ok: false,
  })
})

test('ausente, válido e ilegible son TRES cosas distintas', () => {
  assert.deepEqual(decodificarCursor(null), { presente: false })
  assert.deepEqual(decodificarCursor(''), { presente: false })
  const roto = decodificarCursor('no-es-un-cursor')
  assert.ok(roto.presente && !roto.ok, 'un cursor ilegible debe verse presente y no válido')
})

// ─── El corte de página, y el «+1» ───────────────────────────────────────────

test('con una fila de más, hay siguiente y el cursor apunta a la última VISIBLE', () => {
  // Se piden `limite + 1` filas; la extra revela que hay más pero NO se enseña,
  // y el cursor cuelga de la última que sí se devuelve.
  const filas = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] // limite = 2, vino 1 de más
  const { items, nextCursor } = construirPagina(filas, 2)
  assert.deepEqual(items, [{ id: 'a' }, { id: 'b' }])
  assert.deepEqual(decodificarCursor(nextCursor), { presente: true, ok: true, id: 'b' })
})

test('sin fila de más, esta era la última página', () => {
  const { items, nextCursor } = construirPagina([{ id: 'a' }, { id: 'b' }], 2)
  assert.deepEqual(items, [{ id: 'a' }, { id: 'b' }])
  assert.equal(nextCursor, null, 'una página incompleta no debería ofrecer siguiente')
})

test('una página vacía no ofrece cursor', () => {
  assert.deepEqual(construirPagina([], 50), { items: [], nextCursor: null })
})

test('recorrer entero no salta ni repite ninguna fila', () => {
  /**
   * La prueba de que el «+1» y el cursor casan: se pagina de tres en tres una
   * lista de diez y tiene que salir la lista entera, en orden y sin huecos ni
   * dobles. Es exactamente lo que un tope fijo silencioso rompía.
   */
  const todo = Array.from({ length: 10 }, (_, i) => ({ id: `x${i}` }))
  const vistos: string[] = []
  let desde = 0
  for (let vuelta = 0; vuelta < 20; vuelta++) {
    const lote = todo.slice(desde, desde + 3 + 1) // como haría `take: limite + 1`
    const { items, nextCursor } = construirPagina(lote, 3)
    vistos.push(...items.map((i) => i.id))
    if (!nextCursor) break
    desde += 3
  }
  assert.deepEqual(vistos, todo.map((t) => t.id))
  assert.equal(new Set(vistos).size, vistos.length, 'hubo filas repetidas')
})

// ─── El contrato y las rutas ─────────────────────────────────────────────────

test('las rutas marcadas como paginadas de verdad paginan', () => {
  /**
   * El inventario dice qué colecciones paginan; si una lo declarara y su ruta
   * no leyera el cursor, quien importe el OpenAPI escribiría un bucle de
   * paginación contra una lista que ignora el parámetro y devuelve siempre lo
   * mismo — un bucle infinito.
   */
  const paginadas = INVENTARIO_API.filter((r) => r.paginado).map((r) => r.ruta)
  assert.ok(paginadas.length >= 3, 'se esperaban al menos tres colecciones paginadas')
  for (const ruta of paginadas) {
    const archivo = `src/app/api/platform/v1/${ruta.replace(/^\//, '')}/route.ts`
    const src = codigo(archivo)
    assert.match(src, /leerPaginacion\(/, `${ruta} se declara paginada y no lee la paginación`)
    assert.match(src, /construirPagina\(/, `${ruta} no corta la página`)
    assert.match(src, /page: \{ limit: pag\.limite, nextCursor \}/, `${ruta} no devuelve el sobre de página`)
  }
})

test('cada listado paginado desempata su orden con `id`', () => {
  /**
   * La condición para que un cursor no salte ni repita: que el orden sea
   * determinista. Un `orderBy` que no termina en `id` deja empates, y el cursor
   * cae en medio de uno.
   *
   * El `orderBy` de un listado puede vivir en la ruta (citas, membresías,
   * promociones) o en el módulo al que la ruta delega la consulta (los clientes,
   * en `consultas.ts`). Se busca primero en la ruta y, si allí no hay `orderBy`,
   * en el módulo — pero SIEMPRE se exige encontrarlo, para que «no lo vi» no pase
   * por «está bien».
   */
  const fuentes = [
    'src/modules/plataforma/consultas.ts',
    'src/modules/plataforma/escrituras.ts',
  ].map(codigo)
  for (const r of INVENTARIO_API.filter((x) => x.paginado)) {
    const src = codigo(`src/app/api/platform/v1/${r.ruta.replace(/^\//, '')}/route.ts`)
    if (src.includes('orderBy:')) {
      const orderBy = src.slice(src.indexOf('orderBy:'), src.indexOf('take:'))
      assert.match(orderBy, /id: 'asc'/, `${r.ruta}: el orden no desempata con id`)
    } else {
      // La ruta delega: su consulta paginada tiene que estar en algún módulo, y
      // su orden terminar en id.
      const modulo = fuentes.find((f) => /orderBy: \[[^\]]*id: 'asc'[^\]]*\]/.test(f))
      assert.ok(modulo, `${r.ruta}: delega la consulta y no se encontró un orden con id`)
    }
  }
})

test('el sobre `page` va a la respuesta, no un cursor suelto en la raíz', () => {
  // El cursor vive dentro de `page` para no chocar con un campo del recurso que
  // se llamara igual, y para que «esto es meta, no datos» quede claro.
  for (const r of INVENTARIO_API.filter((x) => x.paginado)) {
    const src = codigo(`src/app/api/platform/v1/${r.ruta.replace(/^\//, '')}/route.ts`)
    assert.match(src, /nextCursor \} = construirPagina/, r.ruta)
  }
})

test('la paginación es un helper compartido, no copiado ruta por ruta', () => {
  // Cuatro copias de «cortar la página» divergen a la tercera. La lógica vive
  // en un núcleo puro y las rutas solo lo componen.
  const nucleo = codigo('src/modules/plataforma/paginacionNucleo.ts')
  assert.match(nucleo, /export function construirPagina/)
  assert.match(nucleo, /export function parsearLimite/)
  assert.match(nucleo, /export function decodificarCursor/)
})
