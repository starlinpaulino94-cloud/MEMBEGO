import { plural } from '@/lib/plural'
import {
  ETIQUETA_GRUPO,
  ETIQUETA_SEVERIDAD,
  MUESTRA_POR_REGLA,
  ORDEN_DE_GRUPOS,
  ordenarHallazgos,
  resumirConciliacion,
  type Hallazgo,
  type Severidad,
} from '@/modules/conciliacion/domain'
import { ReporteImprimible } from '@/components/ui/reporte-imprimible'
import { SectionHeader } from '@/components/ui/section-header'

const num = (n: number) => new Intl.NumberFormat('es-DO').format(n)

const CLASE_SEVERIDAD: Record<Severidad, string> = {
  ALTA: 'bg-destructive/10 text-destructive',
  MEDIA: 'bg-warning/15 text-foreground',
  BAJA: 'bg-muted text-muted-foreground',
}

function Insignia({ s }: { s: Severidad }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${CLASE_SEVERIDAD[s]}`}>{ETIQUETA_SEVERIDAD[s]}</span>
}

function Celda({ label, valor, nota }: { label: string; valor: string; nota: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 print:border-black print:p-2">
      <p className="text-overline">{label}</p>
      <p className="mt-1.5 truncate text-h2 tabular-nums text-foreground print:text-base print:font-bold">{valor}</p>
      <p className="mt-1 text-xs text-muted-foreground">{nota}</p>
    </div>
  )
}

/**
 * CONCILIACIÓN DEL COMERCIO (superadmin). Solo lectura: enseña dónde NO cuadran los pedidos, los pagos, las
 * comisiones, el libro de cada cuenta, las ofertas y el inventario. No corrige nada.
 */
export function ConciliacionVista({ hallazgos, generadoEn, controles }: { hallazgos: (Hallazgo & { error?: string })[]; generadoEn: string; controles?: React.ReactNode }) {
  const resumen = resumirConciliacion(hallazgos)
  const conError = hallazgos.filter((h) => h.error)

  return (
    <ReporteImprimible
      titulo="Conciliación del comercio"
      subtitulo={`${plural(resumen.reglas, 'regla', 'reglas')} · todas las empresas, sin las de práctica`}
      generadoEn={generadoEn}
      controles={controles}
      pie={
        <>
          Una regla de conciliación dice «estas dos cosas tienen que cuadrar». Esta pantalla no corrige nada: la base ya impide casi todo esto con sus
          propias reglas, así que un hallazgo es la señal de que algo se las saltó (una escritura manual, un error, un dato anterior a la regla) o, en las
          informativas, de algo que el diseño permite a propósito y conviene ver.
        </>
      }
    >
      <section>
        <SectionHeader title="Resumen" description="Cuántas reglas encontraron algo y cuántos casos hay." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
          <Celda label="Reglas con hallazgos" valor={`${num(resumen.reglasConHallazgos)} de ${num(resumen.reglas)}`} nota={resumen.reglasConHallazgos === 0 ? 'Todo cuadra' : 'Revisa las de severidad alta primero'} />
          <Celda label="Casos" valor={num(resumen.casos)} nota="Suma de todas las reglas" />
          <Celda label="Severidad alta" valor={num(resumen.porSeveridad.ALTA)} nota="Dinero o inventario que no cuadra" />
          <Celda label="Media e informativa" valor={`${num(resumen.porSeveridad.MEDIA)} · ${num(resumen.porSeveridad.BAJA)}`} nota="Media · informativa" />
        </div>
        {conError.length > 0 && (
          <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm" role="alert">
            No se pudo evaluar: {conError.map((h) => h.regla.codigo).join(', ')}. Los demás resultados valen; intenta de nuevo.
          </p>
        )}
      </section>

      {ORDEN_DE_GRUPOS.map((grupo) => {
        const delGrupo = ordenarHallazgos(hallazgos.filter((h) => h.regla.grupo === grupo))
        if (delGrupo.length === 0) return null
        return (
          <section key={grupo} data-testid={`grupo-${grupo}`}>
            <SectionHeader title={ETIQUETA_GRUPO[grupo]} description={`${plural(delGrupo.length, 'regla', 'reglas')}`} />
            <ul className="divide-y divide-border rounded-lg border border-border">
              {delGrupo.map((h) => (
                <li key={h.regla.codigo} className="px-4 py-3" data-testid={`regla-${h.regla.codigo}`}>
                  <details open={h.total > 0 && h.regla.severidad === 'ALTA'} className="group">
                    <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-mono text-sm text-muted-foreground">{h.regla.codigo}</span>
                      <span className="min-w-0 flex-1 font-medium text-foreground">{h.regla.titulo}</span>
                      <Insignia s={h.regla.severidad} />
                      {h.error ? (
                        <span className="text-sm text-destructive">No se evaluó</span>
                      ) : h.total === 0 ? (
                        <span className="text-sm text-success">Cuadra</span>
                      ) : (
                        <span className="text-sm font-semibold tabular-nums text-foreground">{plural(h.total, 'caso', 'casos')}</span>
                      )}
                    </summary>
                    <div className="mt-3 space-y-3 text-sm">
                      <p className="text-muted-foreground">{h.regla.queEs}</p>
                      {h.total > 0 && (
                        <>
                          <p className="text-muted-foreground">
                            <span className="font-medium text-foreground">Qué hacer: </span>
                            {h.regla.queHacer}
                          </p>
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                              <thead>
                                <tr className="border-b border-border text-muted-foreground">
                                  <th scope="col" className="py-1.5 pr-3 font-medium">Empresa</th>
                                  <th scope="col" className="py-1.5 pr-3 font-medium">Caso</th>
                                  <th scope="col" className="py-1.5 font-medium">Qué no cuadra</th>
                                </tr>
                              </thead>
                              <tbody>
                                {h.muestra.map((f, i) => (
                                  <tr key={`${f.companyId}-${f.referencia}-${i}`} className="border-b border-border/60 last:border-0">
                                    <td className="py-1.5 pr-3">{f.empresa}</td>
                                    <td className="py-1.5 pr-3 font-mono">{f.referencia}</td>
                                    <td className="py-1.5 text-muted-foreground">{f.detalle}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {h.total > h.muestra.length && (
                            <p className="text-xs text-muted-foreground">
                              Se enseñan los {h.muestra.length} más recientes de {num(h.total)} (hasta {MUESTRA_POR_REGLA} por regla).
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </ReporteImprimible>
  )
}
