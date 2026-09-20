import Link from 'next/link'
import { plural } from '@/lib/plural'
import type { Rango } from '@/modules/reportes/rango'
import { serieParaGrafico } from '@/modules/reportes/serie'
import type { FilaOperacion, ReporteOperacion } from '@/modules/reportes/operacion'
import { KpiReporte } from '@/components/reportes/KpiReporte'
import { ReporteImprimible } from '@/components/ui/reporte-imprimible'
import { SectionHeader } from '@/components/ui/section-header'
import { StatusBanner } from '@/components/ui/status-banner'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * OPERACIÓN.
 *
 * Sin gráficas, y es una decisión, no una carencia: `ResponsiveContainer` de
 * Recharts sale en blanco en `@media print` —está documentado en
 * `docs/REPORTES.md`— y este reporte se imprime más de lo que se mira, porque
 * quien lo usa lo usa para cuadrar el turno. Las tablas dicen lo mismo, se
 * imprimen bien y son la alternativa textual para un lector de pantalla.
 *
 * El desglose por empleado puede no venir: sin el permiso `ver_empleados` la
 * consulta ni se lanza. En ese caso la sección no se pinta vacía —se dice por
 * qué falta—, que es distinto de que no haya habido canjes.
 */
export function ReporteOperacionVista({
  r,
  rango,
  empresa,
  generadoEn,
  qs,
  eyebrow,
  controles,
}: {
  r: ReporteOperacion
  rango: Rango
  empresa: string
  generadoEn: string
  /** Query string del rango y los filtros, para que el detalle abra igual. */
  qs?: string
  eyebrow?: React.ReactNode
  controles?: React.ReactNode
}) {
  const entero = (n: number) => new Intl.NumberFormat('es-DO').format(n)

  // La serie se pliega a la granularidad del periodo: un año en días son 365
  // barras y no se lee ninguna. Es una SUMA de los mismos días que ya venían de
  // la base, así que la semana nunca puede discrepar del día.
  const serie = serieParaGrafico(r.serie, rango.granularidad)
  const detalle = (vista: string) =>
    `/admin/reportes/operacion/detalle?vista=${vista}${qs ? `&${qs}` : ''}`

  // El recorte se lee con NOMBRES, y viene del reporte, no de la URL: si un id
  // pedido no se aplicó (inventado, de otra empresa, sin permiso), aquí no
  // sale, y así la pantalla nunca dice un filtro que los números no llevan.
  const filtroEtiqueta = r.filtro
    ? [
        r.filtro.sucursal && `la sucursal «${r.filtro.sucursal.nombre}»`,
        r.filtro.empleado && `el empleado «${r.filtro.empleado.nombre}»`,
      ]
        .filter(Boolean)
        .join(' y ')
    : null

  return (
    <ReporteImprimible
      titulo={`Operación · ${empresa}`}
      subtitulo={`${rango.etiqueta} · ${rango.desdeDia} a ${rango.hastaDia} (${plural(rango.dias, 'día', 'días')}) · vs. ${rango.etiquetaComparacion.toLowerCase()}`}
      generadoEn={generadoEn}
      controles={controles}
      pie={
        <>
          Un canje es un escaneo registrado. Las visitas revertidas siguen contando como canjes —el
          servicio se dio— y se miran aparte. Las filas «{'(sin asignar)'}» son canjes registrados
          sin sucursal o sin empleado, y «{'(resto, agrupado)'}» es todo lo que no cupo en la tabla:
          las dos se enseñan para que los subtotales sumen el total.
        </>
      }
    >
      {eyebrow && <div className="print:hidden">{eyebrow}</div>}

      {/* Se imprime a propósito: un papel con cifras filtradas y sin la línea
          que lo dice sería indistinguible del reporte de toda la empresa. */}
      {filtroEtiqueta && (
        <p className="rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-small text-foreground print:border-black">
          <span className="font-semibold">Filtrado:</span> solo {filtroEtiqueta}. Todas las
          cifras, la comparación y la serie llevan el recorte.
        </p>
      )}

      {r.incompleto && (
        <StatusBanner variant="warning" title="El reporte está incompleto">
          Alguna consulta no respondió, así que hay cifras que pueden estar en cero sin serlo.
          Recarga en unos segundos antes de tomar decisiones con estos números.
        </StatusBanner>
      )}

      {r.cobertura.pendiente && (
        <StatusBanner variant="info" title="Faltan visitas por asignar a su empresa">
          Las visitas antiguas se están marcando con su empresa por lotes, y mientras el proceso no
          termine este reporte solo cuenta las que ya lo están: los canjes de los periodos más
          viejos van a salir por debajo de lo que fueron. Las visitas nuevas entran completas desde
          el primer día.
        </StatusBanner>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
        <KpiReporte label="Canjes" kpi={r.canjes} formato={entero} />
        <KpiReporte label="Descontaron un uso" kpi={r.descontados} formato={entero} />
        <Celda
          label="Sin descontar"
          valor={entero(r.sinDescontar)}
          nota="Planes ilimitados y cortesías"
        />
        <Celda
          label="Clientes atendidos"
          valor={entero(r.clientesAtendidos)}
          nota="Distintos, no canjes"
        />
      </div>

      {/* El detalle no puede vivir escondido: es LA pantalla que responde
          «¿quién canjeó, cuándo y qué servicio?». Un número que no se puede
          abrir hasta sus filas es una afirmación, no un reporte. */}
      <div className="print:hidden">
        <Link
          href={detalle('CANJES')}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-small font-semibold text-primary hover:bg-muted/40"
        >
          Ver el detalle canje por canje: quién, cuándo y qué servicio →
        </Link>
      </div>

      {r.canjes.valor === 0 ? (
        <EmptyState
          title="Sin canjes en este periodo"
          description="No se registró ningún escaneo en las fechas elegidas."
        />
      ) : (
        <>
          <section>
            <SectionHeader title="Por sucursal" />
            <TablaOperacion filas={r.porSucursal} columna="Sucursal" entero={entero} />
          </section>

          <section>
            <SectionHeader
              title="Por empleado"
              description="Operaciones registradas en cada mostrador. No es una medida de ritmo ni un ranking de personas."
            />
            {r.porEmpleado === null ? (
              <p className="text-small text-muted-foreground">
                Tu cuenta no tiene permiso para ver el desglose por empleado. El resto del reporte
                no cambia: los canjes de arriba ya los incluyen a todos.
              </p>
            ) : (
              <TablaOperacion filas={r.porEmpleado} columna="Empleado" entero={entero} />
            )}
          </section>

          <section>
            <SectionHeader
              title="Por beneficio"
              description="El servicio tal como quedó escrito al canjear."
            />
            <TablaOperacion filas={r.porServicio} columna="Beneficio" entero={entero} />
          </section>

          <section>
            <SectionHeader title="Día a día" />
            <Tabla
              encabezados={['Día', 'Canjes', 'Descontaron']}
              filas={serie
                .filter((p) => p.canjes > 0)
                .map((p) => [p.dia, entero(p.canjes), entero(p.descontados)])}
              vacio="Sin canjes diarios en el periodo."
            />
          </section>
        </>
      )}

      <section>
        <SectionHeader
          title="Códigos QR"
          description="Sale de la bitácora, no de las visitas: por eso puede no cuadrar con los canjes de arriba. Un QR se genera al activar una membresía y al terminar cada canje."
        />
        {r.filtro ? (
          // Un total de empresa pintado bajo un reporte filtrado sería un
          // número mentiroso; mejor decir por qué no está.
          <p className="text-small text-muted-foreground">
            Con un filtro activo los QR no se enseñan: la bitácora no guarda ni la sucursal ni el
            empleado, así que no hay forma de repartirlos. Quita el filtro para verlos.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3 print:grid-cols-3">
            <Celda label="Generados" valor={entero(r.qrGenerados)} />
            <Celda label="Usados" valor={entero(r.qrUsados)} />
            <Celda
              label="Compartidos"
              valor={entero(r.qrCompartidos)}
              nota="Compartir no consume el código"
            />
          </div>
        )}
      </section>

      <section>
        <SectionHeader
          title="Visitas revertidas"
          description="Anuladas después de registrarse. No se restan de los canjes: el servicio se dio, y que después se anulara la factura es un hecho posterior."
        />
        <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
          <Celda label="Revertidas en el periodo" valor={entero(r.revertidas)} />
        </div>
      </section>

      <p className="print:hidden text-caption text-muted-foreground">
        Abre el detalle de cada cifra:{' '}
        <Link href={detalle('CANJES')} className="underline">
          canjes
        </Link>
        {' · '}
        <Link href={detalle('DESCONTADOS')} className="underline">
          descontaron un uso
        </Link>
        {' · '}
        <Link href={detalle('SIN_DESCONTAR')} className="underline">
          sin descontar
        </Link>
        {' · '}
        <Link href={detalle('REVERTIDAS')} className="underline">
          revertidas
        </Link>
      </p>
    </ReporteImprimible>
  )
}

function TablaOperacion({
  filas,
  columna,
  entero,
}: {
  filas: FilaOperacion[]
  columna: string
  entero: (n: number) => string
}) {
  return (
    <Tabla
      encabezados={[columna, 'Canjes', 'Descontaron']}
      filas={filas.map((f) => [f.nombre, entero(f.canjes), entero(f.descontados)])}
      vacio="Sin canjes en el periodo."
    />
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
