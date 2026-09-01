import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DIAS_ALTA_ABANDONADA,
  altaAbandonada,
  altaCompleta,
  altaVacia,
  conRespuesta,
  guionCaducado,
  leerEstadoAlta,
  pasoActual,
  pasoCumplido,
  pasosVisitables,
  progreso,
  type EstadoAlta,
  type HechosAlta,
} from '../src/modules/connect/altaNucleo'
import { claseDeEstadoHttp, claseDeFalloDeRed } from '../src/modules/connect/proveedores/tipos'
import { proveedorDe } from '../src/modules/connect/proveedores/indice'

/**
 * MEMBEGO CONNECT · Fase 12 (El alta guiada + Google Calendar completo).
 *
 * El núcleo del alta se ejecuta de verdad; lo que necesita red o base se
 * vigila leyendo el fuente, igual que en el resto de la suite.
 */

const leer = (r: string) => readFileSync(join(__dirname, '..', r), 'utf8')
const codigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const GOOGLE = proveedorDe('google-calendar')!
const SIN_HECHOS: HechosAlta = { autorizado: false, validado: false }

// ─── El paso actual se DEDUCE ────────────────────────────────────────────────

test('alta: el primer paso es el primero sin cumplir', () => {
  const estado = altaVacia(GOOGLE.versionAlta)
  assert.equal(pasoActual(GOOGLE, estado, SIN_HECHOS)?.id, 'autorizar')
  assert.equal(progreso(GOOGLE, estado, SIN_HECHOS).numero, 1)
  assert.equal(progreso(GOOGLE, estado, SIN_HECHOS).total, 4)
})

test('alta: volver de OAuth avanza el paso SIN que nadie mueva un cursor', () => {
  // Éste es el motivo de todo el diseño: el usuario vuelve de Google en una
  // petición nueva —otra pestaña, otro día— y el asistente aterriza solo en el
  // paso siguiente porque la credencial YA existe.
  const estado = altaVacia(GOOGLE.versionAlta)
  const trasAutorizar: HechosAlta = { autorizado: true, validado: false }
  assert.equal(pasoActual(GOOGLE, estado, trasAutorizar)?.id, 'calendario')
})

test('alta: contestar avanza; el alta se completa cuando no queda nada', () => {
  const hechos: HechosAlta = { autorizado: true, validado: false }
  let estado = altaVacia(GOOGLE.versionAlta)
  estado = conRespuesta(estado, 'calendario', 'agenda@grupo.calendar.google.com')
  assert.equal(pasoActual(GOOGLE, estado, hechos)?.id, 'opciones')

  estado = conRespuesta(estado, 'opciones', { sincronizarConfirmadas: true })
  assert.equal(pasoActual(GOOGLE, estado, hechos)?.id, 'validacion')
  assert.equal(altaCompleta(GOOGLE, estado, hechos), false)

  assert.equal(altaCompleta(GOOGLE, estado, { autorizado: true, validado: true }), true)
  assert.equal(pasoActual(GOOGLE, estado, { autorizado: true, validado: true }), null)
})

test('alta: un paso puede cumplirse por un HECHO y no por una respuesta', () => {
  // El token de WhatsApp NO se guarda en el estado del alta —sería un secreto
  // en claro dentro de un JSON— así que su paso se da por hecho porque la
  // credencial existe.
  const wa = proveedorDe('whatsapp')!
  const credencial = wa.pasos().find((p) => p.id === 'credencial')!
  assert.equal(credencial.cumpleCon, 'autorizado')
  assert.equal(pasoCumplido(credencial, altaVacia(2), SIN_HECHOS), false)
  assert.equal(pasoCumplido(credencial, altaVacia(2), { autorizado: true, validado: false }), true)
})

test('alta: no se puede volver ANTES de la autorización ya hecha', () => {
  // Borrar la respuesta de «autorizar» no revocaría la credencial: enseñaría
  // un botón de conectar sobre una cuenta ya conectada. Deshacer eso es
  // desconectar, que es otra acción.
  let estado = altaVacia(GOOGLE.versionAlta)
  estado = conRespuesta(estado, 'calendario', 'x')
  const visitables = pasosVisitables(GOOGLE, estado, { autorizado: true, validado: false })
  assert.ok(!visitables.some((p) => p.id === 'autorizar'))
  assert.deepEqual(visitables.map((p) => p.id), ['calendario', 'opciones'])
})

