import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * LA APP DEL CLIENTE SE USA EN UN TELÉFONO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL FALLO QUE ORIGINÓ ESTAS GUARDIAS
 *
 * El shell reservaba `pb-24` —96 px escritos a ojo— para la barra inferior. La
 * barra mide 56 px MÁS `env(safe-area-inset-bottom)`, que en cualquier móvil
 * con barra de gestos son 24-48 px más. 56 + 48 = 104 > 96: la barra tapaba el
 * final de cada pantalla.
 *
 * Se vio en el detalle de una promoción, con «Ver empresa y sus planes» cortado
 * por la mitad y sin poder pulsarse. No era esa pantalla: era TODAS, porque el
 * hueco lo reserva el shell.
 *
 * Y no se veía programando, porque el navegador de escritorio no tiene área
 * segura: `env(safe-area-inset-bottom)` vale 0 y los 96 px sobraban.
 */

const limpio = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const leer = (p: string) => limpio(readFileSync(p, 'utf8'))

function tsx(dir: string): string[] {
  const acc: string[] = []
  let entradas: string[]
  try {
    entradas = readdirSync(dir)
  } catch {
    return acc
  }
  for (const e of entradas) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) acc.push(...tsx(p))
    else if (p.endsWith('.tsx')) acc.push(p)
  }
  return acc
}

/** Lo que el cliente ve en su teléfono. */
const PANTALLAS_CLIENTE = [
  'src/app/(cliente)',
  'src/components/cliente',
  'src/components/marketplace',
  'src/components/membresia',
  'src/components/qr',
  'src/components/wallet',
  'src/components/layout',
].flatMap(tsx)

test('el hueco de la barra inferior sale del alto real, no de un número a ojo', () => {
  const shell = leer('src/components/layout/AppShell.tsx')
  assert.ok(
    !/\bpb-24\b/.test(shell),
    'Volvió `pb-24`: 96 px fijos no cubren la barra (56px) más el área segura ' +
      'del móvil, y el botón principal de cada pantalla queda debajo de ella.'
  )
  assert.match(
    shell,
    /con-dock-inferior/,
    'El hueco lo reserva `.con-dock-inferior`, que suma el área segura.'
  )

  const css = readFileSync('src/app/globals.css', 'utf8')
  // La declaración entera, en una línea. Nada de `[^)]*` entre `calc(` y `env(`:
  // el valor lleva un `var(--dock-inferior)` en medio y ese paréntesis lo corta
  // — la primera versión de esta guardia falló por eso con el código ya bien.
  const decl = css.split('\n').find((l) => l.includes('--espacio-dock:'))
  assert.ok(decl, 'No se encontró la declaración de `--espacio-dock`.')
  assert.match(
    decl,
    /env\(safe-area-inset-bottom/,
    'El hueco DEBE incluir `env(safe-area-inset-bottom)`. Sin él el fallo vuelve ' +
      'entero, y solo se ve en un teléfono de verdad — nunca programando.'
  )
})

test('la barra y el hueco leen la misma variable de alto', () => {
  const nav = leer('src/components/layout/BottomNav.tsx')
  assert.match(
    nav,
    /--dock-inferior/,
    'La barra debe declarar su alto con `--dock-inferior`, la misma variable con ' +
      'la que el shell calcula el hueco. Escritos por separado ya se separaron ' +
      'una vez, y el síntoma aparece en el móvil de un cliente.'
  )
})

test('nada fijo abajo se salta el área segura', () => {
  const culpables = PANTALLAS_CLIENTE.filter((p) => {
    const s = leer(p)
    return (
      /\bfixed\b[^\n]*\bbottom-0\b/.test(s) &&
      !/safe-area-inset-bottom|espacio-dock|dock-inferior/.test(s)
    )
  })
  assert.deepEqual(
    culpables,
    [],
    'Un elemento anclado abajo sin área segura queda por debajo de la barra de ' +
      'gestos del teléfono: se ve a medias y no se puede pulsar.'
  )
})

test('ninguna rejilla del cliente reparte 3+ columnas en el teléfono', () => {
  // Sin prefijo de punto de ruptura, `grid-cols-3` también aplica a 360px de
  // ancho: cada celda se queda en ~106px y su contenido se parte en cuatro
  // líneas. Se permite `grid-cols-3` con prefijo (`sm:grid-cols-3`).
  //
  // TECHO 1: `perfil/page.tsx` reparte tres CIFRAS con su icono y una etiqueta
  // de una palabra — un resumen compacto que a 106px sigue leyéndose. Es el
  // único caso que lo aguanta, y por eso el techo es 1 y no 0.
  const TECHO = 1
  const culpables: string[] = []
  for (const p of PANTALLAS_CLIENTE) {
    for (const _ of leer(p).matchAll(/(?<![a-z]:)\bgrid-cols-([3-9]|1[0-2])\b/g)) culpables.push(p)
  }
  assert.ok(
    culpables.length <= TECHO,
    `Hay ${culpables.length} rejillas de 3+ columnas sin variante móvil y el ` +
      `techo es ${TECHO}:\n  ${culpables.join('\n  ')}`
  )
})

test('los micro-textos del cliente solo pueden bajar', () => {
  // 31 → 27 → 13. Los catorce que faltaban estaban en la tarjeta de membresía
  // y en la rejilla de planes, y se arreglaron MIRÁNDOLAS: se montó un taller
  // temporal, se renderizaron a 360px en Chromium y se midió cada texto.
  //
  // Mereció la pena: las etiquetas «DESCRIPCIÓN» y «BENEFICIOS» no solo eran
  // de 10px, es que con su `/70` de opacidad daban 3,11:1 sobre la tarjeta
  // —por debajo del 4,5:1 de AA—. Eso no sale de leer el código: el token que
  // usaban es legítimo y el número solo aparece al componer la opacidad contra
  // el fondo real. Ahora usan `.text-overline`, que es el token del sistema
  // para eso y arregla tamaño y contraste a la vez.
  //
  // Los 13 que quedan están repartidos de dos en dos por pantallas sueltas.
  const TECHO = 13
  let total = 0
  for (const p of PANTALLAS_CLIENTE) {
    total += [...leer(p).matchAll(/\btext-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/g)].length
  }
  assert.ok(
    total <= TECHO,
    `Hay ${total} textos por debajo de 12px en la app del cliente y el techo es ` +
      `${TECHO}. Es un número que solo baja: la app se usa de pie y con una mano.`
  )
})
