import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MARGEN_REFRESCO_MS,
  VIDA_ESTADO_S,
  firmarEstado,
  fusionarTokens,
  leerEstado,
  necesitaRefresco,
  nuevoPkce,
  retoDesde,
  urlDeAutorizacion,
  destinoDeVueltaSeguro,
} from '../src/modules/connect/oauthNucleo'

/**
 * MEMBEGO CONNECT · Fase 5 — OAuth.
 *
 * Aquí MembeGo es el CLIENTE. Cada prueba protege una de las formas conocidas
 * de robar un flujo OAuth: código interceptado (PKCE), callback falsificado
 * (state firmado), callback repetido (uso único) y redirector abierto.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const SECRETO = 'secreto-de-firma-de-pruebas-con-largo-suficiente'

// ─── PKCE ────────────────────────────────────────────────────────────────────

test('oauth/pkce: el reto es el sha256 del verificador y el verificador no se puede deducir', () => {
  const par = nuevoPkce()
  assert.equal(par.challenge, retoDesde(par.verifier))
  assert.notEqual(par.challenge, par.verifier)
  // 43 caracteres = 32 bytes en base64url, el mínimo del RFC 7636.
  assert.ok(par.verifier.length >= 43)
  // Dos flujos nunca comparten verificador.
  assert.notEqual(nuevoPkce().verifier, par.verifier)
})

// ─── Estado firmado ──────────────────────────────────────────────────────────

test('oauth/estado: ida y vuelta con la firma correcta', () => {
  const token = firmarEstado(SECRETO, { id: 'est_1', iat: Math.floor(Date.now() / 1000) })
  const r = leerEstado(SECRETO, token)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.estado.id, 'est_1')
})

test('oauth/estado: no se acepta firmado con otro secreto ni manipulado', () => {
  const token = firmarEstado(SECRETO, { id: 'est_1', iat: Math.floor(Date.now() / 1000) })
  assert.deepEqual(leerEstado('otro-secreto-distinto', token), { ok: false, motivo: 'firma' })

  // Cambiar el id del estado invalida la firma: es lo que impide que alguien
  // se fabrique un callback apuntando al flujo de otra empresa.
  const [, firma] = token.split('.')
  const otraCarga = Buffer.from(JSON.stringify({ id: 'est_2', iat: 1 }), 'utf8').toString(
    'base64url'
  )
  assert.deepEqual(leerEstado(SECRETO, `${otraCarga}.${firma}`), { ok: false, motivo: 'firma' })
  assert.deepEqual(leerEstado(SECRETO, 'basura'), { ok: false, motivo: 'formato' })
})

test('oauth/estado: caduca', () => {
  const viejo = Math.floor(Date.now() / 1000) - VIDA_ESTADO_S - 1
  const token = firmarEstado(SECRETO, { id: 'est_1', iat: viejo })
  assert.deepEqual(leerEstado(SECRETO, token), { ok: false, motivo: 'vencido' })
})

// ─── URL de autorización ─────────────────────────────────────────────────────

test('oauth/url: lleva PKCE con S256, el state y la redirect_uri', () => {
  const url = new URL(
    urlDeAutorizacion({
      proveedor: {
        urlAutorizacion: 'https://proveedor.example/authorize',
        urlToken: 'https://proveedor.example/token',
        clientId: 'cid-123',
        extra: { access_type: 'offline' },
      },
      redirectUri: 'https://www.membego.com/api/connect/oauth/callback',
      scopes: ['a.read', 'b.write'],
      state: 'firmado',
      challenge: 'RETO',
    })
  )
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('code_challenge'), 'RETO')
  assert.equal(url.searchParams.get('scope'), 'a.read b.write')
  assert.equal(url.searchParams.get('redirect_uri'), 'https://www.membego.com/api/connect/oauth/callback')
  // Los parámetros propios del proveedor viajan sin que el núcleo los conozca.
  assert.equal(url.searchParams.get('access_type'), 'offline')
})

// ─── Refresco ────────────────────────────────────────────────────────────────

test('oauth/refresco: se adelanta al vencimiento, y sin caducidad no refresca', () => {
  const ahora = Date.now()
  assert.equal(necesitaRefresco(new Date(ahora + MARGEN_REFRESCO_MS - 1000), ahora), true)
  assert.equal(necesitaRefresco(new Date(ahora + MARGEN_REFRESCO_MS + 60_000), ahora), false)
  assert.equal(necesitaRefresco(new Date(ahora - 1000), ahora), true)
  // Sin fecha no se refresca: gastaría el refresh token de balde y, con
  // proveedores que lo rotan, podría dejarnos sin ninguno válido.
  assert.equal(necesitaRefresco(null, ahora), false)
})

test('oauth/refresco: refrescar NO puede borrar el refresh token anterior', () => {
  // El fallo clásico: al refrescar, muchos proveedores devuelven solo el
  // access_token. Guardar la respuesta tal cual mataría la conexión al
  // siguiente vencimiento — una hora después, cuando ya nadie mira.
  const previos = { accessToken: 'viejo', refreshToken: 'refresco-1', scopes: ['a'] }
  const fusion = fusionarTokens(previos, { accessToken: 'nuevo' })
  assert.deepEqual(fusion, { accessToken: 'nuevo', refreshToken: 'refresco-1', scopes: ['a'] })

  // Y si el proveedor SÍ manda uno nuevo (rotación), gana el nuevo.
  const rotado = fusionarTokens(previos, { accessToken: 'n2', refreshToken: 'refresco-2' })
  assert.equal(rotado.refreshToken, 'refresco-2')
})

// ─── Redirector abierto ──────────────────────────────────────────────────────

test('oauth/vuelta: solo rutas propias de /admin/', () => {
  assert.equal(destinoDeVueltaSeguro('/admin/integraciones?x=1'), '/admin/integraciones?x=1')
  // `//otro.com` PARECE una ruta y es una URL absoluta: es el caso que se
  // cuela cuando solo se mira el primer carácter.
  assert.equal(destinoDeVueltaSeguro('//malo.com/x'), '/admin/integraciones')
  assert.equal(destinoDeVueltaSeguro('https://malo.com'), '/admin/integraciones')
  assert.equal(destinoDeVueltaSeguro('/cliente/inicio'), '/admin/integraciones')
  assert.equal(destinoDeVueltaSeguro(null), '/admin/integraciones')
})

// ─── Guardias estructurales ──────────────────────────────────────────────────

test('oauth/callback: la redirect_uri se recalcula, nunca se lee de la petición', () => {
  const src = leer('src/app/api/connect/oauth/callback/route.ts')
  assert.match(src, /redirectUri: redirectUriDeCallback\(\)/)
  // Si se aceptara de la URL, se podrían robar códigos de autorización.
  assert.ok(!/redirect_uri.*searchParams|searchParams.*redirect_uri/.test(src))
})

test('oauth/callback: el destino final sale del ESTADO, no de la URL', () => {
  const src = leer('src/app/api/connect/oauth/callback/route.ts')
  assert.match(src, /res\.volverA \?\? '\/admin\/integraciones'/)
  assert.ok(!/params\.get\('volverA'\)/.test(src))
})

test('oauth/canje: el estado se consume con un borrado condicionado (uso único)', () => {
  const src = leer('src/modules/connect/oauth.ts')
  assert.match(src, /deleteMany\(\{ where: \{ id: fila\.id \} \}\)/)
  assert.match(src, /if \(consumido\.count === 0\) return \{ ok: false, motivo: 'estado_usado_o_vencido' \}/)
  // Y la firma se mira ANTES de tocar la base.
  const iFirma = src.indexOf('leerEstado(secretoFirma')
  const iBase = src.indexOf('tx.estadoOAuth.findUnique')
  assert.ok(iFirma > -1 && iBase > iFirma)
})

test('oauth/canje: el verificador PKCE sale de la base, no del navegador', () => {
  const src = leer('src/modules/connect/oauth.ts')
  assert.match(src, /codeVerifier: fila\.codeVerifier/)
})

test('oauth: los secretos de cliente viven en el entorno, nunca en la base', () => {
  const rutas = leer('src/modules/connect/oauthRutas.ts')
  // El catálogo guarda el NOMBRE de la variable, no su valor.
  assert.match(rutas, /clientSecretEnv/)
  assert.match(leer('src/modules/connect/oauth.ts'), /process\.env\[input\.config\.clientSecretEnv\]/)
})

test('oauth: la config sale del conector y solo si está disponible', () => {
  // En la Fase 5 este catálogo estaba vacío. La Fase 6 lo llenó, pero la
  // exigencia no cambió: un conector que no esté configurado en ESTE
  // despliegue no devuelve config, y la ruta de inicio contesta que no está
  // disponible en vez de mandar al usuario a una pantalla rota.
  // La Fase 10 movió la resolución al registro de proveedores; la exigencia es
  // la misma y ahora se comprueba donde vive.
  const src = leer('src/modules/connect/proveedores/indice.ts')
  assert.match(
    src,
    /if \(!p \|\| p\.autorizacion\.tipo !== 'OAUTH2' \|\| !p\.disponible\(\)\) return null/
  )
})

test('oauth/migración: el verificador no puede quedar vacío', () => {
  const m = leer('prisma/migrations/20260901_connect_oauth/migration.sql')
  assert.match(m, /estados_oauth_verifier_no_vacio[\s\S]*?length\("codeVerifier"\) >= 43/)
  assert.equal(/CREATE TABLE (?!IF NOT EXISTS)/.test(m), false)
})
