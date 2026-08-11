/**
 * FASE 6 · LA RELACIÓN CON UN NEGOCIO — verificación contra PostgreSQL real.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS DOS PREGUNTAS QUE SE CONFUNDÍAN
 *
 * «¿Es este negocio el ACTIVO de mi sesión?» y «¿soy cliente de este negocio?»
 * no son la misma pregunta, y el perfil de empresa hacía la primera creyendo
 * hacer la segunda. Quien era cliente de un negocio con la sesión apuntando a
 * otro veía su perfil sin botón y sin elegibilidad: un folleto.
 *
 * Y «seguir» tampoco es «ser cliente». Como el botón de dejar de seguir está a
 * un toque, bastaba eso para que un negocio con membresía activa desapareciera
 * de «Mis empresas».
 *
 * Cada comprobación trae su control: alguien que NO tiene esa relación.
 *
 *   DATABASE_URL=…  DIRECT_URL=…  npm run verificar:perfil-empresa
 */
import { prisma } from '../src/lib/prisma'
import { fichaEnEmpresa } from '../src/modules/cliente/afiliacion'
import {
  getMisEmpresas,
  getPromocionesDeEmpresaParaMi,
  getSeguidasIds,
} from '../src/modules/social/queries'

const url = process.env.DATABASE_URL ?? ''
if (!/localhost|127\.0\.0\.1/.test(url) || /prod/i.test(url)) {
  console.error(
    'Este script BORRA datos. Solo se ejecuta contra una base local desechable.\n' +
      `DATABASE_URL actual: ${url.replace(/:[^:@]*@/, ':***@') || '(vacío)'}`
  )
  process.exit(2)
}

const P = 'fase6-'
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
  await prisma.promocion.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.cliente.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } })
  await prisma.company.deleteMany({ where: { id: { in: ids } } })
}

const dias = (n: number) => new Date(Date.now() + n * 24 * 3600_000)

