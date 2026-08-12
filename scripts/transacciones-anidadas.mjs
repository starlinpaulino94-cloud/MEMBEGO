#!/usr/bin/env node
/**
 * TRANSACCIONES ANIDADAS — el punto ciego que dejó la migración de RLS.
 *
 * `conEmpresa`/`sinEmpresa`/`conEmpresaOTodas`/`conUsuario` abren un
 * `prisma.$transaction`. Llamar DENTRO de ese callback a una función que abre la
 * suya pide una segunda conexión desde dentro de una abierta: con un pooler
 * delante, así se agota el pool. No da un error claro — da timeouts
 * intermitentes bajo carga, que es la peor forma de fallar.
 *
 * POR QUÉ HACE FALTA ESTO. Al migrar los 85 archivos comprobé que no quedaran
 * llamadas `prisma.` sueltas dentro de un envoltorio. Esa comprobación es
 * necesaria y NO es suficiente: no ve una LLAMADA A FUNCIÓN que por dentro abre
 * su propia transacción. Dos se colaron en el panel de plataforma y sobrevivieron
 * a un «cero transacciones anidadas, comprobado».
 *
 * CÓMO BUSCA. Para cada archivo:
 *   1. Localiza los envoltorios y extrae el cuerpo de su callback por
 *      paréntesis balanceados.
 *   2. Reúne los nombres SOSPECHOSOS: funciones del propio archivo que
 *      contienen un envoltorio, y nombres importados de módulos que exportan
 *      funciones con envoltorio.
 *   3. Si el cuerpo del callback llama a uno de esos nombres, lo reporta.
 *
 * Prefiere avisar de más: un falso positivo se descarta leyendo tres líneas,
 * un falso negativo son timeouts en producción.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const C = { ok: '\x1b[32m', mal: '\x1b[31m', dim: '\x1b[2m', off: '\x1b[0m' }
const ENVOLTORIOS = ['conEmpresaOTodas', 'conEmpresa', 'sinEmpresa', 'conUsuario']
const RAIZ = 'src'

function archivos(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) archivos(p, acc)
    else if (/\.tsx?$/.test(p) && !/\.(test|spec)\.tsx?$/.test(p)) acc.push(p)
  }
  return acc
}

/** Índice del paréntesis que cierra el que abre en `apertura`. */
function cierre(texto, apertura) {
  const pares = { '(': ')', '[': ']', '{': '}' }
  const pila = [pares[texto[apertura]]]
  let i = apertura + 1
  while (i < texto.length && pila.length) {
    const c = texto[i]
    if ('([{'.includes(c)) pila.push(pares[c])
    else if (')]}'.includes(c)) { if (c === pila[pila.length - 1]) pila.pop() }
    else if (`'"\``.includes(c)) {
      const comilla = c
      i++
      while (i < texto.length && texto[i] !== comilla) { if (texto[i] === '\\') i++; i++ }
    }
    i++
  }
  return i - 1
}

/** Cuerpos de los callbacks de cada envoltorio del archivo, con su línea. */
function cuerposDeEnvoltorio(src) {
  const fuera = []
  const re = new RegExp(`\\b(${ENVOLTORIOS.join('|')})\\s*\\(`, 'g')
  let m
  while ((m = re.exec(src))) {
    const abre = m.index + m[0].length - 1
    const fin = cierre(src, abre)
    if (fin <= abre) continue
    fuera.push({
      envoltorio: m[1],
      linea: src.slice(0, m.index).split('\n').length,
      cuerpo: src.slice(abre + 1, fin),
    })
    re.lastIndex = abre + 1 // permite detectar envoltorios anidados textualmente
  }
  return fuera
}

/**
 * ¿Este archivo define funciones que abren transacción? Devuelve sus nombres.
 *
 * Cuenta las DOS formas, y la segunda es la que se coló: `getEmpresaPrincipal`
 * es `export const X = unstable_cache(async () => { … sinEmpresa … })`, así que
 * buscar solo `function NOMBRE` la daba por inofensiva. Media búsqueda es peor
 * que ninguna, porque deja la sensación de haber mirado.
 *
 * Ambas anclan a principio de línea (`^`): así un `const` interno de otra
 * función no parte el trozo que se está analizando.
 */
