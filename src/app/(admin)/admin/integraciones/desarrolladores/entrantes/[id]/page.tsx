import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireSection } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'
import { formatDateTime } from '@/lib/format'
import { recepcionesDe } from '@/modules/connect/entrantes'
import { nombreDeEvento } from '@/modules/connect/entrantesNucleo'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Lo recibido' }

/**
 * LO QUE NOS MANDARON por un webhook entrante (hallazgo B-1).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTA PANTALLA ES LA MITAD DEL VALOR DE LA FUNCIÓN
 *
 * Recibir un aviso no sirve de nada si no se puede VER lo que llegó. Quien
 * conecta su herramienta necesita el cuerpo exacto para saber qué campos trae
 * antes de construir nada encima — y es exactamente el flujo de las
 * herramientas contra las que esto se integra: mandas una prueba, miras la
 * forma, y luego automatizas.
 *
 * Sale de `automation_events` y no de una tabla propia: lo recibido ya se
 * guarda ahí como evento. Una segunda tabla con los mismos datos sería un sitio
 * más que purgar y aislar, y dos respuestas posibles a «qué nos mandaron el
 * martes».
 *
 * La fila se busca por `(id, companyId)`: el id viaja en la URL y lo escribe
 * quien quiera. `notFound()` y no «no autorizado» — que exista tampoco es
 * asunto suyo.
 */
export default async function RecibidoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireSection('integraciones')
  if (!user?.metadata.companyId) redirect('/admin/dashboard')
  const companyId = user.metadata.companyId

  const entrante = await conEmpresa(companyId, (tx) =>
    tx.webhookEntrante.findFirst({
      where: { id, companyId },
      select: { id: true, nombre: true, slug: true, estado: true, recibidos: true },
    })
  ).catch(() => null)
  if (!entrante) notFound()

  const recepciones = await recepcionesDe(companyId, entrante.slug)
  const evento = nombreDeEvento(entrante.slug)

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Link
          href="/admin/integraciones/desarrolladores/entrantes"
          className="inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Webhooks entrantes
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-h2">{entrante.nombre}</h1>
          {entrante.estado !== 'ACTIVE' && <Badge variant="secondary">Pausado</Badge>}
        </div>
        <p className="text-caption text-muted-foreground">
          Lo que llegue aquí entra como el evento{' '}
          <code className="font-mono">{evento}</code>. Ése es el nombre que tiene que escuchar la
          automatización que quieras disparar.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-h3">Últimos avisos recibidos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {recepciones.length === 0 ? (
            <p className="text-caption text-muted-foreground">
              Todavía no hemos recibido nada. Manda una prueba desde tu herramienta y recarga esta
              página: aquí verás el cuerpo exacto que llegó.
            </p>
          ) : (
            <ul className="space-y-3">
              {recepciones.map((r) => (
                <li key={r.id} className="rounded-xl border border-border/60 px-3 py-2">
                  <time
                    dateTime={r.occurredAt.toISOString()}
                    className="text-caption text-muted-foreground"
                  >
                    {formatDateTime(r.occurredAt)}
                  </time>
                  {/*
                    El cuerpo entero y sin recortar. Es lo que se viene a buscar:
                    un resumen o los primeros campos obligarían a salir de aquí
                    para ver el que falta, que siempre es el que falta.
                  */}
                  <pre className="mt-1 max-h-72 overflow-auto rounded-lg bg-muted px-3 py-2 font-mono text-caption">
                    {JSON.stringify(r.payload ?? {}, null, 2)}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
