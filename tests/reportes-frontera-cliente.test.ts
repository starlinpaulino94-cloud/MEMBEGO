import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { formatMoney } from '../src/lib/format'
import { formatear, formatoDinero, formatoEntero } from '../src/modules/reportes/formato'

/**
 * LA FRONTERA ENTRE SERVIDOR Y CLIENTE, EN REPORTES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL FALLO QUE COSTÓ TRES DÍAS
 *
 * Las vistas de reportes son componentes de SERVIDOR; las gráficas, de CLIENTE.
 * A las gráficas se les pasaba el formateador como prop:
 *
 *     <GraficoTendencia formato={dinero} … />
 *
 * Next lo rechaza al renderizar —«Functions cannot be passed directly to Client
 * Components»— con un 500 y un digest numérico. Reproducido levantando un
 * servidor Next y pidiendo la ruta: HTTP 500, digest 3988668934. Con el
 * arreglo, la misma página devuelve 200.
 *
 * LO QUE HACE ESTE FALLO TAN CARO ES DÓNDE **NO** SE VE:
 *
 *   · `tsc` no lo ve: una función es una prop válida.
 *   · `next build` no lo ve: pasa en el render, no al compilar.
 *   · El CI no lo ve: compila y no pide la página como administrador.
 *   · Una prueba que renderice el árbol con `renderToStaticMarkup` TAMPOCO lo
 *     ve — se comprobó: el árbol entero renderiza sin quejarse, porque en
 *     React a secas no existe la frontera. Esa prueba existía y daba verde.
 *
 * Solo aparece en producción, y como un número que cambia en cada despliegue.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTAS GUARDIAS Y NO UNA PRUEBA DE RENDER
 *
 * El tipo de `formato` ya impide el caso concreto: volver a pasar una función
 * no compila. Lo que el compilador NO puede impedir es la PRÓXIMA prop, en la
 * próxima gráfica. Eso es lo que vigila la guardia de abajo: ningún componente
 * de cliente de reportes declara props de función.
 */

const RAIZ = join(import.meta.dirname, '..')

function archivosDe(dir: string): string[] {
  const acc: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) acc.push(...archivosDe(p))
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) acc.push(p)
  }
  return acc
}

const DIR_REPORTES = join(RAIZ, 'src/components/reportes')

/**
 * LA GUARDIA CENTRAL.
 *
 * Una prop de función en un componente de CLIENTE de reportes solo puede
 * llegarle desde otro componente de cliente. Y en este módulo no hay ninguno
 * que los monte: los montan las vistas, que son de servidor. Así que declarar
 * una es, en la práctica, prepararle el 500 a quien la use.
 *
 * Se leen los tipos de las props, no las llamadas: el error no está en pasar la
 * función, está en haber creado una prop que invita a pasarla.
 */
test('ningún componente de cliente de reportes declara props de función', () => {
  const culpables: string[] = []
  for (const p of archivosDe(DIR_REPORTES)) {
    const src = readFileSync(p, 'utf8')
    if (!/^'use client'/.test(src)) continue
    for (const [i, linea] of src.split('\n').entries()) {
      // `nombre: (...) => ...` o `nombre?: (...) => ...` dentro de un tipo de
      // props. Se ignoran los comentarios y las funciones locales (`const`).
      if (/^\s{2,}[a-zA-Z][\w]*\??:\s*\(.*\)\s*=>/.test(linea) && !/^\s*[/*]/.test(linea)) {
        culpables.push(`${p.slice(RAIZ.length + 1)}:${i + 1}  ${linea.trim()}`)
      }
    }
  }
  assert.deepEqual(
    culpables,
    [],
    'una prop de función en un componente de cliente: si la monta una vista (servidor), Next devuelve 500 al renderizar.\n' +
      culpables.join('\n')
  )
})

/**
 * Y que las gráficas sigan recibiendo la RECETA. Sin esto, alguien podría
 * satisfacer la guardia de arriba quitando el tipo —`formato: any`— y el fallo
 * volvería sin que nada chille.
 */
test('las tres gráficas reciben FormatoCifra, no un formateador', () => {
  for (const nombre of ['GraficoTendencia', 'GraficoDistribucion', 'GraficoRanking']) {
    const src = readFileSync(join(DIR_REPORTES, 'graficos', `${nombre}.tsx`), 'utf8')
    assert.match(src, /formato:\s*FormatoCifra/, `${nombre} ya no declara formato: FormatoCifra`)
    assert.doesNotMatch(src, /formato\??:\s*\(/, `${nombre} volvió a aceptar una función`)
  }
})

// ── La receta produce exactamente lo que producían las funciones ────────────

/**
 * El arreglo no puede cambiar ni una coma de lo que ve el cliente: la gráfica y
 * la tarjeta que tiene encima enseñan el mismo número, y si se separaran nadie
 * sabría cuál creer.
 */
test('formatear(dinero) da lo mismo que formatMoney', () => {
  const prefs = { moneda: 'DOP', idioma: 'es-DO', zonaHoraria: 'America/Santo_Domingo' }
  for (const n of [0, 1, 9, 1200, 142300, -450, 1234567.89]) {
    assert.equal(formatear(formatoDinero(prefs), n), formatMoney(n, prefs))
  }
  // Con otras preferencias, y sin ninguna.
  const usd = { moneda: 'USD', idioma: 'en-US', zonaHoraria: 'UTC' }
  assert.equal(formatear(formatoDinero(usd), 1200), formatMoney(1200, usd))
  assert.equal(formatear(formatoDinero(null), 1200), formatMoney(1200, null))
  assert.equal(formatear(formatoDinero(prefs, 2), 0.4), formatMoney(0.4, prefs, 2))
})

test('formatear(entero) da lo mismo que el Intl que había en las vistas', () => {
  const prefs = { moneda: 'DOP', idioma: 'es-DO', zonaHoraria: 'America/Santo_Domingo' }
  for (const n of [0, 7, 214, 15000]) {
    assert.equal(formatear(formatoEntero(prefs), n), new Intl.NumberFormat('es-DO').format(n))
    // Tres vistas lo tenían con 'es-DO' escrito a mano: `null` reproduce eso.
    assert.equal(formatear(formatoEntero(null), n), new Intl.NumberFormat('es-DO').format(n))
  }
})

/**
 * Un idioma inválido no puede lanzar. `Intl` lanza ante lo que no reconoce, y
 * esto corre DENTRO de la gráfica, o sea dentro del render: la misma clase de
 * fallo que se acaba de arreglar, por otra puerta.
 */
test('un idioma inválido degrada en vez de lanzar', () => {
  for (const idioma of ['no-existe-esto', '', '???']) {
    assert.doesNotThrow(() => formatear({ tipo: 'entero', idioma }, 1200))
    assert.doesNotThrow(() => formatear({ tipo: 'dinero', idioma, moneda: 'DOP', decimales: 0 }, 1200))
  }
})
