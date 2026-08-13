import { categoriaLabel, estadoLabel } from '@/lib/soporte'
import type { TicketFila } from './queries'

/**
 * La bandeja de soporte en CSV. Módulo PURO: se prueba sin base de datos.
 *
 * Se escapa con la regla de siempre —comillas si hay coma, comilla o salto— y
 * también el punto y coma: Excel en español lo usa como separador, y un asunto
 * de ticket con `;` partiría la fila en dos. En esta tabla el riesgo es real:
 * los asuntos los escribe el cliente.
 *
 * LA ANTIGÜEDAD VA EN DÍAS, no en «hace 3 semanas». El texto sirve para leer en
 * pantalla; en una celda hay que poder ORDENAR por él, y «hace 3 semanas» se
 * ordena alfabéticamente entre «hace 2 días» y «hace 4 h».
 */
function esc(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

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
  const lineas = filas.map((t) =>
    [
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
    ]
      .map(esc)
      .join(';')
  )
  // BOM para que Excel respete los acentos.
  return `﻿${[ENCABEZADOS.join(';'), ...lineas].join('\n')}`
}
