/**
 * Reportes · QUÉ DICEN ESTOS NÚMEROS — núcleo puro.
 *
 * Un panel de KPIs dice qué pasó; lo que falta es qué significa. «Ingresos
 * −18 %» pide una frase que diga si eso es la tendencia o el ruido de una
 * semana corta.
 *
 * Estaba escrito dentro de la página de reportes de empresa, mezclado con el
 * JSX. Aquí es una función de datos a frases: se prueba con números inventados
 * y sin base de datos, y la puede usar también el reporte que el superadmin
 * abre de una empresa concreta.
 *
 * REGLA DE ORO: solo salen los que tienen algo que decir. Un insight que
 * siempre está encendido es decoración, y decoración en un sitio donde se toman
 * decisiones enseña a ignorar la sección entera.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CADA FRASE DICE A DÓNDE IR
 *
 * «Los ingresos bajaron 18 %» es un titular, y un titular sin sitio a donde ir
 * deja a quien lo lee peor que antes: sabe que algo pasa y no tiene el
 * siguiente paso. La respuesta estaba a dos clics —el reporte de finanzas del
 * MISMO periodo— y nadie la encontraba desde aquí.
 *
 * Aquí no se arman URLs a propósito. Este módulo es puro para poder probarlo
 * con números inventados y sin base de datos, y además el mismo reporte se
 * monta en dos sitios: `/admin/reportes` para el dueño y
 * `/superadmin/reportes/[id]` para soporte, donde esos enlaces NO existen. Así
 * que la frase declara UN DESTINO —el mismo juego de claves que ya usan las
 * tarjetas (`EnlacesReporte`)— y quien monta la pantalla decide si hay a dónde
 * ir. Donde no lo hay, la frase se enseña igual y sin enlace roto.
 */

/** A dónde lleva investigar una frase. Las mismas claves que `EnlacesReporte`. */
export type DestinoInsight = 'finanzas' | 'clientes' | 'operacion' | 'membresias'

export interface Insight {
  texto: string
  tono: 'bueno' | 'malo' | 'neutro'
  /**
   * Dónde se comprueba lo que la frase afirma. `etiqueta` dice QUÉ se va a
   * mirar, no «ver más»: un enlace que no promete nada no se pulsa.
   */
  investigar?: { destino: DestinoInsight; etiqueta: string }
}

/** Por debajo de esto, la variación es ruido y no merece una frase. */
export const UMBRAL_VARIACION = 10

/** Mínimo de operaciones para que un porcentaje signifique algo. */
export const MINIMO_OPERACIONES = 10

/** A partir de aquí, la proporción de entregas sin cobro merece nombrarse. */
export const UMBRAL_ENTREGAS = 60

interface Entrada {
  /** `null` = sin permiso financiero. El insight de ingresos no sale. */
  ingresosCaja: { variacion: number | null } | null
  clientesNuevos: { variacion: number | null }
  operaciones: { valor: number }
  entregas: { valor: number }
}

export function calcularInsights(r: Entrada): Insight[] {
  const out: Insight[] = []

  const ingreso = r.ingresosCaja?.variacion ?? null
  if (ingreso != null && Math.abs(ingreso) >= UMBRAL_VARIACION) {
    out.push({
      texto:
        ingreso > 0
          ? `Los ingresos de caja subieron ${ingreso}% frente al periodo anterior de la misma duración.`
          : `Los ingresos de caja bajaron ${Math.abs(ingreso)}% frente al periodo anterior de la misma duración.`,
      tono: ingreso > 0 ? 'bueno' : 'malo',
      investigar: { destino: 'finanzas', etiqueta: 'Ver por qué vía entró el dinero' },
    })
  }

  const nuevos = r.clientesNuevos.variacion
  if (nuevos != null && Math.abs(nuevos) >= UMBRAL_VARIACION) {
    out.push({
      texto:
        nuevos > 0
          ? `Entraron ${nuevos}% más clientes nuevos que en el periodo anterior.`
          : `Entraron ${Math.abs(nuevos)}% menos clientes nuevos que en el periodo anterior.`,
      tono: nuevos > 0 ? 'bueno' : 'malo',
      investigar: { destino: 'clientes', etiqueta: 'Ver por dónde llegaron las altas' },
    })
  }

  // Alta proporción de entregas sin cobro puede ser normal (un negocio que va
  // por membresías) o señal de fuga. La frase lo enuncia sin sentenciar.
  const total = r.operaciones.valor + r.entregas.valor
  if (total >= MINIMO_OPERACIONES) {
    const pct = Math.round((r.entregas.valor / total) * 100)
    if (pct >= UMBRAL_ENTREGAS) {
      out.push({
        texto: `${pct}% de las operaciones fueron entregas sin cobro. Es lo esperable si tu negocio va por membresías; si no, conviene revisar de dónde salen.`,
        tono: 'neutro',
        // La frase dice «conviene revisar de dónde salen» y hasta ahora no
        // decía dónde. Es el reporte de operación: ahí están los canjes que no
        // descontaron un uso, que es exactamente de lo que habla.
        investigar: { destino: 'operacion', etiqueta: 'Ver los canjes que no descontaron' },
      })
    }
  }

  return out
}
