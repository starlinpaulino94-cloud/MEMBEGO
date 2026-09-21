import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * VISTA DEL SUPERADMIN · uso de la API por satélite (B-7, la pieza que faltaba).
 *
 * El agregado ya se recogía (`origen:'SISTEMA'`) y la lectura de UN satélite
 * existía; esto fija que la PANTALLA que faltaba está enganchada: agrega por
 * sistema, sale por el camino omnisciente, y está protegida por rol.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const codigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

// ─── la lectura agregada ─────────────────────────────────────────────────────

test('usoDeSatelites agrega por SISTEMA las métricas de satélite, cross-tenant', () => {
  const src = codigo('src/modules/plataforma/metricas.ts')
  const fn = src.slice(src.indexOf('export async function usoDeSatelites'))
  assert.ok(fn.length > 0, 'no existe usoDeSatelites')
  // Solo métricas de satélite, dentro de la ventana.
  assert.match(fn, /origen:\s*'SISTEMA'/, 'no filtra por origen SISTEMA')
  assert.match(fn, /dia:\s*\{\s*gte:\s*desde\s*\}/, 'no acota a la ventana')
  // Cruza inquilinos: va por el camino omnisciente, no por conEmpresa.
  assert.match(fn, /sinEmpresa\(/, 'una lectura cross-tenant debe declararse sinEmpresa')
  assert.ok(!/conEmpresa\(/.test(fn), 'no debe leer por conEmpresa: un satélite no es de una empresa')
  // Agrega por sistema (dedup de credenciales) y resume con el núcleo puro.
  assert.match(fn, /sistemaDeCred/, 'no mapea credencial → sistema')
  assert.match(fn, /resumirUso\(/, 'no resume con el núcleo puro')
})

// ─── la pestaña ──────────────────────────────────────────────────────────────

test('el hub de integraciones tiene la pestaña «Uso de la API»', () => {
  const src = leer('src/components/superadmin/TabsIntegracionesPlataforma.tsx')
  assert.match(src, /'uso'/, 'la sección uso no está en el tipo')
  assert.match(src, /\/superadmin\/integraciones\/uso/, 'la pestaña no apunta a la página de uso')
})

// ─── la página ───────────────────────────────────────────────────────────────

test('la página de uso es solo para superadmin y usa el agregado', () => {
  const src = codigo('src/app/(superadmin)/superadmin/integraciones/uso/page.tsx')
  assert.match(src, /requireRole\('SUPERADMIN'\)/, 'la pantalla no está protegida por rol')
  assert.match(src, /usoDeSatelites\(/, 'no lee el uso agregado')
  assert.match(src, /activa="uso"/, 'la barra de pestañas no marca «uso» como activa')
  // Ordena de más a menos usado: lo que tiene tráfico y errores, arriba.
  assert.match(src, /b\.resumen\.total - a\.resumen\.total/, 'no ordena por uso descendente')
})

// ─── la tarjeta ──────────────────────────────────────────────────────────────

test('la tarjeta del satélite muestra tasa de error y los endpoints más usados', () => {
  const src = codigo('src/components/superadmin/SateliteUsoCard.tsx')
  assert.match(src, /tasaError/, 'no muestra la tasa de error')
  assert.match(src, /porEndpoint/, 'no lista los endpoints más usados')
  assert.match(src, /Sin llamadas en/, 'no distingue un satélite sin tráfico')
})
