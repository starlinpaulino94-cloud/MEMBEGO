import { formatDateTime } from '@/lib/format'
import { textoNegocio } from '@/modules/connect/bitacoraNucleo'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * HISTORIAL DE UNA INTEGRACIÓN · la vista de la dueña del negocio (Fase 11,
 * rediseño «hub»: como línea de tiempo).
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
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LÍNEA DE TIEMPO
 *
 * Una línea vertical, un punto por apunte y la hora en su propia columna: se
 * lee de arriba abajo como un relato, que es como se cuenta lo que pasó. Los
 * puntos son todos del mismo color a propósito — el texto de negocio ya dice
 * si fue bueno o malo, y colorearlo por nivel sería colar el nivel de log que
 * esta vista se cuida de no enseñar.
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
        <CardTitle className="text-h3">Historial de actividad</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative ml-1.5 space-y-6 border-l-2 border-border pl-6">
          {legibles.map((r) => (
            <li key={r.id} className="relative">
              <span
                aria-hidden
                className="absolute -left-[31px] top-1.5 h-3 w-3 rounded-full border-2 border-card bg-primary"
              />
              <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
                <time
                  dateTime={r.createdAt}
                  className="w-36 shrink-0 text-caption font-medium text-muted-foreground"
                >
                  {formatDateTime(new Date(r.createdAt))}
                </time>
                <p className="text-sm text-foreground">{r.texto}</p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