async function main() {
  await limpiar()

  const gimnasio = await prisma.company.create({
    data: {
      name: 'Gimnasio Fase6',
      slug: `${P}gimnasio`,
      type: 'gimnasio',
      isPublished: true,
      isActive: true,
    },
  })
  const cafe = await prisma.company.create({
    data: {
      name: 'Café Fase6',
      slug: `${P}cafe`,
      type: 'restaurante',
      isPublished: true,
      isActive: true,
    },
  })

  // Rosa es CLIENTE del gimnasio, pero su sesión apunta al café (donde también
  // tiene ficha). Es el caso que el perfil trataba como «empresa ajena».
  const rosa = await prisma.user.create({
    data: { supabaseId: `${P}rosa`, email: `${P}rosa@mail.test`, name: 'Rosa' },
  })
  const rosaGimnasio = await prisma.cliente.create({
    data: {
      companyId: gimnasio.id,
      supabaseId: rosa.supabaseId,
      nombre: 'Rosa',
      email: rosa.email,
    },
  })
  await prisma.cliente.create({
    data: {
      companyId: cafe.id,
      supabaseId: rosa.supabaseId,
      nombre: 'Rosa',
      email: rosa.email,
    },
  })

  // Tito solo SIGUE el gimnasio: no es cliente de nadie.
  const tito = await prisma.user.create({
    data: { supabaseId: `${P}tito`, email: `${P}tito@mail.test`, name: 'Tito' },
  })
  await prisma.companyFollow.create({ data: { userId: tito.id, companyId: gimnasio.id } })

  const publica = await prisma.promocion.create({
    data: {
      companyId: gimnasio.id,
      titulo: 'Primera clase gratis fase6',
      descripcion: 'Para todo el mundo',
      visibilidad: 'publica',
      vigenciaDesde: dias(-3),
      vigenciaHasta: null,
    },
  })
  const privada = await prisma.promocion.create({
    data: {
      companyId: gimnasio.id,
      titulo: 'Solo socios fase6',
      descripcion: 'Reservada a los miembros',
      visibilidad: 'privada',
      vigenciaDesde: dias(-3),
      vigenciaHasta: null,
    },
  })

  // ── 1 · «Soy cliente aquí» no es «esta es mi empresa activa» ──────────────
  console.log('\n1 · La relación con ESTE negocio')
  comprobar(
    'la ficha del gimnasio se encuentra aunque la sesión apunte a otro',
    (await fichaEnEmpresa(rosa.supabaseId, gimnasio.id)) === rosaGimnasio.id,
    'con la comprobación vieja (company.id === metadata.companyId), Rosa veía ' +
      'el perfil de su propio gimnasio sin botón y sin elegibilidad'
  )
  comprobar(
    'quien no tiene ficha allí no aparece como cliente',
    (await fichaEnEmpresa(tito.supabaseId, gimnasio.id)) === null,
    'seguir un negocio se estaría contando como ser su cliente'
  )

  // ── 2 · Las ofertas privadas, en el perfil de su negocio ──────────────────
  console.log('\n2 · Ofertas en el perfil del negocio')
  const paraRosa = await getPromocionesDeEmpresaParaMi(gimnasio.id, rosa.supabaseId)
  const idsRosa = new Set(paraRosa.map((p) => p.id))
  comprobar('el cliente ve la oferta pública', idsRosa.has(publica.id))
  comprobar(
    'el cliente ve la oferta PRIVADA de su negocio',
    idsRosa.has(privada.id),
    'la única persona que puede canjearla era justo la que no la veía'
  )
  const paraTito = await getPromocionesDeEmpresaParaMi(gimnasio.id, tito.supabaseId)
  const idsTito = new Set(paraTito.map((p) => p.id))
  comprobar('quien solo sigue ve la pública', idsTito.has(publica.id))
  comprobar(
    'quien solo sigue NO ve la privada',
    !idsTito.has(privada.id),
    'seguir daría acceso a lo que el negocio reserva para sus miembros'
  )
  const anonima = await getPromocionesDeEmpresaParaMi(gimnasio.id, null)
  comprobar(
    'sin sesión solo se ven las públicas',
    anonima.length === 1 && anonima[0].id === publica.id
  )

  // ── 3 · Dejar de seguir no borra la relación ──────────────────────────────
  console.log('\n3 · Mis empresas')
  const antes = await getMisEmpresas(rosa.id)
  comprobar(
    'sus dos negocios aparecen aunque no siga a ninguno',
    antes.length === 2 && antes.every((e) => e.esCliente && !e.sigo),
    `devolvió ${JSON.stringify(antes.map((e) => [e.company.name, e.esCliente, e.sigo]))}`
  )

  await prisma.companyFollow.create({ data: { userId: rosa.id, companyId: gimnasio.id } })
  const siguiendo = await getMisEmpresas(rosa.id)
  const suGimnasio = siguiendo.find((e) => e.company.id === gimnasio.id)
  comprobar(
    'al seguirlo, la misma empresa no se duplica',
    siguiendo.length === 2 && suGimnasio?.sigo === true && suGimnasio.esCliente === true,
    `devolvió ${siguiendo.length} entradas`
  )

  await prisma.companyFollow.deleteMany({ where: { userId: rosa.id, companyId: gimnasio.id } })
  const despues = await getMisEmpresas(rosa.id)
  comprobar(
    'dejar de seguir NO saca de la lista al negocio del que es cliente',
    despues.some((e) => e.company.id === gimnasio.id),
    'un toque en «dejar de seguir» hacía desaparecer un negocio con membresía ' +
      'activa, y sin más aviso que la tarjeta esfumándose'
  )

  const deTito = await getMisEmpresas(tito.id)
  comprobar(
    'quien solo sigue tiene su empresa marcada como no-cliente',
    deTito.length === 1 && deTito[0].sigo && !deTito[0].esCliente,
    `devolvió ${JSON.stringify(deTito.map((e) => [e.company.name, e.esCliente, e.sigo]))}`
  )
  comprobar(
    'las empresas de Rosa no se cuelan en la lista de Tito',
    !deTito.some((e) => e.company.id === cafe.id)
  )

  // ── 4 · Seguir sigue siendo seguir ────────────────────────────────────────
  console.log('\n4 · Seguimiento')
  const seguidasTito = await getSeguidasIds(tito.id)
  comprobar('el seguimiento de Tito se lee bien', seguidasTito.has(gimnasio.id))
  const seguidasRosa = await getSeguidasIds(rosa.id)
  comprobar(
    'ser cliente no cuenta como seguir',
    !seguidasRosa.has(gimnasio.id),
    'son dos relaciones distintas y el perfil las muestra por separado'
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
