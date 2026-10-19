import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { diagnosticarLlaveServicio } from '../src/lib/supabase/llave-servicio'

/**
 * La llave de servicio de Supabase tiene que ser de SERVICIO. Con otra, la API de administración de usuarios responde
 * `403 not_admin` y cada llamada se traga el error: en producción dejó sin funcionar crear cuentas, invitaciones,
 * restablecer contraseñas y reparar sesiones desde el 11-10-2026, sin un solo aviso.
 */

const jwt = (cuerpo: Record<string, unknown>) => {
  const parte = (valor: unknown) => Buffer.from(JSON.stringify(valor)).toString('base64url')
  return `${parte({ alg: 'HS256', typ: 'JWT' })}.${parte(cuerpo)}.firma-de-mentira`
}
const URL_PROYECTO = 'https://abcdefghijklmnopqrst.supabase.co'

test('una llave service_role del proyecto correcto es válida', () => {
  const r = diagnosticarLlaveServicio(jwt({ role: 'service_role', ref: 'abcdefghijklmnopqrst' }), URL_PROYECTO)
  assert.deepEqual(r, { ok: true, formato: 'jwt', rol: 'service_role', proyecto: 'abcdefghijklmnopqrst' })
})

test('la llave anon (u otro rol) en ese sitio se señala como lo que es', () => {
  for (const rol of ['anon', 'authenticated', undefined]) {
    const r = diagnosticarLlaveServicio(jwt({ role: rol, ref: 'abcdefghijklmnopqrst' }), URL_PROYECTO)
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.motivo, 'rol_incorrecto')
      assert.match(r.detalle, /403 not_admin/)
    }
  }
})

test('una llave de servicio de OTRO proyecto se señala, y sin URL estándar no se compara', () => {
  const r = diagnosticarLlaveServicio(jwt({ role: 'service_role', ref: 'zzzzzzzzzzzzzzzzzzzz' }), URL_PROYECTO)
  assert.equal(r.ok === false && r.motivo, 'proyecto_distinto')
  assert.equal(diagnosticarLlaveServicio(jwt({ role: 'service_role', ref: 'zzzzzzzzzzzzzzzzzzzz' }), 'https://auth.midominio.com').ok, true)
})

test('espacios o saltos de línea pegados con la llave la dejan inservible y se señalan', () => {
  const buena = jwt({ role: 'service_role', ref: 'abcdefghijklmnopqrst' })
  assert.equal(diagnosticarLlaveServicio(buena, URL_PROYECTO).ok, true)
  for (const sucia of [` ${buena}`, `${buena} `, `${buena}\n`, `\n${buena}`, `${buena}\r\n`, `\t${buena}`]) {
    const r = diagnosticarLlaveServicio(sucia, URL_PROYECTO)
    assert.equal(r.ok, false, JSON.stringify(sucia))
    if (!r.ok) assert.match(r.detalle, /espacios o saltos de línea/)
  }
  assert.equal(diagnosticarLlaveServicio('sb_secret_abcdefghijk\n', URL_PROYECTO).ok, false)
})

test('formato nuevo: sb_secret_ vale, sb_publishable_ no, y un prefijo suelto o con basura tampoco', () => {
  assert.equal(diagnosticarLlaveServicio('sb_secret_abcdefghijk', URL_PROYECTO).ok, true)
  for (const mala of ['sb_secret_', 'sb_secret_abc', 'sb_secret_abc def ghij', 'sb_secret_"abcdefghij"']) {
    assert.equal(diagnosticarLlaveServicio(mala, URL_PROYECTO).ok, false, mala)
  }
  const r = diagnosticarLlaveServicio('sb_publishable_abcdefghijk', URL_PROYECTO)
  assert.equal(r.ok === false && r.motivo, 'llave_publica')
})

test('ausente, recortada o con basura: motivo claro y nunca una excepción', () => {
  assert.equal((diagnosticarLlaveServicio(undefined, URL_PROYECTO) as { motivo: string }).motivo, 'ausente')
  assert.equal((diagnosticarLlaveServicio('   ', URL_PROYECTO) as { motivo: string }).motivo, 'ausente')
  for (const basura of ['no-es-una-llave', 'a.b.c', `"${jwt({ role: 'service_role' })}"`, 'eyJ.eyJ']) {
    const r = diagnosticarLlaveServicio(basura, URL_PROYECTO)
    assert.equal(r.ok, false, basura)
  }
})

test('el diagnóstico jamás contiene la llave', () => {
  const llave = jwt({ role: 'anon', ref: 'abcdefghijklmnopqrst' })
  const texto = JSON.stringify(diagnosticarLlaveServicio(llave, URL_PROYECTO))
  assert.equal(texto.includes(llave), false)
  assert.equal(texto.includes('firma-de-mentira'), false)
})

test('createAdminClient avisa UNA vez, fuerte, y el panel de diagnóstico lo muestra solo a administradores', () => {
  const admin = readFileSync('src/lib/supabase/admin.ts', 'utf8')
  assert.match(admin, /diagnosticarLlaveServicio\(key, url\)/)
  assert.match(admin, /console\.error\(`\[supabase-admin\] \$\{diagnostico\.detalle\}/)
  // El aviso va después de la comprobación de la caché: una sola vez por instancia, no en cada llamada.
  assert.ok(admin.indexOf('if (cached) return cached') < admin.indexOf('diagnosticarLlaveServicio(key, url)'))
  const estado = readFileSync('src/app/api/pagos/cardnet-token/estado/route.ts', 'utf8')
  const bloqueAdmin = estado.slice(estado.indexOf('const base = esAdminDespliegue ?'), estado.indexOf('/** Respuesta única para los modos'))
  assert.match(bloqueAdmin, /llaveServicioSupabase: diagnosticarLlaveServicio\(/)
  assert.ok(bloqueAdmin.indexOf('llaveServicioSupabase') < bloqueAdmin.indexOf('} : {'), 'dentro de la rama de administradores')
})
