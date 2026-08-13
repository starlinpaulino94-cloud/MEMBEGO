import Link from 'next/link'
import Form from 'next/form'
import { requireRole } from '@/lib/auth/guards'
import { formatDateTime, formatMoney, TZ_PLATAFORMA } from '@/lib/format'
import { plural } from '@/lib/plural'
import { leerRango, paramsDeRango } from '@/modules/reportes/rango'
import {
  leerFiltroGlobal,
  paramsDeFiltroGlobal,
  ORDENES,
} from '@/modules/reportes/filtrosGlobales'
import { getReporteGlobal, DIAS_POR_VENCER } from '@/modules/reportes/globales'
import { RangoFechas } from '@/components/reportes/RangoFechas'
import { KpiReporte } from '@/components/reportes/KpiReporte'
import { ReporteImprimible, TablaReporte } from '@/components/ui/reporte-imprimible'
import { BotonImprimir } from '@/components/ui/boton-imprimir'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBanner } from '@/components/ui/status-banner'
import { BarChart3, Download } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Reportes de plataforma' }

/**
 * REPORTES DE PLATAFORMA (superadmin).
 *
 * Era la pantalla más vieja del panel y la única que no se benefició de lo que
 * ya se había construido para las otras: no usaba `rango.ts` —cortaba el mes en
 * la zona horaria del servidor—, no usaba `whereCobrado` —el total y el
 * desglose fechaban los cobros con reglas distintas y no sumaban—, no usaba
 * `formatMoney` —«RD$» a mano—, metía las empresas de práctica en los totales
 * de la plataforma mientras el Resumen las dejaba fuera, y no se podía exportar
 * ni imprimir.
 *
 * El motor está en `modules/reportes/globales.ts`, que documenta cada uno de
 * esos fallos. Aquí solo queda pintarlo.
 *
 * QUÉ SE MUESTRA Y QUÉ NO: el desglose por empresa da CUENTAS (ingresos,
 * activas, usos, por vencer). El detalle de QUIÉNES vencen vive en el reporte
 * de cada empresa, donde cabe entero. Antes se intentaba enseñar aquí y salía
 * de una lista global con `take: 500`: las empresas cuyos vencimientos caían
 * más tarde se veían vacías, igual que las que no tenían ninguno.
 */
