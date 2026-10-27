import Link from 'next/link'
import { Inbox } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import {
  ESTADOS_SOLICITUD,
  ESTADO_SOLICITUD_LABEL,
  TONO_SOLICITUD,
  type EstadoSolicitud,
} from '@/modules/solicitudes/nucleo'
import { StatusChip } from '@/components/ui/status-chip'
import { formatDate } from '@/lib/format'
import { Tabla } from '@/components/ui/tabla'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Solicitudes de empresa' }

/**
 * El EMBUDO de altas de la etapa concierge: cada fila es un negocio que llenó
 * el formulario público /solicitud-empresa. De aquí sale cada empresa nueva —
 * primero se revisa y contacta, y con un clic se crea (detalle).
 */
export default async function SolicitudesPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>
}) {
  await requireRole('SUPERADMIN')
  const { estado } = await searchParams
  const filtro = (ESTADOS_SOLICITUD as readonly string[]).includes(estado ?? '')
    ? (estado as EstadoSolicitud)
    : null

  // Una sola transacción para las dos consultas: `sinEmpresa` abre una y las
  // dos van dentro. Con dos envoltorios serían dos conexiones del pool a la vez
  // para una pantalla que cabe en una.
  const [solicitudes, conteos] = await sinEmpresa(
    'embudo de altas: las solicitudes son de negocios que TODAVÍA no son empresa',
    (tx) =>
      Promise.all([
        tx.solicitudEmpresa.findMany({
          where: filtro ? { estado: filtro } : undefined,
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: {
            id: true,
            estado: true,
            nombreNegocio: true,
            tipoNegocio: true,
            contactoCorreo: true,
            createdAt: true,
          },
        }),
        tx.solicitudEmpresa.groupBy({ by: ['estado'], _count: true }),
      ])
  )
  const totalPorEstado = new Map(conteos.map((c) => [c.estado, c._count]))
  const total = conteos.reduce((s, c) => s + c._count, 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Solicitudes de empresa</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Negocios que llenaron el formulario de alta (
          <span className="font-mono text-xs">/solicitud-empresa</span>). Revisa, contacta y
          crea la empresa con un clic.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/superadmin/solicitudes"
          className={`rounded-full border px-3 py-1.5 text-sm font-medium ${!filtro ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
        >
          Todas ({total})
        </Link>
        {ESTADOS_SOLICITUD.map((e) => (
          <Link
            key={e}
            href={`/superadmin/solicitudes?estado=${e}`}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${filtro === e ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            {ESTADO_SOLICITUD_LABEL[e]} ({totalPorEstado.get(e) ?? 0})
          </Link>
        ))}
      </div>

      {solicitudes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <Inbox className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            {filtro
              ? 'No hay solicitudes en este estado.'
              : 'Aún no llega ninguna solicitud. Comparte el enlace /solicitud-empresa con los negocios.'}
          </p>
        </div>
      ) : (
        <Tabla
          caption="Solicitudes de negocios"
          claveDe={(s) => s.id}
          filas={solicitudes}
          filaNavegable
          columnas={[
            {
              clave: 'negocio',
              encabezado: 'Negocio',
              celda: (s) => (
                <Link href={`/superadmin/solicitudes/${s.id}`} className="font-semibold text-foreground hover:text-primary hover:underline">
                  {s.nombreNegocio}
                </Link>
              ),
            },
            { clave: 'tipo', encabezado: 'Tipo', prioridad: 2, valor: (s) => s.tipoNegocio },
            { clave: 'contacto', encabezado: 'Contacto', prioridad: 2, valor: (s) => s.contactoCorreo },
            { clave: 'recibida', encabezado: 'Recibida', prioridad: 3, celda: (s) => formatDate(s.createdAt) },
            {
              clave: 'estado',
              encabezado: 'Estado',
              celda: (s) => (
                <StatusChip tone={TONO_SOLICITUD[s.estado as EstadoSolicitud]} pulso={s.estado === 'NUEVA'}>
                  {ESTADO_SOLICITUD_LABEL[s.estado as EstadoSolicitud]}
                </StatusChip>
              ),
            },
          ]}
        />
      )}
    </div>
  )
}
