import type { NovedadHero } from './vista'

const MAX_NOVEDADES_HERO = 10
const VENTANA_NOVEDADES_MS = 7 * 24 * 60 * 60 * 1000

export function seleccionarNovedadesHero(
  novedades: readonly NovedadHero[],
  ahora: Date,
): readonly NovedadHero[] {
  const ordenadas = [...novedades].sort(
    (a, b) => new Date(b.creadoEn).getTime() - new Date(a.creadoEn).getTime(),
  )
  const corte = ahora.getTime() - VENTANA_NOVEDADES_MS
  const recientes = ordenadas.filter((novedad) => {
    const fecha = new Date(novedad.creadoEn).getTime()
    return fecha >= corte && fecha <= ahora.getTime()
  })

  return (recientes.length > 0 ? recientes : ordenadas).slice(0, MAX_NOVEDADES_HERO)
}
