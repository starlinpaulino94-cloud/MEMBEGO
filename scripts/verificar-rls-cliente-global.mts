/**
 * FASE 10 · QA FINAL — TODO LO ANTERIOR, PERO CON RLS ENCENDIDO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL HUECO QUE ESTE SCRIPT CIERRA
 *
 * En las fases 4 a 9 cada verificación llevaba la misma advertencia: «esto no
 * prueba RLS». Y era verdad. Las políticas viven en
 * `prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql`, que
 * `migrate deploy` no aplica, y la aplicación se conecta hoy con un rol que
 * las ignora — así que todas aquellas comprobaciones pasaban por la PRIMERA
 * barrera: que el `where` de cada consulta esté acotado a las fichas de quien
 * mira.
 *
 * Aquí se enciende la segunda. La base tiene las políticas aplicadas y la
 * aplicación se conecta como `membego_app`, que es `NOBYPASSRLS`. Si alguna de
 * las consultas nuevas se apoyaba sin darse cuenta en que nadie miraba, deja
 * de funcionar ahora.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HAY DOS CONEXIONES
 *
 * El escenario se siembra como DUEÑO de la base: con RLS puesto, un `insert`
 * suelto sin contexto de empresa está bloqueado —y debe estarlo—. Lo que se
 * mide es la lectura y la escritura de la APLICACIÓN, que van por el cliente
 * normal (`src/lib/prisma`), conectado como `membego_app`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PREPARACIÓN
 *
 *   psql -d <base> -v clave='…' -f prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql
 *   DATABASE_URL=postgresql://membego_app:…@localhost:5432/<base> \
 *   SEED_DATABASE_URL=postgresql://<dueño>@localhost:5432/<base> \
 *     npm run verificar:rls-cliente-global
 */
import { PrismaClient } from '@prisma/client'
import { prisma } from '../src/lib/prisma'
import { conEmpresa } from '../src/lib/tenant'
import {
  misClienteIds,
  propagarDatosPersonales,
} from '../src/modules/cliente/afiliacion'
import { getRegalosCliente } from '../src/modules/regalos/queries'
import { getCitasCliente } from '../src/modules/citas/queries'
import { getClientePagos, getVehiculosCliente } from '../src/modules/cliente/queries'
import { listTicketsCliente } from '../src/modules/soporte/queries'
import { getPromotionsPublic } from '../src/modules/marketplace/queries'
import { buscarCercanosRaw } from '../src/modules/geo/cercanos/queries'

const url = process.env.DATABASE_URL ?? ''
const seedUrl = process.env.SEED_DATABASE_URL ?? ''
if (!/localhost|127\.0\.0\.1/.test(url) || /prod/i.test(url)) {
  console.error('Solo contra una base local desechable.')
  process.exit(2)
}
if (!seedUrl) {
  console.error(
    'Falta SEED_DATABASE_URL (el dueño de la base). Con RLS puesto, sembrar el ' +
      'escenario sin contexto de empresa está bloqueado — y debe estarlo.'
  )
  process.exit(2)
}
if (!/membego_app/.test(url)) {
  console.error(
    'DATABASE_URL tiene que apuntar a `membego_app`. Con el rol dueño, RLS se ' +
      'salta entero y este script no comprobaría nada.'
  )
  process.exit(2)
}

/** Cliente con el rol DUEÑO: solo para montar y limpiar el escenario. */
const semilla = new PrismaClient({ datasources: { db: { url: seedUrl } } })

const P = 'fase10-'
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
  const ids = (
    await semilla.company.findMany({ where: { slug: { startsWith: P } }, select: { id: true } })
  ).map((c) => c.id)
  if (ids.length === 0) return
  await semilla.ticketMensaje.deleteMany({ where: { ticket: { companyId: { in: ids } } } })
  await semilla.supportTicket.deleteMany({ where: { companyId: { in: ids } } })
  await semilla.regalo.deleteMany({ where: { companyId: { in: ids } } })
  await semilla.cita.deleteMany({ where: { companyId: { in: ids } } })
  await semilla.visit.deleteMany({ where: { cliente: { companyId: { in: ids } } } })
  await semilla.vehiculo.deleteMany({ where: { cliente: { companyId: { in: ids } } } })
  await semilla.membership.deleteMany({ where: { companyId: { in: ids } } })
  await semilla.plan.deleteMany({ where: { companyId: { in: ids } } })
  await semilla.promocion.deleteMany({ where: { companyId: { in: ids } } })
  await semilla.sucursal.deleteMany({ where: { companyId: { in: ids } } })
  await semilla.companyFollow.deleteMany({ where: { companyId: { in: ids } } })
  await semilla.cliente.deleteMany({ where: { companyId: { in: ids } } })
  await semilla.user.deleteMany({ where: { email: { startsWith: P } } })
  await semilla.company.deleteMany({ where: { id: { in: ids } } })
}

