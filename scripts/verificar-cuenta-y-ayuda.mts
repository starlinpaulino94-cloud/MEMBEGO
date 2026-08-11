/**
 * FASE 8 · CUENTA Y AYUDA — verificación contra PostgreSQL real.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE QUEDABA ATADO A LA FICHA ACTIVA
 *
 * Tres cosas, y las tres se notan solo cuando alguien es cliente de más de un
 * negocio:
 *
 *   1 · Los tickets de ayuda. Un hilo abierto con un negocio desaparecía al
 *       entrar a otro, y con él la respuesta que estaba esperando.
 *
 *   2 · El perfil. Nombre, teléfono y cumpleaños son de la PERSONA, pero se
 *       guardaban solo en la ficha abierta: corregir un teléfono lo corregía
 *       en un negocio y lo dejaba viejo en los demás, sin que nadie lo viera.
 *
 *   3 · Los vehículos. Un coche cuelga de la ficha de un negocio —cada uno le
 *       pone su categoría y su tarifa—, así que el mismo coche aparecía y
 *       desaparecía según la empresa abierta.
 *
 *   DATABASE_URL=…  DIRECT_URL=…  npm run verificar:cuenta-y-ayuda
 */
import { prisma } from '../src/lib/prisma'
import { listTicketsCliente } from '../src/modules/soporte/queries'
import { getVehiculosCliente } from '../src/modules/cliente/queries'
import { misClienteIds, propagarDatosPersonales } from '../src/modules/cliente/afiliacion'

const url = process.env.DATABASE_URL ?? ''
if (!/localhost|127\.0\.0\.1/.test(url) || /prod/i.test(url)) {
  console.error(
    'Este script BORRA datos. Solo se ejecuta contra una base local desechable.\n' +
      `DATABASE_URL actual: ${url.replace(/:[^:@]*@/, ':***@') || '(vacío)'}`
  )
  process.exit(2)
}