// ─── Estado guardado ─────────────────────────────────────────────────────────

test('alta: un estado corrupto se lee como ausente, no revienta', () => {
  for (const basura of [null, 'texto', 42, [], {}, { version: 'dos' }, { version: 1 }]) {
    assert.equal(leerEstadoAlta(basura), null, `${JSON.stringify(basura)} debería descartarse`)
  }
  const bueno: EstadoAlta = { datos: { a: 1 }, version: 2, iniciadoEn: '2026-09-01T00:00:00.000Z' }
  assert.deepEqual(leerEstadoAlta(bueno), bueno)
})

test('alta: si el guion cambió, las respuestas viejas no valen', () => {
  const viejo = altaVacia(1)
  assert.equal(guionCaducado(GOOGLE, viejo), true)
  assert.equal(guionCaducado(GOOGLE, altaVacia(GOOGLE.versionAlta)), false)
})

test('alta: un alta a medias se reconoce como abandonada SIN tocar la conexión', () => {
  const hace = (dias: number) =>
    altaVacia(2, new Date(Date.now() - dias * 24 * 60 * 60 * 1000))
  assert.equal(altaAbandonada(hace(DIAS_ALTA_ABANDONADA + 1)), true)
  assert.equal(altaAbandonada(hace(1)), false)
  // Una fecha ilegible no convierte un alta en abandonada por sorpresa.
  assert.equal(altaAbandonada({ datos: {}, version: 1, iniciadoEn: 'ayer' }), false)
})

// ─── Clasificación de errores ────────────────────────────────────────────────

test('errores: cada estado HTTP implica una conducta distinta', () => {
  assert.equal(claseDeEstadoHttp(401), 'AUTH')
  assert.equal(claseDeEstadoHttp(403), 'PERMISSIONS')
  assert.equal(claseDeEstadoHttp(404), 'CONFIGURATION')
  assert.equal(claseDeEstadoHttp(429), 'RATE_LIMIT')
  assert.equal(claseDeEstadoHttp(500), 'PROVIDER')
  assert.equal(claseDeEstadoHttp(503), 'PROVIDER')
  assert.equal(claseDeEstadoHttp(418), 'UNKNOWN')
  assert.equal(claseDeFalloDeRed(), 'NETWORK')
})

