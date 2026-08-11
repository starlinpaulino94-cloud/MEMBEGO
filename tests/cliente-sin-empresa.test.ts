import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * UN CLIENTE PUEDE EXISTIR SIN NINGUNA EMPRESA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE PASABA ANTES
 *
 * No podía. `repararContextoCliente` le creaba una ficha de `Cliente` en
 * `getEmpresaPrincipal()` a cualquiera que entrara sin contexto, le hacía
 * seguir a esa empresa y le daba su regalo de bienvenida.
 *
 * Sostenía el modo MARCA ÚNICA —con una sola empresa publicada, «tu cuenta de
 * Membego» y «tu ficha en esa empresa» son lo mismo—, así que no se notaba.
 * Con dos empresas deja de ser invisible y pasa a ser un error: alguien se
 * registra en Membego y aparece como cliente de un restaurante que no conoce.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESO DESTAPÓ
 *
 * Dieciocho pantallas del cliente leen `metadata.clienteId`. ONCE no
 * comprobaban que pudiera ser nulo —nunca lo era—. De las siete que sí, tres
 * respondían «Tu cuenta no está completamente configurada. Contacta al
 * soporte»: un mensaje escrito para una sesión ROTA, servido a alguien que
 * acaba de registrarse y no ha hecho nada mal.
 *
 * Estas guardias vigilan las dos mitades: que no vuelva la afiliación
 * automática, y que ninguna pantalla se quede sin manejar el caso.
 */

const leer = (p: string) =>
  readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

function paginas(dir: string): string[] {
  const acc: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) acc.push(...paginas(p))
    else if (e === 'page.tsx') acc.push(p)
  }
  return acc
}

const PAGINAS_CLIENTE = paginas('src/app/(cliente)')
const REPARACION = 'src/lib/auth/reparar-contexto.ts'

test('entrar sin contexto NO afilia a nadie a ninguna empresa', () => {
  const src = leer(REPARACION)
  assert.ok(
    !/tx\.cliente\s*\n?\s*\.create|tx\.cliente\.create/.test(src),
    'Volvió el alta automática: quien crea su cuenta de Membego aparecería como ' +
      'cliente de un negocio que no ha elegido, siguiéndolo y con un regalo suyo. ' +
      'La relación comercial se la inventaría el sistema.'
  )
  assert.ok(
    !/getEmpresaPrincipal/.test(src),
    'La reparación no debe resolver «la empresa principal» para meter ahí a nadie.'
  )
})

test('la bienvenida de la empresa no se perdió: se movió al alta real', () => {
  const alta = leer('src/modules/cliente/afiliacion.ts')
  assert.match(
    alta,
    /otorgarBienvenidaDirecta/,
    'El regalo de bienvenida tiene que entregarse cuando la persona se hace ' +
      'cliente de la empresa DE VERDAD (reclamar, afiliarse, comprar). Quitarlo ' +
      'del registro sin ponerlo aquí sería perder una regla comercial, no ' +
      'moverla.'
  )
})

/**
 * LO QUE AQUÍ *NO* SE VIGILA, Y POR QUÉ.
 *
 * Había una prueba que recorría las pantallas buscando usos de
 * `metadata.clienteId` sin comprobación de nulo. Se escribió TRES veces y las
 * tres marcó como descuidadas pantallas que estaban bien: una caía en
 * `notFound()`, otra encadenaba `&&` con la ficha al final, y la tercera usaba
 * la ficha dentro de un `if` que la había estrechado cuatro líneas antes.
 *
 * El error era de herramienta. `SessionUser['metadata']['clienteId']` ya está
 * declarado `string | null | undefined` en `src/types/index.ts`, así que
 * **TypeScript ya lo garantiza**: si una pantalla usara la ficha donde hace
 * falta un `string`, `tsc --noEmit` fallaría. Que pase es la prueba, y es más
 * fuerte que cualquier expresión regular — entiende el flujo, y un regex no.
 *
 * Lo que sí vigilan las pruebas de este archivo es lo que el compilador NO
 * puede saber: que no vuelva la afiliación automática, que la bienvenida no se
 * haya perdido por el camino, y que a nadie se le diga que su cuenta está rota
 * por acabar de registrarse.
 */

test('nadie le dice a un usuario nuevo que su cuenta está rota', () => {
  // El mensaje existía para una sesión corrupta. Servido a quien acaba de
  // crear su cuenta, lo manda a resolver un problema que no tiene — y a
  // molestar a soporte por funcionar correctamente.
  const culpables: string[] = []
  for (const p of PAGINAS_CLIENTE) {
    const src = leer(p)
    if (/no está completamente configurada|contacta al soporte/i.test(src)) {
      culpables.push(p.replace('src/app/(cliente)', ''))
    }
  }
  assert.deepEqual(
    culpables,
    [],
    'Volvió «tu cuenta no está completamente configurada»:\n  ' + culpables.join('\n  ')
  )
})

test('el estado vacío ofrece a dónde ir', () => {
  const src = leer('src/components/cliente/SinEmpresaTodavia.tsx')
  // Un estado vacío sin salida es una pantalla en blanco con mejor tipografía.
  // El § 13 del encargo lo dice: «un usuario nuevo nunca debería encontrar un
  // inicio vacío».
  assert.match(src, /\/cliente\/promociones/, 'Debe llevar a ver ofertas.')
  assert.match(src, /\/cliente\/cerca/, 'Debe llevar a los negocios cercanos.')
})
