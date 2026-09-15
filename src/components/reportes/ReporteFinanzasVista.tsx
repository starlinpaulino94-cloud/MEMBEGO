import { plural } from '@/lib/plural'
import { formatMoney, type RegionalPrefs } from '@/lib/format'
import type { Rango } from '@/modules/reportes/rango'
import type { ReporteFinanzas } from '@/modules/reportes/finanzas'
import { KpiReporte } from '@/components/reportes/KpiReporte'
import { ReporteImprimible } from '@/components/ui/reporte-imprimible'
import { SectionHeader } from '@/components/ui/section-header'
import { StatusBanner } from '@/components/ui/status-banner'

const ESTADO_INTENTO: Record<string, string> = {
  CREADO: 'Creado',
  REDIRIGIDO: 'Redirigido a la pasarela',
  EN_VALIDACION: 'En validación',
  APROBADO: 'Aprobado',
  RECHAZADO: 'Rechazado',
  ERROR: 'Error técnico',
}

const METODO: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  TARJETA: 'Tarjeta',
  TRANSFERENCIA: 'Transferencia',
  PRESENCIAL: 'En sucursal',
  OTRO: 'Otro',
}

/**
 * FINANZAS.
 *
 * El orden de la pantalla es el argumento: primero lo que entró, después lo
 * que pudo no entrar, y al final —separado y rotulado— lo que solo es una
 * estimación. Un panel que pone el recurrente estimado junto al ingreso
 * cobrado convierte una previsión en un hecho sin que nadie lo decida.
 */
