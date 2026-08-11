import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { prisma } from '@/lib/prisma'
import {
  capacidadesEfectivas,
  CAPACIDADES,
  CAPACIDAD_LABELS,
  CATEGORIA_LABELS,
  MODULOS_CLIENTE,
  MODULO_CLIENTE_AUTO,
  MODULO_CLIENTE_LABELS,
  VISIBILIDAD_LABELS,
} from '@/modules/capacidades/catalogo'
import { appDeCategoria } from '@/modules/apps/catalogo'
import { PageHeader } from '@/components/ui/page-header'
import { ArrowLeft, Check, Minus } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Módulos de tu negocio' }

/**
 * Plataforma modular · E4 — vista de SOLO LECTURA de las capacidades para el
 * admin de la empresa. Responde "¿qué tengo activo y qué no?" sin poder
 * cambiarlo: encender/apagar sigue siendo exclusivo del superadmin (evita que
 * un negocio se apague un módulo del que depende su operación por error).
 */
export default async function CapacidadesEmpresaPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId as string | undefined
  if (!companyId) {
    return <p className="text-muted-foreground">Tu cuenta no está vinculada a una empresa.</p>
  }

  // Lectura DIRECTA (sin caché) y defensiva: si la columna aún no existe en la
  // base de datos, se cae al paquete base de la categoría.
  let empresa: { name: string; type: string | null; capacidades: unknown } | null = null
  try {
    empresa = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, type: true, capacidades: true },
    })
  } catch {
    const basica = await prisma.company
      .findUnique({ where: { id: companyId }, select: { name: true, type: true } })
      .catch(() => null)
    empresa = basica ? { ...basica, capacidades: null } : null
  }

  if (!empresa) {
    return <p className="text-muted-foreground">No se pudo cargar tu empresa.</p>
  }

  const { categoria, activas, modulosCliente } = capacidadesEfectivas(
    empresa.type,
    empresa.capacidades
  )
  const app = appDeCategoria(categoria)

  return (
    <div className="space-y-6">
      <Link
        href="/admin/aplicaciones"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Aplicaciones
      </Link>

      <PageHeader
        title="Módulos de tu negocio"
        description="Qué tienes activo hoy. Para encender o apagar un módulo, escríbenos: lo hace el equipo de MembeGo."
      />

      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-border/70 bg-card p-4">
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Tipo de negocio
          </dt>
          <dd className="mt-1 text-lg font-bold text-foreground">
            {CATEGORIA_LABELS[categoria]}
          </dd>
        </div>
        <div className="rounded-2xl border border-border/70 bg-card p-4">
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Tu aplicación
          </dt>
          <dd className="mt-1 text-lg font-bold text-foreground">
            {app?.nombre ?? 'Sin aplicación especializada'}
          </dd>
        </div>
      </dl>

      <ul className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/70 bg-card">
        {CAPACIDADES.map((cap) => {
          const encendida = activas.has(cap)
          return (
            <li key={cap} className="flex items-center justify-between gap-4 px-4 py-3">
              <span className={encendida ? 'text-foreground' : 'text-muted-foreground'}>
                {CAPACIDAD_LABELS[cap]}
              </span>
              {encendida ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-[11px] font-bold uppercase text-success">
                  <Check className="h-3.5 w-3.5" /> Activo
                </span>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-bold uppercase text-muted-foreground">
                  <Minus className="h-3.5 w-3.5" /> Apagado
                </span>
              )}
            </li>
          )
        })}
      </ul>

      <p className="text-xs text-muted-foreground">
        Los módulos apagados no aparecen en tu menú y tampoco se pueden usar por
        detrás: la restricción se aplica en el servidor.
      </p>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">Qué ve tu cliente</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cada sección aparece en la app de tus clientes cuando tiene algo dentro.
            Mientras esté vacía se esconde, para no ofrecerles una puerta que no
            lleva a ninguna parte.
          </p>
        </div>
        <ul className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/70 bg-card">
          {MODULOS_CLIENTE.map((modulo) => {
            const forzado = modulosCliente[modulo] ?? 'AUTO'
            return (
              <li key={modulo} className="flex items-start justify-between gap-4 px-4 py-3">
                <span>
                  <span className="font-medium text-foreground">
                    {MODULO_CLIENTE_LABELS[modulo]}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {MODULO_CLIENTE_AUTO[modulo]}
                  </span>
                </span>
                <span
                  className={`text-overline shrink-0 rounded-full px-2.5 py-0.5 ${
                    forzado === 'OCULTAR'
                      ? 'bg-muted text-muted-foreground'
                      : forzado === 'MOSTRAR'
                        ? 'bg-info/15 text-info'
                        : 'bg-success/15 text-success'
                  }`}
                >
                  {forzado === 'AUTO' ? 'Automático' : VISIBILIDAD_LABELS[forzado]}
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
