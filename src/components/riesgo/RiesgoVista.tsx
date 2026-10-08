import { plural } from '@/lib/plural'
import { ETIQUETA_TIPO_DE_SENAL, resumirRiesgo, UMBRALES, type Senal, type Severidad } from '@/modules/riesgo-comercio/domain'
import { ReporteImprimible } from '@/components/ui/reporte-imprimible'
import { SectionHeader } from '@/components/ui/section-header'

const num = (n: number) => new Intl.NumberFormat('es-DO').format(n)

const CLASE: Record<Severidad, string> = { ALTA: 'bg-destructive/10 text-destructive', MEDIA: 'bg-warning/15 text-foreground' }
const ETIQUETA: Record<Severidad, string> = { ALTA: 'Alta', MEDIA: 'Media' }

function Celda({ label, valor, nota }: { label: string; valor: string; nota: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 print:border-black print:p-2">
      <p className="text-overline">{label}</p>
      <p className="mt-1.5 truncate text-h2 tabular-nums text-foreground print:text-base print:font-bold">{valor}</p>
      <p className="mt-1 text-xs text-muted-foreground">{nota}</p>
    </div>
  )
}

function Lista({ titulo, descripcion, vacio, senales, testid }: { titulo: string; descripcion: string; vacio: string; senales: Senal[]; testid: string }) {
  return (
    <section data-testid={testid}>
      <SectionHeader title={titulo} description={descripcion} />
      {senales.length === 0 ? (
        <p className="rounded-lg border border-border px-4 py-6 text-center text-sm text-muted-foreground">{vacio}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {senales.map((s, i) => (
            <li key={`${s.sujeto.id}-${s.tipo}-${i}`} className="px-4 py-3" data-testid="senal">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-foreground">{s.sujeto.nombre}</span>
                  {s.sujeto.contacto && <span className="ml-2 text-sm text-muted-foreground">{s.sujeto.contacto}</span>}
                </span>
                <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">{ETIQUETA_TIPO_DE_SENAL[s.tipo]}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${CLASE[s.severidad]}`}>{ETIQUETA[s.severidad]}</span>
              </div>
              <p className="mt-1 text-sm font-medium text-foreground">{s.titulo}</p>
              <p className="text-sm text-muted-foreground">{s.detalle}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * SEÑALES DE RIESGO (superadmin). Indicios para llamar a alguien, no veredictos: no suspende ni bloquea nada.
 */
export function RiesgoVista({ senales, ventanaDias, empresasRevisadas, generadoEn, controles }: { senales: Senal[]; ventanaDias: number; empresasRevisadas: number; generadoEn: string; controles?: React.ReactNode }) {
  const r = resumirRiesgo(senales)
  const empresas = senales.filter((s) => s.sujeto.tipo === 'EMPRESA')
  const clientes = senales.filter((s) => s.sujeto.tipo === 'CLIENTE')

  return (
    <ReporteImprimible
      titulo="Señales de riesgo"
      subtitulo={`Últimos ${ventanaDias} días · ${plural(empresasRevisadas, 'empresa con actividad o cuenta', 'empresas con actividad o cuenta')} · sin empresas de práctica`}
      generadoEn={generadoEn}
      controles={controles}
      pie={
        <>
          Una señal es un indicio, no un veredicto: puede ser fraude, una mala temporada o un error de operación. Aquí no se suspende, bloquea ni cobra nada;
          es la lista de a quién conviene llamar primero. Solo cuenta el marketplace. Las tasas exigen al menos {UMBRALES.minimoDePedidos} pedidos en el periodo,
          y los umbrales están en el código (<code>modules/riesgo-comercio/domain.ts</code>).
        </>
      }
    >
      <section>
        <SectionHeader title="Resumen" description="Cuántas empresas y clientes dieron alguna señal." />
        <div className="grid gap-4 sm:grid-cols-3 print:grid-cols-3 print:gap-2">
          <Celda label="Empresas con señales" valor={num(r.empresas)} nota={`de ${num(empresasRevisadas)} con actividad o cuenta`} />
          <Celda label="Clientes con señales" valor={num(r.clientes)} nota="Los que cruzaron algún umbral" />
          <Celda label="Severidad alta · media" valor={`${num(r.porSeveridad.ALTA)} · ${num(r.porSeveridad.MEDIA)}`} nota="Señales, no personas" />
        </div>
      </section>

      <Lista titulo="Empresas" descripcion="Cancelaciones, reembolsos, pedidos sin atender, ajustes de monto y estado de la cuenta Membego." vacio="Ninguna empresa cruzó un umbral." senales={empresas} testid="riesgo-empresas" />
      <Lista titulo="Clientes" descripcion="Quienes aparten existencias o cupos de ofertas sin recogerlos, o pidan en ráfaga." vacio="Ningún cliente cruzó un umbral." senales={clientes} testid="riesgo-clientes" />
    </ReporteImprimible>
  )
}
