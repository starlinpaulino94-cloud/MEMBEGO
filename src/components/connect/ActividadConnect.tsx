import { formatDateTime } from '@/lib/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

/**
 * Bitácora de las integraciones de la empresa.
 *
 * Los nombres de evento son estables y en vocabulario interno
 * (`clave_api.creada`); aquí se traducen a algo que se pueda leer sin conocer
 * el código. Un evento sin traducción se enseña tal cual: es preferible una
 * línea rara a una línea que falta.
 */
const TEXTO: Record<string, string> = {
  'clave_api.creada': 'Se creó una clave de API',
  'clave_api.revocada': 'Se revocó una clave de API',
  'webhook.suscrito': 'Se creó un webhook',
  'webhook.apagado_por_fallos': 'Un webhook se apagó por fallos repetidos',
  'conexion.creada': 'Se inició una conexión',
  'conexion.reiniciada': 'Se reinició una conexión',
  'conexion.desconectada': 'Se desconectó una aplicación',
  'conexion.fallo': 'Una conexión falló',
  'credencial.guardada': 'Se guardó una credencial',
  'credencial.eliminada': 'Se eliminó una credencial',
  'credencial.ilegible': 'Una credencial no se pudo leer',
}

const TONO = { INFO: 'secondary', WARN: 'warning', ERROR: 'destructive' } as const

export function ActividadConnect({
  registros,
}: {
  registros: { id: string; nivel: string; evento: string; createdAt: string }[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Actividad</CardTitle>
      </CardHeader>
      <CardContent>
        {registros.length === 0 ? (
          <p className="text-caption text-muted-foreground">
            Todavía no hay actividad. Aquí aparecerá lo que ocurra con tus claves y webhooks.
          </p>
        ) : (
          <ul className="space-y-2">
            {registros.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Badge variant={TONO[r.nivel as keyof typeof TONO] ?? 'secondary'}>
                  {r.nivel}
                </Badge>
                <span className="text-sm">{TEXTO[r.evento] ?? r.evento}</span>
                <span className="text-caption text-muted-foreground">
                  {formatDateTime(new Date(r.createdAt))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
