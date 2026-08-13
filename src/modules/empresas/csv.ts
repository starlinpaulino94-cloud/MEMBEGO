import { desdeHace } from '@/lib/plural'
import { armarCsv } from '@/lib/csv'
import type { EmpresaFila } from './lista'

/**
 * El CRM de empresas en CSV. Módulo PURO: se prueba sin base de datos.
 *
 * UNA DECISIÓN QUE NO ES DE FORMATO: las cifras de dinero van SIN símbolo ni
 * separador de miles. Un «RD$66,200.00» en una celda entra en Excel como texto
 * y deja de sumarse.
 *
 * El armado va por `armarCsv` (`lib/csv.ts`), que es la única puerta: este
 * archivo tenía su propio `esc` y unía con coma, así que las diecinueve
 * columnas llegaban a Excel metidas en la primera.
 */

const ENCABEZADOS = [
  'Empresa',
  'Slug',
  'Estado',
  'Publicada',
  'Practica',
  'Categoria',
  'Ciudad',
  'Correo',
  'Telefono',
  'Clientes',
  'Usuarios',
  'Sucursales',
  'Planes',
  'Membresias vigentes',
  'Cobrado historico',
  'Cobrado este mes',
  'Ultima actividad',
  'En silencio',
] as const

export function empresasToCsv(filas: EmpresaFila[]): string {
  return armarCsv(
    [...ENCABEZADOS],
    filas.map((e) => [
      e.name,
      e.slug,
      // Las MISMAS palabras que la pantalla. Un CSV que dice «inactiva» donde
      // la pantalla dice «suspendida» obliga a traducir para cruzarlos.
      e.isActive ? 'Activa' : 'Suspendida',
      e.isPublished ? 'Si' : 'No',
      e.esDemo ? 'Si' : 'No',
      e.categoria,
      e.ciudad,
      e.email,
      e.telefono,
      e.clientes,
      e.usuarios,
      e.sucursales,
      e.planes,
      e.membresiasVigentes,
      e.ingresosHistoricos,
      e.cobradoMes,
      desdeHace(e.desdeUltimaActividad),
      e.enSilencio ? 'Si' : 'No',
    ])
  )
}
