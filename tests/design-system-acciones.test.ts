import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ACCIONES QUE PREGUNTAN ANTES — que se escriban una vez.
 *
 * El design system ya traía `ConfirmDialog` y `DeleteButton`, y aun así ocho
 * pantallas escribieron su propia versión de la misma danza: `useRef` al
 * formulario, `useState` del diálogo, `useActionState`, `useEffect` con los dos
 * toasts, y el `setOpen(false)` + `requestSubmit()`.
 *
 * Y las diferencias entre copias eran ACCIDENTALES, que es lo que de verdad
 * costaba: unas deshabilitaban el botón mientras la acción corría y otras no
 * —así que en unas se podía disparar dos veces—, y unas marcaban la acción como
 * peligrosa y otras no para acciones igual de destructivas.
 */

const leer = (...p: string[]) => readFileSync(join(...p), 'utf8')

/** Los comentarios citan el código viejo para explicar qué se corrigió. */
const sinComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:\/\/|\*).*$/gm, '')

const BOTON = leer('packages', 'ui', 'src', 'ui', 'boton-confirmado.tsx')

/** Todos los `.ts`/`.tsx` de una carpeta. */
function fuentes(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada)
    if (statSync(ruta).isDirectory()) fuentes(ruta, acc)
    else if (/\.tsx?$/.test(ruta) && !ruta.endsWith('.d.ts')) acc.push(ruta)
  }
  return acc
}

/**
 * Quién puede usar `ConfirmDialog` suelto, y por qué.
 *
 * Los tres tienen una forma que `BotonConfirmado` NO cubre, y forzarlos dentro
 * sería peor que la repetición: el componente crecería props para casos que no
 * comparten nada más.
 */
const PUEDEN_USARLO = new Map<string, string>([
  [
    'src/components/capacidades/CapacidadesPanel.tsx',
    'intercepta el envío de un formulario grande que ya existe, y solo pregunta ' +
      'si de verdad se está apagando una sección encendida',
  ],
  [
    'src/components/superadmin/SistemaConectadoCard.tsx',
    'mismo caso: intercepta el envío de uno de los tres formularios de la tarjeta',
  ],
  [
    'src/components/superadmin/CampanaGlobalAcciones.tsx',
    'dos diálogos sobre llamadas directas con `useTransition`, sin formulario',
  ],
])

test('nadie vuelve a escribir a mano el botón que confirma', () => {
  /**
   * La firma de la copia: `ConfirmDialog` + `requestSubmit()`. Es la danza
   * exacta que `BotonConfirmado` encapsula.
   */
  const infractores = fuentes('src')
    .map((f) => f.replaceAll('\\', '/'))
    .filter((f) => !PUEDEN_USARLO.has(f))
    .filter((f) => {
      const src = sinComentarios(readFileSync(f, 'utf8'))
      return /<ConfirmDialog/.test(src) && /requestSubmit\(\)/.test(src)
    })

  assert.deepEqual(
    infractores,
    [],
    'usa `BotonConfirmado` (@/components/ui/boton-confirmado), o declara aquí la ' +
      'excepción con su motivo:\n' + infractores.join('\n')
  )
})

test('las excepciones declaradas siguen existiendo y siguen siendo excepciones', () => {
  // Una exención que sobra es tan mala como una que falta: deja de proteger y
  // nadie se entera de que ya se podía migrar.
  for (const [ruta, motivo] of PUEDEN_USARLO) {
    const src = sinComentarios(readFileSync(ruta, 'utf8'))
    assert.ok(/<ConfirmDialog/.test(src), `${ruta} ya no usa ConfirmDialog: borra la exención (${motivo})`)
  }
})

test('el botón no se puede pulsar dos veces', () => {
  // Era un fallo real en varias de las copias: sin deshabilitar mientras la
  // acción corre, dos clics seguidos la disparan dos veces. En «aprobar un
  // pago» eso no es cosmético.
  assert.match(sinComentarios(BOTON), /disabled=\{deshabilitado \|\| pendiente\}/)
})

