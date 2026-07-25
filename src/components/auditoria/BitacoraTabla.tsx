import { formatDateTimeExacto } from '@/lib/format'
import type { AuditoriaItem } from '@/modules/auditoria/queries'

/**
 * Bitácora de actividad: una fila por acción, con la FECHA Y HORA EXACTAS
 * (hasta el segundo) en la zona horaria del negocio. Componente de servidor:
 * no necesita interactividad.
 */
export function BitacoraTabla({
  items,
  timeZone,
  mostrarEmpresa = false,
}: {
  items: AuditoriaItem[]
  timeZone: string
  /** Vista global del superadmin: añade la columna Empresa. */
  mostrarEmpresa?: boolean
}) {
  const prefs = { zonaHoraria: timeZone }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
      <table className="w-full min-w-[860px] text-sm">
        <thead>
          <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 font-semibold">Fecha y hora</th>
            <th className="px-4 py-3 font-semibold">Acción</th>
            <th className="px-4 py-3 font-semibold">Detalle</th>
            <th className="px-4 py-3 font-semibold">Quién</th>
            {mostrarEmpresa && <th className="px-4 py-3 font-semibold">Empresa</th>}
            <th className="px-4 py-3 font-semibold">Sobre</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {items.map((i) => (
            <tr key={i.id} className="align-top hover:bg-muted/40">
              <td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums text-foreground">
                {formatDateTimeExacto(i.fecha, prefs)}
              </td>
              <td className="px-4 py-3">
                <span className="font-semibold text-foreground">{i.accionLabel}</span>
              </td>
              <td className="max-w-72 px-4 py-3 text-muted-foreground">{i.detalle ?? '—'}</td>
              <td className="px-4 py-3">
                {i.usuario ? (
                  <>
                    <p className="font-medium text-foreground">{i.usuario}</p>
                    <p className="text-xs text-muted-foreground">{i.usuarioEmail}</p>
                  </>
                ) : (
                  <span className="text-muted-foreground">Sistema</span>
                )}
                {i.ip && <p className="text-xs text-muted-foreground">IP {i.ip}</p>}
              </td>
              {mostrarEmpresa && (
                <td className="px-4 py-3 text-muted-foreground">{i.empresa ?? '—'}</td>
              )}
              <td className="px-4 py-3">
                <p className="text-foreground">{i.entidadTipo}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{i.entidadId}</p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
