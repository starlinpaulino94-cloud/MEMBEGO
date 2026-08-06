#!/usr/bin/env node
/**
 * COBERTURA DE CONTEXTO DE EMPRESA PARA RLS  (Fase 5 · gate estático)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ MIDE
 *
 * Con RLS encendido (`membego_app`, NOBYPASSRLS), cualquier consulta que no
 * haya declarado su empresa en la transacción devuelve CERO filas (fail-closed)
 * o, peor, si declaró la empresa equivocada, filas de otro inquilino. La única
 * forma de declararla es envolver la consulta con `conEmpresa` / `sinEmpresa`
 * de `src/lib/tenant.ts`.
 *
 * Este script detecta los archivos que tocan la base de datos (llamadas a
 * `prisma.<modelo>.` o a `$queryRaw`/`$executeRaw`) y comprueba si ese archivo
 * usa los envoltorios de tenant. Un archivo con consultas pero sin envoltorio
 * es un candidato a quedar descubierto el día que se encienda la Capa 2.
 *
 * NO es la prueba de aislamiento (`npm run rls:probar`, que siembra datos y
 * comprueba el comportamiento real). Es el "dientes" del staged: bloquea en CI
 * que un archivo nuevo con consultas entre sin declarar su contexto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ CUENTA COMO CUBIERTO
 *
 *   · El archivo importa `conEmpresa` o `sinEmpresa` desde `@/lib/tenant`.
 *   · O el archivo está en la lista blanca (que se documenta en el propio
 *     script y debe vaciarse durante la migración):
 *        - infraestructura (proxy, prisma.ts, tenant.ts, jobs internos),
 *        - consultas a esquemas ajenos a `public` (auth, storage),
 *        - métricas de plataforma que sí usan sinEmpresa o catálogos de sistema.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * USO
 *
 *   npm run rls:cobertura             # reporta y sale con error si hay huecos
 *   npm run rls:cobertura -- --info   # reporta sin fallar (durante la migración)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const C = { ok: '\x1b[32m', mal: '\x1b[31m', avi: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' }
const RAIZ = new URL('../src', import.meta.url).pathname
const INFO = process.argv.includes('--info')

/**
 * Archivos que tocan la base pero NO necesitan envoltorio de tenant, con el
 * motivo. Deben vaciarse o justificarse durante la migración: un archivo aquí
 * es una decisión explícita, no un olvido.
 */
const BLANCA = new Map([
  ['lib/prisma.ts', 'el propio cliente Prisma (proxy + logging)'],
  ['lib/prisma-errors.ts', 'utilidades de clasificación de errores, sin consultas propias'],
  ['lib/seed.ts', 'script CLI de seed, corre como postgres fuera de request context'],
  ['lib/tenant.ts', 'los propios envoltorios conEmpresa/sinEmpresa'],
  ['lib/supabase/identity.ts', 'esquema auth (no public), no aplica RLS de inquilino'],
  ['app/api/admin-reset-password/route.ts', 'esquema auth, protegido por bootstrap'],
  ['app/api/health/route.ts', 'centinelas de information_schema (ops)'],
  ['app/api/stats/route.ts', 'conteos de pg_class (catálogo de sistema)'],
  ['app/api/pagos/cardnet-token/estado/route.ts', 'diagnóstico/ops (login-gated): solo lee el propio Cliente del usuario en la rama ?sesion=1'],
  ['modules/observabilidad/metricas.ts', 'métricas de plataforma cross-tenant (sinEmpresa)'],
])

function archivosTS(dir) {
  const salida = []
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada)
    if (statSync(ruta).isDirectory()) {
      if (['__tests__', 'node_modules'].includes(entrada)) continue
      salida.push(...archivosTS(ruta))
    } else if (entrada.endsWith('.ts') && !entrada.endsWith('.test.ts') && !entrada.endsWith('.spec.ts')) {
      salida.push(ruta)
    }
  }
  return salida
}

/** ¿El archivo usa los envoltorios de tenant? */
function usaTenant(contenido) {
  return /import\s*\{[^}]*\b(conEmpresa|sinEmpresa)\b[^}]*\}\s*from\s*['"]@\/lib\/tenant['"]/.test(
    contenido
  ) || /[^.\w](conEmpresa|sinEmpresa)\s*\(/.test(contenido)
}

/** ¿El archivo toca la base (consultas Prisma o SQL crudo)? */
function tocaBase(contenido) {
  return /[^.\w]prisma\s*\.\s*[a-zA-Z]+\s*\./.test(contenido) || /[^.\w]\$queryRaw|[\w.]\$$executeRaw/.test(
    contenido
  ) || /prisma\s*\.\s*\$(queryRaw|executeRaw)\s*/.test(contenido)
}

const huecos = []
let archivosConBase = 0
let sitiosDeConsulta = 0

for (const ruta of archivosTS(RAIZ)) {
  const relativa = ruta.replace(`${RAIZ}/`, '')
  const contenido = readFileSync(ruta, 'utf8')

  if (!tocaBase(contenido)) continue
  archivosConBase++
  sitiosDeConsulta += (contenido.match(/[^.\w]prisma\s*\.\s*[a-zA-Z]+\s*\./g) || []).length
  sitiosDeConsulta += (contenido.match(/\$queryRaw|\$executeRaw/g) || []).length

  if (usaTenant(contenido)) continue
  if (BLANCA.has(relativa)) continue
  huecos.push(relativa)
}

huecos.sort()

console.log('Cobertura de contexto de empresa para RLS')
console.log('─'.repeat(60))
console.log(`${C.dim}Archivos que tocan la base: ${archivosConBase} · sitios de consulta aprox.: ${sitiosDeConsulta}${C.off}`)

if (huecos.length === 0) {
  console.log(`${C.ok}✓${C.off} Todos los archivos con consultas usan conEmpresa/sinEmpresa (o están justificados).`)
} else {
  console.log(`${C.mal}✗ ${huecos.length} archivo(s) con consultas sin envoltorio de tenant:${C.off}`)
  for (const h of huecos) console.log(`   ${h}`)
  console.log(`${C.dim}Envuelve con conEmpresa/sinEmpresa o justifica en scripts/rls-cobertura.mjs${C.off}`)
}

if (huecos.length > 0 && !INFO) {
  console.error('\nBloqueado por el gate de cobertura RLS. (Usa `--info` para reportar sin fallar durante la migración.)')
  process.exit(1)
}
