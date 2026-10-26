import Link from 'next/link'
import type { ReactNode } from 'react'
import { Tabla, type Columna } from '@/components/ui/tabla'
import { EstadoBadge } from '@/components/EstadoBadge'
import { SemaforoCliente } from '@/components/admin/SemaforoCliente'
import { formatDate } from '@/lib/format'
import type { EstadoCliente } from '@/modules/riesgo/semaforo'
import type { MembershipEstado } from '@/types'

export interface ClienteRow {
  id: string
  nombre: string
  email: string
  createdAt: Date
  memberships: Array<{
    id: string
    estado: MembershipEstado
    plan: { nombre: string }
  }>
  /** Semáforo ya calculado en el servidor (`modules/riesgo/semaforo`). */
  semaforo?: { estado: EstadoCliente; motivo: string; diasSinVenir: number | null }
}

/**
 * EL DIRECTORIO DE CLIENTES (auditoría admin · fase 5, tarea 5.3; 06 · T-10, T-15).
 *
 * Era un `DataTable` de cliente (TanStack) con `pageSize={25}` sobre las 50 filas que ya paginaba el servidor: DOS paginaciones
 * apiladas, una dentro de otra —«Página 1 de 2» en la tabla y «Página 1 de 8» debajo—, y nadie sabía cuál mandaba. Ahora es la
 * `Tabla` de servidor del sistema de diseño: una sola paginación (la del servidor, en la URL), `caption` y `scope`, el cliente
 * como identificador de la fila (y su enlace a la ficha, que sustituye al icono de «Acciones»), y las columnas se ocultan por
 * prioridad en pantallas estrechas SIN dejar fuera «Estado», que a 390 px quedaba más allá del borde (T-10).
 *
 * El orden es el del servidor (los más recientes primero) y se dice: ordenar en el navegador solo habría ordenado las filas
 * cargadas. Sin buscador ni exportación propios: la búsqueda y el CSV viven en el servidor sobre TODO el filtro (auditoría M-07
 * y B-9).
 */

const COLUMNAS: Columna<ClienteRow>[] = [
  {
    clave: 'nombre',
    encabezado: 'Nombre',
    celda: (c) => (
      <Link href={`/admin/clientes/${c.id}`} className="font-medium text-primary hover:underline">
        {c.nombre}
      </Link>
    ),
  },
  {
    clave: 'estado',
    encabezado: 'Estado',
    celda: (c) => {
      const s = c.semaforo
      if (!s) return <span className="text-muted-foreground">—</span>
      return (
        <div className="space-y-0.5">
          <SemaforoCliente estado={s.estado} motivo={s.motivo} />
          {/* El número que hay detrás del color: sin él, «en riesgo» es una opinión del sistema y no un dato que se pueda
              comprobar. */}
          <p className="text-caption font-normal text-muted-foreground">
            {s.diasSinVenir == null ? 'nunca ha venido' : `hace ${s.diasSinVenir} d que no viene`}
          </p>
        </div>
      )
    },
  },
  {
    clave: 'membresia',
    encabezado: 'Membresía',
    prioridad: 2,
    celda: (c) => {
      const m = c.memberships?.[0]
      if (!m) return <span className="text-muted-foreground">—</span>
      return (
        <div className="space-y-0.5">
          <p className="text-small font-medium">{m.plan.nombre}</p>
          <EstadoBadge estado={m.estado} />
        </div>
      )
    },
  },
  { clave: 'email', encabezado: 'Correo', prioridad: 2 },
  // Fecha Y hora: el registro es una acción, y la trazabilidad exige saber el momento exacto, no solo el día.
  { clave: 'createdAt', encabezado: 'Registrado', tipo: 'fechaHora', prioridad: 3 },
]

export function ClientesTable({
  data,
  regional,
  hayFiltros = false,
  fallo = false,
  pie,
}: {
  data: ClienteRow[]
  /** Las preferencias de la empresa (zona horaria e idioma): la hora del registro es la de SU negocio. */
  regional?: { idioma?: string | null; zonaHoraria?: string | null } | null
  /** Hay búsqueda o filtros activos: el vacío dice «ninguno coincide» y ofrece quitarlos. */
  hayFiltros?: boolean
  /** La consulta falló: el vacío NO puede decir «todavía no hay clientes», que sería falso. */
  fallo?: boolean
  /** Paginación y total, bajo la tabla. */
  pie?: ReactNode
}) {
  return (
    <Tabla
      caption="Clientes, los más recientes primero"
      columnas={COLUMNAS}
      filas={data}
      claveDe={(c) => c.id}
      columnaIdentificadora="nombre"
      filaNavegable
      formato={{
        fechaHora: (v) => formatDate(v, regional ?? undefined, { dateStyle: 'short', timeStyle: 'short' }),
      }}
      hayFiltros={hayFiltros}
      vacio={
        fallo
          ? { titulo: 'No se pudieron cargar los clientes', descripcion: 'Es un problema temporal; recarga la página en unos segundos.' }
          : { titulo: 'Todavía no hay clientes', descripcion: 'Cuando alguien se registre, aparecerá aquí.' }
      }
      sinResultados={{
        titulo: 'Ningún cliente coincide',
        descripcion: 'Prueba con otro nombre, correo o teléfono, o quita un filtro.',
        accion: (
          <Link href="/admin/clientes" className="text-small font-medium text-primary hover:underline">
            Limpiar filtros
          </Link>
        ),
      }}
      pie={pie}
    />
  )
}
