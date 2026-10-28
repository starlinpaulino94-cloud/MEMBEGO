import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, CircleCheck } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { Badge } from '@/components/ui/badge'
import { StatusChip } from '@/components/ui/status-chip'
import { Tabla, type Columna } from '@/components/ui/tabla'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/format'
import { ACCION_LABEL, ENTIDAD_LABEL } from '@/modules/auditoria/queries'
import { DIAS_SILENCIO } from '@/modules/empresas/silencio'
import { hrefFiltro } from '@/modules/membresias/filtros'
import { desdeHace, plural } from '@/lib/plural'
import {
  PERIODOS,
  getPanelPlataforma,
  leerPeriodo,
  type EmpresaPanel,
  type Metrica,
} from '@/modules/superadmin/panel'
import { InicialesEmpresa } from '@/components/superadmin/InicialesEmpresa'
import { EstadoEmpresa } from '@/components/empresas/EstadoEmpresa'

export const dynamic = 'force-dynamic'

/** Hora de la actividad. Los defaults del formateador del sistema son los de la
 *  plataforma, que es de quien es este panel. */
function fmtHora(d: Date) {
  return formatDate(d, null, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}


const money = (n: number) =>
  new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    maximumFractionDigits: 0,
  }).format(n)

/** La variación como insignia: verde si sube, roja si baja. Sin periodo previo no se inventa un porcentaje. */
function Variacion({ m }: { m: Metrica }) {
  if (m.variacion === null) return null
  return (
    <Badge variant={m.variacion >= 0 ? 'success' : 'destructive'} className="tabular-nums">
      {m.variacion >= 0 ? '+' : '−'}
      {Math.abs(m.variacion)} %
    </Badge>
  )
}

/**
 * LO QUE PIDE TRABAJO, COMO UNA LISTA (piloto de rediseño, oct 2026).
 *
 * Eran cuatro baldosas del mismo tamaño, también las que estaban en cero: «Tickets abiertos: 0» ocupaba lo mismo que
 * «2 empresas en silencio», y para saber CUÁLES había que ir a otra pantalla. Ahora cada asunto pendiente es una fila
 * que dice cuántos, cuáles y adónde ir; lo que está en cero baja a una sola línea de «al día».
 */
interface Asunto {
  clave: string
  titulo: string
  detalle: string
  href: string
  accion: string
  /** El tono y su palabra van en `StatusChip`: el color no es la única señal. */
  tono: 'danger' | 'warning' | 'info'
  etiqueta: string
}

function nombres(empresas: EmpresaPanel[], conTiempo = false): string {
  const lista = empresas.slice(0, 3).map((e) => (conTiempo ? `${e.name} (${desdeHace(e.desdeUltimaActividad)})` : e.name))
  return lista.join(' · ') + (empresas.length > 3 ? ` y ${empresas.length - 3} más` : '')
}

const COLUMNAS_EMPRESA: Columna<EmpresaPanel>[] = [
  {
    clave: 'empresa',
    encabezado: 'Empresa',
    celda: (c) => (
      <span className="flex min-w-0 items-center gap-2.5">
        {c.logoUrl ? (
          <span className="relative block h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-border/60">
            <Image src={c.logoUrl} alt="" fill className="object-cover" />
          </span>
        ) : (
          <InicialesEmpresa nombre={c.name} className="h-8 w-8 rounded-lg" />
        )}
        <Link href={`/superadmin/empresas/${c.id}`} className="truncate font-medium text-foreground hover:text-primary hover:underline">
          {c.name}
        </Link>
      </span>
    ),
  },
  {
    clave: 'estado',
    encabezado: 'Estado',
    celda: (c) => <EstadoEmpresa isActive={c.isActive} isPublished={c.isPublished} esDemo={c.esDemo} unico />,
  },
  { clave: 'clientes', encabezado: 'Clientes', tipo: 'numero' },
  { clave: 'activas', encabezado: 'Activas', tipo: 'numero', prioridad: 2 },
  {
    clave: 'actividad',
    encabezado: 'Última actividad',
    prioridad: 2,
    celda: (c) => (
      <span className={c.enSilencio ? 'font-medium text-warning-ink' : 'text-muted-foreground'}>
        {c.desdeUltimaActividad === null ? 'Sin actividad' : desdeHace(c.desdeUltimaActividad)}
      </span>
    ),
  },
]

