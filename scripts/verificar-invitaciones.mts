/**
 * FASE 7 · INVITAR Y ATRIBUIR — verificación contra PostgreSQL real.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTA FASE SE VERIFICA EJECUTANDO
 *
 * Aquí se reparte dinero. Un enlace de invitación decide quién se lleva una
 * recompensa, y las dos cosas que cambian en esta fase —qué campaña sirve un
 * enlace y desde qué ficha se puede compartir— son exactamente las que deciden
 * la atribución. Una guardia de texto no distingue «acota bien» de «acota
 * distinto».
 *
 * Los dos casos que importan y que llevan control:
 *
 *   1 · El enlace tiene que seguir prometiendo LO QUE PROMETÍA. Antes servía
 *       «la campaña activa ahora», así que cambiar de campaña reescribía todos
 *       los enlaces ya repartidos.
 *
 *   2 · `?c=` NO puede elegir de qué negocio se habla. Es un parámetro de la
 *       URL: si no se comprobara que la campaña es de la misma empresa que la
 *       ficha del código, cualquiera publicaría una landing con el nombre y el
 *       logo de un negocio ajeno, con la atribución yendo al dueño del código.
 *
 *   DATABASE_URL=…  DIRECT_URL=…  npm run verificar:invitaciones
 */
import { prisma } from '../src/lib/prisma'
import {
  getCampanaPorCodigoInvitacion,
  misCampanasDisponibles,
} from '../src/modules/invitaciones/queries'

const url = process.env.DATABASE_URL ?? ''
if (!/localhost|127\.0\.0\.1/.test(url) || /prod/i.test(url)) {
  console.error(
    'Este script BORRA datos. Solo se ejecuta contra una base local desechable.\n' +
      `DATABASE_URL actual: ${url.replace(/:[^:@]*@/, ':***@') || '(vacío)'}`
  )
  process.exit(2)
}

const P = 'fase7-'
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
  await prisma.invitacionEvento.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.campanaInvitacion.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.cliente.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } })
  await prisma.company.deleteMany({ where: { id: { in: ids } } })
}

const dias = (n: number) => new Date(Date.now() + n * 24 * 3600_000)

