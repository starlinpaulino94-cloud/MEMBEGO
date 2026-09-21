import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizarEdicion } from '../src/modules/plataforma/alta-cliente-nucleo'
import { CAPABILITIES, SCOPES, SCOPES_POR_CAPABILITY, INVENTARIO_API } from '@membego/contracts'

/**
 * EDITAR Y LISTAR CLIENTES POR API · hallazgo B-5.
 *
 * El usuario eligió «las dos, con scopes distintos»: el satélite conserva su
 * creación auditada (`customers:write`), y una clave de empresa puede editar la
 * ficha de un cliente que ya existe con un scope aparte (`customers:manage`).
 * Lo que más se prueba aquí es que esos dos caminos no se crucen.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const codigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

// ─── El normalizador de la edición parcial ───────────────────────────────────

test('editar solo un campo no toca los demás', () => {
  // Ausente = «déjalo como está». El update solo recibe lo que se pasó.
  assert.deepEqual(normalizarEdicion({ nombre: 'Ana' }), { ok: true, campos: { nombre: 'Ana' } })
  const r = normalizarEdicion({ telefono: '809-555-1000' })
  assert.ok(r.ok && r.campos.telefono === '809-555-1000' && !('nombre' in r.campos))
})

test('ausente y vacío NO son lo mismo', () => {
  /**
   * No mandar `telefono` es «no lo toques»; mandar `telefono: ""` es «bórralo».
   * Confundirlos borraría un teléfono que una edición de solo-nombre ni
   * mencionó.
   */
  // Vacío explícito → se pone a null (se borra).
  const borra = normalizarEdicion({ telefono: '' })
  assert.ok(borra.ok && borra.campos.telefono === null)
  // Ausente → no aparece en los campos a escribir.
  const soloNombre = normalizarEdicion({ nombre: 'Ana' })
  assert.ok(soloNombre.ok && !('telefono' in soloNombre.campos))
})

test('el nombre, si se toca, no puede quedar vacío', () => {
  // Es el único campo obligatorio; el teléfono y el correo sí se pueden vaciar.
  assert.equal(normalizarEdicion({ nombre: '   ' }).ok, false)
  assert.equal(normalizarEdicion({ nombre: '' }).ok, false)
})

test('un correo sin arroba se rechaza; el correo se guarda en minúsculas', () => {
  assert.equal(normalizarEdicion({ email: 'no-es-correo' }).ok, false)
  const r = normalizarEdicion({ email: 'Ana@Correo.COM' })
  assert.ok(r.ok && r.campos.email === 'ana@correo.com')
})

test('una edición vacía es un error, no un no-op silencioso', () => {
  // Quien manda un PATCH sin campos se equivocó, y prefiere saberlo.
  assert.equal(normalizarEdicion({}).ok, false)
})

// ─── El scope nuevo, y su separación del de crear ────────────────────────────

test('CUSTOMER_UPDATE existe y pide `customers:manage`, no `customers:write`', () => {
  assert.ok((CAPABILITIES as readonly string[]).includes('CUSTOMER_UPDATE'))
  const scopes = SCOPES_POR_CAPABILITY.CUSTOMER_UPDATE
  assert.ok(scopes.includes('customers:manage'), 'editar no pide su scope propio')
  assert.ok(!scopes.includes('customers:write'), 'editar NO debe pedir el scope de crear (satélite)')
  // Incluye read: la edición devuelve la ficha, conceder editar sin leer mentiría.
  assert.ok(scopes.includes('customers:read'))
})

test('crear y editar son scopes DISTINTOS', () => {
  // Es la decisión del usuario: dos caminos, dos permisos, sin cruzarse.
  const crear = SCOPES_POR_CAPABILITY.CUSTOMER_REGISTRATION
  const editar = SCOPES_POR_CAPABILITY.CUSTOMER_UPDATE
  assert.ok(crear.includes('customers:write'))
  assert.ok(!editar.includes('customers:write'))
  assert.ok(editar.includes('customers:manage'))
  assert.ok(!crear.includes('customers:manage'))
  assert.ok(SCOPES.includes('customers:manage'))
})

test('`customers:manage` se puede conceder a una clave de empresa', () => {
  // Si el servidor lo filtrara al crear la clave, el permiso existiría en el
  // contrato y sería imposible de otorgar — una puerta sin llave.
  assert.match(
    codigo('src/modules/connect/adminActions.ts'),
    /SCOPES_DE_ADMINISTRACION = \[[^\]]*'customers:manage'[^\]]*\]/
  )
  assert.match(codigo('src/components/connect/ClavesApiPanel.tsx'), /valor: 'customers:manage'/)
})