export default async function SuperadminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>
}) {
  await requireRole('SUPERADMIN')
  const periodo = leerPeriodo((await searchParams).dias)
  const d = await getPanelPlataforma(periodo)

  const silenciosas = d.empresas.filter((e) => e.enSilencio)
  const sinPublicar = d.empresas.filter((e) => !e.isPublished)
  const asuntos: Asunto[] = []
  if (d.porValidar > 0) {
    asuntos.push({
      clave: 'pagos',
      titulo: `${plural(d.porValidar, 'pago', 'pagos')} por validar`,
      detalle: 'Comprobantes, cobros en sucursal, compras y cambios de plan esperando a alguien',
      // La cola de comprobantes de la plataforma es la lista de Membresías (D-05), no Operaciones.
      href: hrefFiltro({ estado: 'PENDIENTE_PAGO' }, '/superadmin/membresias'),
      accion: 'Revisar',
      tono: 'warning',
      etiqueta: 'Pendiente',
    })
  }
  if (d.ticketsAbiertos > 0) {
    asuntos.push({
      clave: 'tickets',
      titulo: plural(d.ticketsAbiertos, 'ticket abierto', 'tickets abiertos'),
      detalle: 'Empresas esperando respuesta de soporte',
      href: '/superadmin/tickets',
      accion: 'Responder',
      tono: 'danger',
      etiqueta: 'Urgente',
    })
  }
  if (d.enSilencio > 0) {
    asuntos.push({
      clave: 'silencio',
      titulo: `${plural(d.enSilencio, 'empresa', 'empresas')} sin actividad en ${DIAS_SILENCIO} días`,
      detalle: nombres(silenciosas, true) || 'Activas, pero sin una sola señal de vida',
      href: '/superadmin/empresas?orden=actividad',
      accion: 'Ver',
      tono: 'warning',
      etiqueta: 'Aviso',
    })
  }
  if (d.sinPublicar > 0) {
    asuntos.push({
      clave: 'sin-publicar',
      titulo: `${plural(d.sinPublicar, 'empresa', 'empresas')} sin publicar`,
      detalle: sinPublicar.length > 0 ? `${nombres(sinPublicar)}: no ${sinPublicar.length === 1 ? 'aparece' : 'aparecen'} en el directorio` : 'No aparecen en el directorio',
      href: '/superadmin/empresas?estado=sin-publicar',
      accion: 'Ver',
      tono: 'info',
      etiqueta: 'Info',
    })
  }
  const alDia = [
    d.porValidar === 0 && '0 pagos por validar',
    d.ticketsAbiertos === 0 && '0 tickets abiertos',
    d.enSilencio === 0 && 'ninguna empresa en silencio',
    d.sinPublicar === 0 && 'todas publicadas',
  ].filter(Boolean)

  const cifras = [
    {
      etiqueta: 'Empresas',
      valor: String(d.totalEmpresas),
      sub: d.demos.length > 0 ? <>+{d.demos.length} de práctica, aparte</> : <>reales</>,
      href: '/superadmin/empresas',
    },
    {
      etiqueta: 'Clientes',
      valor: d.totalClientes.toLocaleString('es-DO'),
      sub: (
        <>
          {plural(d.nuevos.valor, 'nuevo', 'nuevos')} <Variacion m={d.nuevos} />
        </>
      ),
      href: '/superadmin/usuarios',
    },
    {
      etiqueta: 'Membresías activas',
      valor: d.totalActivas.toLocaleString('es-DO'),
      sub: <>al cierre de hoy</>,
      href: '/superadmin/membresias',
    },
    {
      // Misma definición de «cobrado» que el Resumen de la empresa y Reportes (`modules/pagos/cobrado.ts`).
      etiqueta: 'Cobrado',
      valor: money(d.cobrado.valor),
      sub: (
        <>
          <Variacion m={d.cobrado} /> {d.cobrado.variacion === null ? 'sin periodo previo' : `antes ${money(d.cobrado.anterior)}`}
        </>
      ),
      href: '/superadmin/reportes',
    },
  ]

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h1 text-foreground">Centro de control</h1>
          <p className="mt-1 text-small text-muted-foreground">Toda la plataforma · sin empresas de práctica</p>
        </div>
        {/* El periodo como segmentos que son ENLACES: se ve cuál está puesto sin abrir un desplegable, y cada uno es una
            URL (`?dias=`) que se comparte. Antes era un `<select>` con un botón «Ver» al lado. */}
        <nav aria-label="Periodo" className="inline-flex rounded-xl bg-muted p-1">
          {PERIODOS.map((p) => (
            <Link
              key={p}
              href={`/superadmin/dashboard?dias=${p}`}
              aria-current={p === periodo ? 'page' : undefined}
              className={cn(
                'rounded-lg px-3 py-1.5 text-small font-medium transition-colors duration-fast',
                p === periodo ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {p} días
            </Link>
          ))}
        </nav>
      </div>

      {/* Primero lo que pide trabajo: las cifras informan; esto no puede esperar a un scroll. */}
      <section aria-labelledby="atencion" className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <h2 id="atencion" className="text-h4 text-foreground">
            Necesita tu atención
          </h2>
          {asuntos.length > 0 && (
            <span className="text-caption text-muted-foreground">{plural(asuntos.length, 'asunto', 'asuntos')}</span>
          )}
        </div>
        {asuntos.length === 0 ? (
          <p className="flex items-center gap-2 px-5 py-4 text-small text-foreground">
            <CircleCheck aria-hidden className="h-4 w-4 text-success" />
            Todo al día: nada espera por ti ahora mismo.
          </p>
        ) : (
          <ul>
            {asuntos.map((a) => (
              <li key={a.clave} className="flex items-center gap-3 border-b border-border/60 px-5 py-3.5 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-foreground">
                    <StatusChip tone={a.tono}>{a.etiqueta}</StatusChip>
                    {a.titulo}
                  </p>
                  <p className="truncate text-caption text-muted-foreground">{a.detalle}</p>
                </div>
                <Link
                  href={a.href}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-small font-medium text-foreground transition-colors duration-fast hover:bg-muted"
                >
                  {a.accion}
                  <span className="sr-only">: {a.titulo}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {asuntos.length > 0 && alDia.length > 0 && (
          <p className="border-t border-border bg-muted/40 px-5 py-2.5 text-caption text-muted-foreground">
            Al día: {alDia.join(' · ')}
          </p>
        )}
      </section>

      {/* Cuatro cifras en UNA franja: son el contexto, no la noticia. Antes eran cuatro tarjetas con icono y brillo de
          color que competían con los avisos. */}
      <section aria-label="Cifras del periodo" className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card shadow-sm lg:grid-cols-4">
        {cifras.map((c, i) => (
          <Link
            key={c.etiqueta}
            href={c.href}
            className={cn(
              'block px-5 py-4 outline-none transition-colors duration-fast hover:bg-muted/40 focus-visible:bg-muted/40',
              i % 2 === 1 && 'border-l border-border',
              i >= 2 && 'max-lg:border-t lg:border-l'
            )}
          >
            <p className="text-caption text-muted-foreground">{c.etiqueta}</p>
            <p className="mt-0.5 text-h2 tabular-nums text-foreground">{c.valor}</p>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-caption text-muted-foreground">{c.sub}</p>
          </Link>
        ))}
      </section>

      {/* `minmax(0, …)` y `grid-cols-1`: con pistas `auto`/`fr` a secas la columna crecía hasta el ancho mínimo de su
          contenido y, en móvil, la tabla y la actividad se salían por la derecha. Las dos columnas, solo desde 2xl: a
          1 366 px, junto al menú, la tabla de empresas quedaba en ~600 px y «Última actividad» se cortaba. */}
      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section aria-labelledby="empresas" className="min-w-0">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="empresas" className="text-h4 text-foreground">
              Empresas
            </h2>
            <Link
              href="/superadmin/empresas"
              className="inline-flex items-center gap-1 text-small font-medium text-primary hover:underline"
            >
              Ver todas <ArrowRight aria-hidden className="h-3.5 w-3.5" />
            </Link>
          </div>
          <Tabla
            caption="Empresas de la plataforma"
            columnas={COLUMNAS_EMPRESA}
            filas={d.empresas}
            claveDe={(c) => c.id}
            filaNavegable
            vacio={{ titulo: 'Todavía no hay empresas reales' }}
            // Las de práctica siguen a la vista —una demo que no se ve es una que alguien deja encendida y olvida—,
            // pero en una línea: sus números no cuentan en ninguna cifra de esta pantalla.
            pie={
              d.demos.length > 0 ? (
                <span className="flex flex-wrap items-center justify-between gap-2 text-caption">
                  <span>
                    {d.demos.length} de práctica: {d.demos.map((c) => c.name).join(', ')}
                  </span>
                  <Link href="/superadmin/demo" className="font-medium text-primary hover:underline">
                    Administrar
                  </Link>
                </span>
              ) : undefined
            }
          />
        </section>

        <section aria-labelledby="actividad" className="min-w-0">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="actividad" className="text-h4 text-foreground">
              Actividad reciente
            </h2>
            <Link
              href="/superadmin/auditoria"
              className="inline-flex items-center gap-1 text-small font-medium text-primary hover:underline"
            >
              Auditoría <ArrowRight aria-hidden className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="rounded-xl border border-border bg-card px-5 shadow-sm">
            {d.actividad.length === 0 ? (
              <p className="py-8 text-center text-small text-muted-foreground">
                La actividad de todas las empresas aparecerá aquí.
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {d.actividad.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 py-3 text-sm">
                    <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">
                        {/* El mapa CANÓNICO de la bitácora: con una copia local a la que le faltaban entradas, esta
                            lista enseñaba «CUENTA_ELIMINADA» en crudo. */}
                        {ACCION_LABEL[a.accion] ?? a.accion}
                      </p>
                      <p className="truncate text-caption text-muted-foreground">
                        {[
                          a.entidadTipo ? (ENTIDAD_LABEL[a.entidadTipo] ?? a.entidadTipo) : null,
                          a.empresa ?? 'Plataforma',
                          a.autor,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <time dateTime={a.createdAt.toISOString()} className="shrink-0 text-caption text-muted-foreground">
                      {fmtHora(a.createdAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
