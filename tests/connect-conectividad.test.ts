import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { partirClave, pareceClaveEmpresa, componerClave, PREFIJO_CLAVE } from '../src/modules/connect/clavesApiNucleo'
import {
  FALLOS_PARA_APAGAR,
  suscripcionQuiere,
  validarUrlWebhook,
} from '../src/modules/connect/webhooksNucleo'

/**
 * MEMBEGO CONNECT · Fase 3 — Universal Connectivity.
 *
 * Núcleos puros probados de verdad (formato de clave, validación de URL,
 * selección por evento) y guardias estructurales sobre lo que no se puede
 * ejecutar sin base ni red.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const SECRETO = 'x'.repeat(43)

// ─── Claves de API ───────────────────────────────────────────────────────────

test('claves: parte una clave bien formada en sus dos mitades', () => {
  const clave = componerClave(`${PREFIJO_CLAVE}a1b2c3d4e5f6`, SECRETO)
  assert.deepEqual(partirClave(clave), {
    prefijo: 'mbk_a1b2c3d4e5f6',
    secreto: SECRETO,
  })
})

test('claves: rechaza lo que no tiene la forma exacta', () => {
  // Sin marca de agua, sin punto, prefijo de largo distinto, secreto corto.
  assert.equal(partirClave('Bearer abc'), null)
  assert.equal(partirClave(`${PREFIJO_CLAVE}a1b2c3d4e5f6`), null)
  assert.equal(partirClave(`${PREFIJO_CLAVE}corto.${SECRETO}`), null)
  assert.equal(partirClave(`${PREFIJO_CLAVE}a1b2c3d4e5f6.corto`), null)
  // Un prefijo con caracteres fuera del alfabeto hexadecimal esperado.
  assert.equal(partirClave(`${PREFIJO_CLAVE}A1B2C3D4E5F6.${SECRETO}`), null)
  assert.equal(partirClave(null), null)
})

test('claves: se reconocen por su marca de agua antes de tocar la base', () => {
  assert.equal(pareceClaveEmpresa(`${PREFIJO_CLAVE}a1b2c3d4e5f6.${SECRETO}`), true)
  assert.equal(pareceClaveEmpresa('eyJhbGciOiJIUzI1NiJ9.abc.def'), false)
})

// ─── URL de webhook: la guardia contra SSRF ──────────────────────────────────

test('webhooks: solo https y solo hosts públicos', () => {
  assert.equal(validarUrlWebhook('https://ejemplo.com/hook').ok, true)
  assert.deepEqual(validarUrlWebhook('http://ejemplo.com/hook'), { ok: false, motivo: 'no_https' })
  assert.deepEqual(validarUrlWebhook(''), { ok: false, motivo: 'vacia' })
  assert.deepEqual(validarUrlWebhook('no-es-una-url'), { ok: false, motivo: 'malformada' })
})

test('webhooks: no se entrega a la red interna (SSRF)', () => {
  // El de metadatos de la nube es EL objetivo clásico: desde dentro entrega
  // credenciales de infraestructura a quien pregunte.
  for (const url of [
    'https://169.254.169.254/latest/meta-data/',
    'https://metadata.google.internal/x',
    'https://localhost/hook',
    'https://127.0.0.1/hook',
    'https://10.0.0.5/hook',
    'https://192.168.1.10/hook',
    'https://172.16.0.9/hook',
    'https://172.31.255.1/hook',
    'https://algo.internal/hook',
  ]) {
    assert.deepEqual(validarUrlWebhook(url), { ok: false, motivo: 'host_interno' }, url)
  }
  // 172.32 ya está FUERA del rango privado: no se puede bloquear de más.
  assert.equal(validarUrlWebhook('https://172.32.0.1/hook').ok, true)
})

test('webhooks: sin eventos elegidos, se reciben todos', () => {
  assert.equal(suscripcionQuiere([], 'visit.completed'), true)
  assert.equal(suscripcionQuiere(['visit.completed'], 'visit.completed'), true)
  assert.equal(suscripcionQuiere(['visit.completed'], 'membership.activated'), false)
})

// ─── La guardia de la API v1 ─────────────────────────────────────────────────

const API = leer('src/modules/plataforma/api.ts')

test('api: las claves de empresa están CERRADAS por defecto', () => {
  // El defecto es lo único que protege a las rutas futuras: si `claveDeEmpresa`
  // se leyera como opcional-verdadero, cada ruta nueva nacería expuesta.
  assert.match(API, /if \(!opciones\.claveDeEmpresa\) return negar\('API_KEY_NOT_SUPPORTED'\)/)
  assert.match(API, /opciones: OpcionesAuth = \{\}/)
})

test('api: una clave de empresa no puede nombrar otra empresa', () => {
  const bloque = API.slice(API.indexOf("if (ctx.principal.tipo === 'empresa')"))
  assert.match(bloque.slice(0, 600), /companyId !== ctx\.principal\.companyId/)
  // Y se le contesta lo MISMO que a un sistema sin habilitación: distinguirlo
  // convertiría la API en un directorio de los clientes de MembeGo.
  assert.match(bloque.slice(0, 900), /COMPANY_NOT_ENTITLED/)
})

test('api: el límite por clave se cuenta ANTES de verificar el secreto', () => {
  const i = API.indexOf('const partida = partirClave(bruto)')
  const iLimite = API.indexOf('limitePlataforma(`platform:clave:', i)
  const iResolver = API.indexOf('await resolverClaveApi(bruto)', i)
  assert.ok(i > -1 && iLimite > i && iResolver > iLimite, 'probar secretos al azar saldría gratis')
})

test('api: ninguna ruta de escritura se abrió a claves de empresa', () => {
  // Las escrituras necesitan saber QUÉ sistema respalda la operación; una
  // clave de empresa no puede decirlo, y un canje sin sistema no se audita.
  for (const ruta of [
    'src/app/api/platform/v1/redemptions/route.ts',
    'src/app/api/platform/v1/transactions/route.ts',
    'src/app/api/platform/v1/customers/route.ts',
  ]) {
    assert.ok(!leer(ruta).includes('claveDeEmpresa'), `${ruta} se abrió a claves de empresa`)
  }
})

test('api: las rutas de satélite exigen el principal con el tipo, no a ciegas', () => {
  for (const ruta of [
    'src/app/api/platform/v1/redemptions/route.ts',
    'src/app/api/platform/v1/transactions/route.ts',
    'src/app/api/platform/v1/sso/redeem/route.ts',
    'src/app/api/platform/v1/systems/me/route.ts',
  ]) {
    const src = leer(ruta)
    assert.match(src, /exigeSistema\(ctx\)/, ruta)
    // Nadie vuelve a leer el campo suelto: el tipo ya no lo permite, y esta
    // guardia lo dice en voz alta por si alguien lo reintroduce.
    assert.ok(!/ctx\.sistemaId|ctx\.sistemaSlug/.test(src), ruta)
  }
})

// ─── Migración ───────────────────────────────────────────────────────────────

const MIGRACION = leer('prisma/migrations/20260901_connect_webhooks/migration.sql')

test('migración: https y secreto no vacío se exigen TAMBIÉN en la base', () => {
  assert.match(MIGRACION, /suscripciones_webhook_url_https[\s\S]*?LIKE 'https:\/\/%'/)
  assert.match(MIGRACION, /suscripciones_webhook_secreto_no_vacio[\s\S]*?length\("secreto"\) >= 16/)
  assert.match(MIGRACION, /entregas_webhook_estado_valido[\s\S]*?'PENDIENTE','ENVIADO','DEAD_LETTER'/)
  assert.equal(/CREATE TABLE (?!IF NOT EXISTS)/.test(MIGRACION), false)
})

// ─── Fan-out: un solo río, dos destinos ──────────────────────────────────────

test('bus: el mismo evento va a satélites Y a webhooks de empresa', () => {
  const src = leer('src/modules/estrategias/eventos.ts')
  const iSat = src.indexOf('reenviarEventoASistemas({')
  const iWeb = src.indexOf('repartirEventoAWebhooks({')
  assert.ok(iSat > -1 && iWeb > iSat, 'los dos destinos salen del mismo despacho')
  // Por el cable viaja el nombre v2, no el interno.
  assert.match(src, /evento: tipoV2\(evento\.type\)/)
})

test('webhooks: dos umbrales distintos, uno por mensaje y otro por destino', () => {
  const src = leer('src/modules/connect/webhooks.ts')
  assert.match(src, /intentos >= MAX_INTENTOS \? \{ estado: 'DEAD_LETTER' \}/)
  assert.match(src, /fallosSeguidos >= FALLOS_PARA_APAGAR/)
  assert.equal(FALLOS_PARA_APAGAR > 8, true, 'apagar el destino no puede ser más fácil que rendirse con un mensaje')
})

test('webhooks: el destino se vuelve a resolver en cada reintento', () => {
  const src = leer('src/modules/connect/webhooks.ts')
  // Una suscripción pausada entre medias deja de recibir, en vez de que se le
  // vacíe la cola encima justo cuando pidió que paráramos.
  assert.match(src, /if \(e\.suscripcion\.estado !== 'ACTIVE'\)/)
})

test('webhooks: la bitácora nunca anota el secreto de firma', () => {
  // Se quitan los comentarios ANTES de mirar: el propio comentario que explica
  // «el secreto jamás» contiene la palabra, y una guardia que se dispara con su
  // propia documentación es una guardia que se acaba desactivando.
  const src = leer('src/modules/connect/webhooks.ts').replace(/\/\/.*$/gm, '')
  for (const bloque of src.split('anotarConector({').slice(1)) {
    const detalle = bloque.slice(0, bloque.indexOf('})'))
    assert.ok(!/secreto/.test(detalle), 'la bitácora estaría anotando el secreto de firma')
  }
})
