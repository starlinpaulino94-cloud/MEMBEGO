#!/usr/bin/env node
/**
 * MEMBEGO · EL RECORRIDO E2E, DE PRINCIPIO A FIN Y SIEMPRE IGUAL.
 *
 * Una corrida del E2E tiene cuatro piezas que hay que poner de acuerdo: una
 * base desechable, un servidor de producción apuntando a ESA base, la
 * configuración que el Slice 9 necesita, y Playwright. Cuando se montaban a
 * mano, era fácil dejar una apuntando a otro sitio —así se acabó corriendo la
 * suite contra `membego_dev` durante semanas— y el síntoma era «pruebas
 * inestables».
 *
 * Esto lo hace en un comando y en un orden fijo:
 *
 *   1. recrea la base desechable y le pone el esquema de hoy;
 *   2. da de alta la cuenta con la que corre la integración de pagos y se queda
 *      con su id, porque el servidor la necesita en el arranque y en una base
 *      nueva todavía no existe;
 *   3. arranca `next start` contra esa base y espera a que responda;
 *   4. corre Playwright con los argumentos que le pases;
 *   5. apaga el servidor y devuelve el código de Playwright.
 *
 * USO
 *
 *   npm run e2e:limpio                                   # toda la suite
 *   npm run e2e:limpio -- tests/e2e/supply-v2-slice4.spec.ts
 *   npm run e2e:limpio -- --project=escritorio
 *
 * REQUIERE `npm run build` hecho: se prueba lo que se despliega, no `next dev`.
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const PUERTO = process.env.E2E_PORT || '3210'
const BASE = `http://localhost:${PUERTO}`
const URL_BASE_DATOS = process.env.E2E_DATABASE_URL?.trim() || 'postgresql://postgres:postgres@127.0.0.1:5432/membego_e2e'

if (!existsSync(new URL('../../.next/BUILD_ID', import.meta.url))) {
  console.error('✗ Falta el build. Corre `npm run build` primero: el E2E prueba lo que se despliega.')
  process.exit(1)
}

const paso = (n, texto) => console.log(`\n[${n}/5] ${texto}`)

// ── 1 · la base ────────────────────────────────────────────────────────────
paso(1, 'Base desechable')
execFileSync('node', [new URL('./base-limpia.mjs', import.meta.url).pathname], {
  stdio: 'inherit',
  env: { ...process.env, E2E_DATABASE_URL: URL_BASE_DATOS },
})

// ── 2 · la cuenta de la integración ────────────────────────────────────────
//
// El webhook de pagos externos actúa como una cuenta designada
// (`SUPPLY_V2_WEBHOOK_ACTOR_ID`) y el servidor la comprueba contra la base. En
// una base nueva no existe, así que se crea aquí —con el mismo arnés que usan
// las pruebas, para que sea la misma cuenta— y se le pasa su id al servidor.
//
// Es una cuenta APARTE de las personas del recorrido a propósito: el bloque 3
// del Slice 9 prohíbe que quien procesa el aviso de la pasarela sea quien
// resuelve el incidente que ese aviso abrió.
paso(2, 'Cuenta de la integración')
const actorId = execFileSync('npx', ['tsx', 'scripts/e2e/cuenta-integracion.ts'], {
  env: { ...process.env, DATABASE_URL: URL_BASE_DATOS, DIRECT_URL: URL_BASE_DATOS },
  encoding: 'utf8',
}).trim()
if (!/^[a-z0-9]{20,}$/.test(actorId)) {
  console.error(`✗ No se pudo dar de alta la cuenta de la integración (devolvió «${actorId}»).`)
  process.exit(1)
}
console.log(`  cuenta de integración lista`)

// ── 3 · el servidor ────────────────────────────────────────────────────────
paso(3, `Servidor de producción en ${BASE}`)

/**
 * NUNCA PROBAR UN SERVIDOR QUE NO ARRANCÓ ESTE SCRIPT.
 *
 * Esto costó una tarde. Un `next start` de una corrida anterior se había
 * quedado vivo en el puerto 3210 con la configuración de ESA corrida. Los
 * arranques siguientes fallaban con EADDRINUSE sin que nadie lo viera, la
 * comprobación de salud recibía un 200 —del servidor viejo— y la suite entera
 * corría contra él. El síntoma fue un 401 incomprensible en el Slice 9: las
 * pruebas firmaban los avisos de la pasarela con el secreto de ESTA corrida y
 * el servidor que contestaba tenía el de la anterior.
 *
 * Así que si alguien contesta en el puerto antes de arrancar, esto se para y lo
 * dice. Un servidor ajeno respondiendo 200 es la forma más convincente de que
 * una suite verde no signifique nada.
 */