test('errores: un límite de cuota NO rompe la conexión', () => {
  const src = codigo('src/modules/connect/registro.ts')
  // Marcar ERROR por un 429 pintaría «Requiere atención» sobre una integración
  // que funciona y pediría reconectar una cuenta sana.
  assert.match(src, /const transitorio = CLASES_TRANSITORIAS\.includes\(clase\)/)
  assert.match(src, /if \(!transitorio && estadoActual !== 'ERROR'/)
  // Y un uso correcto borra la clase anterior: si no, seguiría pidiendo
  // reconectar una conexión que ya funciona.
  assert.match(src, /claseError: null/)
})

test('errores: Google usa 403 para dos cosas y se distinguen', () => {
  const src = codigo('src/modules/connect/googleCalendar.ts')
  assert.match(src, /rateLimit\|quota\|userRateLimit/)
  // Del cuerpo de error solo se lee `reason`: en el resto puede viajar
  // información de la cuenta del cliente.
  assert.ok(!/await resp\.text\(\)/.test(src))
})

// ─── Google Calendar ─────────────────────────────────────────────────────────

test('google: se pide el permiso MÁS ESTRECHO que permite listar calendarios', () => {
  const src = leer('src/modules/connect/proveedores/googleCalendar.ts')
  assert.match(src, /auth\/calendar\.events/)
  assert.match(src, /auth\/calendar\.calendarlist\.readonly/)
  // `calendar.readonly` dejaría leer el contenido de TODOS los eventos del
  // cliente, que no necesitamos para nada.
  assert.ok(!/auth\/calendar\.readonly/.test(codigo('src/modules/connect/proveedores/googleCalendar.ts')))
})

test('google: la validación NO escribe nada en la agenda del cliente', () => {
  const src = codigo('src/modules/connect/googleCalendar.ts')
  const validar = src.slice(src.indexOf('export async function validarCalendario'))
  const cuerpo = validar.slice(0, validar.indexOf('export async function crearEventoCalendario'))
  // Ni crear ni borrar: un evento de prueba dispara notificaciones a los
  // invitados antes de que nos dé tiempo a borrarlo.
  assert.ok(!/method: 'POST'/.test(cuerpo), 'la validación estaría creando algo')
  assert.ok(!/method: 'DELETE'/.test(cuerpo), 'la validación estaría borrando algo')
  // Y comprueba lo que de verdad importa: que se pueda escribir DESPUÉS.
  assert.match(cuerpo, /puedeEscribir === true/)
})

test('google: un calendario de solo lectura se detecta ANTES de la primera cita', () => {
  const src = leer('src/modules/connect/googleCalendar.ts')
  // `accessRole` es la razón por la que no basta con listar nombres: elegir el
  // calendario de festivos del país fallaría en cada cita durante meses.
  assert.match(src, /c\.accessRole === 'owner' \|\| c\.accessRole === 'writer'/)
})

test('google: sin calendario elegido NO se escribe en «primary» por si acaso', () => {
  const src = codigo('src/modules/connect/googleCalendar.ts')
  // Adivinar el destino es cómo un negocio acaba con sus citas en la agenda
  // personal de quien conectó la cuenta.
  assert.ok(!/CALENDARIO_POR_DEFECTO|'primary'/.test(src))
  assert.match(src, /return \{ ok: false, motivo: 'sin_configurar' \}/)
})

// ─── Separación entre lo temporal y lo operativo ─────────────────────────────

test('alta: el progreso NO sobrevive a una conexión terminada', () => {
  const src = codigo('src/modules/connect/alta.ts')
  // `undefined` en Prisma significa «no toques este campo»: con él, el
  // progreso del alta se quedaría dentro de la configuración productiva.
  assert.match(src, /setupState: Prisma\.DbNull/)
  assert.match(src, /setupVersion: vista\.def\.versionAlta/)
})

test('alta: el asistente escribe en setupState y JAMÁS en config', () => {
  const src = codigo('src/modules/connect/alta.ts')
  const responder = src.slice(src.indexOf('export async function responderPaso'))
  const cuerpo = responder.slice(0, responder.indexOf('export async function olvidarPaso'))
  assert.match(cuerpo, /data: \{ setupState:/)
  assert.ok(!/config:/.test(cuerpo), 'responderPaso estaría tocando la configuración operativa')
})

test('alta: no se cierra un alta incompleta, lo diga quien lo diga', () => {
  const src = codigo('src/modules/connect/alta.ts')
  assert.match(src, /if \(!vista\.completa\) return \{ ok: false, motivo: 'incompleta' \}/)
})

test('alta: solo se contesta un paso que existe en el guion', () => {
  // Sin esto, un formulario manipulado metería claves arbitrarias en el estado.
  const src = codigo('src/modules/connect/alta.ts')
  assert.match(src, /if \(!vista\.def\.pasos\(\)\.some\(\(p\) => p\.id === input\.pasoId\)\) return/)
})

test('alta: las acciones sacan la empresa de la SESIÓN, nunca del formulario', () => {
  const src = codigo('src/modules/connect/altaActions.ts')
  const guardias = src.match(/requireSection\('integraciones', 'app_conectar'\)/g) ?? []
  assert.ok(guardias.length >= 5, `solo ${guardias.length} acciones con guardia`)
  assert.ok(!/formData\.get\('companyId'\)/.test(src))
})

// ─── Migración ───────────────────────────────────────────────────────────────

const MIGRACION = leer('prisma/migrations/20260904_connect_alta_guiada/migration.sql')

test('migración: dos columnas anulables, sin CHECK, sin índices, sin backfill', () => {
  assert.match(MIGRACION, /ADD COLUMN IF NOT EXISTS "setupState" JSONB/)
  assert.match(MIGRACION, /ADD COLUMN IF NOT EXISTS "setupVersion" INTEGER/)
  for (const destructivo of ['DROP TABLE', 'DROP COLUMN', 'DELETE FROM', 'TRUNCATE', 'CREATE INDEX']) {
    assert.ok(!MIGRACION.includes(destructivo), `la migración contiene ${destructivo}`)
  }
  assert.ok(!/^\s*UPDATE /m.test(MIGRACION))
  // Anulables y sin default: en PostgreSQL 11+ eso NO reescribe la tabla.
  assert.ok(!/NOT NULL|DEFAULT /.test(MIGRACION.split('-- ── Verificación')[0]))
})
