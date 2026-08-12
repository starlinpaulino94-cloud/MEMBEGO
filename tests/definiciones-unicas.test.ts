import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * UNA SOLA DEFINICIÓN POR CONCEPTO.
 *
 * Estas guardias existen porque los dos defectos ya ocurrieron, y ninguno daba
 * error: daban dos pantallas con cifras distintas del mismo mes. Eso es peor que
 * un fallo, porque el sistema parece funcionar y nadie sabe a cuál creer.
 *
 * No se comprueba el RESULTADO —haría falta base de datos— sino que nadie vuelva
 * a escribir el criterio a mano. Es una prueba sobre el código, y es la única
 * forma de atrapar una copia ANTES de que diverja.
 *
 * MIRAN SOLO LAS CONSULTAS SOBRE `membership`. La primera versión buscaba
 * `estado: 'ACTIVA'` en cualquier sitio y señalaba a `productoCompra` y a
 * `campanaInvitacion`, que tienen su propio estado y no tienen nada que ver.
 * Una guardia con falsos positivos se desactiva a la semana.
 */

function archivos(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) archivos(p, acc)
    else if (/\.tsx?$/.test(p)) acc.push(p)
  }
  return acc
}

const FUENTES = archivos('src')
const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const esFuenteDe = (archivo: string, sufijo: string) =>
  archivo.split(/[\\/]/).join('/').endsWith(sufijo)

/** Índice del paréntesis que cierra el que abre en `apertura`. */
function cierre(texto: string, apertura: number): number {
  let profundidad = 0
  for (let i = apertura; i < texto.length; i++) {
    if (texto[i] === '(') profundidad++
    else if (texto[i] === ')') {
      profundidad--
      if (profundidad === 0) return i
    }
  }
  return texto.length - 1
}

/** Los argumentos de cada `membership.<metodo>(…)` del archivo. */
function consultasDeMembresia(src: string, metodos: string[]): string[] {
  const fuera: string[] = []
  const re = new RegExp(`membership\\s*\\.\\s*(?:${metodos.join('|')})\\s*\\(`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const abre = m.index + m[0].length - 1
    fuera.push(src.slice(abre, cierre(src, abre) + 1))
  }
  return fuera
}

/**
 * DINERO COBRADO. Llegó a estar escrito cuatro veces: el Resumen de la empresa,
 * Reportes, la conciliación y el CRM de empresas. La cuarta era además la más
 * laxa —sumaba `montoPagado` sin exigir `pagoConfirmado`—, así que enseñaba como
 * ingresos dinero que nadie había cobrado.
 */
test('el criterio de «cobrado» no se escribe a mano', () => {
  const infractores: string[] = []

  for (const f of FUENTES) {
    if (esFuenteDe(f, 'modules/pagos/cobrado.ts')) continue
    const src = sinComentarios(readFileSync(f, 'utf8'))
    for (const consulta of consultasDeMembresia(src, ['aggregate'])) {
      if (!/_sum:\s*\{\s*montoPagado/.test(consulta)) continue
      if (/whereCobrado/.test(consulta)) continue
      infractores.push(f)
      break
    }
  }

  assert.deepEqual(
    infractores,
    [],
    'usa `whereCobrado` de @/modules/pagos/cobrado en vez de repetir el criterio:\n' +
      infractores.join('\n')
  )
})

/**
 * MEMBRESÍA VIGENTE. `estado: 'ACTIVA'` a secas no mira la fecha de vencimiento,
 * y nada vence las membresías solas: por eso existe `membresiaVigente()`.
 * Contarlas sin ella infla el número, y lo infla distinto en cada pantalla — el
 * CRM decía 40 donde el panel de esa misma empresa decía menos.
 *
 * Se mira solo CONTAR (`count` y `groupBy`). Buscar una membresía concreta por
 * su estado, o cambiárselo, son otras preguntas y no les aplica.
 */
test('contar membresías vigentes pasa por membresiaVigente', () => {
  const infractores: string[] = []

  for (const f of FUENTES) {
    if (esFuenteDe(f, 'modules/membresia/vigencia.ts')) continue
    const src = sinComentarios(readFileSync(f, 'utf8'))
    for (const consulta of consultasDeMembresia(src, ['count', 'groupBy'])) {
      // `estado: 'ACTIVA'` suelto. Un `in: ['ACTIVA', 'PENDIENTE_PAGO']` no
      // cuenta vigentes: clasifica por estado, que es otra pregunta.
      if (!/estado:\s*'ACTIVA'\s*[,}]/.test(consulta)) continue
      if (/membresiaVigente|vigente/.test(consulta)) continue
      // «Por vencer en 7 días» ya acota `fechaVencimiento` a un rango: la
      // pregunta no es «cuántas están vigentes» sino «cuáles caducan pronto», y
      // el rango de fechas ya la hace consciente del vencimiento. Marcarla sería
      // pedir que se sume una condición redundante para callar a la guardia.
      if (/fechaVencimiento/.test(consulta)) continue
      infractores.push(f)
      break
    }
  }

  assert.deepEqual(
    infractores,
    [],
    'usa `membresiaVigente()` de @/modules/membresia/vigencia:\n' + infractores.join('\n')
  )
})
