import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { sinComentarios } from '../scripts/nucleo-sin-verticales.mjs'

/**
 * EL STOCK DE UNA PROMOCIÓN NO SE PUEDE REGALAR POR LA PUERTA DE ATRÁS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ SE ENCONTRÓ AUDITANDO
 *
 * `maxCanjes` FUNCIONABA: `activarCompraPromocion` descuenta el cupo de forma
 * atómica en la transición a `ACTIVA`, y las cinco vías de activación —panel,
 * caja, campañas, compra del cliente y confirmación de pago— pasan todas por
 * ahí. Comprobado contra base real: con stock 3 y diez consumos SIMULTÁNEOS,
 * exactamente tres pasan.
 *
 * Lo que no pasaba por ahí era el Growth Engine: creaba la compra directamente
 * en `ACTIVA` y su propio comentario decía «sin pago ni consumo de cupo». Una
 * promoción con stock 100 podía repartir 150.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTA GUARDIA MIRA LAS ESCRITURAS Y NO EL CONTADOR
 *
 * El fallo no fue que el descuento estuviera mal: fue que apareció una vía
 * NUEVA de entregar la promoción que no lo llamaba. Probar que
 * `consumirCupoPromocion` cuenta bien no habría avisado de nada — y la próxima
 * vía tampoco avisará, salvo que alguien esté mirando las escrituras.
 */

const RAIZ = join(import.meta.dirname, '..')

function archivosDe(dir: string): string[] {
  const acc: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) acc.push(...archivosDe(p))
    else if (p.endsWith('.ts')) acc.push(p)
  }
  return acc
}

/** Código, sin lo que explica el código. Ver `sinComentarios`. */
const codigoDe = (p: string): string => sinComentarios(readFileSync(p, 'utf8'))

/**
 * LA EXCEPCIÓN, NOMBRADA Y CON MOTIVO.
 *
 * El regalo P2P crea una compra ESPEJO para el destinatario. Esa unidad ya la
 * descontó la compra de origen: es una transferencia entre dos personas, no una
 * segunda venta, y cobrarle stock otra vez contaría dos veces lo mismo.
 *
 * Va como lista y no como un `if` suelto para que añadir una excepción cueste
 * escribir por qué.
 */
const EXCEPCIONES: Record<string, string> = {
  'src/modules/regalos/actions.ts':
    'compra espejo de un regalo P2P: la unidad la descontó la compra de origen',
}

/**
 * Los `data: { … }` de cada `productoCompra.create(` del archivo.
 *
 * Se mira el BLOQUE y no el archivo entero: la primera versión de esta guardia
 * señaló `compraActions.ts`, que crea la compra en `SOLICITADA` y la activa por
 * la vía buena — el `estado: 'ACTIVA'` que encontraba estaba treinta líneas
 * antes, dentro del `where` de una consulta de membresía. Una guardia que grita
 * donde no hay nada enseña a ignorarla.
 */
function bloquesDeCreacion(src: string): string[] {
  const bloques: string[] = []
  const marca = 'productoCompra.create('
  let i = src.indexOf(marca)
  while (i !== -1) {
    const siguiente = src.indexOf(marca, i + 1)
    bloques.push(src.slice(i, siguiente === -1 ? src.length : siguiente))
    i = siguiente
  }
  return bloques
}

test('toda vía que entrega una promoción activa descuenta del stock', () => {
  const sospechosos: string[] = []
  for (const p of archivosDe(join(RAIZ, 'src/modules'))) {
    const src = codigoDe(p)
    // Una escritura que crea la compra YA ENTREGADA, de una promoción.
    const entrega = bloquesDeCreacion(src).some(
      (b) => /estado:\s*'ACTIVA'/.test(b) && /promocionId/.test(b)
    )
    if (!entrega) continue

    const rel = p.slice(RAIZ.length + 1)
    if (rel in EXCEPCIONES) continue
    // Dos formas legítimas: descontar aquí, o entregar por `activarCompraPromocion`,
    // que descuenta por dentro.
    if (!/consumirCupoPromocion\(|activarCompraPromocion\(/.test(src)) sospechosos.push(rel)
  }

  assert.deepEqual(
    sospechosos,
    [],
    'entrega una promoción en ACTIVA sin llamar a consumirCupoPromocion: el stock se reparte por la puerta de atrás.\n' +
      sospechosos.join('\n')
  )
})

/**
 * Y que las excepciones sigan siendo reales. Una lista de excepciones que
 * sobrevive al archivo que excusaba es una puerta abierta con la llave puesta.
 */
test('cada excepción del stock apunta a un archivo que existe y sigue entregando', () => {
  for (const [rel, motivo] of Object.entries(EXCEPCIONES)) {
    assert.ok(motivo.length > 20, `la excepción de ${rel} no explica nada`)
    const src = codigoDe(join(RAIZ, rel))
    assert.match(src, /productoCompra\.create\(/, `${rel} ya no crea compras: sobra la excepción`)
  }
})

/**
 * UNA SOLA DEFINICIÓN DEL DESCUENTO.
 *
 * La consulta vivía dentro de `activacionCompra.ts`. Al aparecer el segundo
 * sitio que la necesita, copiarla habría dejado dos guards de concurrencia que
 * hay que arreglar en dos sitios — y solo se arregla uno.
 */
test('el descuento de stock se escribe en un solo sitio', () => {
  const copias = archivosDe(join(RAIZ, 'src'))
    .filter((p) => /"canjes"\s*=\s*"canjes"\s*\+\s*1|canjes:\s*\{\s*increment/.test(codigoDe(p)))
    .map((p) => p.slice(RAIZ.length + 1))
  assert.deepEqual(copias, ['src/modules/promociones/cupo.ts'])
})

/**
 * EL GUARD DE CONCURRENCIA, INTACTO.
 *
 * Sin el `WHERE … < "maxCanjes"` el `UPDATE` siempre escribe y la función
 * siempre dice que sí: el cupo deja de existir sin que nada falle. Y sin el
 * `RETURNING` no hay forma de saber si escribió, que es lo único que se mira.
 */
test('el descuento decide y escribe en la misma operación', () => {
  const src = codigoDe(join(RAIZ, 'src/modules/promociones/cupo.ts'))
  assert.match(src, /UPDATE "promociones" SET "canjes" = "canjes" \+ 1/)
  assert.match(src, /"canjes"\s*<\s*"maxCanjes"/, 'falta el guard: el UPDATE escribiría siempre')
  assert.match(src, /RETURNING "id"/, 'sin RETURNING no se sabe si descontó')
  assert.match(src, /"maxCanjes" IS NULL/, 'sin esto, una promoción ilimitada no entregaría nada')
})
