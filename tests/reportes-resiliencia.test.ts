import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sinComentarios } from '../scripts/nucleo-sin-verticales.mjs'

/**
 * REPORTES NO SE PUEDE CAER ENTERO POR UN DATO QUE NO SE PUDO LEER.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DE DÓNDE SALE ESTO
 *
 * `/admin/reportes` estuvo días cayéndose en producción con «No se pudo cargar
 * esta sección» y un número distinto cada vez —3403005817, 1087123417,
 * 2878041529—. Ese número es el `digest` de Next: un hash del mensaje MÁS el
 * stack, así que cambia en cada despliegue aunque el error sea el mismo, y no
 * se puede invertir. No dice absolutamente nada.
 *
 * Mientras tanto se descartaron tres hipótesis a ciegas, y cada descarte costó
 * un viaje de ida y vuelta con el dueño de la plataforma delante de una
 * pantalla rota. El problema de fondo no era ninguna de ellas: era que la
 * pantalla no tenía forma de decir qué le pasaba.
 *
 * Estas guardias vigilan las dos piezas que cambian eso, y las vigilan por su
 * CAUSA —leyendo el código— porque ninguna se puede probar de otra forma sin
 * una base de datos que falle a propósito.
 */

const RAIZ = join(import.meta.dirname, '..')

/** Código, sin lo que explica el código. Ver `sinComentarios`. */
const codigoDe = (p: string): string => sinComentarios(readFileSync(join(RAIZ, p), 'utf8'))

/**
 * Código sin comentarios Y SIN CADENAS DE TEXTO.
 *
 * Hace falta porque la primera versión de la última guardia pasaba sin deber:
 * buscaba `getReporte` en la sonda y lo encontraba… dentro de la ETIQUETA del
 * paso («7 · getReporte (13 consultas…)»). Quitar la llamada de verdad no
 * rompía nada, que es exactamente la clase de guardia que no sirve para nada.
 *
 * Se quitan las cadenas con comillas simples y dobles, que es donde viven las
 * etiquetas. Las plantillas con acento grave se dejan: llevan código dentro de
 * `${…}` y recortarlas escondería llamadas reales.
 */
const soloCodigo = (p: string): string =>
  codigoDe(p)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')

/**
 * LA TRANSACCIÓN VA ENVUELTA IGUAL QUE SUS CONSULTAS.
 *
 * Las trece consultas del resumen van cada una dentro de `seguro()`: si una
 * revienta, el reporte sale con el resto y marca `incompleto`. El envoltorio
 * quedaba fuera, y `conEmpresa` abre una transacción interactiva que lanza
 * `P2028` cuando no consigue conexión a tiempo — por encima de los trece
 * `seguro()`, que ni llegan a ejecutarse.
 *
 * `lib/tenant.ts` documenta ese incidente y describe el síntoma con las mismas
 * palabras que vio el usuario. Reportes es la pantalla más cara del panel, o
 * sea la primera candidata a agotar el presupuesto de la transacción.
 */
test('getReporte envuelve su transacción en seguro, no solo sus consultas', () => {
  const src = codigoDe('src/modules/reportes/queries.ts')
  const i = src.indexOf('export async function getReporte')
  assert.notEqual(i, -1, 'no se encontró getReporte')
  const cuerpo = src.slice(i, i + 4000)

  assert.match(
    cuerpo,
    /await\s+seguro\(\s*\n?\s*conEmpresa\(/,
    'la transacción del resumen no está envuelta: un P2028 tumbaría la pantalla entera'
  )
})

/**
 * Y que la degradación siga siendo VISIBLE. Un reporte vacío que no avisa de
 * que está vacío es peor que el error: afirma que el negocio no facturó nada.
 * El respaldo suma a `fallos`, que es lo que enciende `incompleto`, y la vista
 * lo anuncia.
 */
test('el respaldo del resumen marca el reporte como incompleto', () => {
  const src = codigoDe('src/modules/reportes/queries.ts')
  assert.match(src, /incompleto:\s*fallos\.n\s*>\s*0/, 'incompleto ya no sale del contador de fallos')
  assert.match(
    codigoDe('src/components/reportes/ReporteEmpresaVista.tsx'),
    /r\.incompleto\s*&&/,
    'la vista dejó de anunciar que el reporte está incompleto'
  )
})

/**
 * LA SONDA, Y QUIÉN PUEDE MIRARLA.
 *
 * Devuelve mensajes de error del servidor sin recortar —es justo para lo que
 * existe— y eso no es para el equipo de mostrador. Misma barrera que la sonda
 * de pagos: `FULL_ADMIN_ROLES`, y la comprobación ANTES de tocar nada.
 */
test('la sonda de reportes existe y está limitada a administración', () => {
  const src = codigoDe('src/app/api/reportes/diagnostico/route.ts')
  const rol = src.indexOf('FULL_ADMIN_ROLES')
  const primerPaso = src.indexOf('medir(')
  assert.notEqual(rol, -1, 'la sonda no comprueba el rol')
  assert.notEqual(primerPaso, -1, 'la sonda no mide ningún paso')
  assert.ok(rol < primerPaso, 'la comprobación de rol tiene que ir ANTES de consultar nada')
  assert.match(src, /getUser\(\)/, 'la sonda no exige sesión')
})

/**
 * LA SONDA RECORRE LOS MISMOS PASOS QUE LA PÁGINA.
 *
 * Una sonda que mide otra cosa que la pantalla es peor que ninguna: da un
 * veredicto verde sobre un camino que nadie recorre. Se comprueba que toca las
 * mismas funciones que el índice de Reportes — si mañana la página añade un
 * paso y la sonda no, esto no lo ve, pero sí ve el caso que importa: que
 * alguien quite de la sonda algo que la página sigue haciendo.
 */
test('la sonda llama a lo mismo que la pantalla de reportes', () => {
  const pagina = soloCodigo('src/app/(admin)/admin/reportes/page.tsx')
  const sonda = soloCodigo('src/app/api/reportes/diagnostico/route.ts')
  for (const paso of [
    'zonaSegura',
    'leerRango',
    'getRegionalPrefs',
    'puedeFuncion',
    'getReporte',
    'misPreferenciasReportes',
  ]) {
    // `nombre(` — una LLAMADA, no una mención.
    const llamada = new RegExp(`\\b${paso}\\s*\\(`)
    assert.match(pagina, llamada, `la página ya no llama a ${paso}`)
    assert.match(sonda, llamada, `la sonda no mide ${paso}, que la página sí hace`)
  }
})
