import Link from 'next/link'
import Form from 'next/form'
import {
  Building2,
  ChevronRight,
  Gift,
  Megaphone,
  MessageCircle,
  X,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatCard } from '@/components/ui/stat-card'
import { BotonExportar } from '@/components/ui/boton-exportar'
import { plural } from '@/lib/plural'
import { listarOperaciones, type OperacionEmpresa } from '@/modules/operaciones/lista'
import { verticalesElegibles } from '@/modules/empresas/verticales'
import {
  AMBITOS,
  AMBITO_LABEL,
  FALTAS,
  FALTA_LABEL,
  POR_PAGINA,
  fichasDeFiltro,
  hayFiltro,
  hrefFiltro,
  leerFiltroOperaciones,
  type FiltroOperaciones,
} from '@/modules/operaciones/filtros'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Operaciones' }

const BASE = '/superadmin/operaciones'

/**
 * UNA FILA DE MÉTRICA. Las tres eran el mismo bloque copiado tres veces.
 *
 * Los iconos van en `text-muted-foreground` y no en verde o ámbar. En el resto
 * del panel esos colores SON el dato —¿esto está sano?—, y gastarlos aquí como
 * decoración fija (el regalo siempre ámbar, WhatsApp siempre verde, dijeran lo
 * que dijeran los números) los desgasta donde sí significan algo.
 */
function FilaMetrica({
  icono: Icono,
  etiqueta,
  children,
}: {
  icono: typeof Megaphone
  etiqueta: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
      <span className="flex items-center gap-2 text-sm text-foreground">
        <Icono aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
        {etiqueta}
      </span>
      {children}
    </div>
  )
}

