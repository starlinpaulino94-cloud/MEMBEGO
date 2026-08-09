import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ÁREA DEL EMPLEADO — la que se lee de pie (DS 2.0 · Fase 17).
 *
 * POR QUÉ ESTA ÁREA TIENE SU PROPIA GUARDIA, MÁS ESTRICTA QUE EL TECHO GLOBAL:
 *
 * El resto del producto se mira sentado, con el aparato a 40 cm. El escáner y
 * la caja se usan **de pie, con el móvil en una mano, el cliente delante y
 * prisa**. Y era, medido, el área con MÁS texto por debajo del suelo de todo
 * el proyecto: 3,99 por cada mil líneas, casi el doble que el panel de
 * administración. El sitio donde peor se lee era el que peor lo tenía.
 *
 * Por eso aquí no hay techo que baje poco a poco: es cero, y la prueba lo
 * defiende.
 */

const DIRS = [
  join('src', 'components', 'scanner'),
  join('src', 'components', 'caja'),
  join('src', 'app', '(empleado)'),
]

function archivosTsx(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada)
    if (statSync(ruta).isDirectory()) archivosTsx(ruta, acc)
    else if (ruta.endsWith('.tsx')) acc.push(ruta)
  }
  return acc
}

const todos = () => DIRS.flatMap((d) => archivosTsx(d))

test('nada baja de 12px en el mostrador', () => {
  const infractores: string[] = []
  for (const archivo of todos()) {
    for (const m of readFileSync(archivo, 'utf8').matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
      if (Number(m[1]) < 12) infractores.push(`${archivo}: ${m[0]}`)
    }
  }
  assert.deepEqual(
    infractores,
    [],
    'Se lee de pie y a un brazo: usa .text-caption (12.5px) o .text-overline (12px).\n' +
      infractores.join('\n')
  )
})

test('los tamaños salen de la escala, no del pulgar', () => {
  // `text-lg`, `text-2xl` y compañía no son roles: son medidas sueltas. Los
  // nueve roles ya cubren desde el metadato hasta el titular.
  const infractores: string[] = []
  for (const archivo of todos()) {
    for (const m of readFileSync(archivo, 'utf8').matchAll(/\btext-(?:lg|2xl|3xl|4xl|5xl)\b/g)) {
      infractores.push(`${archivo}: ${m[0]}`)
    }
  }
  assert.deepEqual(infractores, [], 'Usa .text-h1 … .text-overline:\n' + infractores.join('\n'))
})

test('los estados del escáner se pintan con tokens', () => {
  // El aviso de cola sin conexión usaba `amber-500` con su `dark:` a mano. Es
  // el mensaje que dice "tienes registros sin enviar, revísalos antes de
  // cerrar turno": si se ve mal en oscuro, se pierde dinero de verdad.
  const prohibidos = /\b(?:text|bg|border|ring)-(?:emerald|green|teal|red|amber|orange)-\d{3}\b/
  const infractores: string[] = []
  for (const archivo of todos()) {
    const m = readFileSync(archivo, 'utf8').match(prohibidos)
    if (m) infractores.push(`${archivo}: ${m[0]}`)
  }
  assert.deepEqual(
    infractores,
    [],
    'Usa success / warning / destructive / info:\n' + infractores.join('\n')
  )
})

test('descartar un registro pendiente no es un objetivo diminuto', () => {
  // Medía 28px de alto (`h-7`). Es una acción DESTRUCTIVA —tira un registro
  // que no se pudo enviar, justo los que el propio aviso pide revisar— y se
  // toca con el móvil en una mano. Un objetivo así se pulsa sin querer.
  const src = readFileSync(join('src', 'components', 'scanner', 'IndicadorCola.tsx'), 'utf8')

  // Los iconos SÍ son pequeños y son cuadrados (`h-4 w-4`): se quitan antes de
  // buscar, porque lo que se vigila es la altura de lo que se toca, no la del
  // dibujo que lleva dentro.
  const sinIconos = src.replace(/\bh-(\d+(?:\.\d+)?)\s+w-\1\b/g, '')
  const alturasPequenas = sinIconos.match(/\bh-([1-9]|10)\b/g)

  assert.equal(
    alturasPequenas,
    null,
    `IndicadorCola fija alturas por debajo del objetivo táctil (${alturasPequenas?.join(', ')}): usa min-h-11`
  )
  assert.ok(src.includes('min-h-11'), 'los botones del aviso de cola deben medir al menos 44px')
})