async function main() {
  await limpiar()

  const lavadero = await prisma.company.create({
    data: {
      name: 'Lavadero Fase7',
      slug: `${P}lavadero`,
      type: 'carwash',
      isPublished: true,
      isActive: true,
    },
  })
  const pizzeria = await prisma.company.create({
    data: {
      name: 'Pizzería Fase7',
      slug: `${P}pizzeria`,
      type: 'restaurante',
      isPublished: true,
      isActive: true,
    },
  })

  // Una persona, ficha en los dos negocios y un código distinto en cada uno:
  // el código es de la FICHA, y con él viaja a quién se le paga.
  const ana = await prisma.user.create({
    data: { supabaseId: `${P}ana`, email: `${P}ana@mail.test`, name: 'Ana' },
  })
  const anaLavadero = await prisma.cliente.create({
    data: {
      companyId: lavadero.id,
      supabaseId: ana.supabaseId,
      nombre: 'Ana',
      email: ana.email,
      codigoCorto: 'F7LAVA',
    },
  })
  const anaPizzeria = await prisma.cliente.create({
    data: {
      companyId: pizzeria.id,
      supabaseId: ana.supabaseId,
      nombre: 'Ana',
      email: ana.email,
      codigoCorto: 'F7PIZZ',
    },
  })

  const campanaBase = {
    descripcion: 'Campaña de prueba',
    fechaInicio: dias(-5),
    fechaFin: dias(30),
    estado: 'ACTIVA' as const,
    metaRegistros: 3,
    beneficioInvitante: { descripcion: 'Un lavado gratis' },
    beneficioInvitado: { descripcion: 'Un regalo de bienvenida' },
  }
  // Dos campañas VIVAS a la vez en el lavadero: el caso donde «la activa» no
  // significa nada, porque hay dos.
  const dosLavados = await prisma.campanaInvitacion.create({
    data: {
      ...campanaBase,
      companyId: lavadero.id,
      nombre: 'Dos lavados gratis fase7',
      titulo: 'Dos lavados gratis fase7',
      slug: `${P}dos-lavados`,
      orden: 1,
    },
  })
  const descuento = await prisma.campanaInvitacion.create({
    data: {
      ...campanaBase,
      companyId: lavadero.id,
      nombre: 'Descuento del 10% fase7',
      titulo: 'Descuento del 10% fase7',
      slug: `${P}descuento-10`,
      orden: 2,
    },
  })
  const pizzaGratis = await prisma.campanaInvitacion.create({
    data: {
      ...campanaBase,
      companyId: pizzeria.id,
      nombre: 'Pizza gratis fase7',
      titulo: 'Pizza gratis fase7',
      slug: `${P}pizza-gratis`,
      orden: 1,
    },
  })
  const terminada = await prisma.campanaInvitacion.create({
    data: {
      ...campanaBase,
      companyId: lavadero.id,
      nombre: 'Campaña terminada fase7',
      titulo: 'Campaña terminada fase7',
      slug: `${P}terminada`,
      fechaInicio: dias(-60),
      fechaFin: dias(-1),
      orden: 3,
    },
  })

  // ── 1 · El enlace promete lo que prometía ─────────────────────────────────
  console.log('\n1 · La campaña viaja en el enlace')
  const conCampana = await getCampanaPorCodigoInvitacion('F7LAVA', `${P}descuento-10`)
  comprobar(
    'con `?c=` se sirve ESA campaña, no la primera por orden',
    conCampana?.campana.id === descuento.id,
    `sirvió ${conCampana?.campana.titulo}`
  )
  const sinCampana = await getCampanaPorCodigoInvitacion('F7LAVA')
  comprobar(
    'sin `?c=` (enlaces viejos) se sirve la activa, como antes',
    sinCampana?.campana.id === dosLavados.id,
    `sirvió ${sinCampana?.campana.titulo}`
  )
  comprobar(
    'el ref atribuido es el código usado',
    conCampana?.ref === 'F7LAVA' && sinCampana?.ref === 'F7LAVA'
  )

  // El control que da sentido a todo lo anterior: si `?c=` se ignorara, las
  // dos llamadas devolverían lo mismo.
  comprobar(
    'las dos campañas del mismo negocio se distinguen de verdad',
    conCampana?.campana.id !== sinCampana?.campana.id,
    'el escenario no discrimina: `?c=` podría estar ignorándose'
  )

  // ── 2 · `?c=` no elige de qué negocio se habla ────────────────────────────
  console.log('\n2 · La campaña pedida tiene que ser de su empresa')
  const cruzada = await getCampanaPorCodigoInvitacion('F7LAVA', `${P}pizza-gratis`)
  comprobar(
    'pedir la campaña de OTRA empresa no la sirve',
    cruzada?.campana.id !== pizzaGratis.id,
    'un parámetro de la URL estaría eligiendo qué negocio anunciar: se podría ' +
      'publicar una landing con el nombre y el logo de un negocio ajeno, con la ' +
      'atribución yendo al dueño del código'
  )
  comprobar(
    'y en su lugar cae a la campaña activa de la empresa del código',
    cruzada?.campana.id === dosLavados.id,
    `devolvió ${cruzada?.campana.titulo}`
  )
  const vencida = await getCampanaPorCodigoInvitacion('F7LAVA', `${P}terminada`)
  comprobar(
    'una campaña TERMINADA no se sirve aunque se pida por nombre',
    vencida?.campana.id === dosLavados.id,
    'un enlace viejo seguiría prometiendo algo que ya no existe'
  )
  const inventada = await getCampanaPorCodigoInvitacion('F7LAVA', 'no-existe-fase7')
  comprobar('un slug inventado cae a la activa', inventada?.campana.id === dosLavados.id)

  // ── 3 · Cada código, su negocio ───────────────────────────────────────────
  console.log('\n3 · El código es de la ficha')
  const desdePizzeria = await getCampanaPorCodigoInvitacion('F7PIZZ')
  comprobar(
    'el código de la pizzería resuelve a la campaña de la pizzería',
    desdePizzeria?.campana.id === pizzaGratis.id,
    `devolvió ${desdePizzeria?.campana.titulo}`
  )
  const cruzadaAlReves = await getCampanaPorCodigoInvitacion('F7PIZZ', `${P}dos-lavados`)
  comprobar(
    'con el código de la pizzería no se puede anunciar el lavadero',
    cruzadaAlReves?.campana.id === pizzaGratis.id
  )
  comprobar(
    'un código que no existe no resuelve nada',
    (await getCampanaPorCodigoInvitacion('NOEXIS')) === null
  )

  // ── 4 · Invitar desde cualquiera de sus negocios ──────────────────────────
  console.log('\n4 · Mis campañas disponibles')
  const mias = await misCampanasDisponibles(ana.supabaseId)
  comprobar(
    'aparecen las campañas de sus DOS negocios',
    mias.length === 2 &&
      mias.some((m) => m.company.id === lavadero.id) &&
      mias.some((m) => m.company.id === pizzeria.id),
    `devolvió ${JSON.stringify(mias.map((m) => m.company.name))}`
  )
  const suLavadero = mias.find((m) => m.company.id === lavadero.id)
  comprobar(
    'cada campaña viene con la FICHA de su empresa',
    suLavadero?.clienteId === anaLavadero.id &&
      mias.find((m) => m.company.id === pizzeria.id)?.clienteId === anaPizzeria.id,
    'con la ficha equivocada, el premio se le atribuiría a la persona en el ' +
      'negocio que no es'
  )
  comprobar(
    'una empresa aparece UNA vez aunque tenga varias campañas vivas',
    mias.filter((m) => m.company.id === lavadero.id).length === 1
  )
  comprobar(
    'la campaña terminada no se ofrece para invitar',
    !mias.some((m) => m.campana.id === terminada.id)
  )

  // Control de aislamiento: otra persona sin fichas no ve nada.
  const nadie = await prisma.user.create({
    data: { supabaseId: `${P}nadie`, email: `${P}nadie@mail.test`, name: 'Nadie' },
  })
  comprobar(
    'quien no es cliente de nadie no tiene campañas que compartir',
    (await misCampanasDisponibles(nadie.supabaseId)).length === 0
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