test('un fallo nunca pasa en silencio', () => {
  const src = sinComentarios(BOTON)
  assert.match(src, /if \(estado\.error\) \{\s*toast\.error\(estado\.error\)/)
  // `alFallar` se SUMA al toast, no lo sustituye: si lo sustituyera, quien lo
  // use para navegar dejaría de contar por qué falló.
  const bloque = src.slice(src.indexOf('if (estado.error)'), src.indexOf('if (!estado.success)'))
  assert.match(bloque, /alFallar\?\.\(estado\)/)
})

test('sin confirmación es un envío normal, no un botón que no envía', () => {
  /**
   * Importa para que funcione sin JavaScript: con `type="submit"` el navegador
   * envía el formulario por su cuenta. Solo se pasa a `button` cuando hay que
   * interceptar para preguntar.
   */
  assert.match(sinComentarios(BOTON), /type=\{confirmacion \? 'button' : 'submit'\}/)
})

test('el diálogo se cierra ANTES de enviar', () => {
  // `requestSubmit()` dispara el `submit` de forma síncrona: cerrar después
  // dejaría el diálogo encima de la acción ya en marcha.
  const src = sinComentarios(BOTON)
  const orden = src.slice(src.indexOf('onConfirm={'), src.indexOf('onCancel='))
  assert.ok(
    orden.indexOf('setAbierto(false)') < orden.indexOf('requestSubmit()'),
    'se cierra después de enviar'
  )
})

test('la variante y el tamaño se toman del propio Button', () => {
  // Repetir la lista a mano la deja vieja en cuanto alguien añade un tamaño, y
  // el error aparece en el sitio equivocado.
  const src = sinComentarios(BOTON)
  assert.match(src, /variant\?: React\.ComponentProps<typeof Button>\['variant'\]/)
  assert.match(src, /size\?: React\.ComponentProps<typeof Button>\['size'\]/)
})

test('las seis pantallas migradas usan el componente', () => {
  const MIGRADAS = [
    join('src', 'components', 'admin', 'EjecutarAutomatizaciones.tsx'),
    join('src', 'components', 'admin', 'PromoControls.tsx'),
    join('src', 'components', 'admin', 'ValidarPagoActions.tsx'),
    join('src', 'components', 'admin', 'MembershipAdminActions.tsx'),
    join('src', 'components', 'admin', 'EstrategiaAcciones.tsx'),
    join('src', 'components', 'cliente', 'ComprarPromoButton.tsx'),
  ]
  for (const ruta of MIGRADAS) {
    const src = readFileSync(ruta, 'utf8')
    assert.match(src, /BotonConfirmado/, `${ruta} volvió a hacerlo a mano`)
    assert.ok(
      !/useRef<HTMLFormElement>/.test(sinComentarios(src)),
      `${ruta} conserva el ref al formulario: eso lo lleva BotonConfirmado`
    )
  }
})

test('archivar una promoción pregunta; pausarla y duplicarla no', () => {
  /**
   * Preguntar por todo convierte el aviso en un paso que se despacha con Enter
   * sin leerlo, y entonces tampoco protege el que sí importa. Pausar y duplicar
   * se deshacen con otro clic; archivar saca la promoción de todos los
   * listados.
   */
  const src = sinComentarios(leer('src', 'components', 'admin', 'PromoControls.tsx'))
  assert.equal([...src.matchAll(/confirmacion=/g)].length, 1)
  assert.match(src, /archivada\s*\?\s*undefined/, 'restaurar tampoco debería preguntar')
})

test('cancelar una membresía se marca como peligrosa; desactivarla no', () => {
  // Cancelar no se deshace. Desactivar deja la membresía vencida y se puede
  // renovar: teñir las dos de rojo borra la diferencia.
  const src = sinComentarios(leer('src', 'components', 'admin', 'MembershipAdminActions.tsx'))
  const cancelar = src.slice(src.indexOf('accion={cancelarMembresia}'))
  const desactivar = src.slice(
    src.indexOf('accion={desactivarMembresia}'),
    src.indexOf('accion={cancelarMembresia}')
  )
  assert.match(cancelar, /peligrosa: true/)
  assert.ok(!/peligrosa/.test(desactivar), 'desactivar no es irreversible')
})

// ───────────── Exportar: quince copias, una sola forma ─────────────

const EXPORTAR = leer('packages', 'ui', 'src', 'ui', 'boton-exportar.tsx')

test('exportar es un ancla, no un Link de Next', () => {
  /**
   * Tres de las quince usaban `<Link>`, y otras tres ya llevaban
   * `prefetch={false}` encima — señal de que alguien tropezó con esto y lo
   * parcheó en su pantalla en vez de arreglar el patrón.
   *
   * Un `<Link>` es para navegar DENTRO de la aplicación. Una ruta de
   * exportación devuelve un archivo con `Content-Disposition: attachment`: no
   * hay nada que el router pueda renderizar.
   */
  assert.match(EXPORTAR, /<a href=\{href\}>/)
  assert.ok(!/from 'next\/link'/.test(EXPORTAR))
})

test('nadie vuelve a escribir a mano el botón de exportar', () => {
  const infractores = fuentes(join('src', 'app'))
    .filter((f) => {
      const src = sinComentarios(readFileSync(f, 'utf8'))
      // La firma de la copia: el icono de descarga junto a una ruta de
      // exportación. El componente ya no necesita que nadie importe el icono.
      return /<Download/.test(src) && /(export|exportar)/.test(src)
    })
    .map((f) => f.replaceAll('\\', '/'))

  assert.deepEqual(
    infractores,
    [],
    'usa `BotonExportar` (@/components/ui/boton-exportar):\n' + infractores.join('\n')
  )
})

test('las quince pantallas dicen lo mismo', () => {
  // Decían «CSV» en dos y «Exportar» o «Exportar CSV» en el resto, con tres
  // variantes de botón y dos tamaños de icono. La misma acción tiene que
  // reconocerse de una pantalla a otra.
  assert.match(EXPORTAR, /label = 'Exportar CSV'/)
  const usos = fuentes(join('src', 'app')).filter((f) =>
    /<BotonExportar/.test(readFileSync(f, 'utf8'))
  )
  assert.ok(usos.length >= 15, `solo ${usos.length} pantallas lo usan; eran quince`)
})
