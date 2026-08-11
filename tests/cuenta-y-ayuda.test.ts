import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * LO ÚLTIMO QUE SEGUÍA ATADO A LA FICHA ACTIVA: CUENTA Y AYUDA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES COSAS, Y LAS TRES SOLO SE NOTAN CON MÁS DE UN NEGOCIO
 *
 * 1 · Los tickets. Un hilo abierto con un negocio desaparecía al entrar a
 *     otro, y con él la respuesta que estaba esperando. Peor que no tener
 *     soporte: la persona cree que su consulta se perdió.
 *
 * 2 · El perfil. Nombre, teléfono, cumpleaños y foto son de la PERSONA, pero
 *     se guardaban solo en la ficha abierta. Al corregir un teléfono mal
 *     escrito, la corrección llegaba a un negocio y dejaba el número viejo
 *     vivo en los demás — donde nadie lo mira, que es justo donde importa
 *     cuando llaman para avisar de que el pedido está listo.
 *
 * 3 · Los vehículos. Un coche cuelga de la ficha de un negocio, así que el
 *     mismo coche aparecía y desaparecía según la empresa abierta.
 *
 * Ejecutado contra PostgreSQL en `scripts/verificar-cuenta-y-ayuda.mts`, con
 * otra persona en el mismo negocio como control de aislamiento.
 */

const leer = (p: string) =>
  readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

test('los hilos de ayuda son de la persona, y su camino también', () => {
  const q = leer('src/modules/soporte/queries.ts')
  assert.match(
    q,
    /export async function listTicketsCliente\(clienteIds: string\[\]\)/,
    'Con la ficha activa, un hilo abierto con otro negocio desaparece de la vista.'
  )
  assert.match(q, /company: \{ select: \{ name: true \} \}/, 'Cada hilo dice con qué negocio es.')

  // El listado sin su camino deja un 404 detrás. Ya pasó con «Mis beneficios»,
  // con las citas y con los regalos; aquí se vigilan las tres puertas.
  const detalle = leer('src/app/(cliente)/cliente/ayuda/[id]/page.tsx')
  assert.match(
    detalle,
    /misFichas\.includes\(ticket\.cliente\.id\)/,
    'El detalle devolvía 404 sobre una conversación suya.'
  )
  const acciones = leer('src/modules/soporte/actions.ts')
  assert.match(
    acciones,
    /misFichas\.includes\(ticket\.clienteId\)/,
    'La caja de respuesta contestaba «Ticket no encontrado» sobre un hilo abierto ' +
      'con el negocio esperando esa respuesta.'
  )
})

test('el perfil se guarda en todas sus fichas, y solo lo que es suyo', () => {
  const af = leer('src/modules/cliente/afiliacion.ts')
  assert.match(af, /export async function propagarDatosPersonales/)
  const fn = af.slice(af.indexOf('export async function propagarDatosPersonales'))
  assert.match(
    fn.slice(0, 1200),
    /where: \{ supabaseId \}/,
    'Las fichas se buscan por la persona.'
  )
  assert.match(
    fn.slice(0, 1200),
    /conEmpresa\(ficha\.companyId/,
    'Cada ficha se escribe con `conEmpresa` de SU empresa: el aislamiento sigue ' +
      'puesto en cada escritura, no se abre una lectura omnisciente para escribir.'
  )

  // Lo que NO se propaga: nada de la relación comercial. Si un día alguien
  // añade `membresias` o `notas` a este objeto, esto lo para.
  const iface = af.slice(af.indexOf('export interface DatosPersonales'))
  const campos = iface.slice(0, iface.indexOf('}'))
  for (const prohibido of ['membres', 'beneficio', 'nota', 'saldo', 'compra']) {
    assert.ok(
      !new RegExp(prohibido, 'i').test(campos),
      `«${prohibido}» es de la relación con un negocio, no de la persona: no se ` +
        'copia de una empresa a otra.'
    )
  }

  const accion = leer('src/modules/cliente/profileActions.ts')
  assert.match(
    accion,
    /propagarDatosPersonales\(user\.supabaseId/,
    'El formulario volvió a guardar solo en la ficha activa.'
  )
})

test('los vehículos se ven todos y dicen de qué negocio son', () => {
  const q = leer('src/modules/cliente/queries.ts')
  assert.match(
    q,
    /export async function getVehiculosCliente\(supabaseId: string\)/,
    'El mismo coche aparecía y desaparecía según la empresa abierta.'
  )
  const card = leer('src/components/cliente/VehicleCard.tsx')
  assert.match(
    card,
    /Registrado en \{vehiculo\.empresaNombre\}/,
    'Un coche puede estar registrado en dos negocios: sin el nombre, las dos ' +
      'tarjetas son indistinguibles.'
  )
})

test('las acciones sobre un vehículo usan la ficha del VEHÍCULO', () => {
  /**
   * Aquí no basta con aceptar cualquiera de sus fichas: «principal» es
   * principal DENTRO de un negocio. Usando el `clienteId` de la sesión, el
   * `updateMany` que quita el principal anterior habría desmarcado el coche de
   * OTRA empresa, dejándola con dos principales o ninguno.
   */
  const veh = leer('src/modules/cliente/vehiculosActions.ts')
  const marcar = veh.slice(veh.indexOf('export async function marcarVehiculoPrincipal'))
  assert.match(marcar, /misFichas\.includes\(propio\.clienteId\)/)
  assert.match(
    marcar,
    /const clienteId = propio\.clienteId/,
    'El `clienteId` tiene que salir del vehículo, no de la sesión.'
  )

  const prof = leer('src/modules/cliente/profileActions.ts')
  const borrar = prof.slice(prof.indexOf('export async function eliminarVehiculo'))
  assert.match(borrar, /misFichas\.includes\(v\.clienteId\)/)
  assert.match(
    borrar,
    /const clienteId = v\.clienteId/,
    'El sucesor como principal se busca entre los coches de ESE negocio.'
  )
})
