import Link from 'next/link'
import { Tabla, type Columna } from '@/components/ui/tabla'
import { EstadoChip } from '@/components/ui/estado-chip'
import { formatDateTime } from '@/lib/format'

export interface FilaManifiesto {
  id: string
  hora: string | null
  cliente: string
  telefono: string | null
  excursion: string
  esCombo: boolean
  totalItems: number
  itemsCompletados: number
  totalPasajeros: number
  presentes: number
  checkinAt: Date | string | null
}

/** Lo que dice la celda de embarque: el estado del check-in, con su texto y, si lo hay, cuándo. */
function Embarque({ f }: { f: FilaManifiesto }) {
  const cuando = f.checkinAt ? <span className="block text-caption text-muted-foreground">{formatDateTime(f.checkinAt)}</span> : null

  if (f.esCombo && f.totalItems > 0) {
    if (f.itemsCompletados === 0) return <EstadoChip tono="neutro">Sin embarcar (0/{f.totalItems})</EstadoChip>
    const completo = f.itemsCompletados >= f.totalItems
    return (
      <div>
        <EstadoChip tono={completo ? 'exito' : 'aviso'}>
          {completo ? 'Completo' : 'Parcial'} ({f.itemsCompletados}/{f.totalItems} acts)
        </EstadoChip>
        {cuando}
      </div>
    )
  }
  if (f.checkinAt) {
    const completo = f.presentes === f.totalPasajeros
    return (
      <div>
        <EstadoChip tono={completo ? 'exito' : 'aviso'}>{completo ? 'Completo' : 'Parcial'}</EstadoChip>
        {cuando}
      </div>
    )
  }
  return <EstadoChip tono="neutro">Sin embarcar</EstadoChip>
}

/**
 * EL MANIFIESTO DEL DÍA, EN LA `Tabla` DE SERVIDOR (auditoría admin · fase 7, tarea 7.1; 06 · T-01, T-10, T-15).
 *
 * Es la pantalla que el operador mira de pie junto al bus: el cliente es el identificador de la fila (y su enlace a la reserva),
 * con el teléfono debajo para llamarlo; el embarque se dice con texto, no solo con color; y la excursión, de menos prioridad, se
 * oculta en una pantalla estrecha sin dejar fuera a quién se espera ni si ya se subió. En el teléfono la hora pasa debajo del
 * nombre: lo que el operador no puede perder de vista es el embarque, no un encabezado más.
 */
const COLUMNAS: Columna<FilaManifiesto>[] = [
  { clave: 'hora', encabezado: 'Hora', prioridad: 2 },
  {
    clave: 'cliente',
    encabezado: 'Cliente',
    celda: (f) => (
      <>
        <Link href={`/admin/excursiones/reservas/${f.id}`} className="font-medium text-primary hover:underline">
          {f.cliente}
        </Link>
        {f.telefono ? <span className="block text-caption text-muted-foreground">{f.telefono}</span> : null}
        {/* En pantalla estrecha la columna «Hora» se oculta (el operador necesita ver el embarque sin desplazarse): la hora baja aquí. */}
        {f.hora ? <span className="block text-caption text-muted-foreground md:hidden">{f.hora}</span> : null}
      </>
    ),
  },
  { clave: 'excursion', encabezado: 'Excursión', prioridad: 2 },
  { clave: 'pax', encabezado: 'Pax', alineacion: 'derecha', celda: (f) => `${f.presentes}/${f.totalPasajeros}` },
  { clave: 'embarque', encabezado: 'Embarque', celda: (f) => <Embarque f={f} /> },
]

export function ManifiestoTabla({ filas, dia }: { filas: FilaManifiesto[]; dia: string }) {
  return (
    <Tabla
      caption={`Manifiesto de las salidas del ${dia}, por hora`}
      columnas={COLUMNAS}
      filas={filas}
      claveDe={(f) => f.id}
      columnaIdentificadora="cliente"
      filaNavegable
      vacio={{ titulo: 'No hay salidas registradas para ese día' }}
    />
  )
}
