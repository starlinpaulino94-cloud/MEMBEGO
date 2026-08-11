/**
 * FASE 5 · DESCUBRIMIENTO — verificación contra PostgreSQL real.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ SE COMPRUEBA AQUÍ Y POR QUÉ NO BASTA UNA GUARDIA DE TEXTO
 *
 * Esta fase toca las condiciones de una consulta: qué cuenta como «vigente»,
 * dónde va cada `OR`, qué empresas entran en la vitrina. Un `where` puede
 * estar escrito exactamente como se pretendía y traer las filas equivocadas —
 * y el fallo que se arregla aquí era justo de ese tipo:
 *
 *   `vigenciaHasta: { gt: now }` descartaba en silencio TODA promoción sin
 *   fecha de fin, porque en SQL una comparación contra NULL no es verdadera.
 *   La oferta permanente salía en el inicio del cliente y desaparecía al
 *   buscarla. Ninguna prueba de texto habría visto eso.
 *
 * Cada comprobación de abajo se ejecuta contra una base real y trae consigo su
 * CONTROL: una fila que NO debe aparecer. Una consulta que devuelve todo pasa
 * cualquier prueba escrita solo con lo que sí debe aparecer.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE IMPORTA `queries`, NO `cached`
 *
 * `cached.ts` envuelve estas mismas funciones en `unstable_cache`, que solo
 * existe dentro de Next. Lo que se verifica aquí es la consulta; la capa de
 * caché es un envoltorio que no cambia el `where`.
 *
 *   DATABASE_URL=…  DIRECT_URL=…  npm run verificar:descubrimiento
 */
import { prisma } from '../src/lib/prisma'
import {
  getPromotionsPublic,
  getFeaturedPromotions,
  getPlanesPublic,
} from '../src/modules/marketplace/queries'
import { buscarEnMisEmpresas } from '../src/modules/social/queries'

const url = process.env.DATABASE_URL ?? ''
if (!/localhost|127\.0\.0\.1/.test(url) || /prod/i.test(url)) {
  console.error(
    'Este script BORRA datos. Solo se ejecuta contra una base local desechable.\n' +
      `DATABASE_URL actual: ${url.replace(/:[^:@]*@/, ':***@') || '(vacío)'}`
  )
  process.exit(2)
}

const P = 'fase5-'
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
  await prisma.companyToCategory.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.promocion.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.plan.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.cliente.deleteMany({ where: { companyId: { in: ids } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } })
  await prisma.company.deleteMany({ where: { id: { in: ids } } })
  await prisma.businessCategory.deleteMany({ where: { slug: { startsWith: P } } })
}

const dias = (n: number) => new Date(Date.now() + n * 24 * 3600_000)

