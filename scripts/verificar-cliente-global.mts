/**
 * FASE 4 · «MI MEMBEGO» ES DE LA PERSONA — verificación contra PostgreSQL real.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN SCRIPT Y NO SOLO GUARDIAS DE TEXTO
 *
 * Las pruebas de `tests/` leen el código y comprueban que dice lo que debe
 * decir. Sirven para que nadie deshaga la decisión sin enterarse, pero no
 * demuestran que las consultas DEVUELVAN lo correcto: un `where` puede estar
 * escrito exactamente como se esperaba y traer las filas equivocadas.
 *
 * Este script monta el escenario real —dos empresas, una persona con ficha en
 * cada una, y otra persona distinta como control— y llama a las MISMAS
 * funciones que usan las pantallas. Lo que se afirma aquí está ejecutado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTE SCRIPT **NO** DEMUESTRA
 *
 * No prueba RLS. Las políticas viven en `prisma/migrations_manual/
 * 2026-07-rls-capa2-aislamiento.sql` (no las aplica `migrate deploy`) y la
 * aplicación se conecta hoy con un rol que se las salta —está explicado en
 * `src/lib/tenant.ts`—. Lo que se comprueba aquí es la PRIMERA barrera: que el
 * `where` de cada consulta esté acotado a las fichas de quien mira. Para la
 * segunda barrera está `npm run rls:probar`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CÓMO SE EJECUTA
 *
 *   DATABASE_URL=postgresql://…  DIRECT_URL=…  \
 *     npx tsx --tsconfig tsconfig.verificacion.json \
 *       scripts/verificar-cliente-global.mts
 *
 * Contra una base DESECHABLE: crea y borra sus propios datos. Se niega a
 * correr si la URL no lo parece.
 */
import { prisma } from '../src/lib/prisma'
import { misClienteIds } from '../src/modules/cliente/afiliacion'
import { getRegalosCliente } from '../src/modules/regalos/queries'
import { getGiftCardsCliente } from '../src/modules/regalos/giftcards'
import { getCitasCliente } from '../src/modules/citas/queries'
import {
  getClientePagos,
  getClienteVisitas,
  getBeneficioDisponible,
} from '../src/modules/cliente/queries'
import { getRegalosCliente as getOfertasCliente } from '../src/modules/ofertas/queries'
import { hmEnTz } from '../src/modules/citas/disponibilidad'

// ── Salvaguarda: nunca contra algo que parezca producción ────────────────────
const url = process.env.DATABASE_URL ?? ''
if (!/localhost|127\.0\.0\.1/.test(url) || /prod/i.test(url)) {
  console.error(
    'Este script BORRA datos. Solo se ejecuta contra una base local desechable.\n' +
      `DATABASE_URL actual: ${url.replace(/:[^:@]*@/, ':***@') || '(vacío)'}`
  )
  process.exit(2)
}

const P = 'fase4-' // prefijo de todo lo que crea, para poder limpiarlo

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
  // En orden de dependencia. `deleteMany` con prefijo: no toca nada más.
  const companies = await prisma.company.findMany({
    where: { slug: { startsWith: P } },
    select: { id: true },
  })
  const ids = companies.map((c) => c.id)
  if (ids.length === 0) return
  await prisma.visit.deleteMany({ where: { cliente: { companyId: { in: ids } } } })
  await prisma.cita.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.regalo.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.giftCard.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.membership.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.productoCompra.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.plan.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.promocion.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.cliente.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } })
  await prisma.company.deleteMany({ where: { id: { in: ids } } })
}

