import Form from 'next/form'
import { sinEmpresa } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { CapacidadesPanel } from '@/components/capacidades/CapacidadesPanel'
import {
  CATEGORIA_LABELS,
  capacidadesDeEmpresa,
  resolverConfig,
} from '@/modules/capacidades/catalogo'
import { plural } from '@/lib/plural'

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
  searchParams: Promise<{ empresa?: string; q?: string }>
}) {
  await requireRole('SUPERADMIN')
  const { empresa, q } = await searchParams
  const busqueda = (q ?? '').trim().slice(0, 80)

  /**
   * UNA SOLA CONSULTA.
   *
   * Eran dos: la lista de empresas y después un `findUnique` de la
   * seleccionada, en transacciones distintas, para leer una columna que ya
   * podía venir en la primera.
   *
   * Y trae `tipoNegocioCodigo`, que no traía: sin él, esta pantalla —la que
   * existe para configurar precisamente esto— resolvía la categoría con el
   * `type` heredado e ignoraba el vertical que el superadmin había asignado.
   */
  const empresas = await sinEmpresa(
    'capacidades: el superadmin configura los módulos de cada empresa',
    (tx) =>
      tx.company.findMany({
        where: busqueda ? { name: { contains: busqueda, mode: 'insensitive' } } : {},
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          type: true,
          tipoNegocioCodigo: true,
          capacidades: true,
          esDemo: true,
          isActive: true,
        },
      })
  ).catch(() => [])

  const seleccionada = empresas.find((e) => e.id === empresa) ?? empresas[0] ?? null
  const efectivas = seleccionada ? capacidadesDeEmpresa(seleccionada) : null

  /** ¿Esta empresa está tocada a mano? Se marca en el selector. */
  const ajustada = (e: (typeof empresas)[number]) => {
    const cfg = resolverConfig(e.capacidades)
    return (
      cfg.categoria != null ||
      Object.keys(cfg.overrides ?? {}).length > 0 ||
      Object.keys(cfg.modulosCliente ?? {}).length > 0
    )
  }
  const ajustadas = empresas.filter(ajustada).length

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
        {/* Buscador: el desplegable llevaba TODAS las empresas y con cuarenta
            hay que recorrerlo a ojo. */}
        <label className="space-y-1.5 text-sm font-medium text-foreground">
          Buscar
          <input
            name="q"
            defaultValue={busqueda}
            placeholder="Nombre de la empresa…"
            className="mt-1 block h-10 min-w-56 rounded-xl border border-input bg-background px-3 text-sm"
          />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground">
          Empresa
          <select
            name="empresa"
            defaultValue={seleccionada?.id ?? ''}
            className="mt-1 block h-10 min-w-64 rounded-xl border border-input bg-background px-3 text-sm"
          >
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {/* Práctica, suspendida y «ajustada» a la vista: configurar los
                    módulos de una empresa de entrenamiento creyéndola real es
                    fácil cuando el selector solo enseña el nombre. */}
                {e.name}
                {e.esDemo ? ' · práctica' : ''}
                {!e.isActive ? ' · suspendida' : ''}
                {ajustada(e) ? ' · ajustada' : ''}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="secondary">
          Ver
        </Button>
        {empresas.length > 0 && (
          <p className="text-caption text-muted-foreground">
            {plural(empresas.length, 'empresa', 'empresas')} ·{' '}
            {plural(ajustadas, 'ajustada a mano', 'ajustadas a mano')}
          </p>
        )}
      </Form>

      {!seleccionada || !efectivas ? (
        <p className="text-muted-foreground">
          {busqueda ? 'Ninguna empresa coincide con la búsqueda.' : 'No hay empresas registradas.'}
        </p>
      ) : (
        <section className="rounded-2xl border border-border/70 bg-card p-5">
          <h2 className="mb-1 flex flex-wrap items-center gap-2 text-lg font-bold text-foreground">
            {seleccionada.name}
            {seleccionada.esDemo && (
              <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-caption font-medium text-warning">
                Práctica
              </span>
            )}
            {!seleccionada.isActive && (
              <span className="rounded-full border border-border px-2 py-0.5 text-caption font-medium text-muted-foreground">
                Suspendida
              </span>
            )}
          </h2>
          <p className="mb-5 text-small text-muted-foreground">
            Categoría actual: {CATEGORIA_LABELS[efectivas.categoria]} ·{' '}
            {plural(efectivas.activas.size, 'capacidad activa', 'capacidades activas')}
          </p>
          {/* Un tipo que el catálogo no reconoce ("otro", vacío, uno inventado)
              no es un detalle cosmético: de él dependen los requisitos que se le
              exigen al cliente. Decirlo aquí evita tener que deducirlo mirando
              la pantalla del cliente. */}
          {efectivas.categoriaExplicita == null && (
            <p
              role="status"
              className="mb-5 rounded-xl border border-warning/25 bg-warning/8 p-3 text-small text-foreground"
            >
              Ni el vertical ni el tipo guardado de esta empresa (
              <span className="font-mono">{seleccionada.type || 'vacío'}</span>) corresponden
              a una categoría del catálogo. Se le aplican los módulos de{' '}
              {CATEGORIA_LABELS[efectivas.categoria]}, pero NO se le exige vehículo a sus
              clientes. Elige la categoría correcta abajo para fijarla.
            </p>
          )}
          <CapacidadesPanel
            companyId={seleccionada.id}
            categoria={efectivas.categoria}
            activas={[...efectivas.activas]}
            modulosCliente={efectivas.modulosCliente}
          />
        </section>
      )}
    </div>
  )
}