async function main() {
  await limpiar()

  // ── Escenario ─────────────────────────────────────────────────────────────
  const catBarberia = await prisma.businessCategory.create({
    data: { name: 'Barberías fase5', slug: `${P}barberia`, order: 900 },
  })
  const catComida = await prisma.businessCategory.create({
    data: { name: 'Comida fase5', slug: `${P}comida`, order: 901 },
  })

  const barberia = await prisma.company.create({
    data: {
      name: 'Barbería Fase5',
      slug: `${P}barberia-fase5`,
      type: 'carwash',
      isPublished: true,
      isActive: true,
      moneda: 'DOP',
      idioma: 'es-DO',
      categories: { create: [{ categoryId: catBarberia.id }] },
    },
  })
  const comedor = await prisma.company.create({
    data: {
      name: 'Comedor Fase5',
      slug: `${P}comedor-fase5`,
      type: 'restaurante',
      isPublished: true,
      isActive: true,
      moneda: 'MXN',
      idioma: 'es-MX',
      categories: { create: [{ categoryId: catComida.id }] },
    },
  })
  // El control de la vitrina: existe, está activa, pero NO publicada. Nada
  // suyo puede aparecer en descubrimiento.
  const oculta = await prisma.company.create({
    data: {
      name: 'Oculta Fase5',
      slug: `${P}oculta-fase5`,
      type: 'carwash',
      isPublished: false,
      isActive: true,
    },
  })

  const base = { descripcion: 'Descripción de prueba', visibilidad: 'publica' }
  const permanente = await prisma.promocion.create({
    data: {
      ...base,
      companyId: barberia.id,
      titulo: 'Corte permanente fase5',
      vigenciaDesde: dias(-10),
      vigenciaHasta: null, // ← el caso que desaparecía
    },
  })
  const conFecha = await prisma.promocion.create({
    data: {
      ...base,
      companyId: barberia.id,
      titulo: 'Corte con fecha fase5',
      vigenciaDesde: dias(-5),
      vigenciaHasta: dias(20),
    },
  })
  const caducada = await prisma.promocion.create({
    data: {
      ...base,
      companyId: barberia.id,
      titulo: 'Corte caducada fase5',
      vigenciaDesde: dias(-30),
      vigenciaHasta: dias(-1),
    },
  })
  const programada = await prisma.promocion.create({
    data: {
      ...base,
      companyId: barberia.id,
      titulo: 'Corte programada fase5',
      vigenciaDesde: dias(10),
      vigenciaHasta: dias(40),
    },
  })
  const deOculta = await prisma.promocion.create({
    data: {
      ...base,
      companyId: oculta.id,
      titulo: 'Corte de empresa oculta fase5',
      vigenciaDesde: dias(-5),
      vigenciaHasta: null,
    },
  })
  const privadaComedor = await prisma.promocion.create({
    data: {
      companyId: comedor.id,
      titulo: 'Menú secreto fase5',
      descripcion: 'Solo para miembros',
      visibilidad: 'privada',
      vigenciaDesde: dias(-5),
      vigenciaHasta: null,
    },
  })

  // ── 1 · Vigencia: el fallo que se arregla ─────────────────────────────────
  console.log('\n1 · Qué cuenta como vigente')
  const vitrina = await getPromotionsPublic({ limit: 100 })
  const ids = new Set(vitrina.map((p) => p.id))
  comprobar(
    'una promoción SIN fecha de fin aparece en la vitrina',
    ids.has(permanente.id),
    'volvió `vigenciaHasta: { gt: now }`: las permanentes desaparecen del buscador ' +
      'mientras siguen saliendo en el inicio del cliente'
  )
  comprobar('una promoción con fecha futura aparece', ids.has(conFecha.id))
  comprobar('una CADUCADA no aparece', !ids.has(caducada.id))
  comprobar(
    'una PROGRAMADA para dentro de días todavía no aparece',
    !ids.has(programada.id),
    'publicar con fecha de inicio dejó de significar algo'
  )
  comprobar(
    'lo de una empresa sin publicar no aparece',
    !ids.has(deOculta.id),
    'la vitrina estaría enseñando negocios que no existen de cara al público'
  )
  comprobar('una promoción PRIVADA no aparece en la vitrina', !ids.has(privadaComedor.id))

  // ── 2 · Buscar por texto sin perder la vigencia ───────────────────────────
  console.log('\n2 · Búsqueda por texto')
  const porTexto = await getPromotionsPublic({ search: 'corte', limit: 100 })
  const idsTexto = new Set(porTexto.map((p) => p.id))
  comprobar(
    'la búsqueda encuentra la permanente',
    idsTexto.has(permanente.id),
    `encontró ${porTexto.length} resultados`
  )
  comprobar(
    'la búsqueda NO devuelve la caducada',
    !idsTexto.has(caducada.id),
    'el `OR` del texto pisó al `OR` de la vigencia: Prisma no fusiona claves ' +
      'iguales y el buscador empezó a servir ofertas vencidas'
  )
  comprobar('la búsqueda NO devuelve la programada', !idsTexto.has(programada.id))
  const sinCoincidencia = await getPromotionsPublic({ search: 'zzzznoexiste', limit: 100 })
  comprobar(
    'una búsqueda sin coincidencias devuelve vacío',
    sinCoincidencia.length === 0,
    'una consulta que ignora el filtro pasaría todas las pruebas de arriba'
  )

  // ── 3 · Filtro por categoría del negocio ──────────────────────────────────
  console.log('\n3 · Categoría')
  const soloBarberia = await getPromotionsPublic({ category: `${P}barberia`, limit: 100 })
  const idsCat = new Set(soloBarberia.map((p) => p.id))
  comprobar('filtrando por barbería aparecen las suyas', idsCat.has(permanente.id))
  comprobar(
    'filtrando por barbería NO aparece nada de otra categoría',
    soloBarberia.every((p) => p.company.id === barberia.id),
    `se coló: ${soloBarberia.map((p) => p.company.name).join(', ')}`
  )

  // ── 4 · Lo que solo esta persona puede ver ────────────────────────────────
  console.log('\n4 · Ofertas de mis empresas')
  const socia = await prisma.user.create({
    data: { supabaseId: `${P}socia`, email: `${P}socia@mail.test`, name: 'Socia' },
  })
  await prisma.cliente.create({
    data: {
      companyId: comedor.id,
      supabaseId: socia.supabaseId,
      nombre: 'Socia',
      email: socia.email,
    },
  })
  // Curiosa solo SIGUE al comedor: seguir no da acceso a lo de los miembros.
  const curiosa = await prisma.user.create({
    data: { supabaseId: `${P}curiosa`, email: `${P}curiosa@mail.test`, name: 'Curiosa' },
  })
  await prisma.companyFollow.create({
    data: { userId: curiosa.id, companyId: comedor.id },
  })

  const deSocia = await buscarEnMisEmpresas(socia.id, { texto: 'menú' })
  comprobar(
    'quien es CLIENTE del negocio encuentra su oferta privada',
    deSocia.some((p) => p.id === privadaComedor.id),
    'buscar el nombre de una oferta que tiene delante en su inicio devolvería ' +
      '«sin resultados»'
  )
  const deCuriosa = await buscarEnMisEmpresas(curiosa.id, { texto: 'menú' })
  comprobar(
    'quien solo SIGUE el negocio no ve la privada',
    !deCuriosa.some((p) => p.id === privadaComedor.id),
    'seguir a una empresa daría acceso a lo que reserva para sus miembros'
  )
  const ajena = await buscarEnMisEmpresas(socia.id, { texto: 'corte' })
  comprobar(
    'no devuelve ofertas de empresas que no son suyas',
    ajena.length === 0,
    `devolvió ${ajena.length}: la consulta dejó de estar acotada a sus empresas`
  )
  const sinFiltro = await buscarEnMisEmpresas(socia.id, {})
  comprobar('sin texto ni categoría no devuelve nada', sinFiltro.length === 0)

  // ── 5 · Destacadas ────────────────────────────────────────────────────────
  console.log('\n5 · Destacadas')
  await prisma.promocion.update({
    where: { id: permanente.id },
    data: { isFeatured: true },
  })
  await prisma.promocion.update({
    where: { id: caducada.id },
    data: { isFeatured: true },
  })
  const destacadas = await getFeaturedPromotions(20)
  const idsDest = new Set(destacadas.map((p) => p.id))
  comprobar('una destacada permanente aparece', idsDest.has(permanente.id))
  comprobar('una destacada caducada NO aparece', !idsDest.has(caducada.id))

  // ── 6 · Catálogo global de planes ─────────────────────────────────────────
  console.log('\n6 · Planes de toda la plataforma')
  const planBarberia = await prisma.plan.create({
    data: { companyId: barberia.id, nombre: 'Corte Ilimitado fase5', precio: 1500, esIlimitado: true },
  })
  const planComedor = await prisma.plan.create({
    data: { companyId: comedor.id, nombre: 'Comidas fase5', precio: 900, lavadosIncluidos: 10 },
  })
  await prisma.plan.create({
    data: { companyId: oculta.id, nombre: 'Plan oculto fase5', precio: 100 },
  })
  await prisma.plan.create({
    data: { companyId: barberia.id, nombre: 'Plan inactivo fase5', precio: 50, activo: false },
  })

  const catalogo = (await getPlanesPublic({ limit: 100 })).filter((p) =>
    p.nombre.endsWith('fase5')
  )
  const nombres = catalogo.map((p) => p.nombre)
  comprobar(
    'el catálogo trae planes de VARIOS negocios',
    new Set(catalogo.map((p) => p.company.id)).size >= 2,
    `trajo ${JSON.stringify(nombres)}`
  )
  comprobar(
    'no trae planes de una empresa sin publicar',
    !nombres.includes('Plan oculto fase5'),
    'se estaría ofreciendo la membresía de un negocio que no existe en la vitrina'
  )
  comprobar('no trae planes desactivados', !nombres.includes('Plan inactivo fase5'))
  const elDeComedor = catalogo.find((p) => p.id === planComedor.id)
  comprobar(
    'cada plan viaja con la moneda de SU negocio',
    elDeComedor?.company.moneda === 'MXN' &&
      catalogo.find((p) => p.id === planBarberia.id)?.company.moneda === 'DOP',
    'con una sola moneda para todos, 900 pesos mexicanos se enseñan como 900 pesos dominicanos'
  )
  const buscados = await getPlanesPublic({ search: 'Comedor', limit: 100 })
  comprobar(
    'se puede buscar un plan por el NOMBRE DEL NEGOCIO',
    buscados.some((p) => p.id === planComedor.id),
    'quien busca un negocio por su nombre espera encontrar sus membresías'
  )
  const porCategoria = await getPlanesPublic({ category: `${P}comida`, limit: 100 })
  comprobar(
    'el filtro por categoría acota a los negocios de esa categoría',
    porCategoria.length > 0 && porCategoria.every((p) => p.company.id === comedor.id),
    `devolvió ${porCategoria.map((p) => p.company.name).join(', ')}`
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
