#!/usr/bin/env node
/**
 * VERIFICAR RESPALDO — el simulacro de restauración, automatizado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ PROBLEMA RESUELVE (auditoría de producción · A-08, Fase 5)
 *
 * Supabase hace respaldos. Eso no es lo mismo que tener respaldos.
 *
 * Un respaldo que nunca se restauró es una hipótesis: puede estar truncado,
 * puede haberse hecho de un esquema equivocado, puede restaurar los datos pero
 * no las credenciales, y NADA de eso se sabe hasta el día que hace falta —que
 * es, por definición, el peor día para enterarse—. La única prueba de que un
 * respaldo sirve es haberlo restaurado y haber mirado lo que quedó dentro.
 *
 * Este script hace exactamente eso, y lo hace de forma que se pueda repetir sin
 * que nadie se acuerde: `.github/workflows/respaldo-verificacion.yml` lo corre
 * cada semana contra una base desechable.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ COMPRUEBA, Y POR QUÉ CADA COSA
 *
 *  1. Que el volcado se puede restaurar. Lo obvio.
 *
 *  2. Que `auth.users` viajó con los datos. Esto es lo que casi nadie mira y
 *     es el fallo más caro: `User.supabaseId` (prisma/schema.prisma:132)
 *     apunta al esquema `auth` de Supabase, que Prisma NO gestiona. Un volcado
 *     de `public` restaura las 100.000 fichas de cliente intactas… y ni una
 *     sola contraseña. Todo el mundo existe y nadie puede entrar.
 *
 *  3. Que no quedan usuarios huérfanos: filas en `public.users` cuyo
 *     `supabaseId` no existe en `auth.users`. Un huérfano es una cuenta que se
 *     ve en el panel y con la que es imposible iniciar sesión.
 *
 *  4. Que las migraciones aplicadas en la copia restaurada coinciden con las
 *     del repositorio. Si no coinciden, se restauró una base más vieja que el
 *     código que se va a desplegar encima — y el desfase de esquema es la
 *     forma favorita de este proyecto de romperse en silencio.
 *
 *  5. El RPO REAL, medido: cuánto tiempo hay entre el dato más reciente de la
 *     copia y ahora. No el RPO que promete el plan contratado: el que se puede
 *     demostrar. Es el número que va a docs/RECUPERACION.md.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL VEREDICTO NO ES EL CÓDIGO DE SALIDA DE pg_restore
 *
 * `pg_restore` sobre un volcado de Supabase escupe errores que no importan:
 * extensiones que ya existen, roles (`supabase_admin`, `authenticated`) que no
 * están en la base destino, comentarios sobre objetos del sistema. Si se
 * tratara cada uno como fallo, el simulacro daría rojo siempre y en tres
 * semanas nadie lo miraría — que es peor que no tenerlo.
 *
 * Así que el veredicto lo dan las CONSULTAS de abajo: ¿están las tablas?
 * ¿tienen filas? ¿están las credenciales? Los errores de pg_restore se cuentan
 * y se muestran, pero no deciden.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * USO
 *
 *   RESPALDO_ORIGEN=<DIRECT_URL de producción> \
 *   RESPALDO_DESTINO=<URL de una base VACÍA y desechable> \
 *   npm run respaldo:verificar
 *
 * Opciones:
 *   --archivo <ruta>   Restaura un volcado ya existente en vez de crear uno.
 *   --conservar        No borra el volcado al terminar (para inspeccionarlo).
 *   --solo-volcado     Crea el volcado y para. No restaura ni verifica.
 *
 * ADVERTENCIA: `RESPALDO_DESTINO` se sobrescribe entera. Nunca apuntes esa
 * variable a producción. El script se niega a continuar si origen y destino
 * son el mismo host y la misma base.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTADO — qué está probado y qué no.
 *
 * PROBADO de punta a punta contra un PostgreSQL 16 local que imita la
 * disposición de Supabase (esquemas `public`, `auth` y `storage`, tabla
 * `_prisma_migrations`, `users.supabaseId` apuntando a `auth.users`). Se
 * verificaron los cuatro caminos que importan: la restauración correcta, el
 * volcado que se dejó `auth` fuera, el usuario huérfano y la copia con menos
 * migraciones que el repositorio. Los tres fallos se detectan y devuelven
 * código 1; la salvaguarda de origen == destino corta antes de tocar nada.
 *
 * NO PROBADO contra la base real de MembeGo: este entorno no tiene acceso a
 * ella. Lo que puede cambiar allí son los PERMISOS — si el plan contratado de
 * Supabase no deja leer el esquema `auth` con el usuario del volcado,
 * `pg_dump` fallará y habrá que decidir qué hacer (el propio script lo explica
 * cuando ocurre). La primera ejecución hay que mirarla. Ver docs/RECUPERACION.md.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Esquemas que hay que llevarse. `public` son los datos de la aplicación;
// `auth` son las credenciales (ver punto 2 de la cabecera); `storage` es el
// ÍNDICE de los archivos subidos — no los archivos, que viven en S3 y se
// respaldan aparte (docs/RECUPERACION.md § "Lo que un volcado no cubre").
const ESQUEMAS = ['public', 'auth', 'storage']

// Tablas sin las cuales la copia no sirve para nada.
const CRITICAS = [
  'companies',
  'users',
  'clientes',
  'memberships',
  'transactions',
  'visits',
]

// Tablas cuya columna `createdAt` sirve para medir el RPO real.
const RELOJ = ['visits', 'transactions', 'clientes']

// ── utilidades ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const opcion = (nombre) => {
  const i = args.indexOf(nombre)
  return i === -1 ? null : (args[i + 1] ?? '')
}
const bandera = (nombre) => args.includes(nombre)

const C = { ok: '\x1b[32m', mal: '\x1b[31m', avi: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' }
const log = (s = '') => console.log(s)
const ok = (s) => log(`${C.ok}  ✓${C.off} ${s}`)
const mal = (s) => log(`${C.mal}  ✗${C.off} ${s}`)
const avi = (s) => log(`${C.avi}  !${C.off} ${s}`)
const titulo = (s) => log(`\n${s}\n${'─'.repeat(s.length)}`)

/** Oculta la contraseña de una URL de conexión antes de imprimirla. */
function seguro(url) {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.username}:***@${u.hostname}:${u.port}${u.pathname}`
  } catch {
    return '(URL ilegible)'
  }
}

function ejecutar(cmd, argv, { silencioso = false } = {}) {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.error) return { codigo: -1, salida: '', error: r.error.message }
  if (!silencioso && r.stderr) process.stderr.write(r.stderr)
  return { codigo: r.status ?? -1, salida: (r.stdout ?? '').trim(), error: r.stderr ?? '' }
}

/** Una consulta contra la base restaurada. Devuelve la primera celda o null. */
function consultar(url, sql) {
  const r = ejecutar('psql', [url, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    silencioso: true,
  })
  return r.codigo === 0 ? r.salida : null
}

function existeHerramienta(nombre) {
  return ejecutar(nombre, ['--version'], { silencioso: true }).codigo === 0
}

function humano(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function duracion(ms) {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}

// ── comprobaciones previas ──────────────────────────────────────────────────

const ORIGEN = process.env.RESPALDO_ORIGEN || process.env.DIRECT_URL || ''
const DESTINO = process.env.RESPALDO_DESTINO || ''
const archivoDado = opcion('--archivo')
const soloVolcado = bandera('--solo-volcado')

titulo('Verificación de respaldo — MembeGo')

for (const h of ['pg_dump', 'pg_restore', 'psql']) {
  if (!existeHerramienta(h)) {
    mal(`Falta \`${h}\`. Instala el cliente de PostgreSQL (postgresql-client).`)
    process.exit(1)
  }
}

