import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ETIQUETA_CAPACIDAD,
  ETIQUETA_ESTADO,
  ETIQUETA_ESTADO_VARIANTE,
  ETIQUETA_TIPO,
  formatearPrecio,
  urlPublicaCatalogo,
} from '../src/modules/catalog/formato'
import { CAPACIDADES_POR_TIPO, TIPOS_ITEM } from '../src/modules/catalog/domain'
import { atributosATexto, textoAAtributos } from '../src/components/catalogo/VarianteForm'

test('formatearPrecio: moneda del ítem, siempre dos decimales, sin lanzar con basura', () => {
  assert.equal(formatearPrecio('1500.5', 'DOP'), 'RD$1,500.50')
  assert.equal(formatearPrecio(0, 'DOP'), 'RD$0.00')
  assert.match(formatearPrecio(10, 'USD'), /10\.00/)
  assert.equal(formatearPrecio('x', 'DOP'), 'RD$0.00')
  assert.doesNotThrow(() => formatearPrecio(5, 'no-es-moneda'))
})

test('urlPublicaCatalogo: apunta al bucket promociones y no inventa una URL sin configuración', () => {
  assert.equal(
    urlPublicaCatalogo('emp/catalogo/it/a.jpg', 'https://x.supabase.co/'),
    'https://x.supabase.co/storage/v1/object/public/promociones/emp/catalogo/it/a.jpg'
  )

  // Sin segundo argumento, `urlPublicaCatalogo` cae a
  // `process.env.NEXT_PUBLIC_SUPABASE_URL`, y esta importación ya cargó
  // `@prisma/client` por la cadena `domain.ts` → `commerce-primitives/dinero.ts`
  // → `@prisma/client`: el cliente generado lee `.env` como efecto de
  // importarlo, así que la variable puede venir puesta aunque este archivo
  // nunca la toque. Se guarda y se limpia aquí, igual que en
  // `jwt.test.ts`/`soporte-schema.test.ts`, para que «sin configuración»
  // signifique sin configuración de verdad y no dependa de qué otro módulo se
  // haya importado antes en el mismo proceso.
  const anterior = process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  try {
    assert.equal(urlPublicaCatalogo('a.jpg', undefined), null)
  } finally {
    if (anterior === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = anterior
  }

  assert.equal(urlPublicaCatalogo('', 'https://x.supabase.co'), null)
})

test('cada tipo, estado y capacidad del dominio tiene etiqueta para la pantalla', () => {
  for (const t of TIPOS_ITEM) assert.ok(ETIQUETA_TIPO[t], `falta etiqueta de tipo ${t}`)
  for (const e of ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']) assert.ok(ETIQUETA_ESTADO[e])
  for (const e of ['ACTIVE', 'OUT_OF_STOCK', 'DISCONTINUED']) assert.ok(ETIQUETA_ESTADO_VARIANTE[e])
  assert.deepEqual(Object.keys(ETIQUETA_CAPACIDAD).sort(), Object.keys(CAPACIDADES_POR_TIPO.SERVICE).sort())
})

test('atributos: ida y vuelta entre el objeto y el texto «clave: valor»', () => {
  const a = { talla: 'M', color: 'Rojo oscuro' }
  assert.deepEqual(textoAAtributos(atributosATexto(a)), a)
  assert.deepEqual(textoAAtributos('  talla :  L  \n\nsin dos puntos\n: sinclave\nclave:\nurl: http://x.y'), { talla: 'L', url: 'http://x.y' })
  assert.deepEqual(textoAAtributos(''), {})
})
