#!/usr/bin/env node
/**
 * GUARDIA DEL CATÁLOGO DE PERMISOS (bidireccional).
 *
 * `src/lib/auth/funciones.ts` declara una REGLA DE HONESTIDAD: allí solo se
 * listan funciones que una guardia hace cumplir de verdad. La regla estaba
 * escrita y se comprobaba a mano, sección por sección, en tres pruebas
 * sueltas: 3 de 16 secciones vigiladas. Este guion la comprueba entera, y
 * comprueba además la dirección contraria, que nadie había mirado.
 *
 * LAS DOS DIRECCIONES, Y POR QUÉ LAS DOS DUELEN
 *
 *  A · Catálogo sin guardia = INTERRUPTOR PINTADO. El panel enseña la casilla,
 *      el administrador la apaga, y la action pasa igual. Se promete un
 *      control que no existe.
 *
 *  B · Guardia sin catálogo = GUARDIA MUERTA, y es la peor de las dos porque
 *      no se ve. `guardarPermisosEmpleado` valida `funcionesNegadas` contra
 *      este catálogo y DESCARTA lo que no esté, así que un código ausente no
 *      se puede negar jamás: `funcionPermitida` solo niega ante un `false`
 *      explícito y ese `false` nunca llega a la base. En el código parece un
 *      permiso fino; en producción es un `if` que siempre pasa.
 *
 *      Así entró el fallo del CRM (24-09-2026): nueve actions de prospectos y
 *      respuestas automáticas pedían `requireSection('clientes', …)` cuando
 *      todo el CRM se gobierna con 'leads'. CAJERO y SUPERVISOR traen
 *      'clientes' y no 'leads' — no podían abrir el CRM y aun así pasaban las
 *      nueve, porque una server action se despacha por su id desde cualquier
 *      ruta permitida.
 *
 * CÓMO RECONOCE UNA GUARDIA
 *
 * No basta con buscar `requireSection('sec', 'cod')` literal: hay guardias
 * legítimas que eligen la función antes de llamar —
 * `const funcion = estado === 'ARCHIVADA' ? 'catalogo_archivar' : 'catalogo_editar'`—
 * y otras que filtran lectura con `puedeFuncion`. Un guion que solo viera el
 * literal señalaría a siete guardias que sí existen, y una guardia que señala
 * a quien no es enseña a ignorarla. Por eso el reconocimiento es por ARCHIVO:
 * un archivo que guarda la sección Y menciona el código cuenta como cableado.
 *
 * Correr: node scripts/permisos-catalogo.mjs   (también en el CI)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = new URL('..', import.meta.url).pathname
const CATALOGO = join(RAIZ, 'src/lib/auth/funciones.ts')

/** Todas las formas de pedir permiso que existen hoy en el código. */
const GUARDIAS = [
  /requireSection\(\s*'([a-z0-9-]+)'/g,
  /requireAdminUser\(\s*'([a-z0-9-]+)'/g,
  /puedeFuncion\(\s*'([a-z0-9-]+)'/g,
  /usuarioPuedeFuncion\(\s*[A-Za-z_$][\w$]*\s*,\s*'([a-z0-9-]+)'/g,
]

/** Pares (sección, función) escritos con los dos literales a la vista. */
const PARES_LITERALES = [
  /requireSection\(\s*'([a-z0-9-]+)'\s*,\s*'([a-z0-9_]+)'/g,
  /puedeFuncion\(\s*'([a-z0-9-]+)'\s*,\s*'([a-z0-9_]+)'/g,
  /usuarioPuedeFuncion\(\s*[A-Za-z_$][\w$]*\s*,\s*'([a-z0-9-]+)'\s*,\s*'([a-z0-9_]+)'/g,
]

/** `requireSection('sec', variable)` — la función se decidió más arriba. */
const PARES_VARIABLE = /(?:requireSection|puedeFuncion)\(\s*'([a-z0-9-]+)'\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g

function sinComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * Lee el catálogo emparejando corchetes, no línea a línea: hay secciones
 * escritas en una sola línea (`notificaciones: [{ codigo: 'enviar', … }]`) y
 * un lector por líneas se las come en silencio — precisamente las que después
 * nadie comprueba.
 */
function leerCatalogo() {
  const src = sinComentarios(readFileSync(CATALOGO, 'utf8'))
  const inicio = src.indexOf('export const FUNCIONES_POR_SECCION')
  if (inicio === -1) throw new Error('no se encontró FUNCIONES_POR_SECCION')
  const abre = src.indexOf('{', inicio)
  let nivel = 0
  let fin = abre
  for (let i = abre; i < src.length; i++) {
    if (src[i] === '{') nivel++
    else if (src[i] === '}' && --nivel === 0) { fin = i; break }
  }
  const cuerpo = src.slice(abre + 1, fin)

  const pares = []
  const re = /'?([a-z0-9-]+)'?\s*:\s*\[/g
  let m
  while ((m = re.exec(cuerpo))) {
    const seccion = m[1]
    let nivelC = 0
    let cierre = m.index
    for (let i = cuerpo.indexOf('[', m.index); i < cuerpo.length; i++) {
      if (cuerpo[i] === '[') nivelC++
      else if (cuerpo[i] === ']' && --nivelC === 0) { cierre = i; break }
    }
    const lista = cuerpo.slice(m.index, cierre)
    for (const c of lista.matchAll(/codigo:\s*'([a-z0-9_]+)'/g)) pares.push([seccion, c[1]])
    re.lastIndex = cierre
  }
  return pares
}

function fuentes(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) fuentes(p, acc)
    else if (/\.tsx?$/.test(p)) acc.push(p)
  }
  return acc
}

const catalogo = leerCatalogo()
const enCatalogo = new Set(catalogo.map(([s, c]) => `${s}/${c}`))

const archivos = fuentes(join(RAIZ, 'src'))
  .filter((p) => p !== CATALOGO)
  .map((p) => ({ ruta: p.slice(RAIZ.length), src: sinComentarios(readFileSync(p, 'utf8')) }))

// ── A · toda función del catálogo tiene guardia viva ─────────────────────────

const sinGuardia = []
for (const [seccion, codigo] of catalogo) {
  const literal = new RegExp(`'${codigo}'`)
  const cableada = archivos.some((a) => {
    if (!literal.test(a.src)) return false
    return GUARDIAS.some((re) => {
      re.lastIndex = 0
      let m
      while ((m = re.exec(a.src))) if (m[1] === seccion) return true
      return false
    })
  })
  if (!cableada) sinGuardia.push(`${seccion} · ${codigo}`)
}

// ── B · toda función exigida en el código está en el catálogo ────────────────

const sinCatalogo = new Map()
for (const { ruta, src } of archivos) {
  const vistos = new Set()
  for (const re of PARES_LITERALES) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(src))) vistos.add(`${m[1]}/${m[2]}`)
  }
  // Forma indirecta: se resuelven los literales asignados a esa variable.
  PARES_VARIABLE.lastIndex = 0
  let m
  while ((m = PARES_VARIABLE.exec(src))) {
    const [, seccion, ident] = m
    const asig = new RegExp(`(?:const|let|var)\\s+${ident}\\s*[:=][^\\n;]*`, 'g')
    let a
    while ((a = asig.exec(src))) {
      for (const lit of a[0].matchAll(/'([a-z0-9_]+)'/g)) vistos.add(`${seccion}/${lit[1]}`)
    }
  }
  for (const clave of vistos) {
    if (!enCatalogo.has(clave) && !sinCatalogo.has(clave)) sinCatalogo.set(clave, ruta)
  }
}

// ── Veredicto ────────────────────────────────────────────────────────────────

const fallos = sinGuardia.length + sinCatalogo.size
if (fallos === 0) {
  console.log(`Catálogo de permisos correcto: ${catalogo.length} funciones, guardia viva en las dos direcciones.`)
  process.exit(0)
}

if (sinGuardia.length) {
  console.error('\nINTERRUPTOR PINTADO — en el catálogo, sin guardia que lo haga cumplir:')
  for (const f of sinGuardia) console.error('  ·', f)
  console.error('  Cablea su requireSection(seccion, funcion) o quítalo del catálogo.')
}
if (sinCatalogo.size) {
  console.error('\nGUARDIA MUERTA — exigida en el código, ausente del catálogo:')
  for (const [clave, ruta] of sinCatalogo) console.error('  ·', clave, '→', ruta)
  console.error('  Nadie puede negarla: el editor la descarta al validar. Añádela a')
  console.error('  FUNCIONES_POR_SECCION, o corrige la sección que nombra la guardia.')
}
console.error(`\n${fallos} problema(s).`)
process.exit(1)
