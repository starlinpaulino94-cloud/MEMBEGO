import { formatMoney, type RegionalPrefs } from '@/lib/format'

/**
 * CÓMO SE FORMATEA UNA CIFRA, COMO DATO Y NO COMO FUNCIÓN.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL FALLO QUE ESTO ARREGLA, REPRODUCIDO EN UN NEXT DE VERDAD
 *
 * Las vistas de reportes son componentes de SERVIDOR y las gráficas son de
 * CLIENTE. Entre los dos lados solo cruzan datos serializables, y a las
 * gráficas se les pasaba el formateador:
 *
 *     <GraficoTendencia formato={dinero} … />   // dinero = (n) => formatMoney(n, prefs)
 *
 * Next lo rechaza en el render, con un 500 y un digest numérico:
 *
 *     Error: Functions cannot be passed directly to Client Components unless
 *     you explicitly expose it by marking it with "use server".
 *
 * Y ahí está lo caro: ese error NO se ve en un `next build`, ni en `tsc`, ni en
 * ninguna prueba que renderice el árbol con `renderToStaticMarkup` —en React a
 * secas una función es una prop como cualquier otra y todo pasa—. Solo aparece
 * al pedir la página, y aparece como «No se pudo cargar esta sección» más un
 * número que cambia en cada despliegue. Tres digests distintos y tres
 * hipótesis descartadas a ciegas después, se reprodujo levantando un servidor
 * Next y pidiendo la ruta: HTTP 500, mensaje exacto, digest 3988668934.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN DATO Y NO LAS CIFRAS YA FORMATEADAS
 *
 * Formatear en el servidor y mandar cadenas resolvería los PUNTOS de la serie,
 * y dejaría fuera lo que de verdad importa: las marcas del eje y el tooltip los
 * calcula Recharts en el navegador, sobre valores que el servidor no ha visto
 * nunca. La gráfica necesita poder formatear números arbitrarios, así que lo
 * que cruza es la RECETA —moneda, idioma, decimales— y el formateador se
 * construye del otro lado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y EL TIPO ES LA GUARDIA
 *
 * `formato` dejó de ser `(n: number) => string` en las tres gráficas. Volver a
 * meter el fallo ya no compila: es el compilador quien lo impide, no la
 * disciplina de quien escribe la próxima pantalla.
 */
export type FormatoCifra =
  | { tipo: 'dinero'; moneda: string | null; idioma: string | null; decimales: number }
  | { tipo: 'entero'; idioma: string | null }

/** Receta de dinero con las preferencias de la empresa. */
export function formatoDinero(prefs?: RegionalPrefs | null, decimales = 0): FormatoCifra {
  return {
    tipo: 'dinero',
    moneda: prefs?.moneda ?? null,
    idioma: prefs?.idioma ?? null,
    decimales,
  }
}

/** Receta de número entero (operaciones, canjes, clientes…). */
export function formatoEntero(prefs?: RegionalPrefs | null): FormatoCifra {
  return { tipo: 'entero', idioma: prefs?.idioma ?? null }
}

/**
 * Aplica la receta.
 *
 * El dinero pasa por `formatMoney` —el mismo de toda la plataforma— para que
 * una gráfica y la tarjeta que tiene encima no puedan enseñar el mismo número
 * escrito de dos maneras. El entero replica lo que hacían las vistas, con el
 * `try` que `formatMoney` ya tenía: un idioma inválido degrada en vez de
 * lanzar, y lanzar aquí volvería a tumbar la pantalla.
 */
export function formatear(f: FormatoCifra, n: number): string {
  if (f.tipo === 'dinero') {
    return formatMoney(n, { moneda: f.moneda, idioma: f.idioma }, f.decimales)
  }
  try {
    return new Intl.NumberFormat(f.idioma || 'es-DO').format(n)
  } catch {
    return new Intl.NumberFormat('es-DO').format(n)
  }
}
