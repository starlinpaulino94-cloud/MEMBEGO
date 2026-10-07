import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * `subirImagenExcursion` escribe en Storage con el cliente de SERVICIO, que
 * ignora las políticas del bucket. Una vez estuvo expuesta sin ninguna
 * autenticación: cualquiera podía subir (y sobrescribir) archivos bajo el
 * prefijo de cualquier empresa, con el MIME que dijera.
 *
 * Una Server Action no se puede ejecutar aquí sin servidor, así que esta
 * prueba mira el CÓDIGO: lo que la regresión rompería es el ORDEN (la guardia
 * antes del cliente privilegiado) y los tres hábitos que la cierran.
 */

const RUTA = 'src/modules/excursiones/catalogo/imageActions.ts'
const src = readFileSync(RUTA, 'utf8')
const sinComentarios = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

test('exige sesión y permiso de excursiones ANTES de crear el cliente de servicio', () => {
  const guardia = sinComentarios.indexOf("requireSection('excursiones'")
  const privilegiado = sinComentarios.indexOf('createAdminClient()')
  assert.ok(guardia >= 0, 'la acción no llama a requireSection(\'excursiones\', …)')
  assert.ok(privilegiado >= 0, 'cambió el cliente de subida: revisa esta prueba')
  assert.ok(guardia < privilegiado, 'el cliente de servicio se crea antes de autorizar')
})

test('el permiso es el mismo que crear/editar una excursión', () => {
  assert.match(sinComentarios, /excursionId \? 'catalogo_editar' : 'catalogo_crear'/)
})

test('una guardia fallida corta con un error, no sigue', () => {
  assert.match(sinComentarios, /if \(!user\) return \{ error: 'No autorizado\.' \}/)
})

test('la empresa sale de la sesión: se resuelve y debe coincidir con la recibida', () => {
  assert.match(sinComentarios, /resolveCompanyId\(user,/)
  assert.match(sinComentarios, /if \(empresa !== companyId\) return \{ error: 'No autorizado\.' \}/)
})

test('la ruta de Storage se construye con la empresa RESUELTA, no con el argumento crudo', () => {
  assert.match(sinComentarios, /rutaExcursion\(empresa,/)
  assert.doesNotMatch(sinComentarios, /rutaExcursion\(companyId,/)
})

test('si llega una excursión, se comprueba que es de la empresa', () => {
  assert.match(sinComentarios, /tx\.excursion\.findFirst\(\{ where: \{ id: excursionId, companyId: empresa \}/)
})

test('el tipo y la extensión los decide la firma del archivo, no file.type ni file.name', () => {
  assert.match(sinComentarios, /detectarTipoImagen\(buffer\)/)
  assert.doesNotMatch(sinComentarios, /file\.type/, 'vuelve a confiar en el MIME del cliente')
  assert.doesNotMatch(sinComentarios, /file\.name/, 'vuelve a confiar en el nombre del cliente')
  assert.match(sinComentarios, /contentType: tipo/)
})

test('nunca sobrescribe un objeto existente', () => {
  assert.match(sinComentarios, /upsert: false/)
  assert.doesNotMatch(sinComentarios, /upsert: true/)
})

test('el tamaño se vuelve a medir sobre los bytes leídos', () => {
  assert.match(sinComentarios, /buffer\.length > MAX_BYTES/)
})

test('el archivo exporta una sola acción (una superficie pública más sería otra puerta)', () => {
  const exportadas = [...sinComentarios.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1])
  assert.deepEqual(exportadas, ['subirImagenExcursion'])
})