// ─── Las rutas ───────────────────────────────────────────────────────────────

test('PATCH /customers/{id} es de CLAVE DE EMPRESA, y lo afirma con el tipo', () => {
  /**
   * Editar es de trastienda: una clave de empresa. Un satélite no entra —crea,
   * no edita—. `exigeEmpresa` lo afirma con el tipo, igual que `exigeSistema`
   * hace lo contrario en las escrituras de negocio.
   */
  const r = INVENTARIO_API.find((x) => x.metodo === 'PATCH' && x.ruta === '/customers/{id}')
  assert.ok(r, 'la ruta no está en el inventario')
  assert.equal(r.principal, 'empresa')
  assert.equal(r.scope, 'customers:manage')

  const src = codigo('src/app/api/platform/v1/customers/[id]/route.ts')
  const patch = src.slice(src.indexOf('export async function PATCH'))
  assert.match(patch, /exigeEmpresa\(auth\.ctx\)/)
  assert.match(patch, /'customers:manage'/)
})

test('PATCH no exige Idempotency-Key: es idempotente por naturaleza', () => {
  // Poner el mismo nombre dos veces deja la ficha igual. No consume nada, así
  // que no pasa por la tabla de idempotencia (que es para las escrituras que sí).
  const r = INVENTARIO_API.find((x) => x.metodo === 'PATCH' && x.ruta === '/customers/{id}')
  assert.ok(!r?.idempotente, 'PATCH no debería exigir clave de idempotencia')
})

test('GET /customers es una LECTURA paginada, no una escritura', () => {
  const r = INVENTARIO_API.find((x) => x.metodo === 'GET' && x.ruta === '/customers')
  assert.ok(r)
  assert.equal(r.scope, 'customers:read')
  assert.equal(r.paginado, true)
  assert.equal(r.principal, 'sistema-o-empresa')
})

test('editar y listar van acotados por empresa, nunca por id suelto', () => {
  /**
   * El id del cliente viaja en la URL. Sin el `companyId` en el `where`, una
   * clave editaría o leería la ficha de otra empresa con solo conocer el id.
   */
  const escr = codigo('src/modules/plataforma/escrituras.ts')
  assert.match(escr, /where: \{ id, companyId \}/)
  const cons = codigo('src/modules/plataforma/consultas.ts')
  const listar = cons.slice(cons.indexOf('export async function listarClientes'))
  assert.match(listar.slice(0, 600), /where: \{ companyId \}/)
})

test('un teléfono o correo que ya es de OTRO cliente se rechaza', () => {
  /**
   * No son únicos en la base, pero son con lo que se resuelve a una persona. Si
   * dos fichas compartieran teléfono, resolver por él devolvería una cualquiera
   * y partiría el historial. El choque se comprueba ANTES de escribir.
   */
  const escr = codigo('src/modules/plataforma/escrituras.ts')
  assert.match(escr, /id: \{ not: id \}/)
  assert.match(escr, /motivo: 'conflicto', campo: 'email'/)
  assert.match(escr, /motivo: 'conflicto', campo: 'telefono'/)
  // El teléfono se compara por DÍGITOS, no por texto.
  assert.match(escr, /mismoTelefono\(/)
})

test('el nombreBusqueda NO se escribe a mano: lo pone un trigger', () => {
  /**
   * Un trigger de la base recalcula `nombreBusqueda` en cada UPDATE del nombre.
   * Escribirlo también aquí sería una segunda fuente de la misma verdad, y la
   * que se olvida rompe la búsqueda. Se comprueba que el módulo NO lo toca.
   */
  const escr = codigo('src/modules/plataforma/escrituras.ts')
  assert.ok(!/nombreBusqueda/.test(escr), 'la edición escribe nombreBusqueda a mano')
})

test('la respuesta a un conflicto es 409, no 400', () => {
  // Está bien formada; el choque es con el estado actual. Un 400 diría al
  // cliente que su petición es inválida, cuando el problema es otro.
  const contrato = leer('packages/contracts/src/errores.ts')
  assert.match(contrato, /CUSTOMER_CONFLICT: 409/)
  assert.match(codigo('src/app/api/platform/v1/customers/[id]/route.ts'), /'CUSTOMER_CONFLICT'/)
})