async function main() {
  await limpiar()

  // ── Escenario ─────────────────────────────────────────────────────────────
  // Dos empresas en ZONAS HORARIAS DISTINTAS: es lo que hace visible el fallo
  // de pintar todas las citas con la zona de la empresa activa.
  const lavadero = await prisma.company.create({
    data: {
      name: 'Lavadero Norte',
      slug: `${P}lavadero`,
      type: 'carwash',
      zonaHoraria: 'America/Santo_Domingo', // UTC-4
      idioma: 'es-DO',
    },
  })
  const restaurante = await prisma.company.create({
    data: {
      name: 'Restaurante Sur',
      slug: `${P}restaurante`,
      type: 'restaurante',
      zonaHoraria: 'America/Mexico_City', // UTC-6
      idioma: 'es-MX',
    },
  })

  // Ana: UNA persona, DOS fichas. Su ficha «activa» sería la del lavadero.
  const ana = await prisma.user.create({
    data: { supabaseId: `${P}ana`, email: `${P}ana@mail.test`, name: 'Ana Pérez' },
  })
  const anaLavadero = await prisma.cliente.create({
    data: {
      companyId: lavadero.id,
      supabaseId: ana.supabaseId,
      nombre: 'Ana Pérez',
      email: ana.email,
    },
  })
  const anaRestaurante = await prisma.cliente.create({
    data: {
      companyId: restaurante.id,
      supabaseId: ana.supabaseId,
      nombre: 'Ana Pérez',
      email: ana.email,
    },
  })

  // Beto: OTRA persona con ficha en el mismo restaurante. Es el control: si al
  // ampliar las consultas se hubiera colado un `sinEmpresa` sin acotar, Beto
  // vería las cosas de Ana.
  const beto = await prisma.user.create({
    data: { supabaseId: `${P}beto`, email: `${P}beto@mail.test`, name: 'Beto Gil' },
  })
  const betoRestaurante = await prisma.cliente.create({
    data: {
      companyId: restaurante.id,
      supabaseId: beto.supabaseId,
      nombre: 'Beto Gil',
      email: beto.email,
    },
  })

  // ── 1 · Las fichas de la persona ──────────────────────────────────────────
  console.log('\n1 · Fichas de la persona')
  const fichasAna = await misClienteIds(ana.supabaseId)
  comprobar(
    'misClienteIds devuelve las DOS fichas de Ana',
    fichasAna.length === 2 &&
      fichasAna.includes(anaLavadero.id) &&
      fichasAna.includes(anaRestaurante.id),
    `devolvió ${JSON.stringify(fichasAna)}`
  )
  const fichasBeto = await misClienteIds(beto.supabaseId)
  comprobar(
    'las fichas de Beto son solo suyas',
    fichasBeto.length === 1 && fichasBeto[0] === betoRestaurante.id
  )

  // ── 2 · Regalos P2P ───────────────────────────────────────────────────────
  // Beto le transfiere usos a Ana EN EL RESTAURANTE, que no es su empresa
  // activa. Antes este regalo no aparecía en ninguna pantalla de Ana… y
  // expiraba solo.
  console.log('\n2 · Regalos')
  const regalo = await prisma.regalo.create({
    data: {
      companyId: restaurante.id,
      tipo: 'TRANSFERENCIA_USOS',
      estado: 'PENDIENTE',
      remitenteId: betoRestaurante.id,
      destinatarioId: anaRestaurante.id,
      usos: 2,
      mensaje: 'Para que pruebes los tacos',
      expiraAt: new Date(Date.now() + 7 * 24 * 3600_000),
    },
  })
  const regalosAna = await getRegalosCliente(ana.supabaseId)
  comprobar(
    'Ana ve el regalo recibido en la empresa que NO tiene activa',
    regalosAna.recibidos.some((r) => r.id === regalo.id),
    `recibidos: ${JSON.stringify(regalosAna.recibidos.map((r) => r.id))}`
  )
  comprobar(
    'ese regalo NO figura como enviado por ella',
    !regalosAna.enviados.some((r) => r.id === regalo.id)
  )
  /**
   * CONTROL NEGATIVO — que la prueba de arriba no sea trivial.
   *
   * Una comprobación que pasaría igual con el código viejo no comprueba nada.
   * Aquí se repite la consulta ACOTADA A LA FICHA ACTIVA, que es exactamente
   * lo que hacía antes, y se exige que NO encuentre el regalo. Si algún día
   * esta línea falla, es que el escenario dejó de distinguir los dos casos y
   * el resto de la sección se volvió decorativa.
   */
  const conFichaActiva = await prisma.regalo.findMany({
    where: { destinatarioId: anaLavadero.id, estado: 'PENDIENTE' },
    select: { id: true },
  })
  comprobar(
    'con la ficha ACTIVA ese regalo no aparecía (el fallo que esto arregla)',
    !conFichaActiva.some((r) => r.id === regalo.id),
    'el escenario no distingue: la ficha activa ya veía el regalo'
  )
  comprobar(
    'el destino del regalo es la ficha del restaurante, no la activa',
    regalo.destinatarioId === anaRestaurante.id && anaRestaurante.id !== anaLavadero.id,
    'al aceptar, usar la ficha activa crearía la compra espejo en la empresa equivocada'
  )

  const regalosBeto = await getRegalosCliente(beto.supabaseId)
  comprobar(
    'Beto lo ve como ENVIADO, no como recibido',
    regalosBeto.enviados.some((r) => r.id === regalo.id) &&
      !regalosBeto.recibidos.some((r) => r.id === regalo.id)
  )

  // Un regalo YA VENCIDO se expira solo al listar (expiración perezosa), y la
  // expiración tiene que alcanzar también a las otras fichas de la persona.
  const vencido = await prisma.regalo.create({
    data: {
      companyId: restaurante.id,
      tipo: 'TRANSFERENCIA_USOS',
      estado: 'PENDIENTE',
      remitenteId: betoRestaurante.id,
      destinatarioId: anaRestaurante.id,
      usos: 1,
      expiraAt: new Date(Date.now() - 60_000),
    },
  })
  await getRegalosCliente(ana.supabaseId)
  const vencidoDespues = await prisma.regalo.findUnique({ where: { id: vencido.id } })
  comprobar(
    'un pendiente vencido de otra empresa se marca EXPIRADO al listar',
    vencidoDespues?.estado === 'EXPIRADO',
    `quedó en ${vencidoDespues?.estado}`
  )

  // ── 3 · Gift cards ────────────────────────────────────────────────────────
  console.log('\n3 · Gift cards')
  const gc = await prisma.giftCard.create({
    data: {
      companyId: restaurante.id,
      codigo: `${P}GC1`,
      estado: 'ACTIVA',
      monto: 1000,
      saldo: 1000,
      compradorClienteId: betoRestaurante.id,
      destinatarioClienteId: anaRestaurante.id,
    },
  })
  const gcAna = await getGiftCardsCliente(ana.supabaseId)
  comprobar(
    'Ana ve la gift card recibida en la otra empresa',
    gcAna.recibidas.some((g) => g.id === gc.id),
    `recibidas: ${JSON.stringify(gcAna.recibidas.map((g) => g.codigo))}`
  )
  const gcBeto = await getGiftCardsCliente(beto.supabaseId)
  comprobar(
    'para Beto la misma tarjeta es COMPRADA',
    gcBeto.compradas.some((g) => g.id === gc.id) && gcBeto.recibidas.length === 0
  )

  // ── 4 · Citas, cada una en la hora de SU negocio ──────────────────────────
  console.log('\n4 · Citas')
  const manana = new Date(Date.now() + 24 * 3600_000)
  const citaLavadero = await prisma.cita.create({
    data: {
      companyId: lavadero.id,
      clienteId: anaLavadero.id,
      inicio: manana,
      duracionMin: 30,
      servicio: 'Lavado completo',
      estado: 'CONFIRMADA',
    },
  })
  const citaRestaurante = await prisma.cita.create({
    data: {
      companyId: restaurante.id,
      clienteId: anaRestaurante.id,
      inicio: manana,
      duracionMin: 60,
      servicio: 'Mesa para dos',
      estado: 'CONFIRMADA',
    },
  })
  const citasAna = await getCitasCliente(fichasAna)
  comprobar(
    'Ana ve sus citas de LAS DOS empresas',
    citasAna.some((c) => c.id === citaLavadero.id) &&
      citasAna.some((c) => c.id === citaRestaurante.id),
    `vio ${citasAna.length} citas`
  )
  const cRest = citasAna.find((c) => c.id === citaRestaurante.id)
  comprobar(
    'cada cita trae el nombre de su negocio',
    cRest?.company.name === 'Restaurante Sur',
    `trajo ${JSON.stringify(cRest?.company)}`
  )
  // La prueba que importa: la MISMA marca de tiempo pintada con la zona de la
  // empresa activa da una hora distinta de la real. Dos horas de diferencia
  // entre Santo Domingo y Ciudad de México.
  const horaCorrecta = hmEnTz(citaRestaurante.inicio, cRest!.company.zonaHoraria)
  const horaConZonaActiva = hmEnTz(citaRestaurante.inicio, lavadero.zonaHoraria)
  comprobar(
    'la hora se calcula con la zona del negocio de la cita, no con la activa',
    horaCorrecta !== horaConZonaActiva,
    `ambas dieron ${horaCorrecta}: el escenario no distingue zonas`
  )
  const citasBeto = await getCitasCliente(fichasBeto)
  comprobar('Beto no ve ninguna cita de Ana', citasBeto.length === 0)

  // ── 5 · Pagos y membresías ────────────────────────────────────────────────
  console.log('\n5 · Pagos')
  const planLavadero = await prisma.plan.create({
    data: { companyId: lavadero.id, nombre: 'Plan Brillo', precio: 500, lavadosIncluidos: 4 },
  })
  const planRestaurante = await prisma.plan.create({
    data: { companyId: restaurante.id, nombre: 'Club Sabores', precio: 800 },
  })
  await prisma.membership.create({
    data: {
      clienteId: anaLavadero.id,
      companyId: lavadero.id,
      planId: planLavadero.id,
      estado: 'ACTIVA',
      createdAt: new Date(Date.now() - 10 * 24 * 3600_000),
    },
  })
  // La MÁS RECIENTE es la del restaurante, que no es su empresa activa: con el
  // filtro viejo, «Mis pagos» habría mostrado la del lavadero.
  await prisma.membership.create({
    data: {
      clienteId: anaRestaurante.id,
      companyId: restaurante.id,
      planId: planRestaurante.id,
      estado: 'ACTIVA',
    },
  })
  const pagosAna = await getClientePagos(ana.supabaseId)
  comprobar(
    'la membresía que se muestra es la más reciente de la PERSONA',
    pagosAna.membership?.planNombre === 'Club Sabores',
    `mostró ${JSON.stringify(pagosAna.membership?.planNombre)}`
  )
  const pagosBeto = await getClientePagos(beto.supabaseId)
  comprobar('Beto no hereda las membresías de Ana', pagosBeto.membership === null)

  // ── 6 · Historial de visitas ──────────────────────────────────────────────
  console.log('\n6 · Historial')
  const memLav = await prisma.membership.findFirstOrThrow({
    where: { clienteId: anaLavadero.id },
  })
  const memRes = await prisma.membership.findFirstOrThrow({
    where: { clienteId: anaRestaurante.id },
  })
  await prisma.visit.create({
    data: { clienteId: anaLavadero.id, membershipId: memLav.id, servicio: 'Lavado' },
  })
  await prisma.visit.create({
    data: { clienteId: anaRestaurante.id, membershipId: memRes.id, servicio: 'Cena' },
  })
  const historial = await getClienteVisitas(ana.supabaseId, 1, 20)
  comprobar(
    'el historial suma las visitas de todos sus negocios',
    historial.total === 2 && historial.visitas.length === 2,
    `total=${historial.total} visitas=${historial.visitas.length}`
  )
  const historialBeto = await getClienteVisitas(beto.supabaseId, 1, 20)
  comprobar('el historial de Beto está vacío', historialBeto.total === 0)

  // ── 7 · El beneficio del inicio ───────────────────────────────────────────
  console.log('\n7 · Inicio')
  const promo = await prisma.promocion.create({
    data: {
      companyId: restaurante.id,
      titulo: 'Postre gratis',
      descripcion: 'Con cualquier plato fuerte',
    },
  })
  await prisma.productoCompra.create({
    data: {
      companyId: restaurante.id,
      clienteId: anaRestaurante.id,
      promocionId: promo.id,
      estado: 'ACTIVA',
      usosIncluidos: 1,
      usosRestantes: 1,
    },
  })
  const beneficio = await getBeneficioDisponible(ana.supabaseId)
  comprobar(
    'el inicio muestra la recompensa reclamada en la otra empresa',
    beneficio?.titulo === 'Postre gratis' && beneficio.empresa === 'Restaurante Sur',
    `devolvió ${JSON.stringify(beneficio)}`
  )
  comprobar(
    'Beto no ve la recompensa de Ana en su inicio',
    (await getBeneficioDisponible(beto.supabaseId)) === null
  )

  // ── 8 · Ofertas reclamadas (el otro «getRegalosCliente») ──────────────────
  console.log('\n8 · Ofertas reclamadas')
  const sinFichas = await getOfertasCliente([])
  comprobar('sin fichas no consulta nada y devuelve vacío', sinFichas.length === 0)

  // ── Resumen ───────────────────────────────────────────────────────────────
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
