import Link from 'next/link'
import { Mail, MessageCircle } from 'lucide-react'
import { Tabla, type Columna } from '@/components/ui/tabla'
import { diasDesde, waLink, type FilaSeguimiento } from '@/modules/pagos/colasMezcla'

/**
 * SEGUIMIENTO: iniciaron un pago y no lo completaron. Contacto directo (WhatsApp o correo) para recuperar la venta; los más
 * antiguos primero. Es el primer consumidor real de la `Tabla` de servidor de la fase 4 (docs/auditoria-admin/06 · T-01,
 * T-15): lleva `caption` y `scope`, el cliente es el identificador de la fila y el monto va a la derecha con cifras tabulares.
 * Lo que dice y los enlaces de contacto son los de antes.
 */

function Antiguedad({ fecha }: { fecha: Date }) {
  const dias = diasDesde(fecha)
  const clase =
    dias >= 7 ? 'bg-danger-soft text-danger-ink' : dias >= 3 ? 'bg-warning-soft text-warning-ink' : 'bg-muted text-muted-foreground'
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${clase}`}>
      {dias === 0 ? 'hoy' : `${dias} día${dias !== 1 ? 's' : ''}`}
    </span>
  )
}

function Contactar({ s }: { s: FilaSeguimiento }) {
  const wa = waLink(s.cliente.telefono)
  return (
    <div className="flex items-center gap-1.5">
      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          title={`WhatsApp ${s.cliente.telefono}`}
          aria-label={`Escribir por WhatsApp a ${s.cliente.nombre}`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 text-success hover:bg-success-soft"
        >
          <MessageCircle className="h-4 w-4" />
        </a>
      )}
      <a
        href={`mailto:${s.cliente.email}`}
        title="Enviar correo"
        aria-label={`Enviar un correo a ${s.cliente.nombre}`}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 text-muted-foreground hover:bg-muted"
      >
        <Mail className="h-4 w-4" />
      </a>
    </div>
  )
}

const COLUMNAS: Columna<FilaSeguimiento>[] = [
  {
    clave: 'cliente',
    encabezado: 'Cliente',
    celda: (s) => (
      <>
        <Link href={`/admin/clientes/${s.clienteId}`} className="font-medium text-primary hover:underline">
          {s.cliente.nombre}
        </Link>
        <p className="text-xs font-normal text-muted-foreground">{s.cliente.email}</p>
      </>
    ),
  },
  { clave: 'concepto', encabezado: 'Quería', prioridad: 2 },
  { clave: 'monto', encabezado: 'Monto', tipo: 'dinero' },
  {
    clave: 'situacion',
    encabezado: 'Situación',
    prioridad: 3,
    celda: (s) => <span className="block max-w-64 text-xs text-muted-foreground">{s.situacion}</span>,
  },
  { clave: 'fecha', encabezado: 'Desde hace', prioridad: 2, celda: (s) => <Antiguedad fecha={s.fecha} /> },
  { clave: 'contactar', encabezado: 'Contactar', celda: (s) => <Contactar s={s} /> },
]

export function TablaSeguimiento({ filas, fmtMoney }: { filas: FilaSeguimiento[]; fmtMoney: (n: number) => string }) {
  return (
    <Tabla
      caption="Pagos que no se completaron, los más antiguos primero"
      columnas={COLUMNAS}
      filas={filas}
      claveDe={(s) => s.key}
      formato={{ dinero: (v) => fmtMoney(Number(v)) }}
    />
  )
}
