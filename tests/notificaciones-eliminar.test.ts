import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NOTIFICACIONES_VISIBLES } from '../src/modules/notificaciones/visibles'

const leer = (ruta: string) => readFileSync(join(__dirname, '..', ruta), 'utf8')

/**
 * ELIMINAR NOTIFICACIONES (2026-10-29).
 *
 * Se marca `eliminadaEn`, no se borra la fila: `(userId, dedupeKey)` es lo que
 * evita que los avisos por lote se reenvíen. Estas pruebas fijan eso, que el
 * dueño sale de la sesión y que toda lectura pensada para la persona filtra
 * lo eliminado.
 */

test('lo visible es lo que no se eliminó', () => {
  assert.deepEqual(NOTIFICACIONES_VISIBLES, { eliminadaEn: null })
})

test('eliminar marca la fila: ni la acción ni la API borran notificaciones', () => {
  for (const ruta of ['src/modules/notificaciones/actions.ts', 'src/app/api/v1/cliente/notificaciones/route.ts']) {
    const src = leer(ruta)
    assert.doesNotMatch(src, /notificacion\.(delete|deleteMany)\(/, `${ruta} no puede borrar filas: reviviría los avisos por lote`)
    assert.match(src, /eliminadaEn: new Date\(\)/, `${ruta} marca la fecha en que se eliminó`)
  }
})

test('eliminar: el dueño sale de la sesión, nunca del navegador', () => {
  const acciones = leer('src/modules/notificaciones/actions.ts')
  const trozo = acciones.slice(acciones.indexOf('export async function eliminarNotificacion'))
  assert.match(trozo, /getUser\(\)/)
  assert.match(trozo, /where: \{ id, userId, \.\.\.NOTIFICACIONES_VISIBLES \}/)
  assert.match(trozo, /where: \{ userId, \.\.\.NOTIFICACIONES_VISIBLES \}/)

  const api = leer('src/app/api/v1/cliente/notificaciones/route.ts')
  const del = api.slice(api.indexOf('export async function DELETE'))
  assert.match(del, /role !== 'CLIENTE'/)
  assert.match(del, /id: body\.data\.id, userId/)
})

test('toda lectura para la persona oculta lo eliminado', () => {
  const lecturas: Array<[string, RegExp]> = [
    ['src/modules/notificaciones/actions.ts', /userId: user\.metadata\.dbUserId, \.\.\.NOTIFICACIONES_VISIBLES/],
    ['src/app/api/v1/cliente/notificaciones/route.ts', /const where = \{ userId, \.\.\.NOTIFICACIONES_VISIBLES \}/],
    ['src/app/(cliente)/cliente/novedades/page.tsx', /where: \{ userId: id, \.\.\.NOTIFICACIONES_VISIBLES \}/],
    ['src/app/(cliente)/layout.tsx', /leida: false, \.\.\.NOTIFICACIONES_VISIBLES/],
  ]
  for (const [ruta, patron] of lecturas) assert.match(leer(ruta), patron, `${ruta} debe filtrar lo eliminado`)
})

test('la migración solo añade la columna: no toca la clave de deduplicación', () => {
  const sql = leer('prisma/migrations/20261093_notificaciones_eliminadas/migration.sql')
  assert.match(sql, /ADD COLUMN "eliminadaEn" TIMESTAMP\(3\)/)
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /DROP|DELETE|UNIQUE|dedupeKey/i)
})

test('la app Expo y las pantallas web ofrecen eliminar una y todas', () => {
  const bell = leer('src/components/layout/NotificationBell.tsx')
  assert.match(bell, /eliminarNotificacion/)
  assert.match(bell, /eliminarTodasNotificaciones/)
  const avisos = leer('src/components/cliente/MisAvisos.tsx')
  assert.match(avisos, /eliminarNotificacion/)
  assert.match(avisos, /eliminarTodasNotificaciones/)
  const api = leer('apps/client/src/lib/api.ts')
  assert.match(api, /eliminarNotificacion: \(id: string\)/)
  assert.match(api, /eliminarTodasNotificaciones: \(\)/)
  const pantalla = leer('apps/client/app/notificaciones.tsx')
  assert.match(pantalla, /useEliminarNotificacion/)
  assert.match(pantalla, /useEliminarTodasNotificaciones/)
})
