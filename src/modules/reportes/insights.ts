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
 */

export interface Insight {
  texto: string
  tono: 'bueno' | 'malo' | 'neutro'
}

/** Por debajo de esto, la variación es ruido y no merece una frase. */
export const UMBRAL_VARIACION = 10

/** Mínimo de operaciones para que un porcentaje signifique algo. */
export const MINIMO_OPERACIONES = 10

/** A partir de aquí, la proporción de entregas sin cobro merece nombrarse. */
export const UMBRAL_ENTREGAS = 60

interface Entrada {
  ingresosCaja: { variacion: number | null }
  clientesNuevos: { variacion: number | null }
  operaciones: { valor: number }
  entregas: { valor: number }
}

export function calcularInsights(r: Entrada): Insight[] {
  const out: Insight[] = []

  const ingreso = r.ingresosCaja.variacion
  if (ingreso != null && Math.abs(ingreso) >= UMBRAL_VARIACION) {
    out.push({
      texto:
        ingreso > 0
          ? `Los ingresos de caja subieron ${ingreso}% frente al periodo anterior de la misma duración.`
          : `Los ingresos de caja bajaron ${Math.abs(ingreso)}% frente al periodo anterior de la misma duración.`,
      tono: ingreso > 0 ? 'bueno' : 'malo',
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
      })
    }
  }

  return out
}