const P = 'fase8-'
let ok = 0
let fallidas = 0
function comprobar(nombre: string, condicion: boolean, detalle?: string) {
  if (condicion) {
    ok++
    console.log(`  ✓ ${nombre}`)
  } else {
    fallidas++
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ''}`)
  }
}

async function limpiar() {
  const companies = await prisma.company.findMany({
    where: { slug: { startsWith: P } },
    select: { id: true },
  })
  const ids = companies.map((c) => c.id)
  if (ids.length === 0) return
  await prisma.ticketMensaje.deleteMany({
    where: { ticket: { companyId: { in: ids } } },
  })
  await prisma.supportTicket.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.vehiculo.deleteMany({ where: { cliente: { companyId: { in: ids } } } })
  await prisma.cliente.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } })
  await prisma.company.deleteMany({ where: { id: { in: ids } } })
}

async function main() {
  await limpiar()

  const taller = await prisma.company.create({
    data: { name: 'Taller Fase8', slug: `${P}taller`, type: 'carwash', isActive: true },
  })
  const spa = await prisma.company.create({
    data: { name: 'Spa Fase8', slug: `${P}spa`, type: 'salon', isActive: true },
  })

  const luz = await prisma.user.create({
    data: { supabaseId: `${P}luz`, email: `${P}luz@mail.test`, name: 'Luz' },
  })
  const luzTaller = await prisma.cliente.create({
    data: {
      companyId: taller.id,
      supabaseId: luz.supabaseId,
      nombre: 'Luz',
      email: luz.email,
      telefono: '809-000-0000',
    },
  })
  const luzSpa = await prisma.cliente.create({
    data: {
      companyId: spa.id,
      supabaseId: luz.supabaseId,
      nombre: 'Luz',
      email: luz.email,
      telefono: '809-000-0000',
    },
  })

  // Control: otra persona con ficha en el mismo taller.
  const otro = await prisma.user.create({
    data: { supabaseId: `${P}otro`, email: `${P}otro@mail.test`, name: 'Otro' },
  })
  const otroTaller = await prisma.cliente.create({
    data: {
      companyId: taller.id,
      supabaseId: otro.supabaseId,
      nombre: 'Otro',
      email: otro.email,
    },
  })

  // ── 1 · Tickets ───────────────────────────────────────────────────────────
  console.log('\n1 · Centro de ayuda')
  const enTaller = await prisma.supportTicket.create({
    data: {
      companyId: taller.id,
      clienteId: luzTaller.id,
      asunto: 'Mi factura fase8',
      categoria: 'PAGO',
      estado: 'NUEVO',
    },
  })
  const enSpa = await prisma.supportTicket.create({
    data: {
      companyId: spa.id,
      clienteId: luzSpa.id,
      asunto: 'Cambiar mi cita fase8',
      categoria: 'OTRO',
      estado: 'ESPERANDO_CLIENTE',
    },
  })
  await prisma.supportTicket.create({
    data: {
      companyId: taller.id,
      clienteId: otroTaller.id,
      asunto: 'Ticket ajeno fase8',
      categoria: 'OTRO',
      estado: 'NUEVO',
    },
  })

  const fichasLuz = await misClienteIds(luz.supabaseId)
  const tickets = await listTicketsCliente(fichasLuz)
  const idsTickets = new Set(tickets.map((t) => t.id))
  comprobar(
    've sus hilos de LOS DOS negocios',
    idsTickets.has(enTaller.id) && idsTickets.has(enSpa.id),
    `vio ${tickets.length}: ${tickets.map((t) => t.asunto).join(', ')}`
  )
  comprobar(
    'no ve el hilo de otra persona en el mismo negocio',
    tickets.length === 2,
    `vio ${tickets.length} tickets`
  )
  comprobar(
    'cada hilo dice con qué negocio es',
    tickets.find((t) => t.id === enSpa.id)?.company.name === 'Spa Fase8',
    'con hilos de varias empresas en la lista, un asunto sin destinatario no ' +
      'dice a quién se le preguntó'
  )
  // El control que hace que lo de arriba signifique algo: con la ficha activa
  // (el taller) el hilo del spa NO aparecía.
  const soloTaller = await listTicketsCliente([luzTaller.id])
  comprobar(
    'con la ficha ACTIVA el hilo del otro negocio no aparecía',
    !soloTaller.some((t) => t.id === enSpa.id),
    'el escenario no distingue el caso viejo del nuevo'
  )
  comprobar('sin fichas no hay tickets', (await listTicketsCliente([])).length === 0)

  // ── 2 · Un perfil, N fichas ───────────────────────────────────────────────
  console.log('\n2 · Perfil')
  /**
   * Se llama a `propagarDatosPersonales`, que es EL MISMO código que usa el
   * formulario. La `server action` que lo envuelve necesita sesión de Supabase
   * y no se puede ejecutar aquí; por eso la parte que decide qué se escribe y
   * dónde vive en una función aparte. Reescribir el bucle dentro del script
   * habría sido una prueba que solo se prueba a sí misma.
   */
  const escritas = await propagarDatosPersonales(luz.supabaseId, {
    nombre: 'Luz María',
    telefono: '809-111-2222',
    fechaNacimiento: null,
    ciudad: null,
    genero: null,
    notifPromos: true,
    notifRecordatorios: true,
  })
  comprobar('escribe en sus DOS fichas', escritas === 2, `escribió ${escritas}`)
  const despues = await prisma.cliente.findMany({
    where: { supabaseId: luz.supabaseId },
    select: { nombre: true, telefono: true, companyId: true },
  })
  comprobar(
    'el nombre y el teléfono quedan iguales en sus dos fichas',
    despues.length === 2 &&
      despues.every((c) => c.nombre === 'Luz María' && c.telefono === '809-111-2222'),
    `quedó ${JSON.stringify(despues)}`
  )
  const ajeno = await prisma.cliente.findUnique({
    where: { id: otroTaller.id },
    select: { nombre: true },
  })
  comprobar(
    'no toca la ficha de otra persona',
    ajeno?.nombre === 'Otro',
    'propagar el perfil estaría escribiendo en fichas que no son suyas'
  )

  // ── 3 · Vehículos ─────────────────────────────────────────────────────────
  console.log('\n3 · Vehículos')
  const enElTaller = await prisma.vehiculo.create({
    data: {
      clienteId: luzTaller.id,
      marca: 'Toyota',
      modelo: 'Corolla',
      anio: 2020,
      color: 'Gris',
      esPrincipal: true,
    },
  })
  const enElSpa = await prisma.vehiculo.create({
    data: {
      clienteId: luzSpa.id,
      marca: 'Honda',
      modelo: 'Civic',
      anio: 2018,
      color: 'Azul',
      esPrincipal: true,
    },
  })
  await prisma.vehiculo.create({
    data: {
      clienteId: otroTaller.id,
      marca: 'Ajeno',
      modelo: 'Ajeno',
      anio: 2015,
      color: 'Negro',
    },
  })

  const vehiculos = await getVehiculosCliente(luz.supabaseId)
  const idsVeh = new Set(vehiculos.map((v) => v.id))
  comprobar(
    've los vehículos de sus dos fichas',
    idsVeh.has(enElTaller.id) && idsVeh.has(enElSpa.id) && vehiculos.length === 2,
    `vio ${vehiculos.length}: ${vehiculos.map((v) => v.marca).join(', ')}`
  )
  comprobar(
    'cada uno dice en qué negocio está registrado',
    vehiculos.find((v) => v.id === enElSpa.id)?.empresaNombre === 'Spa Fase8' &&
      vehiculos.find((v) => v.id === enElTaller.id)?.empresaNombre === 'Taller Fase8',
    'el mismo coche puede estar en dos negocios: sin el nombre, las dos ' +
      'tarjetas son indistinguibles'
  )
  comprobar(
    'no ve los vehículos de otra persona',
    !vehiculos.some((v) => v.marca === 'Ajeno')
  )
  comprobar(
    'quien no tiene fichas no tiene vehículos',
    (await getVehiculosCliente(`${P}nadie`)).length === 0
  )
  comprobar(
    'cada negocio conserva SU principal',
    vehiculos.filter((v) => v.esPrincipal).length === 2,
    '«principal» es principal dentro de un negocio; si el cambio de principal ' +
      'usara la ficha de la sesión, desmarcaría el coche de la otra empresa'
  )

  await limpiar()
  console.log(`\n${ok} comprobaciones pasadas, ${fallidas} fallidas.`)
  if (ok === 0) {
    console.log('Ninguna comprobación llegó a ejecutarse: eso NO es un éxito.')
    process.exit(1)
  }
  process.exit(fallidas === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await limpiar().catch(() => {})
  process.exit(1)
})
