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
 * EL SEPARADOR, DE UNA VEZ Y EN UN SOLO SITIO.
 *
 * Había dos dialectos conviviendo: este helper unía con coma y siete módulos
 * unían con punto y coma. El comentario de `reportes/queries.ts` explicaba por
 * qué el punto y coma es el correcto —«Excel en español lo espera como
 * separador y con `,` deja todo en una sola columna»— y el helper compartido,
 * que es el que más gente usa, hacía justo lo contrario. El resultado eran
 * cuatro exportaciones (Clientes, Membresías, Riesgo, Empresas) que llegaban
 * al usuario con las diecinueve columnas metidas en la primera.
 *
 * Ahora hay uno. Cambiarlo rompe cualquier hoja de cálculo que ya consumiera
 * los cuatro archivos de coma, y aun así es lo correcto: el resto de la
 * plataforma —incluida la Auditoría— ya usaba punto y coma, así que la
 * alternativa era dejar al usuario adivinando cuál de sus descargas se abre
 * bien.
 */
export const SEPARADOR_CSV = ';'

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
  const linea = (celdas: unknown[]) => celdas.map(celdaCsv).join(SEPARADOR_CSV)
  return `﻿${[linea(encabezados), ...filas.map(linea)].join('\n')}`
}

/**
 * Une varias tablas en un solo archivo, cada una con su título.
 *
 * Existe porque un reporte no es UNA tabla: el de empresa tiene cinco KPIs,
 * una serie diaria y cuatro desgloses, y hasta ahora el CSV exportaba solo la
 * serie. Quien abría el archivo esperando el reporte que estaba viendo se
 * encontraba una sexta parte de él, sin ninguna señal de que faltara el resto.
 *
 * Un archivo por bloque obligaría a pulsar seis botones; las hojas de un libro
 * de Excel no caben en un CSV. Bloques separados por una línea en blanco es lo
 * que Excel abre de una pieza y lo que cualquiera sabe recortar.
 */
export function armarCsvBloques(
  bloques: { titulo: string; encabezados: string[]; filas: unknown[][] }[]
): string {
  const partes = bloques.map((b) =>
    [celdaCsv(b.titulo), armarCsv(b.encabezados, b.filas).replace('﻿', '')].join('\n')
  )
  return `﻿${partes.join('\n\n')}`
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

/**
 * Cabeceras de una descarga de CSV con nombre fechado.
 *
 * `fechar: false` para los archivos que YA llevan su periodo en el nombre
 * (`reportes-plataforma-2026-05-01_2026-05-31`): añadirles la fecha de descarga
 * da un nombre con tres fechas donde solo una significa algo, y en una carpeta
 * de descargas eso se lee peor que un nombre corto.
 */
export function respuestaCsv(csv: string, nombre: string, opciones?: { fechar?: boolean }): Response {
  const hoy = new Date().toISOString().slice(0, 10)
  const archivo = opciones?.fechar === false ? nombre : `${nombre}-${hoy}`
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${archivo}.csv"`,
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
