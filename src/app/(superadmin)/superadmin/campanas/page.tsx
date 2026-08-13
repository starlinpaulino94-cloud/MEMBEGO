import Link from 'next/link'
import Form from 'next/form'
import { sinEmpresa } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import {
  getCampanasGlobales,
  CAMPANA_TIPO_LABELS,
  CAMPANA_ESTADO_LABELS,
  type CampanaTipo,
  type CampanaEstado,
} from '@/modules/superadmin/campanasGlobales'
import {
  FILTROS_ESTADO,
  FILTRO_ESTADO_LABEL,
  POR_PAGINA,
  hayFiltro,
  hrefCampanas,
  leerFiltroCampanas,
  type FiltroEstadoCampana,
} from '@/modules/superadmin/campanasFiltros'
import { CampanaGlobalForm } from '@/components/superadmin/CampanaGlobalForm'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDateTime } from '@/lib/format'
import { plural } from '@/lib/plural'
import { Megaphone, TriangleAlert, X } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Campañas conjuntas' }

const BASE = '/superadmin/campanas'

/**
 * El color del estado ES el dato: dice si la campaña salió bien.
 *
 * `APLICADA_PARCIAL` va en ámbar y no en verde: antes ese caso —unas empresas
 * sí y otras no— se pintaba idéntico a un reparto perfecto, con el número de
 * fallos escondido en una insignia pequeña a tres columnas de distancia.
 */
const CHIP_ESTADO: Record<string, string> = {
  BORRADOR: 'bg-muted text-muted-foreground',
  APLICADA: 'bg-success/15 text-success',
  APLICADA_PARCIAL: 'bg-warning/15 text-warning',
  ARCHIVADA: 'bg-muted text-muted-foreground line-through',
}

/**
 * CAMPAÑAS CONJUNTAS (superadmin): una oferta o membresía definida una vez y
 * repartida a varias empresas. Cada empresa recibe una copia REAL que puede
 * administrar como propia — por eso funcionan el canje, la caja y los reportes
 * sin ningún cambio en el núcleo.
 */
