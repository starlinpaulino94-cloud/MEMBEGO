/**
 * VERIFICACIÓN DE IDENTIDAD · Fase 7 · LOS DOCUMENTOS DE CIERRE DICEN LO QUE EL CÓDIGO HACE.
 *
 * Una lista de despliegue y un manual de operación que se desactualizan en silencio son peores que no tenerlos: alguien los sigue a las 3 de la madrugada.
 * Esta prueba cruza los documentos con el código: cada migración, cada variable de entorno, la ruta del webhook y el cron tienen que estar nombrados, y lo que el manual
 * promete que se puede hacer en el panel tiene que existir de verdad.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = join(__dirname, '..')
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8')
/** Los documentos se ajustan a un ancho: un texto partido en dos líneas es el mismo texto. */
const plano = (ruta: string) => leer(ruta).replace(/\s+/g, ' ')
const DESPLIEGUE = plano('docs/identidad/LISTA-DE-DESPLIEGUE.md')
const MANUAL = plano('docs/runbooks/verificacion-identidad.md')
const FINAL = plano('docs/identidad/FASE-7-VALIDACION-FINAL.md')

test('LA LISTA DE DESPLIEGUE NOMBRA TODAS LAS MIGRACIONES DE IDENTIDAD, en orden, y el archivo manual de políticas', () => {
  const migraciones = readdirSync(join(RAIZ, 'prisma/migrations'))
    .filter((d) => d >= '20261078' && /identidad/.test(d))
    .sort()
  assert.equal(migraciones.length, 10, 'hay diez migraciones de identidad')
  let desde = 0
  for (const m of migraciones) {
    const i = DESPLIEGUE.indexOf(m, desde)
    assert.ok(i >= 0, `la lista no nombra ${m} (o la nombra fuera de orden)`)
    desde = i
    assert.ok(FINAL.includes(m), `el informe final no nombra ${m}`)
  }
  assert.ok(DESPLIEGUE.includes('prisma/migrations_manual/2026-10-rls-identidad.sql'))
  assert.ok(FINAL.includes('2026-10-rls-identidad.sql'))
})

test('LA LISTA Y EL INFORME NOMBRAN TODAS LAS VARIABLES DE ENTORNO DE LA VERIFICACIÓN, y el ejemplo de entorno las documenta', () => {
  const env = leer('src/lib/env.ts')
  const exigidas = [...(env.slice(env.indexOf('export function faltantesIdentidad')).split('\n}\n')[0]!.matchAll(/faltan\.push\('([A-Z_]+)'\)/g))].map((m) => m[1]!)
  assert.deepEqual(exigidas.sort(), ['DIDIT_API_KEY', 'DIDIT_WEBHOOK_SECRET', 'DIDIT_WORKFLOW_ID', 'IDENTIDAD_CLAVES_MAESTRAS', 'IDENTIDAD_PEPPER_DEDUPE'])
  const ejemplo = leer('.env.example')
  for (const v of [...exigidas, 'DIDIT_WEBHOOK_SECRET_ANTERIOR', 'DIDIT_API_BASE', 'CRON_SECRET', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
    assert.ok(DESPLIEGUE.includes(v) || FINAL.includes(v), `ni la lista ni el informe nombran ${v}`)
  }
  for (const v of [...exigidas, 'DIDIT_WEBHOOK_SECRET_ANTERIOR', 'DIDIT_API_BASE']) assert.ok(ejemplo.includes(`${v}=`), `.env.example no documenta ${v}`)
  for (const v of exigidas) assert.ok(FINAL.includes(v), `el informe final no nombra ${v}`)
})

test('EL WEBHOOK Y EL CRON DE LOS DOCUMENTOS SON LOS DEL CÓDIGO', () => {
  const vercel = JSON.parse(leer('vercel.json')) as { crons: { path: string; schedule: string }[] }
  const cron = vercel.crons.find((c) => c.path === '/api/cron/identidad')
  assert.ok(cron, 'el cron está en vercel.json')
  assert.equal(cron!.schedule, '0 8 * * *')
  assert.match(DESPLIEGUE, /0 8 \* \* \*/)
  assert.match(MANUAL, /08:00 UTC/)
  for (const doc of [DESPLIEGUE, MANUAL, FINAL]) assert.ok(doc.includes('/api/webhooks/identidad/didit'), 'la ruta del webhook está documentada')
  assert.ok(readFileSync(join(RAIZ, 'src/proxy.ts'), 'utf8').includes('api/webhooks'), 'el webhook está fuera del proxy de sesión')
})

test('LO QUE EL MANUAL PROMETE QUE SE HACE EN EL PANEL EXISTE: las pestañas, los motivos de consulta y cada acción', () => {
  const panel = leer('src/app/(superadmin)/superadmin/identidad/page.tsx')
  for (const pestana of ['Resumen', 'Casos en revisión', 'Incidencias', 'Buscar a una persona', 'Reglas', 'Auditoría']) {
    assert.ok(panel.includes(`etiqueta: '${pestana}'`), `el panel no tiene la pestaña «${pestana}»`)
    assert.ok(MANUAL.includes(pestana), `el manual no menciona «${pestana}»`)
  }
  const staff = leer('src/modules/identidad/staff.ts')
  assert.ok(staff.includes("etiqueta: 'Soporte a la persona'") && MANUAL.includes('Soporte a la persona'))
  const caso = leer('src/app/(superadmin)/superadmin/identidad/[userId]/page.tsx')
  for (const boton of ['Reabrir la verificación', 'Retirar la verificación', 'Pedir que se verifique de nuevo', 'Borrar sus datos de verificación']) {
    assert.ok(caso.includes(boton), `la ficha no tiene el botón «${boton}»`)
    assert.ok(MANUAL.includes(boton), `el manual no menciona «${boton}»`)
  }
  const interruptor = panel.includes("'Apagar la verificación'") && panel.includes("'Encender la verificación'")
  assert.ok(interruptor && MANUAL.includes('Encender / Apagar la verificación'))
  // Los números que el manual da son los de la política.
  const nucleo = leer('src/modules/identidad/identidadCore.ts')
  assert.match(nucleo, /validezMeses: 36/)
  assert.match(nucleo, /esperaTrasRechazoMs: 5 \* 60 \* 1000/)
  assert.match(nucleo, /maxRechazosReintentables: 3/)
  assert.match(nucleo, /avisoRevalidacionDias: 30/)
  assert.match(nucleo, /vigenciaIntentoMs: 24 \* 60 \* 60 \* 1000/)
  assert.match(staff, /DIAS_DE_ALERTA_DE_SUPRESION = 7/)
  for (const frase of ['36 meses', '5 minutos', '10 días hábiles', '24 h', '30 días']) assert.ok(MANUAL.includes(frase), `el manual no dice «${frase}»`)
})

test('EL ÍNDICE DE RUNBOOKS ENLAZA EL MANUAL, y el informe final enlaza la lista y el manual', () => {
  assert.match(leer('docs/runbooks/README.md'), /\[`verificacion-identidad\.md`\]\(verificacion-identidad\.md\)/)
  assert.ok(FINAL.includes('./LISTA-DE-DESPLIEGUE.md') && FINAL.includes('../runbooks/verificacion-identidad.md'))
})
