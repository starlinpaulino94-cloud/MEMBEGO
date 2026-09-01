/**
 * Nivel tarifario de los tipos de vehículo · pruebas.
 * Ejecutar: npm test
 *
 * El nivel es el número con el que se decide si una membresía cubre un carro. Lo
 * que se protege aquí es lo que cuesta dinero si se rompe:
 *
 *   · Editar el nombre de un tipo NO puede cambiarle el nivel de rebote. Bajarle
 *     el nivel a un camión sin querer significa regalar lavados de camión a un
 *     plan de sedán, y nadie se enteraría.
 *   · Un nivel fuera de rango se rechaza. Un 30 en vez de un 3 haría que ningún
 *     plan cubriera ese tipo, y el cliente solo vería «no cubierto» sin
 *     explicación posible.
 *   · El endpoint del contrato no filtra por persona y sirve solo los activos.
 *
 * La acción y la consulta tocan la base, así que aquí no se ejecutan: se
 * comprueba el código fuente, igual que en `reversa-contrato.test.ts`. Se lee
 * raro y vale: lo que se verifica es que el candado siga donde tiene que estar.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const accion = readFileSync('src/modules/carwash/catalogo-actions.ts', 'utf8')
const consultas = readFileSync('src/modules/plataforma/consultas.ts', 'utf8')
const ruta = readFileSync('src/app/api/platform/v1/vehicle-types/route.ts', 'utf8')
const panel = readFileSync('src/components/carwash/CatalogoPanel.tsx', 'utf8')

// Solo el cuerpo de `guardarTipoVehiculo`: el archivo tiene otras seis acciones.
const guardarTipo = accion.slice(
  accion.indexOf('export async function guardarTipoVehiculo'),
  accion.indexOf('export async function alternarTipoVehiculo')
)

// ── Lo que no se puede pisar sin querer ─────────────────────────────────────

test('si el nivel no viene en el formulario, el update NO lo toca', () => {
  // El update es condicional: `...(nivelPedido !== null ? { nivelTarifario } : {})`.
  // Sin eso, una llamada que solo cambia el nombre mandaría el nivel a 1 y le
  // quitaría la categoría a un camión en silencio.
  assert.match(
    guardarTipo,
    /\.\.\.\(nivelPedido !== null \? \{ nivelTarifario: nivelPedido \} : \{\}\)/,
    'el nivel tiene que ir condicionado en el update, no siempre'
  )
})

test('un campo vacío se trata como «no vino», no como cero', () => {
  // `Number('')` es 0, que no es un nivel válido: sin el chequeo de cadena vacía
  // el guardado fallaría con «debe ser del 1 al 9» al no tocar el nivel.
  assert.match(guardarTipo, /String\(nivelCrudo\)\.trim\(\) === ''/)
})

test('al crear, el nivel por defecto es 1 y reproduce el comportamiento anterior', () => {
  // Un tipo nuevo sin nivel indicado tiene que nacer en 1: es el valor de
  // fábrica del esquema, y cambiarlo aquí haría que los tipos creados desde esta
  // pantalla se comportaran distinto a los que ya existen.
  assert.match(guardarTipo, /nivelTarifario: nivelPedido \?\? 1/)
})

// ── El rango ────────────────────────────────────────────────────────────────

test('el nivel se valida entero y entre 1 y 9', () => {
  assert.match(guardarTipo, /!Number\.isInteger\(nivelPedido\)/)
  assert.match(guardarTipo, /nivelPedido < 1 \|\| nivelPedido > 9/)
})

test('y el rechazo se explica, no devuelve un error genérico', () => {
  assert.match(guardarTipo, /del 1 al 9/)
})

test('la validación va ANTES de cualquier escritura', () => {
  // Si el rango se comprobara después del update, un valor inválido ya habría
  // tocado la fila antes de rechazarse.
  const posValidacion = guardarTipo.indexOf('del 1 al 9')
  const posUpdate = guardarTipo.indexOf('updateMany')
  const posCreate = guardarTipo.indexOf('tipoVehiculo.create')
  assert.ok(posValidacion > 0, 'debe existir la validación')
  assert.ok(posValidacion < posUpdate, 'la validación va antes del update')
  assert.ok(posValidacion < posCreate, 'la validación va antes del create')
})

// ── El endpoint del contrato ────────────────────────────────────────────────

test('el endpoint pide benefits:read y no un ámbito nuevo', () => {
  // Un ámbito nuevo obligaría a reemitir las credenciales de todos los satélites
  // que ya evalúan beneficios. El nivel solo sirve para decidir cobertura, así
  // que cabe en el ámbito que ya existe para eso.
  // La llamada pasó a varias líneas al abrirse a claves de API de empresa
  // (Connect · F3). La exigencia no cambia: este endpoint pide `benefits:read`.
  assert.match(ruta, /autenticarSobreEmpresa\(\s*req,\s*'benefits:read'/)
})

test('el endpoint NO recibe ningún identificador de persona', () => {
  // Es el catálogo de la propia empresa que pregunta. Un `customerId` aquí no
  // significaría nada y abriría la puerta a filtrar por cliente sin motivo.
  //
  // Se busca la LECTURA del parámetro y no la palabra: el primer intento casaba
  // el comentario del propio archivo, que explica justamente que no lo lleva.
  assert.ok(
    !/params\.get\(\s*['"]customerId['"]\s*\)/.test(ruta),
    'no debe leer customerId de la petición'
  )
})

test('solo se sirven los tipos ACTIVOS', () => {
  // Mandar un tipo retirado invitaría al satélite a mapear una de sus categorías
  // contra algo que la empresa ya no ofrece.
  const fn = consultas.slice(consultas.indexOf('export async function tiposDeVehiculo'))
  assert.match(fn, /where: \{ companyId, activo: true \}/)
})

test('la consulta se acota por empresa con conEmpresa', () => {
  const fn = consultas.slice(consultas.indexOf('export async function tiposDeVehiculo'))
  assert.match(fn, /conEmpresa\(companyId/)
})

test('la consulta no expone nada más que id, nombre y nivel', () => {
  const fn = consultas.slice(
    consultas.indexOf('export async function tiposDeVehiculo')
  )
  const select = fn.slice(fn.indexOf('select:'), fn.indexOf('orderBy'))
  assert.match(select, /id: true/)
  assert.match(select, /nombre: true/)
  assert.match(select, /nivelTarifario: true/)
  // `descripcion` e `iconoUrl` son presentación del asistente de registro de
  // MembeGo y no tienen nada que hacer en el contrato.
  assert.ok(!/iconoUrl/.test(select), 'iconoUrl no pertenece al contrato')
  assert.ok(!/descripcion/.test(select), 'descripcion no pertenece al contrato')
})

// ── La pantalla ─────────────────────────────────────────────────────────────

test('el nivel se puede editar en un tipo YA CREADO, no solo al darlo de alta', () => {
  // Era el hueco real: la lista solo permitía activar y desactivar, así que el
  // nivel de un tipo existente no había forma de cambiarlo desde ninguna parte.
  assert.match(panel, /aria-label=\{`Nivel tarifario de \$\{t\.nombre\}`\}/)
})

test('el formulario de la fila manda nombre y orden, que la acción exige', () => {
  // Sin ellos, cambiar solo el número se rechazaría con «escribe el nombre».
  const fila = panel.slice(panel.indexOf('name="nombre" value={t.nombre}') - 400)
  assert.match(fila, /name="nombre" value=\{t\.nombre\}/)
  assert.match(fila, /name="orden" value=\{t\.orden\}/)
})

test('la pantalla advierte de que con todo en 1 cualquier plan cubre todo', () => {
  // Sin este aviso alguien deja los niveles de fábrica y no entiende por qué un
  // plan de sedán le cubre camionetas.
  assert.match(panel, /cualquier plan cubre cualquier/i)
})
