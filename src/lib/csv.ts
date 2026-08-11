/**
 * CSV para las exportaciones del panel.
 *
 * Existe porque la exportación estaba en el NAVEGADOR: `DataTable` volcaba las
 * filas que la tabla tenía cargadas. En Clientes eso eran 50 de 98, y el
 * archivo se descargaba sin decir que faltaba nada — la forma más silenciosa
 * de perder datos. Ahora se exporta en el servidor, sobre el mismo filtro que
 * el usuario está viendo, y estas funciones son el trozo compartido.
 *
 * Puro: sin Prisma, sin React. Se prueba solo.
 */

/**
 * Escapa un valor de celda. Se entrecomilla también ante `;` porque Excel en
 * configuración regional española usa el punto y coma como separador y una
 * dirección con `;` partiría la fila en dos.
 */
export function celdaCsv(valor: unknown): string {
  if (valor == null) return ''
  const s = String(valor)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Arma el CSV completo.
 *
 * El BOM inicial no es decorativo: sin él, Excel abre el archivo en su
 * codificación local y «Ramón Polanco» llega como «RamÃ³n Polanco». Un informe
 * con los nombres rotos no se usa dos veces.
 */
export function armarCsv(encabezados: string[], filas: unknown[][]): string {
  const lineas = [
    encabezados.map(celdaCsv).join(','),
    ...filas.map((f) => f.map(celdaCsv).join(',')),
  ]
  return `﻿${lineas.join('\n')}`
}

/** Fecha para una celda, en la zona horaria del negocio (vacío si no hay). */
export function fechaCsv(
  fecha: Date | null | undefined,
  timeZone: string,
  conHora = false
): string {
  if (!fecha) return ''
  return new Intl.DateTimeFormat('es-DO', {
    timeZone,
    dateStyle: 'short',
    ...(conHora ? { timeStyle: 'short' as const } : {}),
  }).format(fecha)
}

/** Cabeceras de una descarga de CSV con nombre fechado. */
export function respuestaCsv(csv: string, nombre: string): Response {
  const hoy = new Date().toISOString().slice(0, 10)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nombre}-${hoy}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * Tope de filas por exportación. No es una limitación de la tabla: es el punto
 * en el que un CSV deja de ser un archivo y pasa a ser un problema de memoria
 * del servidor. Quien lo alcance recibe un aviso EN EL PROPIO ARCHIVO — nunca
 * un recorte callado, que es justo lo que se está corrigiendo.
 */
export const TOPE_EXPORTACION = 10_000
