import { BotonExportar } from '@/components/ui/boton-exportar'

/**
 * LAS DOS DESCARGAS DE UN REPORTE, EN UN SOLO SITIO.
 *
 * Nueve pantallas montaban su enlace de exportación a mano, y ya convivían dos
 * formas de pegar la query string: unas con `${qs}` —que ya trae su `?`— y
 * otras con `${qsExport ? `?${qsExport}` : ''}`. Añadir un segundo formato a
 * cada una habría significado escribir nueve veces la misma decisión de si
 * toca `?` o `&`, y la novena es la que se equivoca.
 *
 * Aquí se decide una vez: el periodo y los filtros que viajan en `qs` se
 * conservan tal cual —el archivo sale con EL MISMO corte que la pantalla— y el
 * formato se añade encima.
 *
 * Por qué dos botones y no un desplegable: son dos descargas, no una opción
 * escondida. Quien ya automatizó la del CSV la sigue encontrando donde estaba.
 */
export function BotonesExportar({
  /** La ruta de exportación, sin query string. */
  base,
  /** El periodo y los filtros, con `?` o sin él: aquí da igual. */
  qs,
}: {
  base: string
  qs?: string
}) {
  const params = (qs ?? '').replace(/^\?/, '')
  const csv = params ? `${base}?${params}` : base
  const xlsx = `${base}?${params ? `${params}&` : ''}formato=xlsx`

  return (
    <>
      <BotonExportar href={csv} />
      <BotonExportar href={xlsx} label="Exportar Excel" variant="outline" />
    </>
  )
}
