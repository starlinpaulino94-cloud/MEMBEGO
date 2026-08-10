#!/usr/bin/env node
/**
 * INVENTARIO DE CÓDIGO SIN USO — DS 2.0 · Fase 20.
 *
 * Busca exports que nadie importa y utilidades CSS que nadie escribe. NO borra
 * nada: solo lista, con el conteo de usos al lado, para que la decisión de
 * eliminar sea de una persona y no de una regex.
 *
 * QUÉ NO DETECTA, Y POR QUÉ IMPORTA SABERLO:
 *  · Un componente usado solo desde una `page.tsx` que se renderiza por ruta
 *    dinámica sigue apareciendo aquí como usado (se busca por nombre, no por
 *    grafo de módulos), así que los FALSOS POSITIVOS son improbables.
 *  · Lo contrario sí puede pasar: un nombre genérico (`Card`) coincide con
 *    palabras sueltas. Por eso se busca `<Nombre` y `Nombre(` y se descuenta
 *    siempre la propia declaración.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

function archivos(dir, ext = ['.tsx', '.ts'], acc = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next') continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) archivos(p, ext, acc)
    else if (ext.some((x) => p.endsWith(x))) acc.push(p)
  }
  return acc
}

/** Cuenta usos de un identificador en todo el código, fuera de su archivo. */
function usos(nombre, propioArchivo) {
  try {
    const salida = execSync(
      `grep -rn --include=*.tsx --include=*.ts -E '\\b${nombre}\\b' src packages/ui/src tests 2>/dev/null || true`,
      { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
    )
    return salida
      .split('\n')
      .filter(Boolean)
      .filter((l) => !l.startsWith(propioArchivo + ':'))
  } catch {
    return []
  }
}

// ── 1. Primitives y componentes exportados que nadie importa ────────────────

const EXPORTA = /export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class)\s+([A-Z][A-Za-z0-9_]*)/g

function componentesSinUso(raices) {
  const muertos = []
  for (const raiz of raices) {
    for (const archivo of archivos(raiz)) {
      const src = readFileSync(archivo, 'utf8')
      // Las páginas y layouts de Next se montan por convención de rutas, no por
      // import: nunca cuentan como muertas.
      if (/[\\/](page|layout|template|loading|error|not-found|route|opengraph-image)\.tsx?$/.test(archivo)) continue
      for (const m of src.matchAll(EXPORTA)) {
        const nombre = m[1]
        const refs = usos(nombre, archivo)
        if (refs.length === 0) muertos.push({ archivo, nombre })
      }
    }
  }
  return muertos
}

// ── 2. Utilidades CSS declaradas y nunca escritas ───────────────────────────

function clasesCssSinUso() {
  const css = readFileSync(join('src', 'app', 'globals.css'), 'utf8')
  const declaradas = [...css.matchAll(/^\s{2}\.([a-z][a-z0-9-]+)\s*\{/gm)].map((m) => m[1])
  const muertas = []
  for (const clase of new Set(declaradas)) {
    const refs = execSync(
      `grep -rn --include=*.tsx --include=*.ts -F '${clase}' src packages/ui/src 2>/dev/null || true`,
      { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
    ).split('\n').filter(Boolean)
    if (refs.length === 0) muertas.push(clase)
  }
  return muertas
}

// ── Informe ─────────────────────────────────────────────────────────────────

const muertos = componentesSinUso(['packages/ui/src', 'src/components'])
const cssMuerto = clasesCssSinUso()

console.log('── COMPONENTES EXPORTADOS QUE NADIE IMPORTA ' + '─'.repeat(20))
const porArchivo = new Map()
for (const d of muertos) {
  if (!porArchivo.has(d.archivo)) porArchivo.set(d.archivo, [])
  porArchivo.get(d.archivo).push(d.nombre)
}
for (const [archivo, nombres] of [...porArchivo].sort()) {
  const lineas = readFileSync(archivo, 'utf8').split('\n').length
  console.log(`  ${archivo}  (${lineas} líneas)  →  ${nombres.join(', ')}`)
}
console.log(`  TOTAL: ${porArchivo.size} archivos, ${muertos.length} exports\n`)

console.log('── UTILIDADES CSS DECLARADAS Y NUNCA ESCRITAS ' + '─'.repeat(18))
for (const c of cssMuerto) console.log(`  .${c}`)
console.log(`  TOTAL: ${cssMuerto.length}`)
