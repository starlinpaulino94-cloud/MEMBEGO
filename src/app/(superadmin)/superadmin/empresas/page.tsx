import Link from 'next/link'
import Image from 'next/image'
import { Plus } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { listarEmpresas, type EmpresaFila } from '@/modules/empresas/lista'
import {
  POR_PAGINA,
  hayFiltro,
  hrefPagina,
  leerFiltroEmpresas,
  type FiltroEmpresas,
} from '@/modules/empresas/filtros'
import { desdeHace } from '@/lib/plural'
import { FiltrosEmpresas } from '@/components/empresas/FiltrosEmpresas'
import { AccionesEmpresa } from '@/components/empresas/AccionesEmpresa'
import { EstadoEmpresa } from '@/components/empresas/EstadoEmpresa'
import { Tabla, type Columna } from '@/components/ui/tabla'
import { buttonVariants } from '@/components/ui/button'
import { formatMoneyRD } from '@/lib/format'
import { BotonExportar } from '@/components/ui/boton-exportar'
import { InicialesEmpresa } from '@/components/superadmin/InicialesEmpresa'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Empresas' }

const BASE = '/superadmin/empresas'

/**
 * UNA TABLA, NO UNA PARED DE TARJETAS (piloto de rediseño, oct 2026).
 *
 * Cada empresa era una tarjeta con dos cifras grandes, cuatro pequeñas y un pie: con cuatro empresas la pantalla ya
 * pasaba del alto de un portátil, y comparar dos negocios obligaba a saltar con la vista de una tarjeta a otra porque
 * cada cifra estaba en un sitio distinto. En una tabla la misma cifra de todas está en la misma columna.
 *
 * En el móvil la tabla no cabe: cada empresa es una fila de lista —logo, nombre, lo esencial en una línea y su estado—
 * que lleva a su ficha, donde está todo lo demás.
 */

function LogoEmpresa({ e, className }: { e: EmpresaFila; className: string }) {
  return e.logoUrl ? (
    <span className={`relative block shrink-0 overflow-hidden border border-border/60 ${className}`}>
      <Image src={e.logoUrl} alt="" fill className="object-cover" />
    </span>
  ) : (
    <InicialesEmpresa nombre={e.name} className={className} />
  )
}

function Actividad({ e }: { e: EmpresaFila }) {
  return (
    <span className={e.enSilencio ? 'font-medium text-warning-ink' : 'text-muted-foreground'}>
      {e.desdeUltimaActividad === null ? 'Sin actividad' : desdeHace(e.desdeUltimaActividad)}
    </span>
  )
}

const COLUMNAS: Columna<EmpresaFila>[] = [
  {
    clave: 'empresa',
    encabezado: 'Empresa',
    celda: (e) => (
      <span className="flex min-w-0 items-center gap-3">
        <LogoEmpresa e={e} className="h-8 w-8 rounded-lg" />
        <span className="min-w-0">
          <Link href={`${BASE}/${e.id}`} className="block truncate font-medium text-foreground hover:text-primary hover:underline">
            {e.name}
          </Link>
          <span className="block truncate text-caption text-muted-foreground">
            {[e.categoria, e.ciudad].filter(Boolean).join(' · ') || 'Sin categoría'}
          </span>
        </span>
      </span>
    ),
  },
  {
    clave: 'estado',
    encabezado: 'Estado',
    celda: (e) => <EstadoEmpresa isActive={e.isActive} isPublished={e.isPublished} esDemo={e.esDemo} unico />,
  },
  { clave: 'clientes', encabezado: 'Clientes', tipo: 'numero' },
  { clave: 'membresiasVigentes', encabezado: 'Vigentes', tipo: 'numero', prioridad: 3 },
  { clave: 'cobradoMes', encabezado: 'Este mes', tipo: 'dinero' },
  { clave: 'ingresosHistoricos', encabezado: 'Histórico', tipo: 'dinero', prioridad: 3 },
  { clave: 'actividad', encabezado: 'Última actividad', prioridad: 2, celda: (e) => <Actividad e={e} /> },
  {
    clave: 'acciones',
    encabezado: 'Acciones',
    soloLector: true,
    alineacion: 'derecha',
    celda: (e) => <AccionesEmpresa empresa={e} />,
  },
]

function FilaMovil({ e }: { e: EmpresaFila }) {
  return (
    <li className="border-b border-border/60 last:border-0">
      <Link
        href={`${BASE}/${e.id}`}
        className="flex items-center gap-3 px-4 py-3.5 outline-none transition-colors duration-fast hover:bg-muted/50 focus-visible:bg-muted/50"
      >
        <LogoEmpresa e={e} className="h-10 w-10 rounded-xl" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-foreground">{e.name}</span>
          <span className="block truncate text-caption">
            {/* Lo que cabe en un móvil: clientes y cuándo se movió por última vez. Las vigentes, solo si hay. */}
            <span className="text-muted-foreground">
              {e.clientes} cliente{e.clientes === 1 ? '' : 's'}
              {e.membresiasVigentes > 0 ? ` · ${e.membresiasVigentes} vigente${e.membresiasVigentes === 1 ? '' : 's'}` : ''} ·{' '}
            </span>
            <Actividad e={e} />
          </span>
        </span>
        <EstadoEmpresa isActive={e.isActive} isPublished={e.isPublished} esDemo={e.esDemo} unico />
      </Link>
    </li>
  )
}

