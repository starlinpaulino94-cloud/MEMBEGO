import { desdeHace } from '@/lib/plural'
import type { EmpresaFila } from './lista'

/**
 * El CRM de empresas en CSV. Módulo PURO: se prueba sin base de datos.
 *
 * DOS DECISIONES QUE NO SON DE FORMATO:
 *
 * · Las cifras de dinero van SIN símbolo ni separador de miles. Un
 *   «RD$66,200.00» en una celda entra en Excel como texto y deja de sumarse; y
 *   la coma de los miles se come el separador del propio CSV.
 *
 * · Se escapa con la regla de siempre —comillas dobles si hay coma, comilla o
 *   salto de línea—, y también el punto y coma: Excel en español usa `;` como
 *   separador, así que un nombre con punto y coma partiría la fila en dos.
 */
function esc(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

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
  const lineas = [ENCABEZADOS.join(',')]

  for (const e of filas) {
    lineas.push(
      [
        esc(e.name),
        esc(e.slug),
        // Las MISMAS palabras que la pantalla. Un CSV que dice «inactiva» donde
        // la pantalla dice «suspendida» obliga a traducir para cruzarlos.
        esc(e.isActive ? 'Activa' : 'Suspendida'),
        esc(e.isPublished ? 'Si' : 'No'),
        esc(e.esDemo ? 'Si' : 'No'),
        esc(e.categoria),
        esc(e.ciudad),
        esc(e.email),
        esc(e.telefono),
        e.clientes,
        e.usuarios,
        e.sucursales,
        e.planes,
        e.membresiasVigentes,
        e.ingresosHistoricos,
        e.cobradoMes,
        esc(desdeHace(e.desdeUltimaActividad)),
        esc(e.enSilencio ? 'Si' : 'No'),
      ].join(',')
    )
  }

  return lineas.join('\n')
}