let ocupado = false
try {
  const previo = await fetch(`${BASE}/api/health/live`, { signal: AbortSignal.timeout(2000) })
  ocupado = previo.status > 0
} catch {
  // Lo que se espera es que NADIE responda: un error de conexión es la señal
  // buena.
}
if (ocupado) {
  console.error(`\n✗ Ya hay algo escuchando en ${BASE}.`)
  console.error('  No se prueba un servidor que no arrancó este script: tendría otra base y otra configuración.')
  console.error(`  Apágalo y vuelve a intentarlo:  pkill -f next-server`)
  process.exit(1)
}
const entorno = {
  ...process.env,
  DATABASE_URL: URL_BASE_DATOS,
  DIRECT_URL: URL_BASE_DATOS,
  SUPPLY_V2_WEBHOOK_ACTOR_ID: actorId,
  // Secreto de RELLENO para firmar los webhooks de prueba. No es el de ningún
  // entorno real y la base donde actúa se borra en la siguiente corrida.
  SUPPLY_V2_TEST_GATEWAY_SECRET:
    process.env.SUPPLY_V2_TEST_GATEWAY_SECRET || 'e2e-secreto-de-pasarela-solo-para-pruebas-0123456789',
  NEXT_PUBLIC_APP_URL: BASE,
  E2E_BASE_URL: BASE,
}
// El log del servidor se DEJA PASAR, no se descarta: las líneas `sv2 {...}`
// del Slice 9 dicen por qué se rechazó un aviso de pago, y sin ellas un 401 en
// una prueba obliga a adivinar.
//
// Sale ruido con él: `TypeError: fetch failed … port 54329` es
// `supabase.auth.getUser()` intentando llegar a un Supabase que aquí no existe
// a propósito —es lo que hace que la aplicación caiga a la verificación LOCAL
// del token y acepte las sesiones que firma el arnés—. Son esperados y no se
// filtran: un filtro sobre la salida del servidor acabaría escondiendo el
// error de verdad el día que haya uno.
// `detached: true` para que el servidor tenga su PROPIO grupo de procesos, y
// poder matarlo entero.
//
// Sin esto, `npx next start` deja un nieto: `npx` → `sh -c next start` →
// `next-server`. Matar al primero deja al último vivo con el puerto cogido, y
// la corrida siguiente se encuentra un servidor ajeno respondiendo 200. Así
// nació el zombi que hizo perder una tarde: el apagado parecía funcionar
// porque el proceso que se mataba sí moría.
const servidor = spawn('npx', ['next', 'start', '-p', PUERTO], {
  env: entorno,
  stdio: ['ignore', 'inherit', 'inherit'],
  detached: true,
})
let apagado = false
// Si el servidor se muere al arrancar, se para aquí en vez de esperar 120 s a
// una comprobación de salud que ya no puede pasar.
let murio = null
servidor.on('exit', (codigo, senal) => {
  if (!apagado) murio = `el servidor terminó solo (código ${codigo}, señal ${senal ?? 'ninguna'})`
})
const apagar = () => {
  if (apagado) return
  apagado = true
  // Al GRUPO, no al proceso: el `-` delante del pid es lo que alcanza al nieto.
  try { process.kill(-servidor.pid, 'SIGTERM') } catch { /* ya no estaba */ }
  try { servidor.kill('SIGTERM') } catch { /* ya no estaba */ }
}
process.on('exit', apagar)
process.on('SIGINT', () => { apagar(); process.exit(130) })

async function esperarSalud(limiteMs = 120_000) {
  const hasta = Date.now() + limiteMs
  while (Date.now() < hasta) {
    if (murio) return false
    try {
      const r = await fetch(`${BASE}/api/health/live`)
      if (r.ok) return true
    } catch { /* todavía no levanta */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

if (!(await esperarSalud())) {
  console.error(`✗ ${murio ?? 'El servidor no respondió a /api/health/live en 120 s.'}`)
  apagar()
  process.exit(1)
}
console.log('  responde')

// ── 4 · el recorrido ───────────────────────────────────────────────────────
paso(4, 'Playwright')
let codigo = 0
try {
  execFileSync('npx', ['playwright', 'test', ...process.argv.slice(2)], { stdio: 'inherit', env: entorno })
} catch (e) {
  codigo = typeof e.status === 'number' ? e.status : 1
}

// ── 5 · apagar ─────────────────────────────────────────────────────────────
paso(5, 'Apagando el servidor')
apagar()
// Y se COMPRUEBA que el puerto quedó libre. Decir «apagado» sin mirarlo es lo
// que dejó el zombi suelto la primera vez.
let libre = false
for (let i = 0; i < 20 && !libre; i++) {
  await new Promise((r) => setTimeout(r, 250))
  try {
    await fetch(`${BASE}/api/health/live`, { signal: AbortSignal.timeout(500) })
  } catch {
    libre = true
  }
}
if (!libre) {
  console.error(`  ⚠ el puerto ${PUERTO} sigue ocupado. Apágalo a mano: pkill -f next-server`)
}
console.log(codigo === 0 ? '\n✓ Recorrido completo en verde.' : `\n✗ El recorrido terminó con código ${codigo}.`)
process.exit(codigo)