function Paginacion({ f, total }: { f: FiltroEmpresas; total: number }) {
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  if (paginas <= 1) return null
  return (
    <nav className="flex items-center justify-center gap-3" aria-label="Paginación">
      <Link
        href={hrefPagina(f, BASE, Math.max(1, f.pagina - 1))}
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
        href={hrefPagina(f, BASE, Math.min(paginas, f.pagina + 1))}
        aria-disabled={f.pagina >= paginas}
        className={`rounded-xl border border-input px-3 py-2 text-sm ${
          f.pagina >= paginas ? 'pointer-events-none opacity-40' : 'hover:bg-muted'
        }`}
      >
        Siguiente
      </Link>
    </nav>
  )
}

export default async function SuperadminEmpresas({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireRole('SUPERADMIN')
  const f = leerFiltroEmpresas(await searchParams)
  const d = await listarEmpresas(f)

  // La exportación se lleva EL MISMO filtro que hay en pantalla. Un CSV que
  // ignora los filtros y descarga todo es la forma más silenciosa de dar un
  // dato equivocado: el archivo no dice de qué es.
  const exportHref = hrefPagina(f, `${BASE}/exportar`, 1)

  // El marco del pie lo pone la tabla; la lista del móvil lo pinta con `marcoPie`.
  const pie = (
    <div className="flex flex-wrap items-center justify-between gap-3 text-caption text-muted-foreground">
      <span>
        {d.total} de {d.totalAmbito} empresa{d.totalAmbito !== 1 ? 's' : ''}
      </span>
      <Paginacion f={f} total={d.total} />
    </div>
  )

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h1 text-foreground">Empresas</h1>
          <p className="mt-1 text-small text-muted-foreground">
            {d.total} empresa{d.total !== 1 ? 's' : ''} · {d.activas} activa{d.activas !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BotonExportar href={exportHref} />
          <Link href={`${BASE}/nueva`} className={buttonVariants()}>
            <Plus className="mr-2 h-4 w-4" /> Nueva empresa
          </Link>
        </div>
      </div>

      {/*
        LAS CIFRAS SON DEL FILTRO APLICADO, y las de práctica ya no se cuelan: antes esta pantalla decía 100 clientes y el
        Resumen 99, porque aquí la empresa de prueba contaba como un negocio real.

        Una franja, no cuatro tarjetas con brillo de color: son totales de la tabla de abajo, no la noticia de la
        pantalla. El número de empresas y de activas ya lo dice la línea bajo el título.
      */}
      <section
        aria-label="Totales"
        className="grid grid-cols-1 divide-y divide-border rounded-xl border border-border bg-card shadow-sm sm:grid-cols-3 sm:divide-x sm:divide-y-0"
      >
        {[
          ['Cobrado este mes', formatMoneyRD(d.cobradoMes)],
          ['Cobrado desde el inicio', formatMoneyRD(d.ingresosHistoricos)],
          ['Clientes', d.clientes.toLocaleString('es-DO')],
        ].map(([etiqueta, valor]) => (
          <div key={etiqueta} className="px-5 py-3.5">
            <p className="text-caption text-muted-foreground">{etiqueta}</p>
            <p className="mt-0.5 text-h3 tabular-nums text-foreground">{valor}</p>
          </div>
        ))}
      </section>

      <section aria-label="Listado de empresas" className="space-y-3">
        <FiltrosEmpresas
          f={f}
          categorias={d.categorias}
          ciudades={d.ciudades}
          hayDemos={d.hayDemos}
        />

        {d.filas.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm md:hidden">
            <ul aria-label="Empresas">
              {d.filas.map((e) => (
                <FilaMovil key={e.id} e={e} />
              ))}
            </ul>
            <div className="border-t border-border px-4 py-3">{pie}</div>
          </div>
        )}

        <Tabla
          caption="Empresas de la plataforma"
          columnas={COLUMNAS}
          filas={d.filas}
          claveDe={(e) => e.id}
          formato={{ dinero: (v) => formatMoneyRD(Number(v)) }}
          enlace={({ href, className, children }) => (
            <Link href={href} className={className}>
              {children}
            </Link>
          )}
          filaNavegable
          hayFiltros={hayFiltro(f)}
          vacio={{ titulo: 'Todavía no hay empresas', descripcion: 'Crea la primera con «Nueva empresa».' }}
          sinResultados={{
            titulo: 'Ninguna empresa coincide',
            descripcion: 'Ajusta los filtros o la búsqueda.',
            accion: (
              <Link href={BASE} className="text-small text-primary hover:underline">
                Limpiar filtros
              </Link>
            ),
          }}
          pie={pie}
          className={d.filas.length > 0 ? 'max-md:hidden' : undefined}
        />
      </section>
    </div>
  )
}
