import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * CARA PÚBLICA DEL PRODUCTO (DS 2.0 · Fase 18).
 *
 * Es la única parte que ve alguien que todavía no es cliente, así que una
 * incoherencia aquí no es un detalle interno: es la primera impresión.
 */

const DIRS = [join('src', 'app', '(public)'), join('src', 'components', 'public')]

function archivosTsx(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada)
    if (statSync(ruta).isDirectory()) archivosTsx(ruta, acc)
    else if (ruta.endsWith('.tsx')) acc.push(ruta)
  }
  return acc
}

const todos = () => DIRS.flatMap((d) => archivosTsx(d))

/**
 * DOS OPACIDADES ENCADENADAS = CLASE DESCARTADA.
 *
 * `text-white/80/90` no es una errata inofensiva: Tailwind no la parsea, tira
 * la clase entera y el elemento se queda SIN ese estilo. No avisa, no rompe el
 * build y no falla ninguna prueba — el subtítulo del héroe simplemente se
 * pintaba en blanco puro, perdiendo la jerarquía que lo separaba del titular.
 *
 * Había seis repartidas por el proyecto, tres de ellas en la portada. Se
 * vigilan en TODO `src`, no solo aquí: el fallo es del mismo tipo en cualquier
 * pantalla, y precisamente por ser invisible es el que más dura.
 */
test('ninguna clase encadena dos opacidades', () => {
  const MALFORMADA = /\b(?:text|bg|border|ring|from|to|via|fill|stroke|divide|outline)-[a-z-]+\/\d+\/\d+/g
  const infractores: string[] = []
  for (const archivo of archivosTsx('src')) {
    for (const m of readFileSync(archivo, 'utf8').matchAll(MALFORMADA)) {
      infractores.push(`${archivo}: ${m[0]}`)
    }
  }
  assert.deepEqual(
    infractores,
    [],
    'Tailwind descarta la clase entera y el estilo no se aplica:\n' + infractores.join('\n')
  )
})

/**
 * UNA SOLA SUPERFICIE DE CABECERA.
 *
 * Había SEIS degradados distintos para el mismo papel, escritos a mano página
 * a página: la web pública cambiaba de azul al navegar. Ahora es
 * `.surface-hero`, definida una vez en globals.css con tres topes que TODOS
 * aguantan texto blanco (6.34:1, 8.35:1 y 10.13:1).
 */
test('las cabeceras públicas no vuelven a inventarse su degradado', () => {
  const AZUL_A_MANO = /\b(?:from|via|to)-(?:blue|indigo|sky|slate|cyan)-\d{3}\b/g
  const infractores: string[] = []
  for (const archivo of todos()) {
    const src = readFileSync(archivo, 'utf8')
    for (const linea of src.split('\n')) {
      // Los adornos de un solo uso —el degradado del titular y la línea del
      // pie— no son "la misma cabecera escrita distinta": llevan `bg-clip-text`
      // o son un separador de 1px.
      if (linea.includes('bg-clip-text') || linea.includes('h-px')) continue
      for (const m of linea.matchAll(AZUL_A_MANO)) infractores.push(`${archivo}: ${m[0]}`)
    }
  }
  assert.deepEqual(
    infractores,
    [],
    'Usa `.surface-hero` (cabeceras) o `.bg-gradient-brand` (chips):\n' + infractores.join('\n')
  )
})

test('`.surface-hero` existe y sale de la escala de marca', () => {
  const css = readFileSync(join('src', 'app', 'globals.css'), 'utf8')
  // `.surface-hero {` con llave: el nombre suelto aparece antes en un
  // comentario, y buscar eso dejaba la ventana sobre la prosa en vez de sobre
  // la regla.
  const inicio = css.indexOf('.surface-hero {')
  assert.notEqual(inicio, -1, 'falta la regla .surface-hero en globals.css')
  const bloque = css.slice(inicio, css.indexOf('}', inicio))
  for (const tope of ['--color-primary-700', '--color-primary-800', '--color-primary-900']) {
    assert.ok(bloque.includes(tope), `.surface-hero debe usar ${tope}, no un azul literal`)
  }
})

test('la tipografía pública sale de los nueve roles', () => {
  // Excepción: `text-4xl` y `text-2xl` sobre un emoji o una flecha decorativa
  // son el tamaño del DIBUJO, no tipografía. Van marcados con role="img" o
  // aria-hidden, así que se reconocen por eso y no por una lista de archivos.
  const infractores: string[] = []
  for (const archivo of todos()) {
    const src = readFileSync(archivo, 'utf8')
    src.split('\n').forEach((linea, i) => {
      if (!/\btext-(?:lg|xl|2xl|3xl|4xl|5xl|6xl|7xl)\b/.test(linea)) return
      const contexto = src.split('\n').slice(Math.max(0, i - 2), i + 2).join(' ')
      if (contexto.includes('aria-hidden') || contexto.includes('role="img"')) return
      infractores.push(`${archivo}:${i + 1}`)
    })
  }
  assert.deepEqual(
    infractores,
    [],
    'Usa .text-display / .text-h1 … .text-overline:\n' + infractores.join('\n')
  )
})
