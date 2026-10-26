import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/status-chip'
import type { UsoSatelite } from '@/modules/plataforma/metricas'
import { Tabla } from '@/components/ui/tabla'

/**
 * TARJETA DE USO DE UN SATÉLITE (B-7 · vista del superadmin).
 *
 * La salud vista desde el lado de QUIEN LLAMA —peticiones, tasa de error y los
 * endpoints más usados— frente a la pestaña «Salud», que mira la cola de
 * SALIDA. Componente de servidor: solo pinta datos ya resumidos.
 */

const TOP_ENDPOINTS = 6

function miles(n: number): string {
  return n.toLocaleString('es')
}

function pct(fraccion: number): string {
  // Dos decimales solo cuando hace falta para no enseñar «0.0 %» a un 0,08 %.
  return `${(fraccion * 100).toFixed(fraccion > 0 && fraccion < 0.001 ? 2 : 1)} %`
}

export function SateliteUsoCard({ satelite, dias }: { satelite: UsoSatelite; dias: number }) {
  const { resumen } = satelite
  const sinTrafico = resumen.total === 0
  const tono = satelite.estado !== 'ACTIVE' ? 'neutral' : resumen.errores > 0 ? 'warning' : 'success'

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-h4 font-semibold">{satelite.nombre}</h3>
          <p className="font-mono text-caption text-muted-foreground">{satelite.slug}</p>
        </div>
        <StatusChip tone={tono}>
          {satelite.estado !== 'ACTIVE' ? 'Inactivo' : sinTrafico ? 'Sin tráfico' : 'Activo'}
        </StatusChip>
      </CardHeader>
      <CardContent className="space-y-4">
        {sinTrafico ? (
          <p className="text-caption text-muted-foreground">Sin llamadas en {dias} días.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-small">
              <span>
                <span className="font-semibold">{miles(resumen.total)}</span>{' '}
                <span className="text-muted-foreground">
                  {resumen.total === 1 ? 'llamada' : 'llamadas'} · {dias} d
                </span>
              </span>
              <span>
                <span className={resumen.errores > 0 ? 'font-semibold text-warning' : 'font-semibold'}>
                  {pct(resumen.tasaError)}
                </span>{' '}
                <span className="text-muted-foreground">
                  con error{resumen.errores > 0 ? ` (${miles(resumen.errores)})` : ''}
                </span>
              </span>
            </div>

            {/* Errores = permiso insuficiente: una integración golpeando con un
                scope que no tiene. Es la señal más útil de esta pantalla. */}
            <Tabla
              caption="Endpoints más llamados"
              claveDe={(e) => `${e.metodo} ${e.endpoint}`}
              filas={resumen.porEndpoint.slice(0, TOP_ENDPOINTS)}
              className="border-0 shadow-none"
              columnas={[
                {
                  clave: 'endpoint',
                  encabezado: 'Endpoint',
                  celda: (e) => (
                    <span className="font-mono">
                      <span className="text-muted-foreground">{e.metodo}</span> {e.endpoint}
                    </span>
                  ),
                },
                { clave: 'llamadas', encabezado: 'Llamadas', tipo: 'numero', valor: (e) => e.peticiones },
                {
                  clave: 'errores',
                  encabezado: 'Con error',
                  alineacion: 'derecha',
                  celda: (e) => (e.errores > 0 ? <span className="text-warning">{miles(e.errores)}</span> : <span className="text-muted-foreground">—</span>),
                },
              ]}
              formato={{ numero: miles }}
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}
