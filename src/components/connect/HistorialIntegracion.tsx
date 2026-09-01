import { formatDateTime } from '@/lib/format'
import { textoNegocio } from '@/modules/connect/bitacoraNucleo'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * HISTORIAL DE UNA INTEGRACIÓN · la vista de la dueña del negocio (Fase 11).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * MISMO REGISTRO, OTRO IDIOMA
 *
 * Lee exactamente los mismos apuntes que la pantalla de desarrolladores — una
 * sola tabla, un solo apunte, nada duplicado — pero cuenta lo que le importa a
 * quien tiene un negocio: qué le pasó a SU cuenta. Sin niveles, sin códigos,
 * sin la palabra «credencial».
 *
 * Los eventos que no tienen frase de negocio se OMITEN (no se enseñan crudos).
 * Enseñarle `webhook.apagado_por_fallos` a la dueña de un salón no le dice
 * nada y la asusta; ese apunte sigue entero en /desarrolladores/registros.
 *
 * Si tras filtrar no queda nada, el bloque entero desaparece: una tarjeta
 * vacía titulada «Historial» es peor que ninguna tarjeta.
 */
export function HistorialIntegracion({
  registros,
}: {
  registros: { id: string; evento: string; createdAt: string }[]
}) {
  const legibles = registros
    .map((r) => ({ ...r, texto: textoNegocio(r.evento) }))
    .filter((r): r is typeof r & { texto: string } => r.texto !== null)

  if (legibles.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Historial</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border/60">
          {legibles.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
            >
              <span className="text-sm">{r.texto}</span>
              <time
                dateTime={r.createdAt}
                className="shrink-0 text-caption text-muted-foreground"
              >
                {formatDateTime(new Date(r.createdAt))}
              </time>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
