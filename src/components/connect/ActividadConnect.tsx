import { formatDateTime } from '@/lib/format'
import { textoTecnico } from '@/modules/connect/bitacoraNucleo'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { ScrollText } from 'lucide-react'

/**
 * REGISTROS TÉCNICOS · la vista de quien depura (Connect · Fase 11).
 *
 * Enseña el CÓDIGO del evento junto a su descripción, y el nivel, y el origen.
 * Eso es lo que la diferencia del historial que ve la dueña del negocio en la
 * página de cada integración: aquí no se suaviza nada, porque quien mira esto
 * está buscando algo concreto y necesita el nombre exacto para encontrarlo.
 *
 * La traducción vive en `bitacoraNucleo.ts`, junto a la de negocio, para que
 * las dos se vean una al lado de la otra al añadir un evento nuevo.
 *
 * MÓVIL: cada apunte es un bloque que apila en vertical y el código puede
 * partirse. Antes era una fila de cuatro elementos en línea; con un código de
 * evento largo se salía de la pantalla en un teléfono.
 */

const TONO = { INFO: 'secondary', WARN: 'warning', ERROR: 'destructive' } as const

export interface RegistroVista {
  id: string
  nivel: string
  evento: string
  origen?: string
  createdAt: string
}

export function ActividadConnect({ registros }: { registros: RegistroVista[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Registros</CardTitle>
      </CardHeader>
      <CardContent>
        {registros.length === 0 ? (
          <EmptyState
            icon={<ScrollText className="h-6 w-6" aria-hidden />}
            title="Todavía no hay registros"
            description="Aquí aparecerá lo que haga el sistema con tus claves, tus webhooks y tus conexiones, con su código y su nivel."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {registros.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:gap-3">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant={TONO[r.nivel as keyof typeof TONO] ?? 'secondary'}>
                    {r.nivel}
                  </Badge>
                  {r.origen && (
                    <span className="text-caption text-muted-foreground">{r.origen}</span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{textoTecnico(r.evento)}</span>
                  {/* El nombre exacto, para poder buscarlo en un incidente. */}
                  <code className="block break-all font-mono text-caption text-muted-foreground">
                    {r.evento}
                  </code>
                </span>
                <time
                  dateTime={r.createdAt}
                  className="shrink-0 text-caption text-muted-foreground"
                >
                  {formatDateTime(new Date(r.createdAt))}
                </time>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
