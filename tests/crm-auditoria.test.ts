import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * EL CRM DEJA RASTRO.
 *
 * Se descubrió preguntando algo muy concreto: nueve actions del CRM habían
 * estado abiertas a quien no podía ni abrir el CRM (sección equivocada en la
 * guardia), y al ir a la bitácora a ver si alguien había pasado por ahí, no
 * había bitácora. Ni una línea. Otros 44 módulos auditaban; el CRM no. Y las
 * tablas `Lead` y `AutoReplyConfig` tampoco guardan autor: no existía forma de
 * saber quién creó, editó o descartó nada.
 *
 * Un prospecto es un cliente potencial con su teléfono y su correo, y
 * descartarlo o reasignarlo le quita trabajo —y comisión— a alguien. Las
 * respuestas automáticas contestan EN NOMBRE DE LA EMPRESA sin que nadie las
 * lea antes. Ninguna de las dos cosas puede pasar sin nombre y sin fecha.
 *
 * Esta prueba mira la FUENTE porque lo que hay que impedir es que una action
 * nueva —o una vieja que alguien reescriba— se quede muda. Una prueba de
 * comportamiento no lo vería: no falla nada cuando no se escribe un asiento.
 */

function fuente(...ruta: string[]): string {
  return readFileSync(join(__dirname, '..', ...ruta), 'utf8')
}

/** Recorta el cuerpo de una función exportada hasta la siguiente. */
function cuerpo(src: string, nombre: string): string {
  const i = src.indexOf(`export async function ${nombre}(`)
  assert.notEqual(i, -1, `no existe la action ${nombre}`)
  const sig = src.indexOf('export async function ', i + 10)
  return src.slice(i, sig === -1 ? src.length : sig)
}

const LEADS = fuente('src', 'modules', 'crm', 'lead-actions.ts')
const AUTOREPLY = fuente('src', 'modules', 'connect', 'autoReply-actions.ts')

const ESCRITURAS: [string, string, string][] = [
  ['createLead', 'PROSPECTO_CREADO', 'leads'],
  ['updateLead', 'PROSPECTO_ACTUALIZADO', 'leads'],
  ['deleteLead', 'PROSPECTO_DESCARTADO', 'leads'],
  ['moveToStage', 'PROSPECTO_ETAPA_CAMBIADA', 'leads'],
  ['assignLead', 'PROSPECTO_ASIGNADO', 'leads'],
  ['createAutoReplyConfig', 'AUTO_RESPUESTA_CREADA', 'autoreply'],
  ['updateAutoReplyConfig', 'AUTO_RESPUESTA_ACTUALIZADA', 'autoreply'],
  ['deleteAutoReplyConfig', 'AUTO_RESPUESTA_ELIMINADA', 'autoreply'],
]

for (const [action, accion, archivo] of ESCRITURAS) {
  test(`${action} asienta ${accion} en la bitácora`, () => {
    const src = archivo === 'leads' ? LEADS : AUTOREPLY
    assert.match(cuerpo(src, action), new RegExp(`'${accion}'`))
  })
}

test('cada valor nuevo del enum existe en el esquema Y en su migración', () => {
  const esquema = fuente('prisma', 'schema', 'identidad.prisma')
  const migracion = fuente('prisma', 'migrations', '20260930_crm_auditoria', 'migration.sql')
  for (const [, accion] of ESCRITURAS) {
    assert.ok(new RegExp(`^\\s+${accion}$`, 'm').test(esquema), `${accion} no está en el enum`)
    assert.ok(
      migracion.includes(`ADD VALUE IF NOT EXISTS '${accion}'`),
      `${accion} no está en la migración: el código lo escribiría y PostgreSQL lo rechazaría`
    )
  }
})

test('auditar NUNCA puede tumbar la operación (fail-open, y a propósito)', () => {
  // Las migraciones de este proyecto se aplican a mano. Si el código llega a
  // producción antes que la suya, PostgreSQL rechaza el valor desconocido; si
  // eso ocurriera DENTRO de la transacción del prospecto, se llevaría por
  // delante el cambio y el CRM quedaría de solo lectura sin explicación.
  for (const [src, helper] of [
    [LEADS, 'auditarProspecto'],
    [AUTOREPLY, 'auditarAutoRespuesta'],
  ] as const) {
    const i = src.indexOf(`async function ${helper}(`)
    assert.notEqual(i, -1, `falta el ayudante ${helper}`)
    const fin = src.indexOf('\n}', i)
    const h = src.slice(i, fin)
    assert.match(h, /try\s*{/, `${helper} tiene que tragarse su error`)
    assert.match(h, /catch/, `${helper} tiene que tragarse su error`)
    // Y fuera de la transacción de la operación: su `conEmpresa` es suyo.
    assert.match(h, /conEmpresa\(companyId/, `${helper} escribe con envoltorio de empresa`)
  }
})

test('el asiento guarda IP y navegador, que es para lo que se hizo', () => {
  for (const [src, helper] of [
    [LEADS, 'auditarProspecto'],
    [AUTOREPLY, 'auditarAutoRespuesta'],
  ] as const) {
    const i = src.indexOf(`async function ${helper}(`)
    const h = src.slice(i, src.indexOf('\n}', i))
    assert.match(h, /getRequestMeta\(\)/, `${helper} debe registrar ipAddress y userAgent`)
    assert.match(h, /\.\.\.meta/, `${helper} debe volcar la meta en el asiento`)
  }
})
