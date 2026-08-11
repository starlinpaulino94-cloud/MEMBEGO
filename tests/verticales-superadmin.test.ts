import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * ASIGNAR UN VERTICAL DESDE LA INTERFAZ — la última pieza de la Fase 7.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL TECHO QUE QUEDABA, Y POR QUÉ ERA REAL
 *
 * La Fase 1b convirtió los tipos de negocio en tabla. La Fase 7 añadió
 * `companies.tipoNegocioCodigo` y demostró —contra PostgreSQL real— que un
 * vertical que no existía en ninguna lista, `HOTEL`, se podía registrar desde
 * un manifiesto y dar de alta un huésped con cero cambios de código.
 *
 * Pero el formulario del superadmin seguía ofreciendo cinco `<SelectItem>`
 * escritos a mano. Se podía registrar el sistema del hotel y luego no había
 * forma de decirle a una empresa que ERA un hotel sin volver al script. La
 * arquitectura estaba abierta y la puerta de la interfaz, cerrada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA MITAD QUE SE OLVIDA
 *
 * Poner el `<Select>` a leer la tabla no basta. `registro.ts` resuelve el
 * vertical mirando PRIMERO `tipoNegocioCodigo`, y su propio comentario ya
 * avisaba del hueco: «creada por un camino que aún no la rellena». El
 * formulario era ese camino.
 *
 * Sin escribir la columna, elegir «Hotel» guardaba la cadena en `type` y la
 * resolución antigua la mandaba al `default: CAR_WASH`: la empresa quedaba
 * clasificada como lavadero. Exactamente el fallo que la Fase 7 encontró
 * probando contra base real, reaparecido por la puerta del formulario.
 *
 * Por eso hay dos pruebas y no una: la lectura y la ESCRITURA.
 */

const leer = (p: string) =>
  readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const CREAR = 'src/components/superadmin/EmpresaCreateForm.tsx'
const EDITAR = 'src/components/superadmin/EmpresaEditForm.tsx'
const ACCIONES = 'src/modules/empresas/actions.ts'
const VERTICALES = 'src/modules/empresas/verticales.ts'

test('ningún formulario del superadmin cablea la lista de verticales', () => {
  for (const [ruta, cual] of [
    [CREAR, 'el alta de empresa'],
    [EDITAR, 'la edición de empresa'],
  ] as const) {
    const src = leer(ruta)
    const fijos = [...src.matchAll(/<SelectItem value="(carwash|restaurante|gimnasio|salon)"/g)]
    assert.equal(
      fijos.length,
      0,
      `${cual} volvió a escribir los verticales a mano. Con la lista fija se ` +
        'puede registrar el sistema de un hotel y no hay forma de decirle a una ' +
        'empresa que es un hotel: hay que volver al script.'
    )
    assert.match(
      src,
      /verticales\.map/,
      `${cual} debe pintar las opciones desde \`tipos_negocio\`.`
    )
  }
})

test('elegir el vertical ESCRIBE la columna que manda', () => {
  const src = leer(ACCIONES)
  // Alta y edición. Sin esto, el selector es decorativo: la empresa se sigue
  // resolviendo por `type` y cae en el `default: CAR_WASH`.
  const escrituras = [...src.matchAll(/tipoNegocioCodigo:/g)]
  assert.ok(
    escrituras.length >= 2,
    'El alta y la edición de empresa deben escribir `tipoNegocioCodigo`. ' +
      `Encontradas ${escrituras.length} escrituras. Sin ellas, elegir «Hotel» ` +
      'guarda la cadena en `type` y la empresa queda clasificada como lavadero.'
  )
  assert.match(
    src,
    /verticalValido\(/,
    'El código recibido debe validarse contra la tabla: uno inexistente dejaría ' +
      'a la empresa apuntando a un vertical que no existe, sin ningún sistema y ' +
      'sin que nada diga por qué.'
  )
})

test('leer los verticales nunca deja al superadmin sin poder crear empresas', () => {
  const src = leer(VERTICALES)
  assert.match(
    src,
    /catch/,
    '`tipos_negocio` puede no existir en una base sin migrar. Si esta consulta ' +
      'fallara sin red, el superadmin no podría crear NINGUNA empresa: una ' +
      'regresión peor que el techo que esto viene a quitar.'
  )
  assert.match(
    src,
    /filas\.length > 0 \? filas : RESPALDO/,
    'Una tabla vacía tampoco es una respuesta útil: dejaría el selector sin ' +
      'opciones y sin forma de crear una empresa.'
  )
})
