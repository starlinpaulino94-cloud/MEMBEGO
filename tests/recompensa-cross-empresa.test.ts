import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * ADQUIRIR UNA RECOMPENSA DE CUALQUIER NEGOCIO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ESTABA ROTO, EN LOS TÉRMINOS DE QUIEN LO SUFRÍA
 *
 * Una persona veía «tacos al pastor gratis» de un restaurante que no conocía y
 * lo único que tenía debajo era «Ver empresa y sus planes». El botón de
 * adquirir NO se dibujaba, porque la pantalla exigía `esMiEmpresa`. Y si
 * hubiera llegado igualmente al servidor, el rechazo decía «para adquirir esta
 * promoción primero únete a la empresa que la publica».
 *
 * Es el trato al revés: la recompensa es el motivo por el que alguien se acerca
 * a un negocio nuevo, no el premio por haberse dado de alta antes.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTA GUARDIA ES DE TEXTO Y NO DE COMPORTAMIENTO
 *
 * El camino real toca Supabase, Prisma con contexto multi-empresa y sesión.
 * Montarlo entero aquí probaría sobre todo los dobles. Lo que estas pruebas
 * vigilan son las CUATRO decisiones que, si alguien las revierte sin querer,
 * devuelven exactamente el fallo original — y las tres de ellas que hacen que
 * la recompensa se pueda encontrar después de adquirirla.
 */

/**
 * SIN COMENTARIOS. Una guardia que busca texto en el código fuente encuentra
 * también el texto de los comentarios que EXPLICAN el fallo que vigila — y los
 * de aquí citan literalmente el rechazo antiguo y la condición antigua.
 *
 * Estas dos pruebas fallaron por eso la primera vez que se ejecutaron, con el
 * código ya correcto. Una guardia que se dispara sola no protege nada: se
 * silencia, y el día que el fallo vuelva de verdad ya no la está mirando nadie.
 */
const leer = (p: string) =>
  readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const PAGINA_PROMO = 'src/app/(cliente)/cliente/promociones/[id]/page.tsx'
const ACCIONES = 'src/modules/promociones/compraActions.ts'
const AFILIACION = 'src/modules/cliente/afiliacion.ts'
const MIS_BENEFICIOS = 'src/app/(cliente)/cliente/mis-promociones/page.tsx'
const DETALLE_COMPRA = 'src/app/(cliente)/cliente/mis-promociones/[id]/page.tsx'
const AGENDAR = 'src/app/(cliente)/cliente/mis-promociones/[id]/agendar/page.tsx'

test('la pantalla de la promoción no esconde el botón por ser de otra empresa', () => {
  const src = leer(PAGINA_PROMO)
  assert.ok(
    !/promotion\.venta && esMiEmpresa/.test(src),
    'Volvió la condición `promotion.venta && esMiEmpresa`: en una promoción de ' +
      'otro negocio el botón de adquirir desaparece y solo queda «Ver empresa».'
  )
  assert.match(
    src,
    /comprarSlot=\{\s*promotion\.venta \?/,
    'El botón debe mostrarse siempre que la promoción esté a la venta; quién ' +
      'puede adquirirla lo decide el servidor, no esta pantalla.'
  )
})

test('el servidor ya no exige pertenecer a la empresa antes de adquirir', () => {
  const src = leer(ACCIONES)
  assert.ok(
    !/primero únete a la empresa/i.test(src),
    'Volvió el rechazo «primero únete a la empresa»: eso cobra el trámite por ' +
      'adelantado justo a quien todavía no tiene motivo para pagarlo.'
  )
  assert.match(
    src,
    /asegurarClienteEnEmpresa/,
    'Adquirir en un negocio nuevo tiene que crear la ficha allí; si no, la ' +
      'compra no puede colgar de ningún cliente.'
  )
})

test('el alta crea la ficha Y el seguimiento en el mismo sitio', () => {
  const src = leer(AFILIACION)
  assert.match(
    src,
    /companyFollow\.upsert/,
    'El seguimiento se crea dentro del alta. Dejarlo en manos de cada llamador ' +
      'produce clientes con ficha y sin seguir, un estado que no significa nada ' +
      'y que deja fuera a esa persona de las notificaciones y los segmentos.'
  )
  assert.ok(
    !/auth\.admin\.updateUserById/.test(src),
    'El alta por recompensa NO debe cambiar la empresa activa de la sesión: ' +
      'reclamar unos tacos no es pedir mudarse de negocio.'
  )
})

test('promoción privada: se comprueba la membresía ANTES de crear la ficha', () => {
  const src = leer(ACCIONES)
  const iPrivada = src.indexOf("promo.visibilidad === 'privada'")
  const iAlta = src.indexOf('const ficha = await fichaParaAdquirir')
  assert.ok(iPrivada > 0 && iAlta > 0, 'No se encontraron ambos bloques.')
  assert.ok(
    iPrivada < iAlta,
    'La comprobación de promoción privada quedó DESPUÉS del alta. Así se afilia ' +
      'a la persona a un negocio del que se va con un «es exclusiva para ' +
      'miembros» — y siguiéndolo, además.'
  )
})

test('ventana de adquisición: tampoco se afilia a nadie para nada', () => {
  const src = leer(ACCIONES)
  const iVentana = src.indexOf('validarVentanaAdquisicion(promo)')
  const iAlta = src.indexOf('const ficha = await fichaParaAdquirir')
  assert.ok(
    iVentana > 0 && iVentana < iAlta,
    'La ventana y el cupo se validan antes del alta: una promoción agotada no ' +
      'debe dejar a nadie dado de alta en una empresa de la que no se lleva nada.'
  )
})

test('lo adquirido en otra empresa se puede encontrar después', () => {
  // Las tres pantallas del camino que sigue el cliente al adquirir. Si
  // cualquiera vuelve a mirar solo la ficha activa, la recompensa se cobra y
  // desaparece: en el listado no sale, y el detalle —adonde redirige el propio
  // botón— da 404.
  for (const [ruta, que] of [
    [MIS_BENEFICIOS, 'el listado de beneficios'],
    [DETALLE_COMPRA, 'el detalle de la compra'],
    [AGENDAR, 'el paso de agendar'],
  ] as const) {
    const src = leer(ruta)
    assert.match(
      src,
      /misClienteIds/,
      `${que} debe mirar TODAS las fichas de la persona (misClienteIds).`
    )
    assert.ok(
      !/compra\.clienteId !== user\.metadata\.clienteId/.test(src),
      `${que} volvió a comparar con la ficha activa: una recompensa de otro ` +
        'negocio deja de ser suya y desaparece.'
    )
  }
})

test('las comprobaciones de propiedad de una compra son por persona', () => {
  const src = leer(ACCIONES)
  assert.ok(
    !/compra\.clienteId !== user\.metadata\.clienteId/.test(src),
    'Pagar o cancelar una recompensa de otro negocio devolvería «No autorizado» ' +
      'a su dueña legítima. La pertenencia es de la persona, no de la ficha activa.'
  )
  assert.match(src, /esMiCompra\(user\.supabaseId/, 'Debe usarse la comprobación por persona.')
})
