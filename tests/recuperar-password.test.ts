import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { recoveryEmailLimiter, recoveryIpLimiter } from '../src/lib/rate-limit'

/**
 * RECUPERAR CONTRASEÑA · "Failed to fetch (xxxx.supabase.co)".
 *
 * La pantalla `/recuperar` pedía el correo desde el NAVEGADOR, directo a
 * supabase.co. Si el teléfono no alcanzaba ese host, el usuario veía el error
 * crudo del SDK con el dominio interno del proyecto y no podía recuperar su
 * cuenta aunque la app sí le cargara. Ahora la petición la hace el servidor.
 *
 * Lo puro (los limitadores) se prueba de verdad; lo que depende de Next y de
 * Supabase es una guardia estructural sobre el fuente, como el resto de la suite.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const codigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

test('/recuperar ya no llama a Supabase desde el navegador', () => {
  const src = codigo('src/app/(auth)/recuperar/page.tsx')
  assert.ok(!src.includes('@/lib/supabase/client'), 'la página importa el cliente de navegador')
  assert.ok(!src.includes('resetPasswordForEmail'), 'la página pide el correo directo a Supabase')
  assert.match(src, /solicitarRecuperacion\(/)
})

test('/recuperar no muestra el error crudo ni el host del proyecto', () => {
  const src = codigo('src/app/(auth)/recuperar/page.tsx')
  assert.ok(!/resetError|\.message|supabase\.co/.test(src), 'la página interpola un mensaje del proveedor')
})

test('la acción reintenta fallos de red/5xx, no los 429, y no filtra el mensaje del proveedor', () => {
  const src = codigo('src/modules/auth/recuperarActions.ts')
  assert.match(src, /isTransientAuthError\(error\)/, 'no reintenta fallos transitorios')
  assert.match(src, /error\.status !== 429/, 'reintentaría un 429, que solo lo agrava')
  // Lo que llega a la persona son constantes; nunca el mensaje del proveedor
  // (`error.message` o su copia local `msg`).
  const retornos = src.match(/return \{ error: [^}\n]+\}/g) ?? []
  assert.ok(retornos.length >= 4, 'cambió la forma de los retornos; actualiza la guardia')
  for (const r of retornos) {
    assert.ok(!/error\.message|\bmsg\b/.test(r), `devuelve texto del proveedor: ${r}`)
  }
})

test('la acción aplica los dos limitadores y los consulta SIEMPRE los dos', () => {
  const src = codigo('src/modules/auth/recuperarActions.ts')
  assert.match(src, /Promise\.all\(\[\s*recoveryIpLimiter\([^)]*\),\s*recoveryEmailLimiter\(/)
})

test('el enlace de recuperación sigue aterrizando en /actualizar-password', () => {
  const src = codigo('src/modules/auth/recuperarActions.ts')
  assert.match(src, /absoluteUrl\('\/actualizar-password'\)/)
})

test('/actualizar-password no enseña el mensaje crudo del proveedor', () => {
  const src = codigo('src/app/(auth)/actualizar-password/page.tsx')
  assert.ok(!/setError\(\s*updateError\.message/.test(src), 'muestra updateError.message tal cual')
})

test('el limitador por correo frena a la sexta solicitud y no afecta a otro correo', async () => {
  const correo = `email:limite-${Date.now()}@ejemplo.com`
  for (let i = 1; i <= 5; i++) {
    assert.equal(await recoveryEmailLimiter(correo), true, `la solicitud ${i} debía pasar`)
  }
  assert.equal(await recoveryEmailLimiter(correo), false, 'la sexta debía frenarse')
  assert.equal(await recoveryEmailLimiter(`email:otro-${Date.now()}@ejemplo.com`), true)
})

test('el limitador por IP es más ancho que el de correo (CGNAT de operadores móviles)', async () => {
  const ip = `ip:10.0.0.${Math.floor(Math.random() * 250)}-${Date.now()}`
  for (let i = 1; i <= 30; i++) {
    assert.equal(await recoveryIpLimiter(ip), true, `la solicitud ${i} de la misma IP debía pasar`)
  }
  assert.equal(await recoveryIpLimiter(ip), false, 'la 31 debía frenarse')
})
