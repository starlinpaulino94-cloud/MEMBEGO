import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PROPIEDAD_CITA,
  borradoYaHecho,
  creacionYaHecha,
  cuerpoEvento,
  esIdEventoValido,
  idEventoDeCita,
  sincronizaConfirmadas,
} from '../src/modules/connect/googleCalendarNucleo'

/**
 * GOOGLE CALENDAR · el ciclo de vida completo del evento de una cita.
 *
 * Hasta aquí el conector sabía CREAR. Estas pruebas vigilan lo que faltaba
 * para estar integrado de verdad con la referencia v3: que crear sea
 * idempotente, que cancelar borre, que una cita autoconfirmada también
 * llegue, que la opción del alta se respete, y que desconectar revoque en
 * Google además de borrar nuestra copia.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const codigo = (r: string) =>
  leer(r).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const ACCIONES = 'src/modules/citas/actions.ts'
const CALENDARIO = 'src/modules/connect/googleCalendar.ts'
const REGISTRO = 'src/modules/connect/registro.ts'

// ─── Reglas puras ────────────────────────────────────────────────────────────

test('id del evento: determinista y dentro del alfabeto que Google acepta', () => {
  // Un cuid real lleva letras w–z, que están FUERA de base32hex.
  const cuid = 'cmf1xyzw9000008l4hz2a3bqe'
  const id = idEventoDeCita(cuid)
  assert.equal(id, idEventoDeCita(cuid), 'la misma cita tiene que dar el mismo id')
  assert.notEqual(id, idEventoDeCita('cmf1xyzw9000008l4hz2a3bqf'))
  assert.ok(esIdEventoValido(id), `«${id}» no es base32hex de 5–1024`)
  assert.ok(id.startsWith('membego'))
  assert.ok(!esIdEventoValido('con-guion'))
  assert.ok(!esIdEventoValido('abc'))
})

test('cuerpo del evento: id propio, zona horaria en las dos fechas y la cita dentro', () => {
  const inicio = new Date('2026-09-10T13:00:00.000Z')
  const fin = new Date('2026-09-10T13:30:00.000Z')
  const cuerpo = cuerpoEvento('cita1', {
    titulo: 'Lavado · Ana',
    inicio,
    fin,
    zonaHoraria: 'America/Santo_Domingo',
  })
  assert.equal(cuerpo.id, idEventoDeCita('cita1'))
  assert.equal(cuerpo.start.timeZone, 'America/Santo_Domingo')
  assert.equal(cuerpo.end.timeZone, 'America/Santo_Domingo')
  assert.equal(cuerpo.start.dateTime, inicio.toISOString())
  assert.equal(cuerpo.extendedProperties.private[PROPIEDAD_CITA], 'cita1')
  // Los avisos son los del calendario del negocio: no se inventa una antelación.
  assert.deepEqual(cuerpo.reminders, { useDefault: true })
})

test('respuestas de Google que cuentan como hechas', () => {
  assert.ok(borradoYaHecho(404) && borradoYaHecho(410), 'no existe / ya borrado = hecho')
  assert.ok(!borradoYaHecho(403) && !borradoYaHecho(500))
  assert.ok(creacionYaHecha(409), 'id repetido = ya existía')
  assert.ok(!creacionYaHecha(400))
})

test('la opción «llevar las citas confirmadas» ausente es sí; solo false la apaga', () => {
  assert.equal(sincronizaConfirmadas({}), true)
  assert.equal(sincronizaConfirmadas({ sincronizarConfirmadas: true }), true)
  assert.equal(sincronizaConfirmadas({ sincronizarConfirmadas: false }), false)
})

// ─── El esquema ──────────────────────────────────────────────────────────────

test('esquema: la cita recuerda su evento de Google, con migración aditiva', () => {
  assert.match(leer('prisma/schema/citas.prisma'), /googleEventId\s+String\?/)
  const m = leer('prisma/migrations/20260908_citas_google_event_id/migration.sql')
  assert.match(m, /ADD COLUMN IF NOT EXISTS "googleEventId" TEXT/)
  assert.ok(!/DROP |DELETE |UPDATE /i.test(m), 'la migración tiene que ser aditiva')
})

// ─── Citas ───────────────────────────────────────────────────────────────────

function cuerpoDe(src: string, funcion: string): string {
  const desde = src.indexOf(`export async function ${funcion}`)
  assert.ok(desde >= 0, `no existe ${funcion}`)
  const siguiente = src.indexOf('\nexport async function ', desde + 1)
  return src.slice(desde, siguiente === -1 ? undefined : siguiente)
}

test('citas: una cita autoconfirmada al reservar también llega a Google', () => {
  // La única llamada estaba en «confirmar» del negocio: con la agenda en
  // autoconfirmación, ninguna cita llegaba nunca a la agenda.
  const reservar = cuerpoDe(codigo(ACCIONES), 'reservarCita')
  assert.match(reservar, /llevarCitaAGoogle\(/)
})

test('citas: al cancelar —el cliente o el negocio— el evento se borra de la agenda', () => {
  const src = codigo(ACCIONES)
  assert.match(cuerpoDe(src, 'cancelarCitaCliente'), /quitarCitaDeGoogle\(/)
  const admin = cuerpoDe(src, 'actualizarEstadoCita')
  const cancelar = admin.slice(admin.indexOf("accion === 'cancelar'"))
  assert.match(cancelar, /quitarCitaDeGoogle\(/)
})

test('citas: el id que devuelve Google se guarda, y no se crea dos veces', () => {
  const src = codigo(ACCIONES)
  assert.match(src, /googleEventId: /, 'el id del evento no se guarda en la cita')
  // Con id guardado no se vuelve a crear: es la primera línea de defensa
  // contra el duplicado (la segunda es el id determinista y el 409).
  assert.match(src, /if \(cita\.googleEventId\) return/)
  // Y nada de esto puede romper la cita: todo es best-effort.
  assert.match(leer(ACCIONES), /no se pudo crear el evento en Google/)
  assert.match(leer(ACCIONES), /no se pudo quitar el evento de Google/)
})

// ─── El conector ─────────────────────────────────────────────────────────────

test('google: crear es idempotente (id propio) y respeta la opción del alta', () => {
  const src = codigo(CALENDARIO)
  const crear = src.slice(src.indexOf('export async function crearEventoCalendario'))
  assert.match(crear, /cuerpoEvento\(/, 'el cuerpo tiene que salir del núcleo puro')
  assert.match(crear, /creacionYaHecha\(resp\.status\)/, 'un 409 es «ya existía», no un fallo')
  assert.match(crear, /sincronizaConfirmadas\(/)
  assert.match(crear, /motivo: 'desactivado'/)
})

test('google: borrar existe, no avisa a nadie y trata «ya no está» como hecho', () => {
  const src = codigo(CALENDARIO)
  const borrar = src.slice(src.indexOf('export async function eliminarEventoCalendario'))
  assert.ok(borrar.length > 0, 'falta eliminarEventoCalendario')
  assert.match(borrar, /method: 'DELETE'/)
  // `sendUpdates=none`: borrar una cita no manda un correo de «evento
  // cancelado» a nadie desde la cuenta del negocio.
  assert.match(borrar, /sendUpdates=none/)
  assert.match(borrar, /borradoYaHecho\(resp\.status\)/)
})

test('google: la validación sigue sin escribir ni borrar nada', () => {
  // La función nueva de borrar va DESPUÉS de crear: la prueba de la Fase 12
  // recorta la validación hasta `crearEventoCalendario` y no debe encontrarse
  // un DELETE por el camino.
  const src = codigo(CALENDARIO)
  const validar = src.indexOf('export async function validarCalendario')
  const crear = src.indexOf('export async function crearEventoCalendario')
  const borrar = src.indexOf('export async function eliminarEventoCalendario')
  assert.ok(validar < crear && crear < borrar, 'orden: validar → crear → borrar')
})

// ─── Desconectar ─────────────────────────────────────────────────────────────

test('desconectar: se revoca en Google ANTES de borrar nuestra copia', () => {
  const src = codigo(REGISTRO)
  const desconectar = src.slice(src.indexOf('export async function desconectarConexion'))
  const revocar = desconectar.indexOf('revocarTokensOauth(')
  const borrar = desconectar.indexOf('eliminarCredencial(')
  assert.ok(revocar >= 0, 'desconectar no revoca en el proveedor')
  assert.ok(revocar < borrar, 'hay que revocar mientras todavía tenemos el token')
  // Best-effort: un fallo al revocar no puede dejar la conexión a medias.
  assert.match(desconectar, /revocarTokensOauth\([\s\S]*?\)\.catch\(/)
})

test('revocar: Google tiene punto de revocación y la llamada tiene tope de tiempo', () => {
  assert.match(
    leer('src/modules/connect/proveedores/googleCalendar.ts'),
    /urlRevocacion: 'https:\/\/oauth2\.googleapis\.com\/revoke'/
  )
  const rev = leer('src/modules/connect/revocacion.ts')
  assert.match(rev, /AbortSignal\.timeout\(/)
  // 400 = el token ya no valía: mismo resultado que revocado.
  assert.match(rev, /resp\.status === 400/)
  // Y no cierra el ciclo oauth → registro → oauth.
  assert.ok(!/from '@\/modules\/connect\/oauth'/.test(rev))
  assert.ok(!/from '@\/modules\/connect\/registro'/.test(rev))
})
