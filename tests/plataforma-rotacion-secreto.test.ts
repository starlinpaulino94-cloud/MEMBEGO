import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DIAS_SOLAPE_ROTACION,
  SOLAPE_ROTACION_MS,
  rotacionEnCurso,
  rotacionVencidaSinPromover,
  secretosVivos,
  verificarConVivos,
  type SecretosSistema,
} from '../src/modules/plataforma/rotacion-secreto-nucleo'
import { crearTokenSSO, verificarTokenSSO } from '../src/modules/integraciones/nucleo'

/**
 * ROTACIÓN DEL SECRETO DE SATÉLITE · hallazgo A-7 de la auditoría.
 *
 * Lo que decide qué secretos valen y cómo verificar contra ellos es puro y se
 * prueba aquí, incluida la propiedad que importa: durante el solape, un token
 * firmado con el nuevo se acepta, y fuera del solape ya no.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

const VIEJO = 'whs_viejo0000000000000000000000000000000000000000'
const NUEVO = 'whs_nuevo1111111111111111111111111111111111111111'
const AHORA = new Date('2026-09-17T12:00:00.000Z')

const sinRotacion: SecretosSistema = { secreto: VIEJO, secretoSiguiente: null, secretoSiguienteHasta: null }
const enSolape: SecretosSistema = {
  secreto: VIEJO,
  secretoSiguiente: NUEVO,
  secretoSiguienteHasta: new Date(AHORA.getTime() + 2 * 86_400_000),
}
const solapeVencido: SecretosSistema = {
  secreto: VIEJO,
  secretoSiguiente: NUEVO,
  secretoSiguienteHasta: new Date(AHORA.getTime() - 1),
}

// ─── Qué secretos están vivos ────────────────────────────────────────────────

test('sin rotación, solo vive el primario (y se prueba una sola vez)', () => {
  assert.deepEqual(secretosVivos(sinRotacion, AHORA), [VIEJO])
  assert.equal(rotacionEnCurso(sinRotacion, AHORA), false)
})

test('en solape, viven los dos, con el primario primero', () => {
  assert.deepEqual(secretosVivos(enSolape, AHORA), [VIEJO, NUEVO])
  assert.equal(rotacionEnCurso(enSolape, AHORA), true)
})

test('pasada la ventana, el nuevo deja de valer aunque siga en la fila', () => {
  // Aceptar para siempre un secreto que se dio por caducado es lo contrario de
  // rotar. La pendiente sigue en la fila hasta que el cron la limpia, pero ya no
  // verifica nada.
  assert.deepEqual(secretosVivos(solapeVencido, AHORA), [VIEJO])
  assert.equal(rotacionEnCurso(solapeVencido, AHORA), false)
  assert.equal(rotacionVencidaSinPromover(solapeVencido, AHORA), true)
  assert.equal(rotacionVencidaSinPromover(enSolape, AHORA), false)
})

// ─── La propiedad que importa: aceptar cualquiera de los dos ─────────────────

test('durante el solape se acepta un token firmado con el NUEVO', () => {
  // Es todo el sentido de A-7: el satélite instala el nuevo y empieza a firmar
  // con él; MembeGo lo acepta sin esperar a que los dos lados coincidan.
  const datos = { sub: 'u1', email: 'a@b.co', rol: 'EMPLEADO', companyId: 'c1', exp: 2_000_000_000 }
  const token = crearTokenSSO(NUEVO, datos)

  const conNuevo = verificarConVivos(secretosVivos(enSolape, AHORA), (s) => verificarTokenSSO(s, token))
  assert.ok(conNuevo, 'el token firmado con el nuevo no se aceptó durante el solape')
  assert.equal(conNuevo!.companyId, 'c1')

  // Y el viejo sigue valiendo a la vez.
  const tokenViejo = crearTokenSSO(VIEJO, datos)
  assert.ok(verificarConVivos(secretosVivos(enSolape, AHORA), (s) => verificarTokenSSO(s, tokenViejo)))
})

test('fuera del solape, un token firmado con el nuevo YA no se acepta', () => {
  const datos = { sub: 'u1', email: 'a@b.co', rol: 'EMPLEADO', companyId: 'c1', exp: 2_000_000_000 }
  const token = crearTokenSSO(NUEVO, datos)
  assert.equal(
    verificarConVivos(secretosVivos(solapeVencido, AHORA), (s) => verificarTokenSSO(s, token)),
    null
  )
})

test('un token firmado con un secreto ajeno no se acepta nunca', () => {
  const datos = { sub: 'u1', email: 'a@b.co', rol: 'EMPLEADO', companyId: 'c1', exp: 2_000_000_000 }
  const token = crearTokenSSO('whs_intruso999999999999999999999999999999999999', datos)
  assert.equal(
    verificarConVivos(secretosVivos(enSolape, AHORA), (s) => verificarTokenSSO(s, token)),
    null
  )
})

test('verificarConVivos devuelve el primer resultado válido y no sigue', () => {
  // También sirve de contraprueba de que no se traga un válido por probar de más.
  let intentos = 0
  const r = verificarConVivos(['a', 'b', 'c'], (s) => {
    intentos++
    return s === 'a' ? { ok: true } : null
  })
  assert.deepEqual(r, { ok: true })
  assert.equal(intentos, 1)
})

// ─── Constantes ──────────────────────────────────────────────────────────────

test('el solape dura los mismos 7 días que la rotación de webhooks', () => {
  assert.equal(DIAS_SOLAPE_ROTACION, 7)
  assert.equal(SOLAPE_ROTACION_MS, 7 * 24 * 60 * 60 * 1000)
})

// ─── Guardias del cableo ─────────────────────────────────────────────────────

test('las DOS rutas de verificación entrante aceptan los secretos vivos', () => {
  // Eran los dos caminos que la auditoría señaló como delicados: `/sso/entrar` y
  // `/sso/redeem`. Si alguno volviera a verificar contra un solo secreto, una
  // rotación le cortaría el SSO en cuanto el satélite cambiara su .env.
  for (const ruta of ['src/app/sso/entrar/route.ts', 'src/app/api/platform/v1/sso/redeem/route.ts']) {
    const src = leer(ruta)
    assert.match(src, /verificarConVivos\(/, `${ruta} no acepta los secretos vivos`)
    assert.match(src, /secretosVivos\(/, ruta)
  }
})

test('lo SALIENTE sigue firmándose con el secreto primario, no con una lista', () => {
  // El token SSO saliente y el HMAC de los webhooks se firman con `sistema.secreto`
  // a secas: meterles el nuevo o una lista rompería a un satélite que aún no
  // actualizó. La rotación de lo saliente es `promover`, no firmar con dos.
  const sso = leer('src/modules/integraciones/sso.ts')
  assert.match(sso, /crearTokenSSO\(sistema\.secreto/)
  assert.ok(!/secretosVivos|secretoSiguiente/.test(sso), 'el SSO saliente no debe mirar el secreto nuevo')
})

test('la migración añade los dos campos, nullable e idempotente', () => {
  const sql = leer('prisma/migrations/20260925_rotacion_secreto_satelite/migration.sql')
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "secretoSiguiente" TEXT/)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "secretoSiguienteHasta"/)
  assert.equal(/CREATE TABLE/.test(sql), false)
})

test('la promoción y la limpieza no se confunden: una mueve, la otra descarta', () => {
  // La distinción que la auditoría pidió revisar con cuidado: nunca se promueve
  // sola una pendiente vencida (sería cambiar el saliente a un secreto que el
  // satélite quizá no instaló); se descarta.
  const src = leer('src/modules/plataforma/rotacion-secreto.ts')
  const limpiar = src.slice(src.indexOf('export async function limpiarRotacionesVencidas'))
  assert.match(limpiar.slice(0, 600), /secretoSiguiente: null/)
  assert.ok(!/secreto: .*secretoSiguiente/.test(limpiar.slice(0, 600)), 'limpiar no debe promover')
})
