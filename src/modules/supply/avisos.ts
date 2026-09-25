import { HALLAZGO_LABELS, type Gravedad, type TipoHallazgo } from './hallazgos'
import type { Hallazgo } from './conciliacion'
import type { AlertaVencimiento } from './vencimientos'

/**
 * MEMBEGO SUPPLY · QUÉ SE AVISA, A QUIÉN Y UNA SOLA VEZ (Fase 40).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA NO ERA CALCULAR: ERA AVISAR
 *
 * El cron ya sabía desde el primer día que 170 pizzas valoradas en RD$51.000
 * vencían en diez días, y que un lote tenía el invariante roto. Lo devolvía en
 * el JSON de su respuesta —que no lee nadie— y no escribía en `Notificacion`.
 * Un aviso que solo existe si alguien entra a mirar el panel no es un aviso:
 * es un informe.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE ARCHIVO ES PURO
 *
 * Aquí viven las claves de deduplicación y los textos, y nada más. Se puede
 * probar sin base de datos, que es exactamente lo que hay que poder probar:
 * si una clave cambia entre dos ejecuciones, el aviso se duplica, y eso no se
 * ve en una pantalla —se ve tres semanas después, cuando nadie lee ya la
 * campanita—. Las escrituras viven en `notificar.ts`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA REGLA DE ORO DE LA DEDUPLICACIÓN
 *
 * `Notificacion` tiene índice único `(userId, dedupeKey)`. Una clave ESTABLE
 * convierte el segundo intento en no-op; una clave que lleve la hora, un
 * contador o «hoy» duplica el aviso en cada pasada. El cron corre todos los
 * días a las 07:00 UTC, así que una clave mal puesta son 30 avisos del mismo
 * lote en un mes.
 */

/** Dinero en pesos, sin céntimos: las cifras de supply son de miles. */
export function dineroRD(monto: number): string {
  return `RD$${Math.round(monto).toLocaleString('es-DO')}`
}

// ── Vencimientos ────────────────────────────────────────────────────────────

/**
 * Un aviso por LOTE y por UMBRAL cruzado (30, 14, 7, 3, 1 días).
 *
 * El umbral va en la clave a propósito: cruzar los 14 días es una noticia
 * distinta de cruzar los 30, y merece sonar otra vez. Lo que NO puede entrar
 * aquí son los días restantes en crudo —serían 30 claves distintas y 30 avisos—
 * ni la fecha de ejecución.
 */
export function dedupeVencimiento(loteId: string, umbral: number): string {
  return `supply-vence|${loteId}|${umbral}`
}

export function textoVencimiento(
  a: Pick<
    AlertaVencimiento,
    'codigo' | 'item' | 'proveedorNombre' | 'enRiesgo' | 'expuestas' | 'exposicionFinanciera'
  >,
  umbral: number
): { titulo: string; mensaje: string; href: string } {
  const dias = umbral === 1 ? 'mañana' : `en ${umbral} días`
  const vivas = a.enRiesgo + a.expuestas
  // La cifra en dinero va PRIMERO en el mensaje. «170 unidades» se lee como un
  // dato de inventario; «RD$51.000» se lee como una pérdida, que es lo que es.
  const partes = [
    `${dineroRD(a.exposicionFinanciera)} en ${vivas} ${vivas === 1 ? 'unidad' : 'unidades'} de ${a.item} (${a.proveedorNombre}).`,
  ]
  if (a.enRiesgo > 0) {
    partes.push(`${a.enRiesgo} todavía se pueden repartir.`)
  }
  if (a.expuestas > 0) {
    // Estas ya están en manos de clientes: no se pueden reasignar, solo avisar
    // a quien las tiene. Decirlo evita que alguien intente «recuperarlas».
    partes.push(`${a.expuestas} ya están entregadas y sin canjear.`)
  }
  return {
    titulo: `Supply vence ${dias}: ${a.codigo}`,
    mensaje: partes.join(' '),
    href: `/superadmin/supply/vencimientos`,
  }
}

/** El mismo hecho, contado al proveedor: su contrato, no nuestra exposición. */
export function textoVencimientoProveedor(
  a: Pick<AlertaVencimiento, 'codigo' | 'item' | 'enRiesgo' | 'expuestas'>,
  umbral: number
): { titulo: string; mensaje: string; href: string } {
  const dias = umbral === 1 ? 'mañana' : `en ${umbral} días`
  const pendientes = a.enRiesgo + a.expuestas
  return {
    titulo: `Tu compromiso con Membego vence ${dias}`,
    // Al proveedor NO se le dice cuánto le costó a Membego: el costo unitario
    // es información de contrato y el portal del proveedor no la enseña.
    mensaje: `${a.codigo} · ${a.item}: quedan ${pendientes} ${pendientes === 1 ? 'unidad' : 'unidades'} sin entregar.`,
    href: `/admin/supply`,
  }
}

// ── Descuadres de conciliación ──────────────────────────────────────────────

/** Solo lo que invalida cifras llega a la campanita. */
const AVISABLES: readonly Gravedad[] = ['CRITICA', 'ALTA']

export function esAvisable(gravedad: Gravedad): boolean {
  return AVISABLES.includes(gravedad)
}

/**
 * Semana ISO (`2026-W39`) como parte de la clave del descuadre.
 *
 * Es el único sitio donde entra el tiempo, y es deliberado. Un descuadre no se
 * arregla en una tarde: avisar cada día sería ruido, y avisar UNA VEZ PARA
 * SIEMPRE haría que un invariante roto en octubre siguiera roto en diciembre
 * sin que nada volviera a sonar. Una vez por semana mientras siga ahí: lo
 * bastante insistente para no olvidarse, lo bastante espaciado para leerse.
 */
export function semanaIso(fecha: Date): string {
  // Jueves de la semana de `fecha`: por definición ISO, su año es el año de la
  // semana. Sin este salto, los primeros días de enero caen en la semana 1 del
  // año anterior y la clave cambia de año a mitad de la misma semana.
  const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()))
  const diaIso = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
  d.setUTCDate(d.getUTCDate() + 4 - diaIso)
  const inicioAno = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const semana = Math.ceil(((d.getTime() - inicioAno.getTime()) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`
}

export function dedupeDescuadre(
  h: Pick<Hallazgo, 'tipo' | 'entidad' | 'entidadId'>,
  ahora: Date
): string {
  return `supply-descuadre|${h.tipo}|${h.entidad}|${h.entidadId}|${semanaIso(ahora)}`
}

export function textoDescuadre(
  h: Pick<Hallazgo, 'tipo' | 'gravedad' | 'titulo' | 'detalle' | 'entidad' | 'entidadId'>
): { titulo: string; mensaje: string; href: string } {
  return {
    titulo: h.gravedad === 'CRITICA' ? `Descuadre crítico: ${h.titulo}` : `Descuadre: ${h.titulo}`,
    // El detalle lleva la entidad concreta porque un aviso que dice «hay un
    // descuadre» y no dice DÓNDE obliga a rebuscar en la conciliación entera.
    mensaje: `${HALLAZGO_LABELS[h.tipo as TipoHallazgo]}. ${h.detalle} (${h.entidad} ${h.entidadId})`,
    href: `/superadmin/supply/conciliacion`,
  }
}
