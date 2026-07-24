import Form from 'next/form'
import { requireRole } from '@/lib/auth/guards'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { CapacidadesPanel } from '@/components/capacidades/CapacidadesPanel'
import { capacidadesEfectivas } from '@/modules/capacidades/catalogo'
import { CATEGORIA_LABELS } from '@/modules/capacidades/catalogo'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Capacidades por empresa' }

/**
 * Plataforma modular · E4 — administración de capacidades (superadmin).
 * Selecciona una empresa y enciende/apaga sus módulos; el paquete base lo da
 * su categoría y aquí solo se guardan las diferencias.
 */
export default async function CapacidadesSuperadminPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string }>
}) {
  await requireRole('SUPERADMIN')
  const { empresa } = await searchParams

  const empresas = await prisma.company.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, type: true },
  })
  const seleccionada = empresas.find((e) => e.id === empresa) ?? empresas[0] ?? null

  // Estado efectivo actual (lectura DIRECTA, sin caché: el superadmin debe
  // ver lo recién guardado). Defensivo ante la migración pendiente.
  let raw: unknown = null
  if (seleccionada) {
    raw = await prisma.company
      .findUnique({ where: { id: seleccionada.id }, select: { capacidades: true } })
      .then((c) => c?.capacidades ?? null)
      .catch(() => null)
  }
  const efectivas = seleccionada ? capacidadesEfectivas(seleccionada.type, raw) : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Capacidades por empresa"
        description="Enciende o apaga los módulos de cada negocio. El paquete base lo define su categoría; aquí se ajusta lo puntual."
      />

      <Form
        action="/superadmin/capacidades"
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-border/70 bg-card p-4"
      >
        <label className="space-y-1.5 text-sm font-medium text-foreground">
          Empresa
          <select
            name="empresa"
            defaultValue={seleccionada?.id ?? ''}
            className="mt-1 block h-10 min-w-64 rounded-xl border border-input bg-background px-3 text-sm"
          >
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="secondary">
          Ver
        </Button>
      </Form>

      {!seleccionada || !efectivas ? (
        <p className="text-muted-foreground">No hay empresas registradas.</p>
      ) : (
        <section className="rounded-2xl border border-border/70 bg-card p-5">
          <h2 className="mb-1 text-lg font-bold text-foreground">{seleccionada.name}</h2>
          <p className="mb-5 text-sm text-muted-foreground">
            Categoría actual: {CATEGORIA_LABELS[efectivas.categoria]} ·{' '}
            {efectivas.activas.size} capacidades activas
          </p>
          <CapacidadesPanel
            companyId={seleccionada.id}
            categoria={efectivas.categoria}
            activas={[...efectivas.activas]}
          />
        </section>
      )}
    </div>
  )
}