export default async function CampanasGlobalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireRole('SUPERADMIN')
  const f = leerFiltroCampanas(await searchParams)

  // `getCampanasGlobales` abre su propia transacción: fuera del envoltorio, que
  // anidarlas pide una segunda conexión desde dentro de una abierta y con el
  // pooler por delante es así como se agota el pool.
  const [empresas, datos] = await Promise.all([
    sinEmpresa(
      'campañas conjuntas: por definición agrupan varias empresas',
      (tx) =>
        tx.company.findMany({
          where: { isActive: true },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, esDemo: true },
        })
    ).catch(() => []),
    getCampanasGlobales(f).catch(() => null),
  ])

  const paginas = datos ? Math.max(1, Math.ceil(datos.total / POR_PAGINA)) : 1

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campañas conjuntas"
        description="Una oferta o membresía que defines una vez y se crea en todas las empresas que elijas."
      />

      <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-small text-muted-foreground">
        <p>
          <b className="text-foreground">Cómo funciona:</b> al aplicar la campaña, cada
          empresa participante recibe su <b>propia copia</b> de la oferta. El cliente la
          canjea en la empresa donde la tomó, y cada negocio puede pausarla o ajustarla.
          Archivar la campaña la desactiva en todas, sin borrar el historial.
        </p>
        {/* «Todas las empresas» dejó de incluir las de práctica: recibían la
            oferta real como cualquier negocio, sin avisar. Se pueden seguir
            eligiendo a mano. */}
        <p className="mt-2">
          <b className="text-foreground">Empresas de práctica:</b> quedan fuera de «todas
          las empresas». Si quieres incluirlas en un entrenamiento, márcalas a mano.
        </p>
      </div>

      <CampanaGlobalForm empresas={empresas} />

      {datos === null ? (
        <EmptyState
          icon={<TriangleAlert className="h-7 w-7" />}
          title="No se pudieron cargar las campañas"
          description="Si acabas de instalar esta versión, corre la migración 20260760_campanas_globales en la base de datos."
        />
      ) : (
        <div className="space-y-3">
          <Form action={BASE} className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1">
              <label htmlFor="q" className="mb-1 block text-caption text-muted-foreground">
                Buscar
              </label>
              <input
                id="q"
                name="q"
                defaultValue={f.q}
                placeholder="Nombre de la campaña…"
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground"
              />
            </div>
            <div>
              <label htmlFor="estado" className="mb-1 block text-caption text-muted-foreground">
                Estado
              </label>
              <select
                id="estado"
                name="estado"
                defaultValue={f.estado}
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground"
              >
                {FILTROS_ESTADO.map((e) => (
                  <option key={e} value={e}>
                    {FILTRO_ESTADO_LABEL[e]}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="h-10 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Filtrar
            </button>
          </Form>

          {hayFiltro(f) && (
            <div className="flex flex-wrap items-center gap-2">
              {f.q && (
                <Link
                  href={hrefCampanas(f, BASE, { q: '', pagina: 1 })}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-caption text-foreground hover:bg-muted"
                  aria-label={`Quitar filtro «${f.q}»`}
                >
                  «{f.q}» <X aria-hidden className="h-3 w-3" />
                </Link>
              )}
              {f.estado !== 'todos' && (
                <Link
                  href={hrefCampanas(f, BASE, { estado: 'todos', pagina: 1 })}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-caption text-foreground hover:bg-muted"
                  aria-label={`Quitar filtro ${FILTRO_ESTADO_LABEL[f.estado as FiltroEstadoCampana]}`}
                >
                  {FILTRO_ESTADO_LABEL[f.estado as FiltroEstadoCampana]} <X aria-hidden className="h-3 w-3" />
                </Link>
              )}
              <Link href={BASE} className="text-caption text-primary hover:underline">
                Limpiar todo
              </Link>
            </div>
          )}

          {datos.filas.length === 0 ? (
            <EmptyState
              icon={<Megaphone className="h-7 w-7" />}
              title={hayFiltro(f) ? 'Sin resultados' : 'Aún no hay campañas conjuntas'}
              description={
                hayFiltro(f)
                  ? 'Ajusta los filtros o la búsqueda.'
                  : 'Crea la primera para lanzar una promoción o membresía en varias empresas a la vez.'
              }
            />
          ) : (
            <>
              <p className="text-caption text-muted-foreground">
                {datos.filas.length} de {plural(datos.total, 'campaña', 'campañas')}
              </p>
              <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
                <table className="w-full min-w-[720px] text-sm">
                  <caption className="sr-only">
                    Campañas conjuntas con su tipo, empresas alcanzadas y estado
                  </caption>
                  <thead>
                    <tr className="border-b border-border/60 text-left text-caption uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="px-4 py-3 font-semibold">Campaña</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Crea</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Empresas con su copia</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Estado</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Creada</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {datos.filas.map((c) => (
                      <tr key={c.id} className="hover:bg-muted/40">
                        <td className="px-4 py-3">
                          <Link
                            href={`${BASE}/${c.id}`}
                            className="font-semibold text-primary hover:underline"
                          >
                            {c.nombre}
                          </Link>
                          {c.descripcion && (
                            <p className="truncate text-caption text-muted-foreground">
                              {c.descripcion}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {CAMPANA_TIPO_LABELS[c.tipo as CampanaTipo] ?? c.tipo}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {/* El encabezado dice ya de qué es el «3/5»: antes
                              ponía solo «Empresas» y había que deducirlo. */}
                          <span className="font-bold tabular-nums text-foreground">
                            {c.aplicadas}/{c.totalEmpresas}
                          </span>
                          {c.todasLasEmpresas && (
                            <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-overline text-muted-foreground">
                              todas
                            </span>
                          )}
                          {c.conError > 0 && (
                            // Lleva a la campaña, donde está el error de cada
                            // empresa: antes era una insignia que no se podía
                            // pulsar y el detalle había que buscarlo a mano.
                            <Link
                              href={`${BASE}/${c.id}`}
                              className="ml-2 inline-block rounded-full bg-destructive/10 px-2 py-0.5 text-overline text-destructive hover:bg-destructive/20"
                            >
                              {c.conError} con error
                            </Link>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-overline ${CHIP_ESTADO[c.estado] ?? 'bg-muted'}`}
                          >
                            {CAMPANA_ESTADO_LABELS[c.estado as CampanaEstado] ?? c.estado}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-caption text-muted-foreground">
                          {formatDateTime(c.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {paginas > 1 && (
                <nav
                  className="flex items-center justify-center gap-3 pt-2"
                  aria-label="Paginación"
                >
                  <Link
                    href={hrefCampanas(f, BASE, { pagina: Math.max(1, f.pagina - 1) })}
                    aria-disabled={f.pagina <= 1}
                    className={`rounded-xl border border-input px-3 py-2 text-sm ${
                      f.pagina <= 1 ? 'pointer-events-none opacity-40' : 'hover:bg-muted'
                    }`}
                  >
                    Anterior
                  </Link>
                  <span className="text-small text-muted-foreground">
                    Página {f.pagina} de {paginas}
                  </span>
                  <Link
                    href={hrefCampanas(f, BASE, { pagina: Math.min(paginas, f.pagina + 1) })}
                    aria-disabled={f.pagina >= paginas}
                    className={`rounded-xl border border-input px-3 py-2 text-sm ${
                      f.pagina >= paginas ? 'pointer-events-none opacity-40' : 'hover:bg-muted'
                    }`}
                  >
                    Siguiente
                  </Link>
                </nav>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