export function ReporteFinanzasVista({
  r,
  rango,
  prefs,
  empresa,
  generadoEn,
  eyebrow,
  controles,
}: {
  r: ReporteFinanzas
  rango: Rango
  prefs: RegionalPrefs | null
  empresa: string
  generadoEn: string
  eyebrow?: React.ReactNode
  controles?: React.ReactNode
}) {
  const dinero = (n: number) => formatMoney(n, prefs)
  const entero = (n: number) => new Intl.NumberFormat(prefs?.idioma || 'es-DO').format(n)

  return (
    <ReporteImprimible
      titulo={`Finanzas · ${empresa}`}
      subtitulo={`${rango.etiqueta} · ${rango.desdeDia} a ${rango.hastaDia} (${plural(rango.dias, 'día', 'días')}) · vs. ${rango.etiquetaComparacion.toLowerCase()}`}
      generadoEn={generadoEn}
      controles={controles}
      pie={
        <>
          El ingreso de caja y los cobros de membresías se enseñan por separado porque son dinero
          que entra por caminos distintos: sumarlos en una sola cifra impediría cuadrar este
          reporte contra la caja del día. El recurrente estimado no es dinero cobrado.
        </>
      }
    >
      {eyebrow && <div className="print:hidden">{eyebrow}</div>}

      {r.incompleto && (
        <StatusBanner variant="warning" title="El reporte está incompleto">
          Alguna consulta no respondió, así que hay cifras que pueden estar en cero sin serlo.
          Recarga en unos segundos antes de tomar decisiones con estos números.
        </StatusBanner>
      )}

      {r.cobradoSinEntregar.total > 0 && (
        <StatusBanner
          variant="destructive"
          title={`${r.cobradoSinEntregar.total} ${plural(r.cobradoSinEntregar.total, 'pago cobrado', 'pagos cobrados')} sin entregar`}
        >
          {dinero(r.cobradoSinEntregar.monto)} ya se cobraron y su entrega sigue pendiente. No
          depende del periodo elegido: se revisa todo lo que quede abierto, porque un pago
          atascado en marzo sigue siendo un problema hoy — y es el único descuadre que el cliente
          descubre antes que el negocio.
        </StatusBanner>
      )}

      <section>
        <SectionHeader title="Lo que entró" description="Dinero cobrado en el periodo." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
          <KpiReporte label="Ingreso de caja" kpi={r.ingresosCaja} formato={dinero} />
          <KpiReporte label="Cobros de membresías" kpi={r.cobrosMembresias} formato={dinero} />
          <KpiReporte label="Total cobrado" kpi={r.ingresoTotal} formato={dinero} />
          <KpiReporte label="Operaciones" kpi={r.operacionesCobradas} formato={entero} />
        </div>
      </section>

      <section>
        <SectionHeader title="Cómo pagaron" />
        <Tabla
          encabezados={['Método', 'Operaciones', 'Monto']}
          filas={r.porMetodo.map((m) => [
            METODO[m.metodo] ?? m.metodo,
            entero(m.operaciones),
            dinero(m.monto),
          ])}
          vacio="No hubo cobros de caja en el periodo."
        />
      </section>

      <section>
        <SectionHeader
          title="Intentos de pago en línea"
          description="Cada vez que alguien intentó pagar con la pasarela, terminara bien o mal."
        />
        <div className="mb-3 grid gap-4 sm:grid-cols-2 print:grid-cols-2">
          <Celda
            label="Tasa de aprobación"
            valor={r.tasaAprobacion == null ? 'Sin dato' : `${r.tasaAprobacion} %`}
            nota={
              r.tasaAprobacion == null
                ? 'No hubo intentos concluidos en el periodo'
                : 'Aprobados ÷ (aprobados + rechazados)'
            }
          />
          <Celda
            label="Descuentos aplicados"
            valor={dinero(r.descuentos)}
            nota="Bienvenida y similares, ya restados de lo cobrado"
          />
        </div>
        <Tabla
          encabezados={['Estado', 'Intentos', 'Monto']}
          filas={r.intentos.map((i) => [
            ESTADO_INTENTO[i.estado] ?? i.estado,
            entero(i.total),
            dinero(i.monto),
          ])}
          vacio="No hubo intentos de pago en línea en el periodo."
        />
      </section>

      {r.motivosRechazo.length > 0 && (
        <section>
          <SectionHeader
            title="Por qué se rechazaron"
            description="Lo que devolvió la pasarela, tal cual."
          />
          <Tabla
            encabezados={['Motivo', 'Veces']}
            filas={r.motivosRechazo.map((m) => [m.motivo, entero(m.total)])}
            vacio=""
          />
        </section>
      )}

      <section>
        <SectionHeader
          title="Operaciones deshechas"
          description="Anuladas y revertidas. No restan del ingreso: se miran aparte, porque un negocio que anula mucho tiene un problema que el total esconde."
        />
        <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
          <Celda label="Operaciones" valor={entero(r.deshechas.total)} />
          <Celda label="Monto implicado" valor={dinero(r.deshechas.monto)} />
        </div>
      </section>

      <section className="rounded-xl border border-dashed border-border p-5 print:border-black print:p-2">
        <SectionHeader
          title="Recurrente estimado — no es dinero cobrado"
          description="Lo que entraría en 30 días si ninguna membresía vigente se fuera. Es una previsión: nadie garantiza que renueven."
        />
        <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
          <Celda
            label="Estimación a 30 días"
            valor={dinero(r.recurrenteEstimado.monto)}
            nota="Calculado con lo que cada cliente pagó de verdad, no con el precio de lista"
          />
          <Celda
            label="Membresías vigentes"
            valor={entero(r.recurrenteEstimado.membresias)}
            nota="Vigentes de verdad: no cuenta las vencidas que nadie desactivó"
          />
        </div>
      </section>
    </ReporteImprimible>
  )
}

function Celda({ label, valor, nota }: { label: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 print:border-black print:p-2">
      <p className="text-overline">{label}</p>
      <p className="mt-1 text-h3 tabular-nums text-foreground">{valor}</p>
      {nota && <p className="mt-0.5 text-caption text-muted-foreground">{nota}</p>}
    </div>
  )
}

function Tabla({
  encabezados,
  filas,
  vacio,
}: {
  encabezados: string[]
  filas: string[][]
  vacio: string
}) {
  if (filas.length === 0) {
    return vacio ? <p className="text-small text-muted-foreground">{vacio}</p> : null
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-small">
        <thead>
          <tr className="border-b border-border text-left">
            {encabezados.map((h, i) => (
              <th
                key={h}
                className={`py-2 text-overline ${i === 0 ? '' : 'text-right tabular-nums'}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => (
            <tr key={fila.join('|')} className="border-b border-border/60">
              {fila.map((celda, i) => (
                <td
                  key={i}
                  className={`py-2 ${i === 0 ? 'text-foreground' : 'text-right tabular-nums text-foreground'}`}
                >
                  {celda}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
