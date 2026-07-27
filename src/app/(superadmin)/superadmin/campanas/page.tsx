import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { prisma } from '@/lib/prisma'
import {
  getCampanasGlobales,
  CAMPANA_TIPO_LABELS,
  CAMPANA_ESTADO_LABELS,
  type CampanaTipo,
  type CampanaEstado,
} from '@/modules/superadmin/campanasGlobales'
import { CampanaGlobalForm } from '@/components/superadmin/CampanaGlobalForm'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDateTime } from '@/lib/format'
import { Megaphone, TriangleAlert } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Campañas conjuntas' }

const CHIP_ESTADO: Record<string, string> = {
  BORRADOR: 'bg-muted text-muted-foreground',
  APLICADA: 'bg-success/15 text-success-foreground',
  ARCHIVADA: 'bg-muted text-muted-foreground line-through',
}

/**
 * CAMPAÑAS CONJUNTAS (superadmin): una oferta o membresía definida una vez y
 * repartida a varias empresas. Cada empresa recibe una copia REAL que puede
 * administrar como propia — por eso funcionan el canje, la caja y los reportes
 * sin ningún cambio en el núcleo.
 */
export default async function CampanasGlobalesPage() {
  await requireRole('SUPERADMIN')

  const [empresas, campanas] = await Promise.all([
    prisma.company
      .findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      })
      .catch(() => []),
    getCampanasGlobales().catch(() => null),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campañas conjuntas"
        description="Una oferta o membresía que defines una vez y se crea en todas las empresas que elijas."
      />

      <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
        <p>
          <b className="text-foreground">Cómo funciona:</b> al aplicar la campaña, cada
          empresa participante recibe su <b>propia copia</b> de la oferta. El cliente la
          canjea en la empresa donde la tomó, y cada negocio puede pausarla o ajustarla.
          Archivar la campaña la desactiva en todas, sin borrar el historial.
        </p>
      </div>

      <CampanaGlobalForm empresas={empresas} />

      {campanas === null ? (
        <EmptyState
          icon={<TriangleAlert className="h-7 w-7" />}
          title="No se pudieron cargar las campañas"
          description="Si acabas de instalar esta versión, corre la migración 20260760_campanas_globales en la base de datos."
        />
      ) : campanas.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="h-7 w-7" />}
          title="Aún no hay campañas conjuntas"
          description="Crea la primera para lanzar una promoción o membresía en varias empresas a la vez."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Campaña</th>
                <th className="px-4 py-3 font-semibold">Crea</th>
                <th className="px-4 py-3 font-semibold">Empresas</th>
                <th className="px-4 py-3 font-semibold">Estado</th>
                <th className="px-4 py-3 font-semibold">Creada</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {campanas.map((c) => (
                <tr key={c.id} className="hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <Link
                      href={`/superadmin/campanas/${c.id}`}
                      className="font-semibold text-primary hover:underline"
                    >
                      {c.nombre}
                    </Link>
                    {c.descripcion && (
                      <p className="truncate text-xs text-muted-foreground">{c.descripcion}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {CAMPANA_TIPO_LABELS[c.tipo as CampanaTipo] ?? c.tipo}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="font-bold tabular-nums text-foreground">
                      {c.aplicadas}/{c.totalEmpresas}
                    </span>
                    {c.todasLasEmpresas && (
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                        todas
                      </span>
                    )}
                    {c.conError > 0 && (
                      <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold uppercase text-destructive">
                        {c.conError} con error
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase ${CHIP_ESTADO[c.estado] ?? 'bg-muted'}`}
                    >
                      {CAMPANA_ESTADO_LABELS[c.estado as CampanaEstado] ?? c.estado}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                    {formatDateTime(c.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