function TarjetaEmpresa({ e }: { e: OperacionEmpresa }) {
  return (
    <Card className="border-border/60 shadow-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          {/*
            La pantalla detectaba «esta empresa no tiene WhatsApp» y no llevaba
            a ningún sitio: había que salir, ir a Empresas, buscarla y entrar.
            Se enlaza a su página EN ESTE PANEL, no a `/admin/*`: aquélla opera
            sobre la empresa activa de la sesión, así que llevaría a otra
            empresa y cambiaría el panel entero de contexto.
          */}
          <Link
            href={`/superadmin/empresas/${e.id}`}
            className="inline-flex items-center gap-1 rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {e.name}
            <ChevronRight aria-hidden className="h-4 w-4 text-muted-foreground" />
          </Link>
          <span className="flex flex-wrap items-center gap-1">
            {/* El vertical REAL: `tipoNegocioCodigo` cuando está. La insignia
                enseñaba `type`, la categoría histórica que el sistema ya no usa
                para decidir compatibilidad. */}
            <Badge variant="secondary" className="text-caption">
              {e.verticalNombre}
            </Badge>
            {e.esDemo && (
              <Badge
                variant="outline"
                className="border-warning/40 bg-warning/10 text-caption text-warning"
              >
                Práctica
              </Badge>
            )}
            {!e.isActive && (
              <Badge variant="outline" className="text-caption text-muted-foreground">
                Suspendida
              </Badge>
            )}
            {e.isActive && !e.isPublished && (
              <Badge variant="outline" className="text-caption text-muted-foreground">
                Sin publicar
              </Badge>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <FilaMetrica icono={Megaphone} etiqueta="Promociones vigentes">
          {/*
            «Vigentes», no «activas»: se contaba `activo: true` a secas, así que
            entraban las caducadas hace meses y las programadas para el futuro.
            Y el total deja fuera las archivadas.
          */}
          <span className="font-semibold tabular-nums text-foreground">
            {e.promosVigentes} <span className="font-normal text-muted-foreground">de</span>{' '}
            {e.promosTotal}
          </span>
        </FilaMetrica>

        <FilaMetrica icono={Gift} etiqueta="Referidos completados">
          {/* Un 40 acumulado en dos años y un 40 del mes pasado se veían
              idénticos. La ventana es lo que dice si esto sigue vivo. */}
          <span className="text-right">
            <span className="font-semibold tabular-nums text-foreground">
              {e.referidosMes}
            </span>{' '}
            <span className="text-caption text-muted-foreground">
              en 30 días · {e.referidosCompletados} en total
            </span>
          </span>
        </FilaMetrica>

        <FilaMetrica icono={Gift} etiqueta="Reglas de referido">
          {/* Encendidas: `activo` no se filtraba, así que tres reglas apagadas
              figuraban igual que tres funcionando. */}
          <span className="font-semibold tabular-nums text-foreground">
            {plural(e.reglasActivas, 'activa', 'activas')}
          </span>
        </FilaMetrica>

        {/* El número completo dentro de la insignia desbordaba la fila. Estado
            arriba, número debajo y marcable. */}
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm text-foreground">
              <MessageCircle aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
              WhatsApp
            </span>
            {e.whatsapp ? (
              <Badge
                variant="outline"
                className={
                  e.whatsapp.activo
                    ? 'border-success/40 bg-success/10 text-caption text-success'
                    : 'text-caption text-muted-foreground'
                }
              >
                {e.whatsapp.activo ? 'Activo' : 'Inactivo'}
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-caption">
                Sin configurar
              </Badge>
            )}
          </div>
          {e.whatsapp && (
            <a
              href={`tel:${e.whatsapp.numero.replace(/\s+/g, '')}`}
              className="mt-1 block text-caption text-muted-foreground hover:text-foreground hover:underline"
            >
              {e.whatsapp.numero}
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function Paginacion({ f, total }: { f: FiltroOperaciones; total: number }) {
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  if (paginas <= 1) return null
  return (
    <nav className="flex items-center justify-center gap-3 pt-2" aria-label="Paginación">
      <Link
        href={hrefFiltro(f, BASE, { pagina: Math.max(1, f.pagina - 1) })}
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
        href={hrefFiltro(f, BASE, { pagina: Math.min(paginas, f.pagina + 1) })}
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

export default async function OperacionesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireRole('SUPERADMIN')
  const f = leerFiltroOperaciones(await searchParams)

  // Los verticales van ANTES y aparte: `verticalesElegibles()` abre su propia
  // transacción, y pedirlos desde dentro de la del listado tomaría una segunda
  // conexión del pool. Eso no falla — se degrada, que es peor de encontrar.
  const verticales = new Map((await verticalesElegibles()).map((v) => [v.codigo, v.nombre]))

  let d = {
    filas: [] as OperacionEmpresa[],
    total: 0,
    totalAmbito: 0,
    faltan: { whatsapp: 0, promociones: 0, reglas: 0 },
  }
  try {
    d = await listarOperaciones(f, verticales)
  } catch (e) {
    console.error('[operaciones]', e)
  }

  const fichas = fichasDeFiltro(f, BASE)
  const clase =
    'h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground'

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Superadmin</p>
          <h1 className="text-h1 text-foreground">Operaciones</h1>
          <p className="text-small text-muted-foreground">
            Qué tiene montado cada empresa: promociones, referidos y WhatsApp.
          </p>
        </div>
        <BotonExportar href={hrefFiltro(f, `${BASE}/exportar`)} />
      </div>

      {/*
        LO QUE FALTA, ARRIBA Y PULSABLE. Es la pregunta que esta pantalla existe
        para responder, y había que leer las cuarenta tarjetas a ojo para
        contestarla. Las cifras son del ÁMBITO, no del filtro: si menguaran al
        filtrar dejarían de decir cuánto trabajo queda.
      */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard
          label="Sin WhatsApp"
          value={d.faltan.whatsapp}
          icon={MessageCircle}
          accent={d.faltan.whatsapp > 0 ? 'warning' : 'success'}
          sub="Sin configurar o apagado"
          href={hrefFiltro(f, BASE, { falta: 'whatsapp', pagina: 1 })}
          hrefLabel="Ver las empresas sin WhatsApp"
        />
        <StatCard
          label="Sin promociones vigentes"
          value={d.faltan.promociones}
          icon={Megaphone}
          accent={d.faltan.promociones > 0 ? 'warning' : 'success'}
          sub="Nada que ofrecer hoy"
          href={hrefFiltro(f, BASE, { falta: 'promociones', pagina: 1 })}
          hrefLabel="Ver las empresas sin promociones vigentes"
        />
        <StatCard
          label="Sin reglas de referido"
          value={d.faltan.reglas}
          icon={Gift}
          accent={d.faltan.reglas > 0 ? 'warning' : 'success'}
          sub="El programa no puede premiar"
          href={hrefFiltro(f, BASE, { falta: 'reglas', pagina: 1 })}
          hrefLabel="Ver las empresas sin reglas de referido"
        />
      </div>

      <div className="space-y-3">
        <Form action={BASE} className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1 lg:max-w-sm">
            <label htmlFor="q" className="mb-1 block text-caption text-muted-foreground">
              Buscar
            </label>
            <input
              id="q"
              name="q"
              defaultValue={f.q}
              placeholder="Nombre de la empresa…"
              className={`${clase} w-full`}
            />
          </div>

          <div>
            <label htmlFor="falta" className="mb-1 block text-caption text-muted-foreground">
              Qué le falta
            </label>
            <select id="falta" name="falta" defaultValue={f.falta} className={clase}>
              {FALTAS.map((x) => (
                <option key={x} value={x}>
                  {FALTA_LABEL[x]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="ambito" className="mb-1 block text-caption text-muted-foreground">
              Incluir
            </label>
            <select id="ambito" name="ambito" defaultValue={f.ambito} className={clase}>
              {AMBITOS.map((a) => (
                <option key={a} value={a}>
                  {AMBITO_LABEL[a]}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="h-10 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Aplicar
          </button>
        </Form>

        {fichas.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {fichas.map((ficha) => (
              <Link
                key={ficha.clave}
                href={ficha.quitarHref}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-caption text-foreground hover:bg-muted"
                aria-label={`Quitar filtro ${ficha.texto}`}
              >
                {ficha.texto}
                <X aria-hidden className="h-3 w-3" />
              </Link>
            ))}
            {hayFiltro(f) && (
              <Link href={BASE} className="text-caption text-primary hover:underline">
                Limpiar todo
              </Link>
            )}
          </div>
        )}
      </div>

      <p className="text-caption text-muted-foreground">
        {d.total} de {plural(d.totalAmbito, 'empresa', 'empresas')}
      </p>

      {d.filas.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 py-16">
          <Building2 aria-hidden className="mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium text-muted-foreground">
            {d.totalAmbito === 0 ? 'No hay empresas registradas' : 'Sin resultados'}
          </p>
          <p className="text-small text-muted-foreground/60">
            {d.totalAmbito === 0
              ? 'Crea la primera desde el panel de empresas.'
              : 'Ajusta los filtros o la búsqueda.'}
          </p>
          {d.totalAmbito > 0 && (
            <Link href={BASE} className="mt-3 text-small text-primary hover:underline">
              Limpiar filtros
            </Link>
          )}
        </div>
      ) : (
        <ul className="grid list-none gap-4 md:grid-cols-2">
          {d.filas.map((e) => (
            <li key={e.id}>
              <TarjetaEmpresa e={e} />
            </li>
          ))}
        </ul>
      )}

      <Paginacion f={f} total={d.total} />
    </div>
  )
}
