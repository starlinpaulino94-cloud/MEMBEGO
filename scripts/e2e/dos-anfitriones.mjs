#!/usr/bin/env node
/**
 * MEMBEGO · EL E2E DE LOS DOS ANFITRIONES (separación landing/app · F7).
 *
 * Prueba el corte `membego.com` / `app.membego.com` con un servidor REAL de producción construido con las variables del
 * corte puestas, y un Chromium que resuelve los dos dominios de prueba a este equipo:
 *
 *   landing  http://membego.test:3210
 *   app      http://app.membego.test:3210      (cookie compartida: .membego.test)
 *
 * El build va a su propio directorio (`.next-f7`) para no pisar el normal: las variables `NEXT_PUBLIC_*` se incrustan al
 * construir, así que un build de un solo dominio no sirve para esto.
 *
 * USO
 *
 *   bun run e2e:dos-anfitriones                  # construye y corre tests/e2e/separacion-f7.spec.ts
 *   bun run e2e:dos-anfitriones -- --sin-build   # reutiliza el build de .next-f7
 *   bun run e2e:dos-anfitriones -- --project=movil
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const PUERTO = '3210'
const entorno = {
  ...process.env,
  E2E_PORT: PUERTO,
  E2E_DOS_ANFITRIONES: '1',
  MEMBEGO_DIST_DIR: '.next-f7',
  NEXT_PUBLIC_LANDING_URL: `http://membego.test:${PUERTO}`,
  NEXT_PUBLIC_APP_ORIGIN: `http://app.membego.test:${PUERTO}`,
  NEXT_PUBLIC_COOKIE_DOMAIN: '.membego.test',
}

const args = process.argv.slice(2)
const sinBuild = args.includes('--sin-build')
const resto = args.filter((a) => a !== '--sin-build')

if (!sinBuild || !existsSync(new URL('../../.next-f7/BUILD_ID', import.meta.url))) {
  console.log('\n[build] Construyendo con los dos anfitriones en .next-f7 …')
  execFileSync('bun', ['run', 'build'], { stdio: 'inherit', env: entorno })
}

const especificacion = resto.some((a) => a.endsWith('.spec.ts')) ? [] : ['tests/e2e/separacion-f7.spec.ts']
let codigo = 0
try {
  execFileSync('node', [new URL('./correr.mjs', import.meta.url).pathname, ...especificacion, ...resto], { stdio: 'inherit', env: entorno })
} catch (e) {
  codigo = typeof e.status === 'number' ? e.status : 1
}
process.exit(codigo)
