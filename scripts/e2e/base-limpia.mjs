#!/usr/bin/env node
/**
 * MEMBEGO · BASE DE DATOS DESECHABLE PARA EL RECORRIDO E2E.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE ESTO
 *
 * El E2E de los Slices 1–8 llevaba tiempo en rojo en local —9 de 18— y el
 * diagnóstico decía «problema del entorno». Lo era, y tenía una causa concreta:
 * se corría contra `membego_dev`, la base de desarrollo, que lleva acumulada la
 * basura de toda la historia del proyecto. Medido el 2026-10-03: 2 665 ofertas
 * ACTIVAS, 1 303 campañas, 920 redenciones, 6 365 compras y 367 885 filas de
 * bitácora.
 *
 * Con eso, estas pruebas fallan por dos motivos que no son del producto:
 *
 *   1. TIEMPO. Pantallas que listan cientos de filas tardan tanto que el
 *      recorrido agota su plazo. Dos recorridos del Slice 4 morían a los 420 s
 *      y 480 s; sobre una base limpia el archivo entero corre en 1,6 min.
 *   2. PRIMERA PÁGINA. Las pruebas buscan SU fila en tablas que hoy tienen
 *      cientos. Cuando la suya no entra en la primera página, la prueba dice
 *      «no existe».
 *
 * La respuesta NO es subir los plazos: eso esconde la causa y deja la suite
 * igual de frágil. La respuesta es que cada corrida parta de una base vacía,
 * que es además lo que el CI ya hacía (`.github/workflows/e2e.yml`) y lo que
 * `docs/PRUEBAS-E2E.md` ya recomendaba. Lo que se había desviado era la
 * práctica local.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA SALVAGUARDA
 *
 * Esto BORRA una base de datos. Para que no pueda borrar la equivocada, exige
 * que el nombre contenga `e2e` y rechaza cualquier otra cosa. No hay bandera
 * para saltárselo: si hace falta otro nombre, se cambia aquí y se lee por qué.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * USO
 *
 *   npm run e2e:base            # recrea la base y aplica el esquema
 *   E2E_DATABASE_URL=… npm run e2e:base
 *
 * Después, el servidor y Playwright tienen que apuntar a ESA base:
 *
 *   npm run e2e:limpio          # lo hace todo: base, servidor y recorrido
 */

import { execFileSync } from 'node:child_process'

const POR_DEFECTO = 'postgresql://postgres:postgres@127.0.0.1:5432/membego_e2e'
const url = process.env.E2E_DATABASE_URL?.trim() || POR_DEFECTO

const nombre = (() => {
  try {
    return new URL(url).pathname.replace(/^\//, '')
  } catch {
    console.error(`✗ E2E_DATABASE_URL no es una URL válida: ${url.replace(/:[^:@/]*@/, ':***@')}`)
    process.exit(1)
  }
})()

// La salvaguarda. Un `DROP DATABASE` sobre la base equivocada no se arregla
// con un «perdón»: o el nombre dice que es de pruebas, o aquí no se toca.
if (!/e2e/i.test(nombre)) {
  console.error(`✗ Me niego a recrear la base «${nombre}»: su nombre no contiene «e2e».`)
  console.error('  Esto hace DROP DATABASE. Usa una base cuyo nombre diga que es desechable.')
  process.exit(1)
}

/** La base de mantenimiento del mismo servidor: no se puede soltar la que se usa. */
const mantenimiento = (() => {
  const u = new URL(url)
  u.pathname = '/postgres'
  return u.toString()
})()

function psql(contra, sql) {
  execFileSync('psql', [contra, '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql], { stdio: ['ignore', 'ignore', 'inherit'] })
}

console.log(`Base desechable para el E2E: ${nombre}`)
console.log('─'.repeat(60))

process.stdout.write('  recreando…           ')
psql(mantenimiento, `DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`)
psql(mantenimiento, `CREATE DATABASE "${nombre}"`)
console.log('ok')

// Las extensiones las necesita el esquema (índices GIN de `pg_trgm`) y un
// PostgreSQL recién creado no las trae. Si faltan, el push revienta con
// «operator class gin_trgm_ops does not exist» y cuesta entender por qué.
process.stdout.write('  extensiones…         ')
psql(url, 'CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent')
console.log('ok')

// `db push` y no `migrate deploy`, igual que el CI: lo que interesa es el
// esquema que el código ESPERA hoy, no el historial de cómo se llegó a él. El
// historial ya lo verifica el gate de migraciones aparte.
process.stdout.write('  esquema…             ')
execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
  stdio: ['ignore', 'ignore', 'inherit'],
  env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
})
console.log('ok')

console.log('─'.repeat(60))
console.log('Lista. El servidor y Playwright tienen que apuntar a esta base:')
console.log(`  export DATABASE_URL="${url.replace(/:[^:@/]*@/, ':***@')}"`)