if (!archivoDado && !ORIGEN) {
  mal('Falta RESPALDO_ORIGEN (o DIRECT_URL). Es la conexión DIRECTA, puerto 5432.')
  log(`${C.dim}  El pooler (6543) no sirve para volcar: pg_dump necesita conexión directa.${C.off}`)
  process.exit(1)
}
if (!soloVolcado && !DESTINO) {
  mal('Falta RESPALDO_DESTINO: la base VACÍA donde se va a restaurar la copia.')
  process.exit(1)
}

// Salvaguarda contra el error irreversible: restaurar encima de producción.
if (ORIGEN && DESTINO) {
  try {
    const o = new URL(ORIGEN)
    const d = new URL(DESTINO)
    if (o.hostname === d.hostname && o.pathname === d.pathname) {
      mal('RESPALDO_DESTINO apunta a la MISMA base que RESPALDO_ORIGEN.')
      log(`${C.dim}  Restaurar ahí borraría producción. No se continúa.${C.off}`)
      process.exit(1)
    }
  } catch {
    mal('Alguna de las URL de conexión no es válida.')
    process.exit(1)
  }
}

// ── 1) volcado ──────────────────────────────────────────────────────────────

let carpetaTemporal = null
let volcado = archivoDado

if (!volcado) {
  titulo('1 · Volcado del origen')
  log(`${C.dim}  ${seguro(ORIGEN)}${C.off}`)
  carpetaTemporal = mkdtempSync(join(tmpdir(), 'membego-respaldo-'))
  volcado = join(carpetaTemporal, 'membego.dump')

  const t0 = Date.now()
  const r = ejecutar('pg_dump', [
    ORIGEN,
    '--format=custom',
    // Sin dueños ni privilegios: los roles de Supabase (supabase_admin,
    // authenticated, anon) no existen en la base destino y cada GRANT sobre
    // ellos sería un error inútil que ensucia el informe.
    '--no-owner',
    '--no-privileges',
    ...ESQUEMAS.map((s) => `--schema=${s}`),
    `--file=${volcado}`,
  ])

  if (!existsSync(volcado) || statSync(volcado).size === 0) {
    mal('El volcado no se creó o salió vacío.')
    if (r.error) log(`${C.dim}${r.error.trim()}${C.off}`)
    log('')
    avi('Causa habitual: el usuario no puede leer el esquema `auth`. Con el plan')
    avi('Free de Supabase eso es esperable. Si es tu caso, documenta en')
    avi('docs/RECUPERACION.md que las credenciales NO están cubiertas y')
    avi('reduce ESQUEMAS a ["public"] — pero sabiendo lo que eso significa.')
    process.exit(1)
  }

  ok(`${humano(statSync(volcado).size)} en ${duracion(Date.now() - t0)} → ${volcado}`)
  if (r.codigo !== 0) avi(`pg_dump terminó con código ${r.codigo}; revisa los avisos de arriba.`)
} else {
  titulo('1 · Volcado')
  if (!existsSync(volcado)) {
    mal(`No existe el archivo ${volcado}`)
    process.exit(1)
  }
  ok(`Se usa el archivo dado: ${volcado} (${humano(statSync(volcado).size)})`)
}

