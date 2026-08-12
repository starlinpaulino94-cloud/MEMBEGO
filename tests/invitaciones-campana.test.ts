import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * UN ENLACE DE INVITACIÓN TIENE QUE SEGUIR PROMETIENDO LO QUE PROMETÍA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE PASABA
 *
 * `/invitar/CODIGO` no llevaba la campaña dentro: al abrirlo se servía «la que
 * esté ACTIVA en ese negocio ahora mismo». Así que el negocio cambiaba de
 * campaña y cambiaban con él TODOS los enlaces ya repartidos — la tarjeta que
 * la gente vio en WhatsApp ofrecía dos lavados gratis y, al tocarla, la
 * landing ofrecía otra cosa. Nadie tocó el enlace: cambió por debajo.
 *
 * Con dos campañas vivas a la vez era aún menos determinado: decidía
 * `orderBy: { orden: 'asc' }`, un campo de ordenación del panel.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA PARTE QUE ES DE SEGURIDAD, NO DE PRODUCTO
 *
 * La campaña viaja ahora en `?c=<slug>`, que es un parámetro de la URL — o
 * sea, algo que escribe quien quiera. Si no se comprobara que esa campaña es
 * de LA MISMA EMPRESA que la ficha del código, `?c=` elegiría de qué negocio
 * hablar: se podría publicar una landing con el nombre y el logo de un negocio
 * ajeno mientras la atribución va al dueño del código.
 *
 * Ejecutado contra PostgreSQL en `scripts/verificar-invitaciones.mts`: quitar
 * esa comprobación hace fallar tres comprobaciones.
 */

const leer = (p: string) =>
  readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const QUERIES = 'src/modules/invitaciones/queries.ts'

test('el enlace lleva la campaña dentro', () => {
  const page = leer('src/app/(cliente)/cliente/invita-y-gana/page.tsx')
  assert.match(
    page,
    /\/invitar\/\$\{codigoCorto\}\?c=\$\{encodeURIComponent\(campana\.slug\)\}/,
    'Sin `?c=`, cambiar de campaña reescribe todos los enlaces ya compartidos.'
  )

  const landing = leer('src/app/invitar/[code]/page.tsx')
  assert.match(
    landing,
    /getCampanaPorCodigoInvitacion\(code, c\)/,
    'La landing tiene que leer la campaña del enlace.'
  )
  assert.match(
    landing,
    /og\/campana\?slug=\$\{encodeURIComponent\(campana\.slug\)\}/,
    'La tarjeta de vista previa se pide por slug: con `?code=` volvía a ' +
      'preguntar «¿cuál está activa?» y podía dibujar una campaña distinta de ' +
      'la que la landing enseña debajo.'
  )
})

test('`?c=` no puede elegir de qué negocio se habla', () => {
  const src = leer(QUERIES)
  const fn = src.slice(
    src.indexOf('export const getCampanaPorCodigoInvitacion'),
    src.indexOf('export const getCampanaBySlug')
  )
  assert.match(
    fn,
    /slug: campanaSlug\.trim\(\),[\s\S]{0,200}?companyId: cliente\.companyId,/,
    'La campaña pedida DEBE filtrarse por la empresa de la ficha del código. ' +
      'Sin eso, cualquiera publica una landing con el nombre y el logo de un ' +
      'negocio ajeno y la atribución va al dueño del código.'
  )
  assert.match(
    fn,
    /\.\.\.vigente,/,
    'Y tiene que seguir viva: una campaña terminada no puede prometer nada.'
  )
  assert.match(
    fn,
    /pedida \?\?/,
    'Sin `c` —los enlaces repartidos antes de esto— se sirve la activa, como antes.'
  )
})

test('se puede invitar desde cualquiera de sus negocios', () => {
  const src = leer(QUERIES)
  assert.match(src, /export async function misCampanasDisponibles\(supabaseId: string\)/)
  const fn = src.slice(src.indexOf('export async function misCampanasDisponibles'))
  assert.match(
    fn.slice(0, 2000),
    /companyId: \{ in: fichas\.map\(\(f\) => f\.company\.id\) \}/,
    'La lista sale de SUS fichas, no de un parámetro de la vista.'
  )
  assert.ok(
    !/export async function getCampanaActiva/.test(src),
    'Volvió «la campaña de la empresa activa», que es la forma de pensar que ' +
      'esta fase quita: quien es cliente de tres negocios solo podía invitar al ' +
      'que tuviera abierto.'
  )

  const page = leer('src/app/(cliente)/cliente/invita-y-gana/page.tsx')
  assert.match(page, /misCampanasDisponibles\(user\.supabaseId\)/)
  assert.match(
    page,
    /opciones\.length > 1 &&/,
    'Con un solo negocio, un selector de una opción es ruido.'
  )
})

test('compartir se registra con la ficha del negocio de la campaña', () => {
  /**
   * El listado sin su acción otra vez. Comprobando la ficha ACTIVA, cada
   * compartido hecho desde un negocio que no fuera el activo se rechazaba en
   * silencio —`{ ok: false }`, sin mensaje—: el evento no se guardaba,
   * «invitaciones enviadas» no subía nunca y el embudo perdía su primer paso.
   */
  const src = leer('src/modules/invitaciones/clienteActions.ts')
  const fn = src.slice(src.indexOf('export async function registrarShareCampana'))
  assert.match(
    fn.slice(0, 2500),
    /fichaEnEmpresa\(user\.supabaseId, campana\.companyId\)/,
    'Hay que resolver la ficha de la empresa DE LA CAMPAÑA.'
  )
  assert.ok(
    !/cliente\.companyId !== campana\.companyId/.test(fn),
    'Volvió la comparación contra la empresa activa.'
  )
  assert.match(
    fn.slice(0, 2500),
    /if \(!clienteId\) return \{ ok: false \}/,
    'Sigue siendo una comprobación de pertenencia: sin ficha en esa empresa, no ' +
      'hay evento.'
  )
})
