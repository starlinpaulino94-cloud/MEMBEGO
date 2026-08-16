export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { AlertTriangle, CalendarClock, ShieldCheck, X } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { leerPaginacion } from '@/lib/paginacion'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'
import { StatCard } from '@/components/ui/stat-card'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/format'
import { plural } from '@/lib/plural'
import { membresiaEstadoUi } from '@/lib/estados'
import { MembershipAdminActions } from '@/components/admin/MembershipAdminActions'
import { AjustarLavados } from '@/components/superadmin/AjustarLavados'
import { listarMembresias, type MembresiaFila } from '@/modules/membresias/lista'
import {
  AMBITOS,
  AMBITO_LABEL,
  ESTADO_LABEL,
  FILTROS_ESTADO,
  fichasDeFiltro,
  hayFiltro,
  hrefFiltro,
  leerFiltroMembresias,
} from '@/modules/membresias/filtros'
import type { MembershipEstado } from '@/types'
import { BotonExportar } from '@/components/ui/boton-exportar'

export const metadata = { title: 'Membresías' }

const BASE = '/superadmin/membresias'

function fmtDate(d: Date | null) {
  return d ? formatDate(d) : '—'
}

/**
 * EL ESTADO, Y SI VALE HOY.
 *
 * `ACTIVA` no significa vigente: significa «nadie la ha tocado desde que se
 * activó». Lo dice el propio módulo de vigencia, y por eso existe
 * `membresiaVigente()`. La tabla pintaba `estado` en crudo, así que una
 * membresía vencida en marzo salía como «Activa» en agosto mientras el escáner
 * del mostrador la rechazaba — y ésta es la pantalla a la que se viene a
 * averiguar por qué la rechazó.
 *
 * No se sustituye la etiqueta: se le añade la advertencia. El estado guardado
 * sigue siendo un dato (es lo que hay que arreglar), y taparlo con «Vencida»
 * escondería que la base dice otra cosa.
 */
function EstadoConVigencia({ fila }: { fila: MembresiaFila }) {
  const ui = membresiaEstadoUi(fila.estado)
  const desfasada = fila.estado === 'ACTIVA' && !fila.vigente
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge variant={desfasada ? 'outline' : ui.variant}>{ui.label}</Badge>
      {desfasada && (
        <Badge
          variant="outline"
          className="border-warning/40 bg-warning/10 text-caption text-warning"
          title="Sigue marcada como activa en la base, pero su fecha ya pasó: el escáner la rechaza."
        >
          ya venció
        </Badge>
      )}
    </span>
  )
}

