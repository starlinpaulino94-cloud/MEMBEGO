import { armarCsv } from '@/lib/csv'
import type { OperacionEmpresa } from './lista'

/**
 * Operaciones por empresa en CSV. Módulo PURO: se prueba sin base de datos.
 *
 * El armado va por `armarCsv` (`lib/csv.ts`), que es la única puerta: escapa
 * también el punto y coma, porque Excel en español lo usa como separador y un
 * nombre de empresa con `;` partiría la fila en dos.
 *
 * LAS PROMOCIONES VAN EN DOS COLUMNAS, vigentes y totales, y no en una sola
 * «3 / 12». En una celda, esa barra convierte el dato en texto y deja de poder
 * ordenarse ni sumarse — que es para lo único que se abre un CSV.
 */
const ENCABEZADOS = [
  'Empresa',
  'Vertical',
  'Practica',
  'Activa',
  'Publicada',
  'Promos vigentes',
  'Promos totales',
  'Reglas de referido activas',
  'Referidos completados (30 dias)',
  'Referidos completados (total)',
  'WhatsApp',
  'Numero WhatsApp',
]

export function operacionesToCsv(filas: OperacionEmpresa[]): string {
  return armarCsv(
    ENCABEZADOS,
    filas.map((e) => [
      e.name,
      e.verticalNombre,
      e.esDemo ? 'Si' : 'No',
      e.isActive ? 'Si' : 'No',
      e.isPublished ? 'Si' : 'No',
      e.promosVigentes,
      e.promosTotal,
      e.reglasActivas,
      e.referidosMes,
      e.referidosCompletados,
      // Tres estados, no dos: sin configurar y configurado-pero-apagado tienen
      // la misma consecuencia para el cliente pero se arreglan distinto.
      e.whatsapp ? (e.whatsapp.activo ? 'Activo' : 'Inactivo') : 'Sin configurar',
      e.whatsapp?.numero ?? '',
    ])
  )
}
