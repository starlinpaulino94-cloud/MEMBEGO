#!/usr/bin/env node
/**
 * PRESUPUESTOS DE RENDIMIENTO DEL BUNDLE (auditoría · Fase 7, punto 29).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ PROBLEMA RESUELVE
 *
 * El JavaScript de una aplicación web solo crece. Nunca hay un día en que
 * alguien decida "hoy engordamos el bundle": hay cien días en que se añade una
 * librería de gráficos, un selector de fechas, un lector de QR, y cada uno
 * suma cincuenta kilobytes que nadie mira. Un año después la aplicación tarda
 * seis segundos en abrir en un teléfono de gama media con datos móviles, y ya
 * no se puede señalar al culpable porque no hay uno.
 *
 * Un presupuesto convierte eso en una decisión consciente: el día que se pasa,
 * el CI falla y alguien tiene que mirar qué entró y decidir si vale la pena.
 * No prohíbe crecer — prohíbe crecer *sin darse cuenta*.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE MIDE ASÍ Y NO CON "First Load JS"
 *
 * El número que todo el mundo cita es el "First Load JS" que imprime
 * `next build`. Con Next 16 y esta configuración esa tabla ya no sale, así que
 * parsear la salida del build no es una base sobre la que construir nada.
 *
 * Se miden los bytes en disco de `.next/static/chunks`, que es lo que de verdad
 * se descarga. Tres números, cada uno responde a una pregunta distinta:
 *
 *   · TOTAL — todo el JavaScript de cliente que existe. Crece con cada
 *     funcionalidad y no lo paga un usuario concreto; es el indicador de si
 *     el proyecto se está haciendo pesado en general.
 *   · ENTRADA COMPARTIDA — lo que se descarga SIEMPRE, en cualquier página, la
 *     primera vez. Este es el que de verdad siente el usuario. Es el que hay
 *     que vigilar como un perro.
 *   · MAYOR TROZO — el trozo individual más grande. Un trozo enorme suele ser
 *     una librería que se coló en el camino común en vez de cargarse a
 *     demanda; suele ser el hallazgo más accionable de los tres.
 *
 * SIN COMPRIMIR. Los bytes que viajan van con gzip o brotli y son bastante
 * menos, pero el tamaño sin comprimir es el que el navegador tiene que PARSEAR
 * y COMPILAR, y en un teléfono de gama media eso pesa más que la descarga.
 * Además es estable: no depende de cómo tenga configurada la compresión el CDN.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DE DÓNDE SALEN LOS NÚMEROS DE ABAJO
 *
 * Del estado real del proyecto el día que se escribió esto (Fase 7), con un
 * margen deliberado por encima. NO son objetivos: son techos. La diferencia
 * importa —un objetivo se persigue, un techo se respeta— y hoy la aplicación
 * está por debajo de todos.
 *
 * Si algún día el CI falla aquí, las opciones en orden: (1) mirar qué entró y
 * cargarlo con `next/dynamic`, (2) buscar una alternativa más ligera,
 * (3) subir el techo A PROPÓSITO y anotar por qué. La tercera es legítima; lo
 * que no vale es subirlo sin mirar.
 *
 * USO:  npm run build && npm run presupuesto
 * ────────────────────────────────────────────────────────────────────────────
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR_CHUNKS = join(RAIZ, '.next', 'static', 'chunks')
const MANIFIESTO = join(RAIZ, '.next', 'build-manifest.json')

const KB = 1024

/**
 * Los techos. Medidos en la Fase 7 y con margen:
 *   total ≈ 5.2 MB · entrada ≈ 820 KB · mayor trozo ≈ 493 KB
 */
