/**
 * LA FORMA DE UNA CIFRA, DENTRO DE SU TARJETA.
 *
 * SVG a mano y NO Recharts, a propósito: aquí no hace falta interacción, y a
 * cambio se gana lo que Recharts no puede dar en este sitio — cero JavaScript
 * en el cliente, se pinta en el servidor con el resto de la tarjeta, y **se
 * imprime**, que es donde `ResponsiveContainer` deja un hueco en blanco.
 *
 * No lleva ejes ni números: no es un gráfico, es la diferencia entre «bajó un
 * 12 %» y «bajó un 12 % después de subir tres semanas». Por eso va acompañado
 * siempre de la cifra y de su variación, nunca solo.
 *
 * Es decorativo para un lector de pantalla (`aria-hidden`) porque lo que dice
 * ya está escrito al lado en palabras: repetirlo sería ruido.
 */
export function Sparkline({
  datos,
  tono = 'neutro',
  className = '',
}: {
  /** La serie, en orden. Con menos de tres puntos no se pinta: no hay forma. */
  datos: number[]
  /** El significado del movimiento, que decide el color. */
  tono?: 'bueno' | 'malo' | 'neutro'
  className?: string
}) {
  if (datos.length < 3) return null

  const ancho = 100
  const alto = 24
  const min = Math.min(...datos)
  const max = Math.max(...datos)
  const rango = max - min

  // Serie plana: una recta a media altura dice la verdad («no se movió»)
  // mejor que una línea que sube por un redondeo.
  const y = (v: number) => (rango === 0 ? alto / 2 : alto - ((v - min) / rango) * (alto - 2) - 1)
  const x = (i: number) => (i / (datos.length - 1)) * ancho

  const puntos = datos.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const trazo =
    tono === 'bueno' ? 'stroke-success' : tono === 'malo' ? 'stroke-destructive' : 'stroke-chart-1'

  return (
    <svg
      viewBox={`0 0 ${ancho} ${alto}`}
      preserveAspectRatio="none"
      className={`h-6 w-full ${className}`}
      aria-hidden
      focusable="false"
    >
      <polyline
        points={puntos}
        fill="none"
        className={trazo}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