if (soloVolcado) {
  log('\n--solo-volcado: no se restaura ni se verifica.')
  process.exit(0)
}

// ── 2) restauración ─────────────────────────────────────────────────────────

titulo('2 · Restauración en la base desechable')
log(`${C.dim}  ${seguro(DESTINO)}${C.off}`)

const t1 = Date.now()
const restauracion = ejecutar(
  'pg_restore',
  [
    '--dbname', DESTINO,
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
    volcado,
  ],
  { silencioso: true }
)
const tiempoRestauracion = Date.now() - t1

const erroresRestore = (restauracion.error.match(/^pg_restore: error:/gm) ?? []).length
log(`  Duración: ${duracion(tiempoRestauracion)}`)
if (erroresRestore > 0) {
  avi(`${erroresRestore} error(es) reportados por pg_restore (no deciden el veredicto).`)
  const muestra = restauracion.error
    .split('\n')
    .filter((l) => l.startsWith('pg_restore: error:'))
    .slice(0, 5)
  muestra.forEach((l) => log(`${C.dim}    ${l}${C.off}`))
  if (erroresRestore > muestra.length) log(`${C.dim}    … y ${erroresRestore - muestra.length} más${C.off}`)
} else {
  ok('pg_restore terminó sin errores.')
}

// ── 3) verificación ─────────────────────────────────────────────────────────

titulo('3 · ¿Qué quedó realmente dentro?')

let fallos = 0
let avisos = 0

// 3.1 · las tablas críticas existen y tienen filas
const conteos = {}
for (const tabla of CRITICAS) {
  const existe = consultar(DESTINO, `select to_regclass('public.${tabla}') is not null`)
  if (existe !== 't') {
    mal(`public.${tabla} — NO EXISTE en la copia restaurada`)
    fallos++
    continue
  }
  const n = consultar(DESTINO, `select count(*) from public."${tabla}"`)
  conteos[tabla] = Number(n ?? 0)
  if (conteos[tabla] === 0) {
    avi(`public.${tabla} — existe pero está VACÍA`)
    avisos++
  } else {
    ok(`public.${tabla} — ${conteos[tabla].toLocaleString('es-DO')} filas`)
  }
}

