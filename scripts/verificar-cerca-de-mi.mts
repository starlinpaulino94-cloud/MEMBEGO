/**
 * FASE 9 · CERCA DE MÍ — verificación contra PostgreSQL real.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ AQUÍ NO VALE OTRA COSA
 *
 * La búsqueda del mapa es SQL crudo (`$queryRaw`), con dos motores —PostGIS y
 * un respaldo con Haversine— y `LEFT JOIN`s que se arman a trozos según haya
 * sesión o no. TypeScript no mira dentro de esa cadena: un JOIN mal escrito
 * compila igual, y una condición de más o de menos no cambia el tipo del
 * resultado, solo las filas.
 *
 * Lo que se comprueba: que el mapa distinga las DOS relaciones —seguir un
 * negocio y ser su cliente—, que no se las invente para quien no las tiene, y
 * que la respuesta tenga la misma forma con sesión y sin ella.
 *
 * El caso que se arregla: el mapa marcaba solo el seguimiento, así que un
 * negocio donde la persona lleva un año siendo clienta se le ofrecía igual que
 * uno que no ha pisado nunca.
 *
 *   DATABASE_URL=…  DIRECT_URL=…  npm run verificar:cerca-de-mi
 */
import { prisma } from '../src/lib/prisma'
import { buscarCercanosRaw, buscarEnViewportRaw } from '../src/modules/geo/cercanos/queries'

const url = process.env.DATABASE_URL ?? ''
if (!/localhost|127\.0\.0\.1/.test(url) || /prod/i.test(url)) {
  console.error(
    'Este script BORRA datos. Solo se ejecuta contra una base local desechable.\n' +
      `DATABASE_URL actual: ${url.replace(/:[^:@]*@/, ':***@') || '(vacío)'}`
  )
  process.exit(2)
}

const P = 'fase9-'
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
  await prisma.companyFollow.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.sucursal.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.cliente.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } })
  await prisma.company.deleteMany({ where: { id: { in: ids } } })
}

// Tres puntos cercanos en Santo Domingo, a unos cientos de metros del ancla.
const ANCLA = { lat: 18.4861, lng: -69.9312 }

async function crearNegocio(nombre: string, slug: string, dLat: number, dLng: number) {
  const company = await prisma.company.create({
    data: { name: nombre, slug, type: 'carwash', isActive: true, isPublished: true },
  })
  const sucursal = await prisma.sucursal.create({
    data: {
      companyId: company.id,
      nombre: `${nombre} · Principal`,
      activa: true,
      mostrarEnMapa: true,
      latitud: ANCLA.lat + dLat,
      longitud: ANCLA.lng + dLng,
    },
  })
  return { company, sucursal }
}