function funcionesConEnvoltorio(src) {
  const nombres = new Set()
  const re = /^(?:export\s+)?(?:(?:async\s+)?function\s+|const\s+)([A-Za-z_$][\w$]*)/gm
  let m
  const marcas = []
  while ((m = re.exec(src))) marcas.push({ nombre: m[1], desde: m.index })
  for (let i = 0; i < marcas.length; i++) {
    const hasta = i + 1 < marcas.length ? marcas[i + 1].desde : src.length
    const cuerpo = src.slice(marcas[i].desde, hasta)
    if (ENVOLTORIOS.some((e) => new RegExp(`\\b${e}\\s*\\(`).test(cuerpo))) {
      nombres.add(marcas[i].nombre)
    }
  }
  return nombres
}

// ── Mapa de módulos: qué exporta cada archivo que abra transacción ───────────
const todos = archivos(RAIZ)
const exportaConEnvoltorio = new Map() // ruta sin extensión → Set(nombres)
for (const ruta of todos) {
  const src = readFileSync(ruta, 'utf8')
  if (!ENVOLTORIOS.some((e) => src.includes(e))) continue
  const clave = ruta.replace(/\.tsx?$/, '')
  exportaConEnvoltorio.set(clave, funcionesConEnvoltorio(src))
}

/** Nombres importados que, en su módulo, abren transacción. */
function importadosPeligrosos(src) {
  const peligrosos = new Set()
  const re = /import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g
  let m
  while ((m = re.exec(src))) {
    const origen = m[2]
    if (!origen.startsWith('@/') && !origen.startsWith('.')) continue
    const clave = origen.startsWith('@/') ? 'src/' + origen.slice(2) : null
    const candidatos = clave
      ? [clave, clave + '/index']
      : [...exportaConEnvoltorio.keys()].filter((k) => k.endsWith(origen.replace(/^\.+\//, '')))
    const exportados = candidatos.map((c) => exportaConEnvoltorio.get(c)).find(Boolean)
    if (!exportados) continue
    for (const nombre of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop())) {
      if (exportados.has(nombre)) peligrosos.add(nombre)
    }
  }
  return peligrosos
}

let hallazgos = 0
for (const ruta of todos) {
  const src = readFileSync(ruta, 'utf8')
  if (!ENVOLTORIOS.some((e) => src.includes(e))) continue

  const locales = funcionesConEnvoltorio(src)
  const importados = importadosPeligrosos(src)
  const sospechosos = new Set([...locales, ...importados])
  if (!sospechosos.size) continue

  for (const { envoltorio, linea, cuerpo } of cuerposDeEnvoltorio(src)) {
    for (const nombre of sospechosos) {
      // La llamada, no la definición ni una mención en un comentario.
      const sinComentarios = cuerpo.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
      const llamada = new RegExp(`\\b${nombre}\\s*\\(`, 'g')
      let c
      while ((c = llamada.exec(sinComentarios))) {
        // PASAR EL `tx` NO ES ANIDAR, ES LO CONTRARIO.
        //
        // Muchas de estas funciones aceptan un `tx` opcional justamente para
        // poder participar en la transacción de quien llama. Marcarlas sería
        // enseñar a ignorar este aviso, que es la peor consecuencia posible
        // para una guardia: la que grita siempre deja de oírse.
        const abre = c.index + c[0].length - 1
        const args = sinComentarios.slice(abre + 1, cierre(sinComentarios, abre))
        if (/(^|[\s,(])tx\b|(^|[\s,(])t\b/.test(args)) continue

        hallazgos++
        console.log(
          `${C.mal}✗${C.off} ${ruta}:${linea}  ${C.dim}${envoltorio}(…) llama a${C.off} ${nombre}()`
        )
        break
      }
    }
  }
}

console.log('─'.repeat(60))
if (hallazgos) {
  console.log(`${C.mal}✗${C.off} ${hallazgos} transacción(es) anidada(s).`)
  console.log(
    `${C.dim}  Saca la llamada FUERA del envoltorio, o pásale el \`tx\` que ya está abierto.${C.off}`
  )
  process.exit(1)
}
console.log(`${C.ok}✓${C.off} Ninguna transacción anidada.`)
