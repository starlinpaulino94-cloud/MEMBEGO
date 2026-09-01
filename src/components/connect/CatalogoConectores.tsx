import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { Plug } from 'lucide-react'

/**
 * Catálogo de conectores nativos disponibles para la empresa.
 *
 * Hoy está VACÍO y la pantalla lo dice sin disimulo. Es la misma regla de
 * honestidad del módulo de Permisos: no se lista lo que no funciona. Cuando la
 * Fase 6 traiga WhatsApp y Google Calendar, aparecerán aquí solos — el
 * catálogo se lee de la base, no de una lista en el código.
 */
export function CatalogoConectores({
  conectores,
}: {
  conectores: {
    id: string
    slug: string
    nombre: string
    descripcion: string | null
    categoria: string
    authTipo: string
  }[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Aplicaciones disponibles</CardTitle>
      </CardHeader>
      <CardContent>
        {conectores.length === 0 ? (
          <EmptyState
            icon={<Plug className="h-6 w-6" aria-hidden />}
            title="Todavía no hay aplicaciones para conectar"
            description="Estamos preparando las primeras (WhatsApp y Google Calendar). Mientras tanto, con una clave de API o un webhook ya puedes conectar MembeGo con Zapier, Make o tu propio sistema."
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {conectores.map((c) => (
              <li key={c.id} className="rounded-xl border border-border/60 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{c.nombre}</span>
                  <Badge variant="secondary">{c.categoria}</Badge>
                </div>
                {c.descripcion && (
                  <p className="mt-1 text-caption text-muted-foreground">{c.descripcion}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