const dias = (n: number) => new Date(Date.now() + n * 24 * 3600_000)

async function main() {
  await limpiar()

  // ── Escenario: una persona con ficha en dos negocios ──────────────────────
  const uno = await semilla.company.create({
    data: {
      name: 'Negocio Uno Fase10',
      slug: `${P}uno`,
      type: 'carwash',
      isActive: true,
      isPublished: true,
    },
  })
  const dos = await semilla.company.create({
    data: {
      name: 'Negocio Dos Fase10',
      slug: `${P}dos`,
      type: 'restaurante',
      isActive: true,
      isPublished: true,
    },
  })
  const ana = await semilla.user.create({
    data: { supabaseId: `${P}ana`, email: `${P}ana@mail.test`, name: 'Ana' },
  })
  const fichaUno = await semilla.cliente.create({
    data: { companyId: uno.id, supabaseId: ana.supabaseId, nombre: 'Ana', email: ana.email },
  })
  const fichaDos = await semilla.cliente.create({
    data: { companyId: dos.id, supabaseId: ana.supabaseId, nombre: 'Ana', email: ana.email },
  })
  const ajena = await semilla.user.create({
    data: { supabaseId: `${P}ajena`, email: `${P}ajena@mail.test`, name: 'Ajena' },
  })
  const fichaAjena = await semilla.cliente.create({
    data: { companyId: uno.id, supabaseId: ajena.supabaseId, nombre: 'Ajena', email: ajena.email },
  })

  // ── 0 · El rol es el correcto ─────────────────────────────────────────────
  console.log('\n0 · La conexión de la aplicación')
  const [{ usuario, bypass }] = await prisma.$queryRaw<
    { usuario: string; bypass: boolean }[]
  >`SELECT current_user AS usuario, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`
  comprobar(
    `la aplicación se conecta como ${usuario} y NO se salta RLS`,
    usuario === 'membego_app' && bypass === false,
    'con un rol que se salta RLS, todo lo de abajo pasaría sin comprobar nada'
  )

  // ── 1 · Lo global de las fases 4 a 9 sigue funcionando ────────────────────
  console.log('\n1 · Las consultas de la persona, con RLS puesto')
  const fichas = await misClienteIds(ana.supabaseId)
  comprobar(
    'misClienteIds encuentra sus DOS fichas',
    fichas.length === 2,
    `encontró ${fichas.length}: `.concat(JSON.stringify(fichas)) +
      ' — `sinEmpresa` es la puerta de las lecturas globales; si se cerrara, ' +
      'todo «Mi Membego» se quedaría vacío'
  )

  const regalo = await semilla.regalo.create({
    data: {
      companyId: dos.id,
      tipo: 'TRANSFERENCIA_USOS',
      estado: 'PENDIENTE',
      remitenteId: fichaAjena.id,
      destinatarioId: fichaDos.id,
      usos: 1,
      expiraAt: dias(5),
    },
  })
  const regalos = await getRegalosCliente(ana.supabaseId)
  comprobar(
    've el regalo recibido en el negocio que no es el activo',
    regalos.recibidos.some((r) => r.id === regalo.id),
    'la expiración perezosa y el listado cruzan empresas: con RLS mal puesto, ' +
      'un regalo pendiente se volvería invisible y expiraría solo'
  )

  const cita = await semilla.cita.create({
    data: {
      companyId: dos.id,
      clienteId: fichaDos.id,
      inicio: dias(1),
      duracionMin: 30,
      estado: 'CONFIRMADA',
    },
  })
  const citas = await getCitasCliente(fichas)
  comprobar('ve su cita del otro negocio', citas.some((c) => c.id === cita.id))

  const ticket = await semilla.supportTicket.create({
    data: {
      companyId: dos.id,
      clienteId: fichaDos.id,
      asunto: 'Consulta fase10',
      categoria: 'OTRO',
      estado: 'NUEVO',
    },
  })
  const tickets = await listTicketsCliente(fichas)
  comprobar('ve su hilo de ayuda del otro negocio', tickets.some((t) => t.id === ticket.id))

  const vehiculo = await semilla.vehiculo.create({
    data: {
      clienteId: fichaUno.id,
      marca: 'Toyota',
      modelo: 'Corolla',
      anio: 2020,
      color: 'Gris',
    },
  })
  const vehiculos = await getVehiculosCliente(ana.supabaseId)
  comprobar('ve sus vehículos', vehiculos.some((v) => v.id === vehiculo.id))

  const plan = await semilla.plan.create({
    data: { companyId: dos.id, nombre: 'Plan Fase10', precio: 500 },
  })
  await semilla.membership.create({
    data: { clienteId: fichaDos.id, companyId: dos.id, planId: plan.id, estado: 'ACTIVA' },
  })
  const pagos = await getClientePagos(ana.supabaseId)
  comprobar('ve su membresía del otro negocio', pagos.membership?.planNombre === 'Plan Fase10')

  // ── 2 · La vitrina pública y el mapa ──────────────────────────────────────
  console.log('\n2 · Lo público')
  const promo = await semilla.promocion.create({
    data: {
      companyId: uno.id,
      titulo: 'Oferta Fase10',
      descripcion: 'Prueba',
      visibilidad: 'publica',
      vigenciaDesde: dias(-1),
      vigenciaHasta: null,
    },
  })
  const vitrina = await getPromotionsPublic({ search: 'Fase10', limit: 50 })
  comprobar(
    'la vitrina pública sigue viéndose',
    vitrina.some((p) => p.id === promo.id),
    'el marketplace cruza empresas por diseño: si RLS lo cerrara, la app pública ' +
      'se quedaría en blanco'
  )

  await semilla.sucursal.create({
    data: {
      companyId: uno.id,
      nombre: 'Sucursal Fase10',
      activa: true,
      mostrarEnMapa: true,
      latitud: 18.4861,
      longitud: -69.9312,
    },
  })
  const { filas } = await buscarCercanosRaw(
    {
      lat: 18.4861,
      lng: -69.9312,
      radioKm: 5,
      limit: 20,
      userId: ana.id,
      supabaseId: ana.supabaseId,
    },
    false
  )
  const enMapa = filas.find((f) => f.empresaSlug === `${P}uno`)
  comprobar('el mapa encuentra la sucursal', !!enMapa)
  comprobar(
    'y la marca como suya, porque tiene ficha ahí',
    enMapa?.esCliente === true,
    'el JOIN contra `clientes` cruza empresas: con RLS mal puesto devolvería ' +
      'siempre false y la marca no se encendería nunca'
  )

  // ── 3 · Escribir con RLS puesto ───────────────────────────────────────────
  console.log('\n3 · Escritura')
  const escritas = await propagarDatosPersonales(ana.supabaseId, {
    nombre: 'Ana Actualizada',
    telefono: '809-555-1234',
    fechaNacimiento: null,
    ciudad: null,
    genero: null,
    notifPromos: true,
    notifRecordatorios: true,
  })
  comprobar(
    'el perfil se escribe en sus dos fichas, cada una con su empresa',
    escritas === 2,
    `escribió ${escritas}: cada ficha se actualiza con \`conEmpresa\` de SU ` +
      'empresa; si se hubiera hecho con una sola, RLS habría rechazado la otra'
  )
  const tras = await semilla.cliente.findMany({
    where: { supabaseId: ana.supabaseId },
    select: { nombre: true },
  })
  comprobar(
    'y quedó guardado de verdad',
    tras.length === 2 && tras.every((c) => c.nombre === 'Ana Actualizada'),
    `quedó ${JSON.stringify(tras)}`
  )

  // ── 4 · El aislamiento, que es lo que RLS aporta ──────────────────────────
  console.log('\n4 · Aislamiento')
  // Con el contexto en la empresa UNO, una consulta SIN `where` no puede
  // alcanzar las fichas de la empresa DOS. Este es EL caso: el `where`
  // olvidado en una consulta nueva.
  const desdeUno = await conEmpresa(uno.id, (tx) =>
    tx.cliente.findMany({ select: { id: true, companyId: true } })
  )
  comprobar(
    'con el contexto en un negocio no se ven las fichas del otro',
    desdeUno.length > 0 && desdeUno.every((c) => c.companyId === uno.id),
    `se colaron ${desdeUno.filter((c) => c.companyId !== uno.id).length} filas ajenas`
  )
  comprobar(
    'la ficha de la otra empresa existe, pero no desde aquí',
    !desdeUno.some((c) => c.id === fichaDos.id),
    'si apareciera, el escenario no distinguiría: RLS no estaría filtrando'
  )
  // Y una escritura cruzada tampoco: RLS no puede ser solo un filtro de
  // lectura.
  const cruzada = await conEmpresa(uno.id, (tx) =>
    tx.cliente.updateMany({ where: { id: fichaDos.id }, data: { nombre: 'PISADO' } })
  ).catch(() => ({ count: -1 }))
  comprobar(
    'no se puede modificar la ficha de otra empresa',
    cruzada.count <= 0,
    'un `update` desde una empresa alcanzó filas de otra'
  )
  const sigueBien = await semilla.cliente.findUnique({
    where: { id: fichaDos.id },
    select: { nombre: true },
  })
  comprobar('la ficha ajena quedó intacta', sigueBien?.nombre === 'Ana Actualizada')

  await limpiar()
  console.log(`\n${ok} comprobaciones pasadas, ${fallidas} fallidas.`)
  await semilla.$disconnect()
  if (ok === 0) {
    console.log('Ninguna comprobación llegó a ejecutarse: eso NO es un éxito.')
    process.exit(1)
  }
  process.exit(fallidas === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await limpiar().catch(() => {})
  await semilla.$disconnect().catch(() => {})
  process.exit(1)
})
