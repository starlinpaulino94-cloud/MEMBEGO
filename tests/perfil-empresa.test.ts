import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * EL PERFIL DE UN NEGOCIO SABE QUIÉN ERES **AHÍ**.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA PREGUNTA EQUIVOCADA
 *
 * El perfil decidía todo con `company.id === user.metadata.companyId`: «¿es
 * este el negocio ACTIVO de la sesión?». Creía estar preguntando «¿es cliente
 * de este negocio?», que es otra cosa.
 *
 * Quien era cliente de ese negocio desde hacía un año, con la sesión apuntando
 * a otro, caía en la rama de «empresa ajena»: sin botón, sin elegibilidad. El
 * perfil —la pantalla donde se decide entrar a un negocio— quedaba de folleto.
 *
 * Es el mismo error que la fase 4 corrigió en «Mi Membego», visto desde el
 * lado del negocio.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y SEGUIR NO ES SER CLIENTE
 *
 * «Mis empresas» salía solo de `CompanyFollow`. Con el botón de dejar de
 * seguir a un toque, eso bastaba para que un negocio donde la persona tiene
 * membresía activa desapareciera de su lista.
 *
 * Que las consultas devuelvan lo correcto se comprueba ejecutándolas contra
 * PostgreSQL en `scripts/verificar-perfil-empresa.mts`.
 */

const leer = (p: string) =>
  readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const PERFIL = 'src/app/(cliente)/cliente/empresas/[companySlug]/page.tsx'

test('la pertenencia se mide con la ficha, no con la empresa activa', () => {
  const src = leer(PERFIL)
  assert.match(
    src,
    /const fichaAqui = await fichaEnEmpresa\(user\.supabaseId, company\.id\)/,
    'Sin esto, ser cliente de un negocio depende de qué empresa tenga abierta.'
  )
  assert.match(src, /const esCliente = fichaAqui != null/)
  assert.ok(
    !/const esMiEmpresa = company\.id === user\.metadata\.companyId/.test(src),
    'Volvió a confundirse «mi empresa activa» con «soy cliente aquí».'
  )
})

test('la elegibilidad se calcula con la ficha de ESE negocio', () => {
  const src = leer(PERFIL)
  const bloque = src.slice(src.indexOf('let requisitos'), src.indexOf('const rutaVehiculo'))
  assert.match(
    bloque,
    /companyId: company\.id,\s*clienteId: fichaAqui,/,
    'Calcular los requisitos con la ficha de OTRA empresa da una respuesta que ' +
      'no es de esta persona en este negocio.'
  )
})

test('el perfil siempre ofrece por dónde entrar', () => {
  const src = leer(PERFIL)
  assert.match(src, /ctaSlot=\{/, 'Sin botón, el perfil es una vitrina sin puerta.')
  const cta = leer('src/components/cliente/CtaEmpresa.tsx')
  assert.match(cta, /Unirme a \$\{companyName\}/, 'Quien no es cliente tiene que poder entrar.')
  assert.match(
    cta,
    /Ver planes de \$\{companyName\}/,
    'Quien ya es cliente tiene que poder llegar a los planes de ESE negocio.'
  )
  assert.match(
    cta,
    /Cambiaremos a este negocio/,
    'Cambiar el negocio activo le cambia el menú y el QR: hay que decirlo antes, ' +
      'no descubrirlo después.'
  )
})

test('las ofertas privadas del negocio llegan a sus clientes', () => {
  const src = leer(PERFIL)
  assert.match(
    src,
    /getPromocionesDeEmpresaParaMi\(company\.id, user\.supabaseId/,
    'Con la vitrina pública a secas, el único que puede canjear una oferta ' +
      'privada era justo el que no la veía en el perfil del negocio.'
  )
  const q = leer('src/modules/social/queries.ts')
  const fn = q.slice(q.indexOf('export async function getPromocionesDeEmpresaParaMi'))
  assert.match(
    fn.slice(0, 1500),
    /ficha \? \{\} : \{ visibilidad: 'publica' \}/,
    'Sin ficha en ese negocio, solo lo público.'
  )
  assert.match(
    fn.slice(0, 1500),
    /tx\.cliente\.findUnique/,
    'Que sea cliente se comprueba contra la base, no con un dato que venga de la vista.'
  )
})

test('dejar de seguir no borra la relación comercial', () => {
  const q = leer('src/modules/social/queries.ts')
  const fn = q.slice(
    q.indexOf('export async function getMisEmpresas'),
    q.indexOf('export async function getSeguidasIds')
  )
  assert.match(
    fn,
    /tx\.cliente\.findMany/,
    'La lista volvió a salir solo de CompanyFollow: un toque en «dejar de seguir» ' +
      'hace desaparecer un negocio con membresía activa.'
  )
  assert.match(fn, /sigo: true/)
  assert.match(fn, /esCliente: true/)

  const lista = leer('src/components/cliente/MisEmpresasList.tsx')
  assert.match(lista, /Eres cliente/, 'La tarjeta debe decir qué relación es.')
  assert.match(
    lista,
    /sigo \? 'Dejar de seguir' : 'Seguir'/,
    'A un negocio del que se es cliente sin seguirlo hay que ofrecerle seguir, ' +
      'no echarlo de la lista.'
  )
})
