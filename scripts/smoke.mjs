#!/usr/bin/env node
/**
 * MEMBEGO · SMOKE TEST (Slice 9 · bloque 5 · §18).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ES Y QUÉ NO
 *
 * Esto NO es una prueba E2E. No abre un navegador, no entra con una sesión y
 * no comprueba reglas de negocio: para eso está `npm run e2e:limpio` contra una
 * base desechable. Esto responde una sola pregunta, en veinte segundos, contra
 * un despliegue REAL:
 *
 *     ¿está vivo lo que tiene que estar vivo, y cerrado lo que tiene que estar
 *     cerrado?
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO MODIFICA NADA. NUNCA
 *
 * Solo hace peticiones GET y una sola POST: la del webhook SIN firma, para
 * comprobar que la rechaza. Esa es la única forma honesta de verificar que la
 * puerta está cerrada —preguntarle a la puerta— y por definición no puede
 * entrar: si entrara, el smoke test habría encontrado exactamente el agujero
 * que busca.
 *
 * Por eso se puede correr contra producción sin pensarlo: no crea compras, no
 * confirma pagos, no manda correos y no toca una sola fila.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * USO
 *
 *   npm run smoke -- https://membego.com
 *   SMOKE_URL=https://staging.membego.com npm run smoke
 *
 * Sale con 0 si todo lo esperado se cumple, 1 si no. Pensado para el final de
 * un despliegue.
 */

const base = (process.argv[2] || process.env.SMOKE_URL || 'http://localhost:3210').replace(/\/$/, '')
const TIEMPO_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15_000)

const C = { ok: '\x1b[32m', mal: '\x1b[31m', avi: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' }
const resultados = []

async function pedir(ruta, opciones = {}) {
  const t0 = Date.now()
  try {
    const r = await fetch(`${base}${ruta}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIEMPO_MS),
      ...opciones,
    })
    return { status: r.status, ms: Date.now() - t0, cuerpo: await r.text().catch(() => ''), cabeceras: r.headers }
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, cuerpo: '', error: e instanceof Error ? e.message : 'error' }
  }
}

/**
 * Una comprobación. `esperado` es una LISTA de códigos aceptables, no uno solo:
 * una ruta protegida puede contestar 302 o 307 según cómo esté montado el
 * middleware, y fallar por eso sería ruido, no una señal.
 */
function comprobar(nombre, r, esperado, extra) {
  const bien = esperado.includes(r.status) && (!extra || extra(r))
  resultados.push({ nombre, bien, status: r.status, ms: r.ms, esperado, error: r.error })
  const marca = bien ? `${C.ok}✓${C.off}` : `${C.mal}✗${C.off}`
  const detalle = r.error ? ` ${C.mal}${r.error}${C.off}` : ''
  console.log(`  ${marca} ${nombre.padEnd(46)} ${String(r.status).padStart(3)}  ${C.dim}${r.ms} ms${C.off}${detalle}`)
  return bien
}

console.log(`\nSMOKE · ${base}`)
console.log('─'.repeat(72))

// ── 1 · ¿vive la aplicación? ────────────────────────────────────────────────
console.log(`${C.dim}vida${C.off}`)
comprobar('liveness responde sin tocar nada externo', await pedir('/api/health/live'), [200], (r) =>
  r.cuerpo.includes('alive')
)
const ready = await pedir('/api/health/ready')
// 200 = listo o degradado · 503 = NO listo. Las dos son respuestas válidas del
// endpoint; lo que sería un fallo es que no conteste.
comprobar('readiness contesta (200 listo/degradado · 503 no)', ready, [200, 503])
if (ready.status === 503) {
  console.log(`  ${C.avi}⚠ readiness dice NO LISTO. El detalle está en el cuerpo y en el Centro de Operaciones.${C.off}`)
}

// ── 2 · ¿se ve lo público? ──────────────────────────────────────────────────
console.log(`${C.dim}público${C.off}`)
comprobar('la portada carga', await pedir('/'), [200])
comprobar('el marketplace carga', await pedir('/promociones'), [200])
comprobar('las campañas cargan', await pedir('/promociones/campanas'), [200])
comprobar('el login carga', await pedir('/login'), [200])

// ── 3 · ¿está cerrado lo que tiene que estarlo? ─────────────────────────────
//
// Esta sección es la que de verdad importa. Una ruta de superadmin que
// contesta 200 sin sesión no es un fallo de disponibilidad: es una brecha.
console.log(`${C.dim}puertas cerradas${C.off}`)
comprobar('el área de cliente pide sesión', await pedir('/cliente/compras'), [302, 307, 401, 403])
comprobar('el Centro de Operaciones pide sesión', await pedir('/superadmin/supply-v2/operaciones'), [302, 307, 401, 403])
// 404 = hay secreto y no lo llevamos (a quien no tiene la llave, el endpoint
// "no existe") · 503 = METRICAS_SECRET no está configurado, que es fail-closed
// a propósito. Lo inaceptable es un 200.
comprobar('las métricas NO son públicas', await pedir('/api/metricas'), [401, 403, 404, 503])
// 401 = hay secreto y no lo llevamos · 503 = falta `CRON_SECRET` y el cron se
// niega a correr, que es fail-closed. Las dos cierran la puerta; la segunda
// además significa que el cron NO está corriendo (→ checklist § 1).
const cron = await pedir('/api/cron/supply-v2')
comprobar('el cron no corre sin su secreto', cron, [401, 403, 503])
if (cron.status === 503) {
  console.log(`  ${C.avi}⚠ falta CRON_SECRET: el cron no corre. No se barre el inbox ni se despacha el outbox.${C.off}`)
}

// El webhook SIN firma. Tiene que rechazar: 401 si la capacidad está encendida,
// 503 si está apagada a propósito. Un 200 aquí sería el peor resultado posible
// de todo este archivo.
const webhook = await pedir('/api/webhooks/supply-v2/TEST_GATEWAY', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
})
comprobar('el webhook rechaza lo que no lleva firma', webhook, [401, 503])
if (webhook.status === 503) {
  console.log(`  ${C.avi}⚠ los pagos externos están APAGADOS (kill switch). Es una decisión, no una avería.${C.off}`)
}

// ── 4 · cabeceras de seguridad ──────────────────────────────────────────────
console.log(`${C.dim}cabeceras${C.off}`)
const portada = await pedir('/')
comprobar('la portada llega con cabeceras de seguridad', portada, [200], (r) =>
  Boolean(r.cabeceras?.get('x-content-type-options') && r.cabeceras?.get('referrer-policy'))
)

// ── Resumen ─────────────────────────────────────────────────────────────────
console.log('─'.repeat(72))
const fallos = resultados.filter((r) => !r.bien)
const lento = resultados.filter((r) => r.ms > 3000)
if (lento.length) {
  console.log(`${C.avi}⚠ ${lento.length} comprobación(es) por encima de 3 s: ${lento.map((l) => l.nombre).join(', ')}${C.off}`)
}
if (fallos.length === 0) {
  console.log(`${C.ok}✓ ${resultados.length} comprobaciones, todas como se esperaba.${C.off}\n`)
  process.exit(0)
}
console.log(`${C.mal}✗ ${fallos.length} de ${resultados.length} no salieron como se esperaba:${C.off}`)
for (const f of fallos) {
  console.log(`   · ${f.nombre}: devolvió ${f.status}, se esperaba ${f.esperado.join(' o ')}${f.error ? ` (${f.error})` : ''}`)
}
console.log('')
process.exit(1)
