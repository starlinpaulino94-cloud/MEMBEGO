#!/usr/bin/env node
/**
 * EL CORE NO CONOCE A NINGÚN VERTICAL (plataforma · Fase 7).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ MIDE, Y POR QUÉ ESTA MEDIDA Y NO OTRA
 *
 * La pregunta de la Fase 7 es «¿se integra un sistema nuevo sin tocar el
 * Core?». La forma ingenua de comprobarlo sería buscar la palabra «restaurant»
 * por el código — y no serviría: MembeGo tiene restaurantes de verdad en su
 * marketplace, en sus categorías y en sus datos de demostración. Esa búsqueda
 * daría decenas de aciertos legítimos y el número no significaría nada.
 *
 * Lo que de verdad rompe la arquitectura no es NOMBRAR un vertical: es
 * RAMIFICAR por él.
 *
 *     if (sistema.slug === 'restaurant') { ... }     ← esto es la deuda
 *     switch (categoria) { case 'CAR_WASH': ... }    ← y esto
 *
 * Cada una de esas líneas es un despliegue de MembeGo por cada vertical nuevo,
 * que es exactamente el techo que esta arquitectura existe para quitar. Con
 * doscientos sistemas conectados, ese `switch` es el negocio entero parado
 * esperando a que alguien lo edite.
 *
 * Así que se busca la COMPARACIÓN, no la palabra. Y se busca solo en la capa de
 * plataforma: el módulo `carwash` puede hablar de lavados cuanto quiera, porque
 * es un vertical, no el Core.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS COMENTARIOS NO CUENTAN
 *
 * Se quitan antes de buscar. Una guardia que falla con la documentación que
 * explica por qué existe enseña una sola cosa: a borrar la documentación.
 *
 * USO
 *   node scripts/nucleo-sin-verticales.mjs
 *   node scripts/nucleo-sin-verticales.mjs --detalle
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * La capa de plataforma: lo que tiene que servir a CUALQUIER vertical. Fuera de
 * aquí, nombrar un vertical es lo normal —`modules/carwash` habla de placas—.
 */
const CAPA_PLATAFORMA = [
  join('src', 'modules', 'plataforma'),
  join('src', 'app', 'api', 'platform'),
  join('src', 'app', 'sso'),
  join('packages', 'contracts', 'src'),
  join('packages', 'platform-sdk', 'src'),
]

/**
 * Nombres de variable que denotan «qué vertical es este». Comparar uno de
 * ellos contra una cadena fija es ramificar por vertical.
 */
const SUJETOS = ['slug', 'categoria', 'vertical', 'sistema', 'tipoNegocio', 'businessType']

/** `x.slug === 'algo'`, `slug !== "algo"`, `case 'algo':` dentro de un switch. */
function patrones() {
  const sujeto = `(?:\\w+\\.)?(?:${SUJETOS.join('|')})\\w*`
  return [
    // comparación en cualquiera de los dos sentidos
    new RegExp(`${sujeto}\\s*[=!]==?\\s*['"\`][\\w-]+['"\`]`, 'gi'),
    new RegExp(`['"\`][\\w-]+['"\`]\\s*[=!]==?\\s*${sujeto}\\b`, 'gi'),
    // pertenencia a una lista fija de verticales
    new RegExp(`\\[[^\\]\\n]*['"\`][\\w-]+['"\`][^\\]\\n]*\\]\\s*\\.\\s*includes\\s*\\(\\s*${sujeto}`, 'gi'),
  ]
}

/**
 * Quita comentarios de bloque y de línea. Lo que se documenta no se juzga.
 *
 * SE EXPORTA A PROPÓSITO. Cuatro guardias de este proyecto han fallado ya
 * contra su propia documentación —el archivo explicaba en un comentario justo
 * lo que la prueba prohibía— y la lección de las cuatro es la misma: una prueba
 * que lee código tiene que leer CÓDIGO. Con el quitador suelto en un sitio, la
 * quinta no repite el error.
 *
 * El `[^:]` de las líneas evita cortar en `https://`, que aparece en cualquier
 * URL y no abre un comentario.
 */
export function sinComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function archivos(dir) {
  const acc = []
  let entradas
  try {
    entradas = readdirSync(dir)
  } catch {
    return acc
  }
  for (const e of entradas) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) acc.push(...archivos(p))
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) acc.push(p)
  }
  return acc
}

/**
 * Ramificaciones dentro de UN texto. Separado para que la guardia pueda
 * comprobarse a sí misma: una medida que siempre da cero porque no sabe buscar
 * es indistinguible de un código limpio, y peor, porque nadie la revisa.
 */
export function ramificacionesEn(fuente, archivo = '<texto>') {
  const hallazgos = []
  const lineas = sinComentarios(fuente).split('\n')
  for (const re of patrones()) {
    for (let i = 0; i < lineas.length; i++) {
      for (const m of lineas[i].matchAll(re)) {
        hallazgos.push({ archivo, linea: i + 1, texto: m[0].trim() })
      }
    }
  }
  return hallazgos
}

export function medirRamificaciones(dirs = CAPA_PLATAFORMA) {
  const hallazgos = []
  for (const dir of dirs) {
    for (const archivo of archivos(dir)) {
      hallazgos.push(...ramificacionesEn(readFileSync(archivo, 'utf8'), archivo))
    }
  }
  return hallazgos
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const hallazgos = medirRamificaciones()
  console.log('\nRamificaciones por vertical en la capa de plataforma')
  console.log('────────────────────────────────────────────────────────────')
  console.log(`Encontradas: ${hallazgos.length}`)
  if (process.argv.includes('--detalle')) {
    for (const h of hallazgos) console.log(`  ${h.archivo}:${h.linea}  ${h.texto}`)
  }
  console.log(
    '\nCada una es un despliegue de MembeGo por cada vertical nuevo.\n' +
      'Nombrar un vertical no cuenta; ramificar por él, sí.\n'
  )
}
