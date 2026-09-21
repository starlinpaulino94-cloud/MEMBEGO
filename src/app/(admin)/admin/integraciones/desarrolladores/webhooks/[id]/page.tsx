import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { puedeFuncion, requireSection } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'
import { entregasDeSuscripcion, resumenDeEntregas } from '@/modules/connect/entregas'
import { Badge } from '@/components/ui/badge'
import { StatCard } from '@/components/ui/stat-card'
import { EntregasWebhook } from '@/components/connect/EntregasWebhook'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Entregas del webhook' }

/**
 * ENTREGAS DE UN WEBHOOK (hallazgo A-4 de la auditoría de integraciones).
 *
 * La tabla `entregas_webhook` guardaba desde la Fase 3 el estado, los intentos,
 * el código HTTP y el error de cada aviso. No se enseñaba en ninguna pantalla
 * de empresa: su único lector era un `count()` del panel del superadmin. O sea
 * que «no me llegan los eventos» solo se podía contestar abriendo la base — y
 * era, por tanto, siempre un ticket.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA SUSCRIPCIÓN SE BUSCA POR (id, companyId), NO POR id
 *
 * El id viaja en la URL y lo escribe quien quiera. Sin la condición de empresa,
 * pegar el id de otra empresa enseñaría SUS entregas, con los datos de SUS
 * clientes dentro. No es una hipótesis remota: es la primera cosa que alguien
 * prueba. `notFound()` y no «no autorizado»: que exista tampoco es asunto suyo.
 */
export default async function EntregasWebhookPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await requireSection('integraciones')
  if (!user?.metadata.companyId) redirect('/admin/dashboard')
  const companyId = user.metadata.companyId

  const suscripcion = await conEmpresa(companyId, (tx) =>
    tx.suscripcionWebhook.findFirst({
      where: { id, companyId },
      select: { id: true, nombre: true, url: true, estado: true, eventos: true },
    })
  ).catch(() => null)
  if (!suscripcion) notFound()

  const [entregas, resumen, puedeProbar, puedeReenviar] = await Promise.all([
    entregasDeSuscripcion(companyId, suscripcion.id),
    resumenDeEntregas(companyId, suscripcion.id),
    // Se pregunta por cada función, no se deduce del acceso a la sección: un
    // botón pintado que la server action va a rechazar después es peor que no
    // tener el botón.
    puedeFuncion('integraciones', 'webhook_probar'),
    puedeFuncion('integraciones', 'webhook_reenviar'),
  ])

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Link
          href="/admin/integraciones/desarrolladores/webhooks"
          className="inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Webhooks
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-h2">{suscripcion.nombre}</h1>
          {suscripcion.estado !== 'ACTIVE' && (
            <Badge variant={suscripcion.estado === 'PAUSED' ? 'warning' : 'destructive'}>
              {suscripcion.estado === 'PAUSED' ? 'Pausado' : 'Apagado'}
            </Badge>
          )}
        </div>
        <code className="block break-all font-mono text-caption text-muted-foreground">
          {suscripcion.url}
        </code>
      </div>

      {/*
        Los tres números salen de un `groupBy`, no de contar las cincuenta filas
        que se enseñan: «entregadas» tiene que decir cuántas van EN TOTAL, no
        cuántas de las últimas cincuenta. Un contador que cambia de significado
        según cuánto quepa en pantalla no es un contador.
      */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Entregadas" value={resumen.enviadas} />
        <StatCard label="Reintentando" value={resumen.pendientes} />
        <StatCard label="Se agotaron" value={resumen.descartadas} />
      </div>

      <EntregasWebhook
        suscripcionId={suscripcion.id}
        activo={suscripcion.estado === 'ACTIVE'}
        puedeProbar={puedeProbar}
        puedeReenviar={puedeReenviar}
        entregas={entregas.map((e) => ({
          id: e.id,
          evento: e.evento,
          estado: e.estado,
          intentos: e.intentos,
          estadoHttp: e.estadoHttp,
          ultimoError: e.ultimoError,
          enviadoAt: e.enviadoAt?.toISOString() ?? null,
          proximoIntentoAt: e.proximoIntentoAt?.toISOString() ?? null,
          createdAt: e.createdAt.toISOString(),
        }))}
      />
    </div>
  )
}
