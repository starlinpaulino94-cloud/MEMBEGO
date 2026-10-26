import { diaLocal, inicioDeHoyEn, limiteDiaLocal, sumarDias } from '@/modules/reportes/rango'

/**
 * El CALENDARIO del Resumen: los instantes y las etiquetas del mes, del mes anterior y de la serie de 14 días, en el
 * calendario del NEGOCIO (su zona horaria) y sin base de datos, para poder probarlos con un reloj fijo.
 */

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const dos = (n: number) => String(n).padStart(2, '0')

/** «1–20 oct 2026» (o «1 oct 2026» el día 1). El año se omite si `sinAnio`. */
export function etiquetaTramo(anio: number, mes: number, hastaDia: number, sinAnio = false): string {
  const dias = hastaDia <= 1 ? '1' : `1–${hastaDia}`
  return `${dias} ${MESES[mes - 1]}${sinAnio ? '' : ` ${anio}`}`
}

/** Los instantes y etiquetas del calendario del negocio, en un solo sitio y sin base de datos (se prueba aparte). */
export function calendarioDelResumen(ahora: Date, timeZone: string) {
  const hoyDia = diaLocal(ahora, timeZone)
  const [anio, mes, dia] = hoyDia.split('-').map(Number)
  const mesClave = hoyDia.slice(0, 7)
  const previo = mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 }
  const previoClave = `${previo.anio}-${dos(previo.mes)}`
  const diasDelPrevio = new Date(Date.UTC(previo.anio, previo.mes, 0)).getUTCDate()
  const finDia = Math.min(dia, diasDelPrevio)
  return {
    hoyDia,
    mesClave,
    inicioHoy: inicioDeHoyEn(timeZone, ahora),
    finHoy: limiteDiaLocal(sumarDias(hoyDia, 1), timeZone),
    inicioMes: limiteDiaLocal(`${mesClave}-01`, timeZone),
    inicioMesAnterior: limiteDiaLocal(`${previoClave}-01`, timeZone),
    // El MISMO tramo del mes anterior (1–20 sep frente a 1–20 oct), no el mes entero: comparar un mes a medias con uno
    // completo hace que casi siempre «bajemos» (05 · D-06). Fin EXCLUSIVO, como `whereCobrado`.
    finTramoAnterior: limiteDiaLocal(`${previoClave}-${dos(finDia)}`, timeZone, true),
    primerDiaSerie: sumarDias(hoyDia, -13),
    desdeSerie: limiteDiaLocal(sumarDias(hoyDia, -13), timeZone),
    ventanaMes: etiquetaTramo(anio, mes, dia),
    ventanaAnterior: etiquetaTramo(previo.anio, previo.mes, finDia, previo.anio === anio),
  }
}

/** Rellena los 14 días (también los sin movimiento) con los totales por día. */
export function serieDe14(primerDia: string, porDia: Map<string, number>): { fecha: string; total: number }[] {
  return Array.from({ length: 14 }, (_, i) => {
    const fecha = sumarDias(primerDia, i)
    return { fecha, total: porDia.get(fecha) ?? 0 }
  })
}
