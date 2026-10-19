import { formatDateTime } from '@/lib/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { CambioDeVencimiento } from '@/modules/inventory/lotes-queries'

/** INV-5b5 · Las correcciones de vencimiento de los lotes de un producto: de qué fecha a cuál, por qué y quién (la historia no se edita). */
export function HistorialDeVencimientos({ cambios }: { cambios: readonly CambioDeVencimiento[] }) {
  if (cambios.length === 0) return null
  return (
    <Card aria-label="Correcciones de vencimiento">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Correcciones de vencimiento ({cambios.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y text-sm" aria-label="Historial de correcciones de vencimiento">
          {cambios.map((c) => (
            <li key={c.id} data-lote={c.loteCodigo} className="space-y-0.5 py-2">
              <p className="font-medium">
                Lote {c.loteCodigo}: {c.anterior ?? 'no vencía'} → {c.nuevo ?? 'no vence'}
              </p>
              <p className="text-xs text-muted-foreground">
                {c.motivo} · {c.usuarioNombre ?? 'Sistema'} · {formatDateTime(c.creadoEn)}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