export default async function SuperadminMembresiasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const f = leerFiltroMembresias(sp)
  const paginacion = leerPaginacion(sp)

  let d = {
    filas: [] as MembresiaFila[],
    total: 0,
    resumen: { porValidar: 0, vigentes: 0, vencenPronto: 0, vencidasSinMarcar: 0 },
    empresas: [] as { id: string; name: string; esDemo: boolean }[],
  }
  try {
    d = await listarMembresias(f, paginacion)
  } catch (e) {
    console.error('[superadmin-membresias]', e)
  }

  const fichas = fichasDeFiltro(f, BASE, d.empresas)
  const clase = 'rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/*
            Se llamaba «Solicitudes de membresía» y la tabla enseñaba también
            las activas, las vencidas y las canceladas. El título describía una
            de las seis cosas que hay aquí.
          */}
          <h1 className="text-h1 text-foreground">Membresías</h1>
          <p className="text-muted-foreground">
            Todas las membresías de la plataforma: valida comprobantes, renueva,
            desactiva y ajusta usos.
          </p>
        </div>
        <BotonExportar href={hrefFiltro(f, `${BASE}/exportar`)} />
      </div>

      {/*
        LAS CIFRAS SON DEL ÁMBITO, NO DEL FILTRO, y llevan a su propia lista.
        Son el trabajo pendiente: si menguaran al filtrar dejarían de servir
        para decidir qué mirar, que es justo para lo que están.
      */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Por validar"
          value={d.resumen.porValidar}
          icon={ShieldCheck}
          accent={d.resumen.porValidar > 0 ? 'warning' : 'success'}
          sub="Comprobantes esperando"
          href={hrefFiltro({ ...f, estado: 'PENDIENTE_PAGO' }, BASE)}
          hrefLabel="Ver los comprobantes por validar"
        />
        <StatCard
          label="Vigentes hoy"
          value={d.resumen.vigentes.toLocaleString('es-DO')}
          accent="brand"
          sub="Activas y sin vencer"
          href={hrefFiltro({ ...f, estado: 'vigentes' }, BASE)}
          hrefLabel="Ver las membresías vigentes"
        />
        <StatCard
          label="Vencen en 7 días"
          value={d.resumen.vencenPronto}
          icon={CalendarClock}
          accent={d.resumen.vencenPronto > 0 ? 'warning' : 'brand'}
          sub="Para avisar antes"
        />
        {/*
          Debería ser 0 SIEMPRE: `vencerMembresias()` corre a diario. Si no lo
          es, el job no está corriendo, y ésta es la única pantalla donde eso se
          nota antes de que un cliente se plante en el mostrador.
        */}
        <StatCard
          label="Vencidas sin marcar"
          value={d.resumen.vencidasSinMarcar}
          icon={AlertTriangle}
          accent={d.resumen.vencidasSinMarcar > 0 ? 'danger' : 'success'}
          sub={d.resumen.vencidasSinMarcar > 0 ? 'El proceso diario no corrió' : 'Al día'}
          href={hrefFiltro({ ...f, estado: 'vencidas-sin-marcar' }, BASE)}
          hrefLabel="Ver las membresías vencidas sin marcar"
        />
      </div>

      <div className="space-y-3">
        <form className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="q" className="mb-1 block text-caption text-muted-foreground">
              Buscar
            </label>
            <input id="q" name="q" defaultValue={f.q} placeholder="Nombre o correo…" className={clase} />
          </div>

          <div>
            <label htmlFor="estado" className="mb-1 block text-caption text-muted-foreground">
              Estado
            </label>
            <select id="estado" name="estado" defaultValue={f.estado} className={clase}>
              {FILTROS_ESTADO.map((e) => (
                <option key={e} value={e}>
                  {ESTADO_LABEL[e]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="empresa" className="mb-1 block text-caption text-muted-foreground">
              Empresa
            </label>
            <select id="empresa" name="empresa" defaultValue={f.empresa ?? 'todas'} className={clase}>
              <option value="todas">Todas</option>
              {d.empresas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.esDemo ? `${c.name} (práctica)` : c.name}
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
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Filtrar
          </button>
        </form>

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

      <p className="text-small text-muted-foreground">
        {plural(d.total, 'resultado', 'resultados')}
      </p>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted text-caption text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Cliente</th>
              <th className="px-4 py-3 text-left">Empresa</th>
              <th className="px-4 py-3 text-left">Plan</th>
              {/* «Usos», no «Lavados»: esta pantalla cruza empresas que no
                  lavan carros, y el plan ya dice «usos incluidos». */}
              <th className="px-4 py-3 text-left">Usos</th>
              <th className="px-4 py-3 text-left">Estado</th>
              <th className="px-4 py-3 text-left">Inicio</th>
              <th className="px-4 py-3 text-left">Vencimiento</th>
              <th className="px-4 py-3 text-left">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {d.filas.map((m) => (
              <tr key={m.id} className="hover:bg-muted">
                <td className="px-4 py-3 font-medium text-foreground">
                  {/* La ficha del cliente estaba a un id de distancia —la
                      página ya lo pasaba— y no había forma de abrirla desde
                      aquí. Es la pregunta siguiente en cuanto algo no cuadra. */}
                  <Link
                    href={`/admin/clientes/${m.clienteId}`}
                    className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {m.clienteNombre}
                  </Link>
                  <div className="text-caption text-muted-foreground">{m.clienteEmail}</div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {m.empresaNombre}
                  {m.empresaEsDemo && (
                    <span className="ml-1 text-caption font-medium text-warning">· práctica</span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{m.planNombre}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <AjustarLavados
                    membershipId={m.id}
                    lavados={m.usosRestantes}
                    esIlimitado={m.planEsIlimitado}
                  />
                </td>
                <td className="px-4 py-3">
                  <EstadoConVigencia fila={m} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">{fmtDate(m.fechaInicio)}</td>
                <td className="px-4 py-3 text-muted-foreground">{fmtDate(m.fechaVencimiento)}</td>
                <td className="px-4 py-3">
                  <MembershipAdminActions
                    membershipId={m.id}
                    estado={m.estado as MembershipEstado}
                  />
                </td>
              </tr>
            ))}
            {d.filas.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  {hayFiltro(f) ? (
                    <>
                      Sin resultados con estos filtros.{' '}
                      <Link href={BASE} className="text-primary hover:underline">
                        Limpiar
                      </Link>
                    </>
                  ) : (
                    'No hay membresías.'
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {d.filas.length > 0 && (
        <TablaPaginacion
          paginacion={paginacion}
          total={d.total}
          params={sp}
          etiqueta="membresías"
        />
      )}
    </div>
  )
}