export default async function SuperadminReportesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams

  // Sin una empresa de la que sacarla, el corte va en la zona de la
  // plataforma. Lo que no puede es ir en la del servidor, que es UTC.
  const rango = leerRango(sp, TZ_PLATAFORMA)
  const filtro = leerFiltroGlobal(sp)
  const r = await getReporteGlobal(rango, filtro)

  const dinero = (n: number, moneda = r.monedaPrincipal) =>
    formatMoney(n, { moneda, idioma: 'es-DO', zonaHoraria: TZ_PLATAFORMA })
  const entero = (n: number) => new Intl.NumberFormat('es-DO').format(n)

  // Mismo periodo, misma búsqueda, mismo alcance: lo que se descarga o se
  // imprime es exactamente lo que está en pantalla.
  const qsFiltro = paramsDeFiltroGlobal(filtro)
  const qsCompleto = new URLSearchParams(qsFiltro)
  for (const [k, v] of new URLSearchParams(paramsDeRango(rango).replace(/^\?/, ''))) {
    qsCompleto.set(k, v)
  }
  const qs = qsCompleto.toString()

  return (
    <ReporteImprimible
      titulo="Reportes de plataforma"
      subtitulo={`${rango.etiqueta} · ${rango.desdeDia} a ${rango.hastaDia} (${plural(rango.dias, 'día', 'días')}) · ${
        filtro.incluirDemo ? 'incluye empresas de práctica' : 'sin empresas de práctica'
      }`}
      generadoEn={formatDateTime(new Date(), { zonaHoraria: TZ_PLATAFORMA, idioma: 'es-DO' })}
      controles={
        <>
          <Button asChild variant="secondary">
            <a href={`/superadmin/reportes/exportar${qs ? `?${qs}` : ''}`}>
              <Download className="mr-2 h-4 w-4" aria-hidden /> Exportar CSV
            </a>
          </Button>
          <BotonImprimir />
        </>
      }
      pie={
        <>
          Los ingresos son cobros de membresía CONFIRMADOS, fechados por su fecha de pago —la
          misma regla que usa el Resumen y el reporte de cada empresa—. «Membresías activas» y
          «por vencer» son una foto de hoy y no dependen del periodo elegido.
        </>
      }
    >
      {r.incompleto && (
        <StatusBanner variant="warning" title="El reporte está incompleto">
          Alguna consulta no respondió, así que hay cifras que pueden estar en cero sin serlo.
          Recarga en unos segundos antes de tomar decisiones con estos números.
        </StatusBanner>
      )}

      {r.variasMonedas && (
        <StatusBanner variant="info" title="Hay empresas cobrando en monedas distintas">
          Los ingresos se muestran separados por moneda. Sumarlos en una sola cifra daría un
          número que no es dinero de nada; la comparación contra el periodo anterior solo se
          calcula para {r.monedaPrincipal}.
        </StatusBanner>
      )}

      <RangoFechas rango={rango} accion="/superadmin/reportes" extra={qsFiltro} />

      {/* Alcance y orden. Van juntos porque las dos preguntas son la misma:
          qué empresas entran y en qué orden se leen. */}
      <Form
        action="/superadmin/reportes"
        className="print:hidden flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4"
      >
        {rango.preset === 'personalizado' ? (
          <>
            <input type="hidden" name="desde" value={rango.desdeDia} />
            <input type="hidden" name="hasta" value={rango.hastaDia} />
          </>
        ) : (
          <input type="hidden" name="rango" value={rango.preset} />
        )}
        <label className="text-caption">
          Buscar empresa
          <Input
            type="search"
            name="q"
            defaultValue={filtro.q}
            placeholder="Nombre de la empresa"
            className="mt-1 w-56"
          />
        </label>
        <label className="text-caption">
          Ordenar por
          <select
            name="orden"
            defaultValue={filtro.orden}
            className="mt-1 h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            {ORDENES.map((o) => (
              <option key={o.clave} value={o.clave}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-10 items-center gap-2 text-small text-foreground">
          <input
            type="checkbox"
            name="demo"
            value="1"
            defaultChecked={filtro.incluirDemo}
            className="h-4 w-4 rounded border-input"
          />
          Incluir empresas de práctica
        </label>
        <Button type="submit" variant="secondary">
          Aplicar
        </Button>
      </Form>

      {!filtro.incluirDemo && r.demosOcultas > 0 && (
        <p className="print:hidden text-caption text-muted-foreground">
          {plural(r.demosOcultas, 'empresa de práctica queda', 'empresas de práctica quedan')} fuera
          de estas cifras. Es el mismo criterio que usa el Resumen.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 print:grid-cols-5 print:gap-2">
        <KpiReporte
          label={`Ingresos cobrados${r.variasMonedas ? ` (${r.monedaPrincipal})` : ''}`}
          kpi={r.ingresoPrincipal}
          formato={(n) => dinero(n)}
        />
        <KpiReporte label="Usos" kpi={r.usos} formato={entero} />
        <KpiReporte label="Clientes nuevos" kpi={r.clientesNuevos} formato={entero} />
        <KpiReporte
          label="Membresías activas"
          kpi={{ valor: r.activas, anterior: 0, variacion: null }}
          formato={entero}
          nota="foto de hoy"
        />
        <KpiReporte
          label={`Por vencer (${DIAS_POR_VENCER} días)`}
          kpi={{ valor: r.porVencer, anterior: 0, variacion: null }}
          formato={entero}
          nota="foto de hoy"
        />
      </div>

      {r.ingresos.length > 1 && (
        <TablaReporte
          titulo="Ingresos por moneda"
          columnas={[
            { clave: 'moneda', titulo: 'Moneda' },
            { clave: 'total', titulo: 'Cobrado en el periodo', alinearDerecha: true },
          ]}
          filas={r.ingresos.map((m) => ({
            __clave: m.moneda,
            moneda: m.moneda,
            total: dinero(m.total, m.moneda),
          }))}
        />
      )}

      <section className="space-y-3">
        <h2 className="text-h4 text-foreground">
          Por empresa
          <span className="ml-2 text-small font-normal text-muted-foreground">
            {plural(r.empresas.length, 'empresa', 'empresas')}
          </span>
        </h2>

        {r.empresas.length === 0 ? (
          <EmptyState
            icon={<BarChart3 className="h-6 w-6" aria-hidden />}
            title={filtro.q ? 'Ninguna empresa coincide' : 'No hay empresas'}
            description={
              filtro.q
                ? `Sin resultados para «${filtro.q}». Prueba con otro nombre o borra la búsqueda.`
                : 'Cuando registres empresas, sus cifras aparecerán aquí.'
            }
          />
        ) : (
          <TablaReporte
            titulo="Desglose por empresa"
            columnas={[
              { clave: 'nombre', titulo: 'Empresa' },
              { clave: 'ingresos', titulo: 'Ingresos', alinearDerecha: true },
              { clave: 'activas', titulo: 'Activas', alinearDerecha: true },
              { clave: 'usos', titulo: 'Usos', alinearDerecha: true },
              { clave: 'porVencer', titulo: `Por vencer (${DIAS_POR_VENCER} d)`, alinearDerecha: true },
            ]}
            filas={r.empresas.map((e) => ({
              __clave: e.companyId,
              nombre: (
                <span className="flex min-w-0 items-center gap-2">
                  {/* En papel el enlace es texto: `ReporteImprimible` le quita
                      el color y el subrayado. */}
                  <Link
                    href={`/superadmin/reportes/${e.companyId}${qs ? `?${qs}` : ''}`}
                    className="truncate font-medium hover:underline"
                  >
                    {e.nombre}
                  </Link>
                  {e.esDemo && (
                    <span className="shrink-0 text-caption text-muted-foreground">· práctica</span>
                  )}
                </span>
              ),
              ingresos: dinero(e.ingresos, e.moneda),
              activas: entero(e.activas),
              usos: entero(e.usos),
              porVencer: entero(e.porVencer),
            }))}
            total={{
              nombre: 'TOTAL',
              ingresos: r.variasMonedas ? '—' : dinero(r.ingresoPrincipal.valor),
              activas: entero(r.activas),
              usos: entero(r.usos.valor),
              porVencer: entero(r.porVencer),
            }}
          />
        )}
      </section>
    </ReporteImprimible>
  )
}