const PRESUPUESTOS = [
  {
    id: 'total',
    nombre: 'JavaScript de cliente (todo)',
    techoKB: 7500, // 2026-09-02: subido de 7000 por el módulo CRM (169 KB en 5 rutas de cliente). No es una librería: es funcionalidad. Se sube con margen porque un techo a 3 KB del valor real no es un presupuesto, es un cable trampa
    porque: 'Indicador general de peso del proyecto. Ningún usuario lo descarga entero.',
  },
  {
    id: 'entrada',
    nombre: 'Entrada compartida (se descarga siempre)',
    techoKB: 1000,
    porque:
      'ESTE es el que siente el usuario en la primera carga. En 4G de Santo Domingo, ' +
      'cada 100 KB de más son ~0,3 s antes de ver algo.',
  },
  {
    id: 'mayor',
    nombre: 'Trozo individual más grande',
    techoKB: 600,
    porque:
      'Un trozo enorme casi siempre es una librería que debería cargarse a demanda ' +
      'con next/dynamic (como ya se hace con el lector de QR).',
  },
]

const C = { ok: '\x1b[32m', mal: '\x1b[31m', avi: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' }
const kb = (bytes) => Math.round(bytes / KB)

function archivosJs(dir) {
  const salida = []
  const recorrer = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) recorrer(p)
      else if (p.endsWith('.js')) salida.push([p, statSync(p).size])
    }
  }
  recorrer(dir)
  return salida
}

// ── medición ────────────────────────────────────────────────────────────────

if (!existsSync(DIR_CHUNKS)) {
  console.error(`${C.mal}✗${C.off} No hay build. Corre \`npm run build\` primero.`)
  process.exit(1)
}

const archivos = archivosJs(DIR_CHUNKS).sort((a, b) => b[1] - a[1])
const total = archivos.reduce((a, [, s]) => a + s, 0)
const mayor = archivos[0]?.[1] ?? 0

let entrada = 0
try {
  const manifiesto = JSON.parse(readFileSync(MANIFIESTO, 'utf8'))
  for (const f of manifiesto.rootMainFiles ?? []) {
    const p = join(RAIZ, '.next', f)
    if (existsSync(p)) entrada += statSync(p).size
  }
} catch {
  console.error(`${C.avi}!${C.off} No se pudo leer build-manifest.json; se omite la entrada compartida.`)
}

const medido = { total, entrada, mayor }

// ── veredicto ───────────────────────────────────────────────────────────────

console.log('\nPresupuestos de bundle — MembeGo')
console.log('─'.repeat(58))

let excedidos = 0
for (const p of PRESUPUESTOS) {
  const valorKB = kb(medido[p.id])
  if (valorKB === 0) continue

  const uso = valorKB / p.techoKB
  const excede = valorKB > p.techoKB
  if (excede) excedidos++

  const marca = excede ? `${C.mal}✗${C.off}` : uso > 0.9 ? `${C.avi}!${C.off}` : `${C.ok}✓${C.off}`
  console.log(
    `${marca} ${p.nombre.padEnd(42)} ${String(valorKB).padStart(5)} KB / ${p.techoKB} KB  (${Math.round(uso * 100)}%)`
  )
  if (excede || uso > 0.9) console.log(`${C.dim}    ${p.porque}${C.off}`)
}

console.log(`\n${C.dim}Los cinco trozos más grandes:${C.off}`)
for (const [ruta, tam] of archivos.slice(0, 5)) {
  console.log(`${C.dim}  ${String(kb(tam)).padStart(5)} KB  ${ruta.replace(RAIZ + '/', '')}${C.off}`)
}

if (excedidos > 0) {
  console.log(
    `\n${C.mal}✗${C.off} ${excedidos} presupuesto(s) excedido(s). Mira qué entró en el último cambio.`
  )
  console.log(`${C.dim}  Opciones: cargar a demanda con next/dynamic, buscar algo más ligero,${C.off}`)
  console.log(`${C.dim}  o subir el techo a propósito anotando por qué en este archivo.${C.off}\n`)
  process.exit(1)
}

console.log(`\n${C.ok}✓${C.off} Dentro de presupuesto.\n`)