async function main() {
  await limpiar()

  // Tres negocios: donde es clienta, el que solo sigue, y uno desconocido.
  const suyo = await crearNegocio('Lavadero Suyo Fase9', `${P}suyo`, 0.001, 0.001)
  const seguido = await crearNegocio('Lavadero Seguido Fase9', `${P}seguido`, 0.002, 0.001)
  const ajeno = await crearNegocio('Lavadero Ajeno Fase9', `${P}ajeno`, 0.001, 0.002)

  const eva = await prisma.user.create({
    data: { supabaseId: `${P}eva`, email: `${P}eva@mail.test`, name: 'Eva' },
  })
  await prisma.cliente.create({
    data: {
      companyId: suyo.company.id,
      supabaseId: eva.supabaseId,
      nombre: 'Eva',
      email: eva.email,
    },
  })
  await prisma.companyFollow.create({
    data: { userId: eva.id, companyId: seguido.company.id },
  })

  const sesion = { userId: eva.id, supabaseId: eva.supabaseId }
  const radio = { ...ANCLA, radioKm: 5, limit: 50 }

  // El respaldo sin PostGIS (`postgis = false`) es el que corre en cualquier
  // base sin la extensión; se comprueba explícitamente porque es el camino que
  // más se ejecuta.
  const { filas } = await buscarCercanosRaw({ ...radio, ...sesion }, false)
  const mias = filas.filter((f) => f.empresaSlug.startsWith(P))
  const de = (slug: string) => mias.find((f) => f.empresaSlug === slug)

  // ── 1 · Las dos relaciones, por separado ──────────────────────────────────
  console.log('\n1 · Seguir y ser cliente no son lo mismo')
  comprobar(
    'los tres negocios aparecen en el radio',
    mias.length === 3,
    `aparecieron ${mias.length}: ${mias.map((f) => f.empresaNombre).join(', ')}`
  )
  comprobar(
    'el negocio del que es CLIENTA sale marcado como tal',
    de(`${P}suyo`)?.esCliente === true,
    'el mapa le ofrecería como nuevo un negocio donde lleva tiempo siendo clienta'
  )
  comprobar(
    'y no sale marcado como seguido, porque no lo sigue',
    de(`${P}suyo`)?.esFavorita === false,
    'las dos marcas estarían midiendo lo mismo'
  )
  comprobar(
    'el que SIGUE sale como seguido y no como cliente',
    de(`${P}seguido`)?.esFavorita === true && de(`${P}seguido`)?.esCliente === false,
    'seguir un negocio se estaría contando como ser su cliente'
  )
  comprobar(
    'el desconocido no lleva ninguna marca',
    de(`${P}ajeno`)?.esCliente === false && de(`${P}ajeno`)?.esFavorita === false
  )

  // ── 2 · Sin sesión y con la sesión de otra persona ────────────────────────
  console.log('\n2 · Aislamiento')
  const { filas: anon } = await buscarCercanosRaw(radio, false)
  const miasAnon = anon.filter((f) => f.empresaSlug.startsWith(P))
  comprobar(
    'sin sesión el mapa sigue enseñando los tres negocios',
    miasAnon.length === 3,
    'el mapa es público: sin sesión no puede quedarse vacío'
  )
  comprobar(
    'sin sesión ninguna marca viene puesta',
    miasAnon.every((f) => !f.esCliente && !f.esFavorita),
    'la respuesta tiene que tener la misma forma con y sin sesión'
  )

  const otro = await prisma.user.create({
    data: { supabaseId: `${P}otro`, email: `${P}otro@mail.test`, name: 'Otro' },
  })
  const { filas: deOtro } = await buscarCercanosRaw(
    { ...radio, userId: otro.id, supabaseId: otro.supabaseId },
    false
  )
  comprobar(
    'otra persona no hereda las relaciones de Eva',
    deOtro
      .filter((f) => f.empresaSlug.startsWith(P))
      .every((f) => !f.esCliente && !f.esFavorita),
    'el JOIN no estaría acotado a quien mira'
  )

  // ── 3 · La búsqueda por rectángulo hace lo mismo ──────────────────────────
  console.log('\n3 · Arrastrar el mapa')
  const viewport = {
    west: ANCLA.lng - 0.05,
    south: ANCLA.lat - 0.05,
    east: ANCLA.lng + 0.05,
    north: ANCLA.lat + 0.05,
  }
  const enVista = await buscarEnViewportRaw({ viewport, ...sesion, ancla: ANCLA }, false)
  const suyoEnVista = enVista.find((f) => f.empresaSlug === `${P}suyo`)
  comprobar(
    'al mover el mapa las marcas siguen puestas',
    suyoEnVista?.esCliente === true,
    'las dos consultas tienen que dar la misma respuesta: el usuario no ' +
      'distingue si la lista vino de un radio o de un rectángulo'
  )
  comprobar(
    'y la de otra relación también',
    enVista.find((f) => f.empresaSlug === `${P}seguido`)?.esFavorita === true
  )
  const enVistaAnon = await buscarEnViewportRaw({ viewport, ancla: ANCLA }, false)
  comprobar(
    'sin sesión el rectángulo tampoco inventa marcas',
    enVistaAnon
      .filter((f) => f.empresaSlug.startsWith(P))
      .every((f) => !f.esCliente && !f.esFavorita)
  )

  // ── 4 · Lo que el mapa no debe enseñar ────────────────────────────────────
  console.log('\n4 · Qué entra en el mapa')
  const oculta = await crearNegocio('Lavadero Oculto Fase9', `${P}oculto`, 0.001, -0.001)
  await prisma.company.update({
    where: { id: oculta.company.id },
    data: { isPublished: false },
  })
  const sinMapa = await crearNegocio('Lavadero SinMapa Fase9', `${P}sinmapa`, -0.001, 0.001)
  await prisma.sucursal.update({
    where: { id: sinMapa.sucursal.id },
    data: { mostrarEnMapa: false },
  })

  const { filas: despues } = await buscarCercanosRaw({ ...radio, ...sesion }, false)
  const slugs = new Set(despues.map((f) => f.empresaSlug))
  comprobar(
    'un negocio sin publicar no sale en el mapa',
    !slugs.has(`${P}oculto`),
    'el mapa estaría mandando a la gente a negocios que no existen de cara al público'
  )
  comprobar(
    'una sucursal marcada como no visible no sale',
    !slugs.has(`${P}sinmapa`),
    'el interruptor de «mostrar en el mapa» no haría nada'
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
