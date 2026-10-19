import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { ETIQUETA_RESULTADO, claveDeLinea, clasificarDiferencia, diferenciaDeConteo, etiquetaDeLote, ordenarPorDiferencia, resumirVarianza } from '@/modules/inventory/conteos'
import { formatearCantidad, nombreCompleto } from '@/modules/inventory/formato'

export interface LineaInforme {
  varianteId: string
  /** INV-5b3: el lote de la línea (null en un producto sin lotes). */
  loteId: string | null
  loteCodigo: string | null
  loteVencimiento: string | null
  sku: string
  barcode: string | null
  itemNombre: string
  nombreVariante: string
  esDefault: boolean
  contado: number
  esperado: number
  existenciaAntes: number | null
  existenciaDespues: number | null
  ajustado: boolean
}

/**
 * El informe de diferencias de un conteo: resumen y una fila por producto contado,
 * de lo que más descuadra a lo que menos. Componente de servidor (solo pinta). Se
 * usa en la revisión previa a aplicar y en el conteo ya cerrado; NUNCA en la
 * pantalla de captura, porque enseña lo que decía el sistema.
 */
export function InformeDiferencias({
  lineas,
  sinContar,
  aplicado,
  bloqueos,
}: {
  lineas: readonly LineaInforme[]
  /** Productos con existencias que no se contaron (no se tocan). null = no se sabe. */
  sinContar: number | null
  /** Ya aplicado: se enseñan las existencias reales de antes y después de ajustar. */
  aplicado: boolean
  /** Líneas que hoy no se podrían aplicar, con el porqué (solo antes de aplicar), por `claveDeLinea` (producto, o producto y lote). */
  bloqueos?: ReadonlyMap<string, string>
}) {
  const filas = ordenarPorDiferencia(lineas.map((l) => ({ ...l, nombre: nombreCompleto(l.itemNombre, l.nombreVariante, l.esDefault), lote: l.loteCodigo })))
  const r = resumirVarianza(filas)
  const tarjetas: ReadonlyArray<readonly [string, string, string?]> = [
    ['Productos contados', formatearCantidad(r.lineas)],
    ['Coinciden', formatearCantidad(r.coinciden)],
    ['Sobrantes', `${formatearCantidad(r.sobrantes)} · +${formatearCantidad(r.unidadesSobrantes)} u.`, 'text-success'],
    ['Faltantes', `${formatearCantidad(r.faltantes)} · −${formatearCantidad(r.unidadesFaltantes)} u.`, r.faltantes > 0 ? 'text-destructive' : undefined],
    ['Con existencias y sin contar', sinContar === null ? '—' : formatearCantidad(sinContar)],
  ]
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5" aria-label="Resumen de diferencias">
        {tarjetas.map(([etiqueta, valor, color]) => (
          <Card key={etiqueta}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{etiqueta}</p>
              <p className={cn('text-lg font-semibold tabular-nums', color)}>{valor}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {filas.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">Todavía no se contó ningún producto.</CardContent>
        </Card>
      ) : (
        <ul className="divide-y rounded-lg border" aria-label="Diferencias por producto">
          {filas.map((l) => {
            const d = diferenciaDeConteo(l.contado, l.esperado)
            const resultado = clasificarDiferencia(d)
            const clave = claveDeLinea(l.varianteId, l.loteId)
            const bloqueo = bloqueos?.get(clave)
            return (
              <li key={clave} data-lote={l.loteCodigo ?? undefined} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <Link href={`/admin/inventario/${l.varianteId}`} className="font-medium underline-offset-2 hover:underline">
                    {l.nombre}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    SKU {l.sku}
                    {l.barcode && ` · ${l.barcode}`}
                    {l.loteCodigo && ` · ${etiquetaDeLote(l.loteCodigo, l.loteVencimiento)}`}
                  </p>
                  {bloqueo && <p className="mt-1 text-xs text-destructive">No se podría aplicar hoy: {bloqueo}</p>}
                </div>
                <div className="flex items-center gap-4 text-right tabular-nums">
                  <div>
                    <p className="text-xs text-muted-foreground">Esperado</p>
                    <p>{formatearCantidad(l.esperado)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Contado</p>
                    <p>{formatearCantidad(l.contado)}</p>
                  </div>
                  <div className="min-w-24">
                    <p className="text-xs text-muted-foreground">Diferencia</p>
                    <p className={cn('font-semibold', d > 0 && 'text-success', d < 0 && 'text-destructive')}>
                      {d > 0 ? '+' : d < 0 ? '−' : ''}
                      {formatearCantidad(Math.abs(d))} <Badge variant="outline">{ETIQUETA_RESULTADO[resultado]}</Badge>
                    </p>
                  </div>
                  {aplicado && (
                    <div>
                      <p className="text-xs text-muted-foreground">Antes → después</p>
                      <p>
                        {l.existenciaAntes === null ? '—' : `${formatearCantidad(l.existenciaAntes)} → ${formatearCantidad(l.existenciaDespues ?? l.existenciaAntes)}`}
                        {!l.ajustado && l.existenciaAntes !== null && <span className="ml-1 text-xs text-muted-foreground">sin cambio</span>}
                      </p>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
