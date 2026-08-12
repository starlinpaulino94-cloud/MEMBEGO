import Link from 'next/link'
import Image from 'next/image'
import { Building2, ChevronRight, Download, Plus } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { listarEmpresas, type EmpresaFila } from '@/modules/empresas/lista'
import {
  POR_PAGINA,
  hrefPagina,
  leerFiltroEmpresas,
  type FiltroEmpresas,
} from '@/modules/empresas/filtros'
import { desdeHace } from '@/lib/plural'
import { FiltrosEmpresas } from '@/components/empresas/FiltrosEmpresas'
import { AccionesEmpresa } from '@/components/empresas/AccionesEmpresa'
import { EstadoEmpresa } from '@/components/empresas/EstadoEmpresa'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { formatMoneyRD } from '@/lib/format'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Empresas' }

const BASE = '/superadmin/empresas'

/**
 * DOS CIFRAS GRANDES Y EL RESTO EN UNA LÍNEA.
 *
 * Antes eran cinco del mismo tamaño —Clientes, Sucursales, Planes, Activas,
 * Ingresos— y «Sucursales: 1» pesaba lo mismo que «Ingresos: RD$66,200». Cuando
 * todo destaca, nada destaca; y en un móvil de 360 px cada una quedaba en unos
 * 60 px y las cifras de dinero se partían.
 */
function TarjetaEmpresa({ e }: { e: EmpresaFila }) {
  return (
    <Card className="border-border/60 shadow-card">
      <CardContent className="pt-5">
        <div className="flex items-start justify-between gap-3">
          <Link
            href={`${BASE}/${e.id}`}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {e.logoUrl ? (
              <span className="relative block h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-border/60">
                <Image src={e.logoUrl} alt="" fill className="object-cover" />
              </span>
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-brand text-overline text-white">
                {e.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate font-semibold text-foreground">{e.name}</span>
              <span className="block truncate text-caption text-muted-foreground">
                {[e.categoria, e.ciudad].filter(Boolean).join(' · ') || 'Sin categoría'}
              </span>
            </span>
          </Link>
          <div className="flex shrink-0 items-start gap-1.5">
            <EstadoEmpresa
              isActive={e.isActive}
              isPublished={e.isPublished}
              esDemo={e.esDemo}
              soloExcepciones
            />
            <AccionesEmpresa empresa={e} />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-muted/40 py-3 text-center">
            <p className="text-h2 tabular-nums text-foreground">{e.clientes}</p>
            <p className="text-caption text-muted-foreground">Clientes</p>
          </div>
          <div className="rounded-xl bg-muted/40 py-3 text-center">
            <p className="text-h2 tabular-nums text-foreground">
              {formatMoneyRD(e.ingresosHistoricos)}
            </p>
            <p className="text-caption text-muted-foreground">Cobrado histórico</p>
          </div>
        </div>

        <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground">
          <div className="flex gap-1">
            <dt>Membresías vigentes:</dt>
            <dd className="tabular-nums text-foreground">{e.membresiasVigentes}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Este mes:</dt>
            <dd className="tabular-nums text-foreground">{formatMoneyRD(e.cobradoMes)}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Sucursales:</dt>
            <dd className="tabular-nums text-foreground">{e.sucursales}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Planes:</dt>
            <dd className="tabular-nums text-foreground">{e.planes}</dd>
          </div>
        </dl>

        <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-3 text-caption">
          <span className={e.enSilencio ? 'font-medium text-warning' : 'text-muted-foreground'}>
            Actividad: {desdeHace(e.desdeUltimaActividad)}
          </span>
          {/* ENLACE, no un botón que navega. Antes era `router.push` dentro de
              un `<button>`: no se abría en pestaña nueva, no se podía copiar y
              un lector de pantalla lo anunciaba como botón. Y es la acción
              principal de cada tarjeta. */}
          <Link
            href={`${BASE}/${e.id}`}
            className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
          >
            Ver dashboard <ChevronRight aria-hidden className="h-3 w-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

function Paginacion({ f, total }: { f: FiltroEmpresas; total: number }) {
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  if (paginas <= 1) return null
  return (
    <nav className="flex items-center justify-center gap-3 pt-2" aria-label="Paginación">
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

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-h1 text-foreground">Empresas</h1>
          <p className="text-small text-muted-foreground">
            CRM de empresas registradas en la plataforma
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={exportHref}
            prefetch={false}
            className={buttonVariants({ variant: 'secondary' })}
          >
            <Download className="mr-2 h-4 w-4" /> Exportar
          </Link>
          <Link href={`${BASE}/nueva`} className={buttonVariants()}>
            <Plus className="mr-2 h-4 w-4" /> Nueva empresa
          </Link>
        </div>
      </div>

      {/*
        LAS CUATRO CIFRAS SON DEL FILTRO APLICADO, y las de práctica ya no se
        cuelan: antes esta pantalla decía 100 clientes y el Resumen 99, porque
        aquí la empresa de prueba contaba como un negocio real.

        «Ingresos totales» pasa a decir de cuándo habla, y se le añade el mes en
        curso: la cifra histórica no sirve para decidir nada, y estaba junto a
        tres números de estado actual como si fuera del mismo tramo.
      */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Empresas" value={d.total} accent="brand" />
        <StatCard label="Activas" value={d.activas} accent="success" />
        <StatCard label="Clientes" value={d.clientes.toLocaleString('es-DO')} accent="brand" />
        <StatCard
          label="Cobrado este mes"
          value={formatMoneyRD(d.cobradoMes)}
          accent="brand"
          sub={`Histórico: ${formatMoneyRD(d.ingresosHistoricos)}`}
        />
      </div>

      <FiltrosEmpresas
        f={f}
        categorias={d.categorias}
        ciudades={d.ciudades}
        hayDemos={d.hayDemos}
      />

      <p className="text-caption text-muted-foreground">
        {d.total} de {d.totalAmbito} empresa{d.totalAmbito !== 1 ? 's' : ''}
      </p>

      {d.filas.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 py-16">
          <Building2 aria-hidden className="mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium text-muted-foreground">Sin resultados</p>
          <p className="text-small text-muted-foreground/60">Ajusta los filtros o la búsqueda.</p>
          <Link href={BASE} className="mt-3 text-small text-primary hover:underline">
            Limpiar filtros
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {d.filas.map((e) => (
            <TarjetaEmpresa key={e.id} e={e} />
          ))}
        </div>
      )}

      <Paginacion f={f} total={d.total} />
    </div>
  )
}
