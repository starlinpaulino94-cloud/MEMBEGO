import type { ReactNode } from 'react'
import { Tabla, type Columna } from '@/components/ui/tabla'
import { EstadoChip, type TonoEstado } from '@/components/ui/estado-chip'

/**
 * EL HISTORIAL DE COMPROBANTES, EN LA `Tabla` DE SERVIDOR (auditoría admin · fase 7, tarea 7.1; 06 · T-01, T-06, T-15).
 *
 * Antes era una tabla HTML a mano con dos mapas «estado → clases de color», sin título para el lector de pantalla y con el ancho
 * mínimo fijo en 760 px. El comprobante (número, código, tipo y fecha) es el identificador de la fila y el cliente lleva debajo quién lo atendió: así caben
 * seis columnas y la reimpresión no queda fuera de vista en un escritorio. El detalle es de menos prioridad y se oculta en pantallas
 * estrechas, donde el total, el estado y la reimpresión siguen a la vista. La tabla no
 * sabe de botones: la acción de reimprimir (de cliente) llega ya hecha en `accion`.
 */
export interface ComprobanteFila {
  id: string
  ticketNumero: string
  codigo: string
  tipo: string
  cliente: string | null
  detalle: string | null
  /** Método de cobro y sucursal, ya juntos en una línea. */
  detalleSecundario: string
  empleado: string | null
  monto: number | null
  estado: string
  impresiones: number
  creado: Date
  accion: ReactNode
}

// Tipos de comprobante que el negocio reimprime. Las VENTAS son las facturas de caja; el resto son ENTREGAS sin cobro.
export const TIPO_COMPROBANTE: Record<string, string> = {
  SALE: 'Venta',
  MEMBERSHIP_REDEMPTION: 'Uso de membresía',
  PROMOTION_USE: 'Promoción',
  BENEFIT_USE: 'Beneficio',
  REWARD_REDEMPTION: 'Premio',
  COUPON_USE: 'Cupón',
  POINTS_SPEND: 'Canje de puntos',
  REFERRAL: 'Referido',
}

const ESTADO_COMPROBANTE: Record<string, { etiqueta: string; tono: TonoEstado }> = {
  APPLIED: { etiqueta: 'Pagada', tono: 'exito' },
  CANCELLED: { etiqueta: 'Cancelada', tono: 'peligro' },
  REVERTED: { etiqueta: 'Revertida', tono: 'aviso' },
}

/** Etiqueta y tono de un estado de comprobante. Uno desconocido se muestra con su propio texto y tono neutro. */
export function estadoDeComprobante(estado: string): { etiqueta: string; tono: TonoEstado } {
  return ESTADO_COMPROBANTE[estado] ?? { etiqueta: estado, tono: 'neutro' }
}

const fmtRD = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`
const fmtFecha = (d: Date) =>
  new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', dateStyle: 'medium', timeStyle: 'short' }).format(d)

/** Lo que se lee en la columna Total: un cobro con su monto; una venta sin monto, un guion; una entrega sin cobro, «GRATIS». */
export function totalDeComprobante(tipo: string, monto: number | null): string {
  if (monto != null && monto > 0) return fmtRD(monto)
  return tipo === 'SALE' ? '—' : 'GRATIS'
}

const COLUMNAS: Columna<ComprobanteFila>[] = [
  {
    clave: 'comprobante',
    encabezado: 'Comprobante',
    celda: (f) => (
      <>
        <span className="block font-mono font-semibold text-foreground">{f.ticketNumero}</span>
        <span className="block font-mono text-caption font-normal text-muted-foreground">{f.codigo}</span>
        <span className="block text-caption font-normal text-muted-foreground">
          {TIPO_COMPROBANTE[f.tipo] ?? f.tipo} ·{' '}
          <time dateTime={f.creado.toISOString()}>{fmtFecha(f.creado)}</time>
        </span>
      </>
    ),
  },
  {
    clave: 'cliente',
    encabezado: 'Cliente',
    celda: (f) => (
      <>
        {f.cliente ? (
          <span className="block whitespace-nowrap">{f.cliente}</span>
        ) : (
          <>
            <span aria-hidden>—</span>
            <span className="sr-only">Sin dato</span>
          </>
        )}
        {f.empleado ? <span className="block whitespace-nowrap text-caption text-muted-foreground">Atendió {f.empleado}</span> : null}
      </>
    ),
  },
  {
    clave: 'detalle',
    encabezado: 'Detalle',
    prioridad: 3,
    celda: (f) => (
      <div className="max-w-40">
        <p className="truncate text-foreground">{f.detalle ?? '—'}</p>
        <p className="truncate text-caption text-muted-foreground">{f.detalleSecundario}</p>
      </div>
    ),
  },
  {
    clave: 'total',
    encabezado: 'Total',
    alineacion: 'derecha',
    celda: (f) => <span className="font-semibold text-foreground">{totalDeComprobante(f.tipo, f.monto)}</span>,
  },
  {
    clave: 'estado',
    encabezado: 'Estado',
    celda: (f) => {
      const e = estadoDeComprobante(f.estado)
      return (
        <>
          <EstadoChip tono={e.tono}>{e.etiqueta}</EstadoChip>
          {f.impresiones > 0 && (
            <span className="mt-1 block text-caption text-muted-foreground">
              {f.impresiones} {f.impresiones === 1 ? 'impresión' : 'impresiones'}
            </span>
          )}
        </>
      )
    },
  },
  { clave: 'accion', encabezado: 'Reimprimir', soloLector: true, alineacion: 'derecha', celda: (f) => f.accion },
]

export function ComprobantesTabla({ filas, pie }: { filas: readonly ComprobanteFila[]; pie?: ReactNode }) {
  return <Tabla caption="Comprobantes" columnas={COLUMNAS} filas={filas} claveDe={(f) => f.id} pie={pie} />
}
