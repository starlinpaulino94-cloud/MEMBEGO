#!/usr/bin/env node
/**
 * SELLA LAS MIGRACIONES  ·  `npm run migraciones:sellar`
 *
 * Regenera `prisma/migrations/SUMAS.txt` con el SHA-256 de cada
 * `migration.sql`. Es la misma suma que Prisma guarda en `_prisma_migrations`
 * al aplicar la migración, y por eso el archivo vale como cerrojo.
 *
 * Editar una migración ya aplicada NO rompe `migrate deploy` —se comprobó
 * contra Prisma 6.19.3 y sale en verde—, pero sí rompe `migrate dev`, que exige
 * `migrate reset` y borra la base de desarrollo del siguiente que toque el
 * esquema. Y deja el archivo describiendo algo distinto de lo que se aplicó.
 *
 * SOLO SE EJECUTA AL AÑADIR UNA MIGRACIÓN NUEVA. Si la prueba falla por una que
 * ya existía, la respuesta no es sellar: es deshacer la edición.
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = fileURLToPath(new URL('../prisma/migrations', import.meta.url))
export const ARCHIVO = join(RAIZ, 'SUMAS.txt')

/** Nombre → sha256 del `migration.sql`, ordenado por nombre. */
export function sumasEnDisco() {
  const out = new Map()
  for (const nombre of readdirSync(RAIZ, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()) {
    const sql = readFileSync(join(RAIZ, nombre, 'migration.sql'))
    out.set(nombre, createHash('sha256').update(sql).digest('hex'))
  }
  return out
}

/** Nombre → sha256 tal como quedó sellado. Ignora comentarios y vacías. */
export function sumasSelladas() {
  const out = new Map()
  for (const linea of readFileSync(ARCHIVO, 'utf8').split('\n')) {
    const limpia = linea.trim()
    if (!limpia || limpia.startsWith('#')) continue
    const [suma, nombre] = limpia.split(/\s+/)
    out.set(nombre, suma)
  }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cabecera = readFileSync(ARCHIVO, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('#') || l.trim() === '')
    .join('\n')
    .replace(/\n+$/, '\n')
  const cuerpo = [...sumasEnDisco()].map(([nombre, suma]) => `${suma}  ${nombre}`).join('\n')
  writeFileSync(ARCHIVO, `${cabecera}\n${cuerpo}\n`)
  console.log(`Selladas ${sumasEnDisco().size} migraciones en prisma/migrations/SUMAS.txt`)
}