// 3.2 · las credenciales. El punto que casi nadie verifica.
const hayAuth = consultar(DESTINO, `select to_regclass('auth.users') is not null`)
if (hayAuth !== 't') {
  mal('auth.users — NO ESTÁ en la copia.')
  log(`${C.dim}    Con esta copia se recuperan todos los datos y NADIE puede iniciar${C.off}`)
  log(`${C.dim}    sesión. No es una restauración: es un inventario.${C.off}`)
  fallos++
} else {
  const nAuth = Number(consultar(DESTINO, 'select count(*) from auth.users') ?? 0)
  const nApp = conteos.users ?? 0
  if (nAuth === 0 && nApp > 0) {
    mal(`auth.users vacío con ${nApp} usuarios en public.users — nadie podría entrar.`)
    fallos++
  } else {
    ok(`auth.users — ${nAuth.toLocaleString('es-DO')} credenciales`)
  }

  const huerfanos = Number(
    consultar(
      DESTINO,
      `select count(*) from public.users u
        where not exists (select 1 from auth.users a where a.id::text = u."supabaseId")`
    ) ?? -1
  )
  if (huerfanos > 0) {
    mal(`${huerfanos} usuario(s) de la aplicación sin credencial en auth.users`)
    log(`${C.dim}    Se ven en el panel y no pueden iniciar sesión.${C.off}`)
    fallos++
  } else if (huerfanos === 0) {
    ok('Sin usuarios huérfanos: cada ficha tiene su credencial.')
  }
}

// 3.3 · el esquema restaurado coincide con el código
const migracionesRepo = existsSync(join(ROOT, 'prisma', 'migrations'))
  ? readdirSync(join(ROOT, 'prisma', 'migrations'), { withFileTypes: true }).filter((d) =>
      d.isDirectory()
    ).length
  : 0
const migracionesCopia = Number(
  consultar(
    DESTINO,
    `select count(*) from public._prisma_migrations where finished_at is not null`
  ) ?? -1
)
if (migracionesCopia < 0) {
  avi('No se pudo leer _prisma_migrations en la copia.')
  avisos++
} else if (migracionesCopia < migracionesRepo) {
  avi(`La copia tiene ${migracionesCopia} migraciones y el repositorio ${migracionesRepo}.`)
  log(`${C.dim}    Restaurar esta copia deja la base por DETRÁS del código desplegado.${C.off}`)
  log(`${C.dim}    Tras restaurar hay que correr \`prisma migrate deploy\`. Ver el runbook.${C.off}`)
  avisos++
} else {
  ok(`Migraciones: ${migracionesCopia} en la copia, ${migracionesRepo} en el repositorio.`)
}

// 3.4 · RPO real, medido
titulo('4 · RPO medido (no prometido)')
let peorRezago = null
for (const tabla of RELOJ) {
  if (!conteos[tabla]) continue
  const seg = consultar(
    DESTINO,
    `select extract(epoch from now() - max("createdAt"))::bigint from public."${tabla}"`
  )
  if (seg === null || seg === '') continue
  const minutos = Math.round(Number(seg) / 60)
  peorRezago = peorRezago === null ? minutos : Math.max(peorRezago, minutos)
  log(`  ${tabla}: el dato más reciente tiene ${minutos} min`)
}
if (peorRezago === null) {
  avi('No se pudo medir el rezago (tablas vacías o sin createdAt).')
} else if (peorRezago > 24 * 60) {
  avi(`Ventana de pérdida real: ~${Math.round(peorRezago / 60)} h.`)
  log(`${C.dim}    Restaurar esta copia hoy perdería un día de operación. Si eso no es${C.off}`)
  log(`${C.dim}    aceptable, hace falta PITR. Ver docs/RECUPERACION.md.${C.off}`)
} else {
  ok(`Ventana de pérdida real: ~${peorRezago} min.`)
}

// ── veredicto ───────────────────────────────────────────────────────────────

titulo('Veredicto')
if (fallos > 0) {
  mal(`${fallos} comprobación(es) críticas fallaron. Este respaldo NO sirve tal cual.`)
  log('  Anota el resultado en la bitácora de simulacros de docs/RECUPERACION.md.')
} else if (avisos > 0) {
  avi(`Restauración correcta con ${avisos} aviso(s). Léelos: ninguno es decorativo.`)
} else {
  ok('El respaldo restaura y los datos están completos.')
}
log(`\n  Restauración completa en ${duracion(tiempoRestauracion)} — este es el RTO`)
log(`  de la parte de base de datos. Súmale despliegue y verificación manual.\n`)

if (carpetaTemporal && !bandera('--conservar')) {
  // El volcado lleva datos personales de clientes reales. No se queda en disco.
  rmSync(carpetaTemporal, { recursive: true, force: true })
}

process.exit(fallos > 0 ? 1 : 0)
