#!/usr/bin/env node
/**
 * ACOPLAMIENTO DE UN VERTICAL CON EL NÚCLEO (plataforma · Fase 6).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ MIDE
 *
 * Cuántas veces el vertical Car Wash lee o escribe DIRECTAMENTE una tabla que
 * pertenece al Core (§14: identidad, clientes, vehículos, membresías,
 * sucursales, visitas, transacciones).
 *
 * Cada una de esas veces es una línea que habrá que reescribir el día que Car
 * Wash salga del monolito — el día con menos margen de todos. El número es la
 * deuda de esa extracción, medida en vez de supuesta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE SCRIPT Y NO UN `grep`
 *
 * El patrón obvio —`tx.cliente.`— no encuentra esto:
 *
 *     tx.vehiculo
 *       .findFirst({ ... })
 *
 * ...que es como está escrito medio código. La primera versión de esta medida
 * usaba ese patrón y contaba 22 donde había 25. Un número que se cree y es
 * falso es peor que no medir: se toman decisiones con él.
 *
 * Aquí se normalizan los espacios antes de contar, así que el salto de línea
 * deja de esconder nada.
 *
 * USO
 *   node scripts/acoplamiento-vertical.mjs            # resumen
 *   node scripts/acoplamiento-vertical.mjs --detalle  # con archivos
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Modelos del Core según §14 (data ownership). Los demás son del vertical. */
const MODELOS_CORE = [
  'cliente', 'vehiculo', 'user', 'visit', 'sucursal', 'membership',
  'company', 'plan', 'promocion', 'productoCompra', 'qrToken', 'transaction',
]

const VERTICAL = join('src', 'modules', 'carwash')

function archivos(dir) {
  const acc = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) acc.push(...archivos(p))
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) acc.push(p)
  }
  return acc
}

export function medirAcoplamiento(dir = VERTICAL) {
  const porArchivo = {}
  const porModelo = {}
  let total = 0

  for (const archivo of archivos(dir)) {
    // Los espacios y saltos entre `tx.modelo` y `.metodo` se colapsan ANTES de
    // buscar: es lo que la primera versión de esta medida no hacía.
    const src = readFileSync(archivo, 'utf8').replace(/\s+/g, ' ')
    for (const modelo of MODELOS_CORE) {
      const re = new RegExp(`\\b(tx|prisma)\\s*\\.\\s*${modelo}\\s*\\.`, 'g')
      const n = (src.match(re) ?? []).length
      if (!n) continue
      porArchivo[archivo] = (porArchivo[archivo] ?? 0) + n
      porModelo[modelo] = (porModelo[modelo] ?? 0) + n
      total += n
    }
  }
  return { total, porArchivo, porModelo }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { total, porArchivo, porModelo } = medirAcoplamiento()
  console.log('\nAcoplamiento de Car Wash con el núcleo')
  console.log('────────────────────────────────────────────────────────────')
  console.log(`Toques directos a tablas del Core: ${total}`)
  console.log(
    '  ' +
      Object.entries(porModelo)
        .sort((a, b) => b[1] - a[1])
        .map(([m, n]) => `${m}:${n}`)
        .join('  ')
  )
  if (process.argv.includes('--detalle')) {
    console.log('')
    for (const [f, n] of Object.entries(porArchivo).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}  ${f}`)
    }
  }
  console.log(
    '\nCada uno es una línea que habrá que reescribir al extraer el vertical.\n' +
      'Lo que ya pasa por @membego/contracts no cuenta aquí, y ese es el punto.\n'
  )
}
