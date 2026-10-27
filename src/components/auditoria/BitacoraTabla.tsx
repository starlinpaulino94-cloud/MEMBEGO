import { Tabla, type Columna } from '@/components/ui/tabla'
import { formatDateTimeExacto } from '@/lib/format'
import { ENTIDAD_LABEL, type AuditoriaItem } from '@/modules/auditoria/queries'

/**
 * Bitácora de actividad, en la `Tabla` del sistema (auditoría admin · fase 7, tarea 7.1): una fila por acción, con la FECHA Y
 * HORA EXACTAS (hasta el segundo) en la zona horaria del negocio. Componente de servidor: no necesita interactividad.
 *
 * La fecha es el identificador de la fila: en una bitácora lo que ordena y distingue una fila de otra es cuándo pasó. Solo se
 * ocultan en pantallas estrechas «Detalle», «Empresa» y «Sobre»; cuándo, qué y quién siguen a la vista.
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
  const columnas: Columna<AuditoriaItem>[] = [
    {
      clave: 'fecha',
      encabezado: 'Fecha y hora',
      celda: (i) => <span className="whitespace-nowrap tabular-nums">{formatDateTimeExacto(i.fecha, prefs)}</span>,
    },
    { clave: 'accion', encabezado: 'Acción', celda: (i) => <span className="font-semibold text-foreground">{i.accionLabel}</span> },
    { clave: 'detalle', encabezado: 'Detalle', prioridad: 2, celda: (i) => <span className="block max-w-72 font-normal text-muted-foreground">{i.detalle ?? '—'}</span> },
    {
      clave: 'quien',
      encabezado: 'Quién',
      celda: (i) => (
        <>
          {i.usuario ? (
            <>
              <span className="block font-medium text-foreground">{i.usuario}</span>
              <span className="block text-caption text-muted-foreground">{i.usuarioEmail}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Sistema</span>
          )}
          {i.ip && <span className="block text-caption text-muted-foreground">IP {i.ip}</span>}
        </>
      ),
    },
    ...(mostrarEmpresa
      ? [{ clave: 'empresa', encabezado: 'Empresa', prioridad: 2 as const, celda: (i: AuditoriaItem) => <span className="text-muted-foreground">{i.empresa ?? '—'}</span> }]
      : []),
    {
      clave: 'sobre',
      encabezado: 'Sobre',
      prioridad: 3,
      celda: (i) => (
        <>
          <span className="block text-foreground">{ENTIDAD_LABEL[i.entidadTipo] ?? i.entidadTipo}</span>
          <span className="block font-mono text-caption text-muted-foreground">{i.entidadId}</span>
        </>
      ),
    },
  ]
  return <Tabla caption="Bitácora de actividad" columnas={columnas} filas={items} claveDe={(i) => i.id} />
}
