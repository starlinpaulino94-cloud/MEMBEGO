import { categoriaLabel, estadoLabel } from '@/lib/soporte'
import { armarCsv } from '@/lib/csv'
import type { TicketFila } from './queries'

/**
 * La bandeja de soporte en CSV. Módulo PURO: se prueba sin base de datos.
 *
 * El armado va por `armarCsv` (`lib/csv.ts`), que es la única puerta: escapa
 * también el punto y coma, que Excel en español usa como separador y que en
 * esta tabla es un riesgo real —los asuntos los escribe el cliente—.
 *
 * LA ANTIGÜEDAD VA EN DÍAS, no en «hace 3 semanas». El texto sirve para leer en
 * pantalla; en una celda hay que poder ORDENAR por él, y «hace 3 semanas» se
 * ordena alfabéticamente entre «hace 2 días» y «hace 4 h».
 */
const ENCABEZADOS = [
  'Asunto',
  'Cliente',
  'Empresa',
  'Practica',
  'Categoria',
  'Estado',
  'Mensajes',
  'Ultimo movimiento',
  'Dias sin moverse',
]

export function ticketsToCsv(filas: TicketFila[]): string {
  return armarCsv(
    ENCABEZADOS,
    filas.map((t) => [
      t.asunto,
      t.clienteNombre,
      t.empresaNombre,
      t.empresaEsDemo ? 'Si' : 'No',
      categoriaLabel(t.categoria),
      estadoLabel(t.estado),
      t.mensajes,
      // ISO: el único formato que Excel ordena bien en cualquier idioma.
      t.actualizado.toISOString().slice(0, 10),
      Math.floor(t.desdeUltimoMovimiento / (24 * 60 * 60 * 1000)),
    ])
  )
}
