import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * GUARDIA DE LAS SUPERFICIES DE UN SOLO TEMA (`.theme-landing`).
 *
 * La landing pública y la superficie de autenticación son claras SIEMPRE,
 * aunque la persona tenga la aplicación en modo oscuro. Eso se consigue con
 * un bloque `.theme-landing` en un <div>, que gana sobre `:root`.
 *
 * EL FALLO QUE ESTO EVITA, Y POR QUÉ NO SE VE VENIR:
 *
 * Las variables CSS se resuelven en el ancestro MÁS CERCANO que las declare.
 * Con la app en oscuro, `.dark` vive en <html> y `.theme-landing` en un <div>
 * de dentro. Cualquier token que `.dark` declare y `.theme-landing` NO, se lee
 * del bloque oscuro — y aterriza en una página clara.
 *
 * No da error, no rompe el build y no se ve en modo claro, que es como se
 * revisa una pantalla de registro el 95% de las veces. Se ve cuando alguien
 * con el tema oscuro puesto abre el registro y encuentra un esqueleto de carga
 * casi negro dentro de una tarjeta blanca.
 *
 * La regla es simple: `.theme-landing` cubre todo lo que cubre `.dark`.
 */

const CSS = readFileSync('src/app/globals.css', 'utf8')

function variablesDe(selector: string): Set<string> {
  const bloque = new RegExp(`^${selector.replace('.', '\\.')}\\s*\\{(.*?)^\\}`, 'sm')
  const m = CSS.match(bloque)
  assert.ok(m, `no se encontró el bloque ${selector} en globals.css`)
  return new Set([...m[1].matchAll(/(--[a-z0-9-]+)\s*:/g)].map((x) => x[1]))
}

test('.theme-landing cubre todo lo que redefine .dark', () => {
  const dark = variablesDe('.dark')
  const landing = variablesDe('.theme-landing')
  const filtradas = [...dark].filter((v) => !landing.has(v)).sort()

  assert.deepEqual(
    filtradas,
    [],
    'Estos tokens se declaran en .dark pero no en .theme-landing, así que en ' +
      'modo oscuro se colarían en una superficie clara:\n  ' +
      filtradas.join('\n  ')
  )
})

test(':root define todo lo que define .dark', () => {
  // El otro lado del mismo contrato: un token que solo exista en oscuro no
  // tiene valor en claro y cae a `unset`.
  const root = variablesDe(':root')
  const dark = variablesDe('.dark')
  const huerfanas = [...dark].filter((v) => !root.has(v)).sort()

  assert.deepEqual(
    huerfanas,
    [],
    `Tokens definidos solo en .dark: ${huerfanas.join(', ')}`
  )
})

test('la marca es azul, no verde', () => {
  // El matiz 150 es esmeralda; el 255, azul. Antes de la Fase 0 la aplicación
  // era verde y la documentación decía que era azul. Esta prueba impide que
  // vuelva a divergir en silencio.
  // `[\s\S]` en vez de la bandera `s`: el `target` del proyecto es anterior a
  // es2018 y tsc rechaza la bandera en un literal.
  const m = CSS.match(/^:root\s*\{([\s\S]*?)^\}/m)
  assert.ok(m)
  const primary = m[1].match(/--primary:\s*oklch\([\d.]+\s+[\d.]+\s+([\d.]+)\)/)
  assert.ok(primary, 'no se pudo leer --primary de :root')
  const matiz = Number(primary[1])
  assert.ok(
    matiz > 220 && matiz < 290,
    `--primary tiene matiz ${matiz}; se espera azul (220–290). El verde de marca ` +
      'se retiró en la Fase 0: el verde solo sobrevive como --success.'
  )
})
