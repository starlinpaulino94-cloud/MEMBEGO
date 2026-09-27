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

// ════════════════════════════════════════════════════════════════════════════
// AVISOS DE EVENTO (Fase 40, segunda mitad)
//
// Los de arriba nacen de un barrido: el cron mira y decide. Estos nacen de algo
// que alguien acaba de hacer, y por eso su clave es más simple — el hecho ya es
// único (un derecho, una reserva, una redención). La clave no está aquí para
// espaciar avisos en el tiempo sino para que un doble clic, un reintento de la
// cola o una acción reejecutada no manden el aviso dos veces.
//
// Un caso pide clave con umbral igual que los del cron: el beneficio que se le
// vence al CLIENTE en la mano. Ese sí es un barrido.
// ════════════════════════════════════════════════════════════════════════════

/** Día y hora en la zona del comercio, para un mensaje que se lee de un vistazo. */
export function cuando(fecha: Date, zona = 'America/Santo_Domingo'): string {
  const f = new Intl.DateTimeFormat('es-DO', {
    timeZone: zona,
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  return f.format(fecha)
}

export function soloDia(fecha: Date, zona = 'America/Santo_Domingo'): string {
  return new Intl.DateTimeFormat('es-DO', { timeZone: zona, day: 'numeric', month: 'long' }).format(
    fecha
  )
}

// ── Cliente · recibe un beneficio ───────────────────────────────────────────

export function dedupeBeneficio(derechoId: string): string {
  return `supply-beneficio|${derechoId}`
}

export function textoBeneficioNuevo(d: {
  item: string
  proveedorNombre: string
  vencAt: Date
}): { titulo: string; mensaje: string; href: string } {
  return {
    titulo: `Tienes un beneficio nuevo: ${d.item}`,
    // La FECHA LÍMITE va en el mensaje y no en la pantalla de detalle: un
    // beneficio que nadie usa es dinero que Membego ya pagó, y la razón número
    // uno de que no se use es que se olvida.
    mensaje: `Cortesía de Membego en ${d.proveedorNombre}. Úsalo antes del ${soloDia(d.vencAt)}.`,
    href: '/cliente/beneficios',
  }
}

// ── Cliente · se le vence en la mano ────────────────────────────────────────

export function dedupeBeneficioPorVencer(derechoId: string, umbral: number): string {
  return `supply-beneficio-vence|${derechoId}|${umbral}`
}

export function textoBeneficioPorVencer(
  d: { item: string; proveedorNombre: string },
  umbral: number
): { titulo: string; mensaje: string; href: string } {
  const cuando_ = umbral === 1 ? 'mañana' : `en ${umbral} días`
  return {
    titulo: `Tu ${d.item} vence ${cuando_}`,
    mensaje: `Recógelo en ${d.proveedorNombre} antes de que se pierda. No se puede renovar.`,
    href: '/cliente/beneficios',
  }
}

// ── Cliente · reserva y entrega ─────────────────────────────────────────────

export function dedupeReserva(reservaId: string): string {
  return `supply-reserva|${reservaId}`
}

export function textoReserva(d: {
  item: string
  proveedorNombre: string
  sucursal: string | null
  inicioAt: Date
}): { titulo: string; mensaje: string; href: string } {
  const donde = d.sucursal ? `${d.proveedorNombre} · ${d.sucursal}` : d.proveedorNombre
  return {
    titulo: 'Reserva confirmada',
    mensaje: `${d.item} en ${donde}, el ${cuando(d.inicioAt)}. Lleva tu código.`,
    href: '/cliente/beneficios',
  }
}

export function dedupeEntrega(redencionId: string): string {
  return `supply-entrega|${redencionId}`
}

export function textoEntrega(d: {
  item: string
  proveedorNombre: string
  sucursal: string | null
}): { titulo: string; mensaje: string; href: string } {
  const donde = d.sucursal ? `${d.proveedorNombre} · ${d.sucursal}` : d.proveedorNombre
  return {
    titulo: `Entregado: ${d.item}`,
    // Este aviso no es cortesía: es el RECIBO del cliente. Si el comercio marca
    // una entrega que no ocurrió, esto es lo que se la enseña el mismo día, no
    // el mes siguiente cuando vaya a usar su beneficio y no esté.
    mensaje: `Se registró la entrega en ${donde}. Si no lo recibiste, repórtalo desde tus beneficios.`,
    href: '/cliente/beneficios',
  }
}

// ── Proveedor · un voucher suyo entra en circulación ────────────────────────

export function dedupeVoucherProveedor(derechoId: string): string {
  return `supply-voucher-nuevo|${derechoId}`
}

export function textoVoucherNuevo(d: { item: string; codigo: string }): {
  titulo: string
  mensaje: string
  href: string
} {
  return {
    titulo: 'Nuevo voucher de Membego en circulación',
    // NUNCA el nombre del cliente: el proveedor lo verá al escanear, en el
    // mostrador, y no antes. Y nunca el costo, que es información de contrato.
    mensaje: `${d.item} · código ${d.codigo}. Puede presentarse en cualquier momento dentro de la vigencia.`,
    href: '/admin/supply',
  }
}

// ── Proveedor · su capacidad del día se está llenando ───────────────────────

export function dedupeCapacidad(proveedorId: string, dia: string): string {
  // Por día, no por reserva: avisar en cada reserva a partir del 80% sería un
  // aviso cada dos minutos en la hora punta.
  return `supply-capacidad|${proveedorId}|${dia}`
}

/** A partir de aquí se avisa. Por debajo, el dato está en su portal. */
export const UMBRAL_CAPACIDAD = 0.8

export function textoCapacidad(d: { usadas: number; cupo: number; dia: Date }): {
  titulo: string
  mensaje: string
  href: string
} {
  return {
    titulo: `Tu cupo del ${soloDia(d.dia)} se está llenando`,
    mensaje: `${d.usadas} de ${d.cupo} unidades comprometidas con Membego. Al llegar al máximo no se aceptan más reservas ese día.`,
    href: '/admin/supply',
  }
}

// ── Proveedor · incidencia y liquidación ────────────────────────────────────

export function dedupeIncidencia(incidenciaId: string, destinatario: 'proveedor' | 'membego'): string {
  return `supply-incidencia|${incidenciaId}|${destinatario}`
}

export function textoIncidenciaProveedor(d: { tipo: string; item: string }): {
  titulo: string
  mensaje: string
  href: string
} {
  return {
    titulo: 'Un cliente reportó un problema con un voucher',
    // Sin el detalle que escribió el cliente: puede llevar nombres, números de
    // teléfono o lo que se le ocurra, y esto entra en la campanita de un
    // tercero. El detalle lo ve Membego, que es quien media.
    mensaje: `${d.tipo} · ${d.item}. Membego lo está revisando y puede contactarte.`,
    href: '/admin/supply',
  }
}

export function textoIncidenciaMembego(d: {
  tipo: string
  item: string
  proveedorNombre: string
}): { titulo: string; mensaje: string; href: string } {
  return {
    titulo: `Incidencia de cumplimiento: ${d.proveedorNombre}`,
    mensaje: `${d.tipo} · ${d.item}. Entra a resolverla antes de que el cliente vuelva a escribir.`,
    href: '/superadmin/supply/incidencias',
  }
}

export function dedupeLiquidacion(pagoId: string): string {
  return `supply-liquidacion|${pagoId}`
}

export function textoLiquidacion(d: { monto: number; referencia: string | null }): {
  titulo: string
  mensaje: string
  href: string
} {
  const ref = d.referencia ? ` Referencia: ${d.referencia}.` : ''
  return {
    titulo: `Liquidación confirmada: ${dineroRD(d.monto)}`,
    mensaje: `Membego confirmó un pago de ${dineroRD(d.monto)} por tus entregas.${ref}`,
    href: '/admin/supply',
  }
}

// ── Cliente · su pedido ya está hecho ───────────────────────────────────────

export function dedupeProductoListo(reservaId: string): string {
  return `supply-listo|${reservaId}`
}

export function textoProductoListo(d: {
  item: string
  proveedorNombre: string
  sucursal: string | null
}): { titulo: string; mensaje: string; href: string } {
  const donde = d.sucursal ? `${d.proveedorNombre} · ${d.sucursal}` : d.proveedorNombre
  return {
    titulo: `Tu ${d.item} ya está listo`,
    // Sin hora: el comercio pulsa el botón cuando ya lo tiene hecho, así que
    // «ya» es más exacto que repetir la hora que se acordó ayer.
    mensaje: `Puedes pasar a recogerlo en ${donde}. Lleva tu código.`,
    href: '/cliente/beneficios',
  }
}

// ════════════════════════════════════════════════════════════════════════════
// AVISOS ANALÍTICOS DE PLATAFORMA (Fase 40 · los tres que faltaban)
//
// Los de arriba nacen de un hecho —un lote cruza un umbral, alguien pulsa un
// botón—. Estos nacen de una TENDENCIA, y por eso son los últimos que se
// escribieron: hay que elegir a partir de qué número algo deja de ser un mal
// día y pasa a ser un patrón.
//
// ────────────────────────────────────────────────────────────────────────────
// LOS NÚMEROS SON UNA ESTIMACIÓN, NO UNA MEDICIÓN
//
// Cuando se escribieron, el módulo llevaba días en producción: nadie había
// visto todavía la tasa real de incumplimiento de un proveedor de Membego. Por
// eso viven TODOS aquí, con nombre y juntos: con dos meses de datos reales se
// suben o se bajan sin tocar una línea de lógica.
//
// Si algún día resultan ruidosos, lo primero que se toca es la CADENCIA —son
// semanales— y no el umbral. Un aviso correcto que llega a diario se deja de
// leer igual que uno equivocado.
// ════════════════════════════════════════════════════════════════════════════

export const UMBRALES_RIESGO = {
  /**
   * Entregas mínimas antes de juzgar a un proveedor.
   *
   * Sin suelo, un comercio que entregó 3 y falló 1 sale con 33% y parece un
   * desastre. Con 20, un fallo es 5% y el ruido se aplana. Es la diferencia
   * entre medir y acusar.
   */
  ENTREGAS_MINIMAS: 20,
  /** 1 de cada 20 clientes se va con las manos vacías. Ya es un patrón. */
  INCUMPLIMIENTO_AVISO: 5,
  /** 1 de cada 7. A esa altura el acuerdo no se está respetando. */
  INCUMPLIMIENTO_URGENTE: 15,
  /** El puntaje ya penaliza reversas e incumplimientos; por debajo, urgente. */
  PUNTAJE_URGENTE: 50,

  /**
   * Cuánta de su capacidad diaria haría falta, todos los días que quedan, para
   * entregar lo que sigue vivo. Por encima de esto no llega con holgura.
   */
  CABIDA_AVISO: 0.8,
  /** Por encima de 1 no es apretado: es aritméticamente imposible. */
  CABIDA_IMPOSIBLE: 1,

  /** A mitad de vigencia se espera haber consumido al menos esto. */
  CONSUMO_ESPERADO_A_MITAD: 0.3,
  /** Mitad de la vigencia. */
  PROGRESO_PARA_JUZGAR: 0.5,

  /**
   * Dinero por debajo del cual no se avisa aunque el porcentaje cuadre.
   *
   * Un lote de RD$900 que va lento no es un problema de plataforma, y avisar de
   * él gasta la atención que hace falta para el de RD$60.000.
   */
  EXPOSICION_MINIMA: 25_000,
} as const

export type NivelRiesgo = 'AVISO' | 'URGENTE'

// ── 1 · El proveedor no está cumpliendo ─────────────────────────────────────

export function riesgoProveedor(d: {
  redimidas: number
  tasaIncumplimiento: number
  puntaje: number
}): NivelRiesgo | null {
  // El suelo va PRIMERO: sin él, todo lo de abajo mide ruido.
  if (d.redimidas < UMBRALES_RIESGO.ENTREGAS_MINIMAS) return null
  if (
    d.tasaIncumplimiento >= UMBRALES_RIESGO.INCUMPLIMIENTO_URGENTE ||
    d.puntaje < UMBRALES_RIESGO.PUNTAJE_URGENTE
  ) {
    return 'URGENTE'
  }
  if (d.tasaIncumplimiento >= UMBRALES_RIESGO.INCUMPLIMIENTO_AVISO) return 'AVISO'
  return null
}

export function dedupeProveedorEnRiesgo(proveedorId: string, ahora: Date): string {
  return `supply-proveedor-riesgo|${proveedorId}|${semanaIso(ahora)}`
}

export function textoProveedorEnRiesgo(
  d: { proveedor: string; redimidas: number; incumplimientos: number; tasaIncumplimiento: number; puntaje: number },
  nivel: NivelRiesgo
): { titulo: string; mensaje: string; href: string } {
  return {
    titulo:
      nivel === 'URGENTE'
        ? `${d.proveedor} no está cumpliendo`
        : `${d.proveedor} acumula incumplimientos`,
    // Las cifras crudas ANTES del porcentaje: «3 de 40» se discute con el
    // proveedor; «7,5%» no se discute con nadie.
    mensaje: `${d.incumplimientos} de ${d.redimidas} entregas con incidencia por su parte (${d.tasaIncumplimiento}%). Puntaje ${d.puntaje}/100.`,
    href: '/superadmin/supply/proveedores',
  }
}

// ── 2 · El supply no cabe antes de vencer ───────────────────────────────────

/**
 * ¿Le da tiempo al comercio a entregar lo que queda?
 *
 * No es una corazonada: es una división. Quedan 400 pizzas, vencen en 10 días y
 * el contrato dice 20 al día → caben 200 y sobran 200. Eso se sabe HOY, no el
 * día nueve, y por eso este aviso vale lo que vale.
 *
 * Sin capacidad declarada no se juzga: `null` significa SIN límite, no cero.
 */
export function riesgoCabida(d: {
  vivas: number
  diasRestantes: number
  capacidadDiaria: number | null
  exposicion: number
}): NivelRiesgo | null {
  if (!d.capacidadDiaria || d.capacidadDiaria <= 0) return null
  if (d.vivas <= 0) return null

  const dias = Math.max(1, d.diasRestantes)
  const ratio = d.vivas / dias / d.capacidadDiaria

  // Cabe con holgura: no hay nada que decir, por mucho dinero que sea. El
  // dinero solo AGRAVA un problema de cabida; no lo crea.
  if (ratio <= UMBRALES_RIESGO.CABIDA_AVISO) return null
  // No cabe ni llenando el comercio todos los días.
  if (ratio > UMBRALES_RIESGO.CABIDA_IMPOSIBLE) return 'URGENTE'
  // Cabe justo, pero hay demasiado en juego para dejarlo al azar de un día malo.
  if (d.exposicion >= UMBRALES_RIESGO.EXPOSICION_MINIMA) return 'URGENTE'
  return 'AVISO'
}

/** Cuántas unidades no caben. Cero si caben todas. */
export function unidadesQueNoCaben(d: {
  vivas: number
  diasRestantes: number
  capacidadDiaria: number | null
}): number {
  if (!d.capacidadDiaria || d.capacidadDiaria <= 0) return 0
  const caben = Math.max(1, d.diasRestantes) * d.capacidadDiaria
  return Math.max(0, d.vivas - caben)
}

export function dedupeNoCabe(loteId: string, ahora: Date): string {
  return `supply-no-cabe|${loteId}|${semanaIso(ahora)}`
}

export function textoNoCabe(d: {
  codigo: string
  item: string
  proveedorNombre: string
  vivas: number
  diasRestantes: number
  capacidadDiaria: number
  sobran: number
  costoUnitario: number
}): { titulo: string; mensaje: string; href: string } {
  const perdida = dineroRD(d.sobran * d.costoUnitario)
  return {
    titulo:
      d.sobran > 0
        ? `No caben ${d.sobran} unidades de ${d.codigo}`
        : `${d.codigo} va justo de capacidad`,
    mensaje:
      d.sobran > 0
        ? `${d.vivas} ${d.item} para ${d.diasRestantes} día(s) a ${d.capacidadDiaria}/día en ${d.proveedorNombre}: sobran ${d.sobran} y son ${perdida}. Repártelas o renegocia la capacidad.`
        : `${d.vivas} ${d.item} en ${d.diasRestantes} día(s) con cupo de ${d.capacidadDiaria}/día. Cabe, pero sin margen para un día malo.`,
    href: '/superadmin/supply/vencimientos',
  }
}

// ── 3 · Capital dormido ─────────────────────────────────────────────────────

/**
 * Dinero comprometido que no se está consumiendo.
 *
 * Sustituye al «riesgo de presupuesto» que pedía la Fase 40, y el cambio es
 * deliberado: **no existe el concepto de presupuesto en el modelo** —ni tabla,
 * ni tope por campaña o período— así que cualquier umbral sería inventarse una
 * cifra y llamarla riesgo. Esto sí se puede calcular con lo que hay.
 *
 * A mitad de la vigencia con menos de un tercio entregado, o la campaña no está
 * repartiendo o el producto no interesa. Lo que importa es que TODAVÍA DA
 * TIEMPO a reasignarlo: por eso se mira a la mitad y no al final.
 */
export function riesgoCapitalDormido(d: {
  inicioAt: Date
  venceAt: Date
  compradas: number
  redimidas: number
  costoUnitario: number
  ahora: Date
}): NivelRiesgo | null {
  const total = d.venceAt.getTime() - d.inicioAt.getTime()
  if (total <= 0 || d.compradas <= 0) return null
  const progreso = (d.ahora.getTime() - d.inicioAt.getTime()) / total
  if (progreso < UMBRALES_RIESGO.PROGRESO_PARA_JUZGAR || progreso >= 1) return null
  const consumido = d.redimidas / d.compradas
  if (consumido >= UMBRALES_RIESGO.CONSUMO_ESPERADO_A_MITAD) return null
  const dormido = (d.compradas - d.redimidas) * d.costoUnitario
  if (dormido < UMBRALES_RIESGO.EXPOSICION_MINIMA) return null
  return 'AVISO'
}

export function dedupeCapitalDormido(loteId: string, ahora: Date): string {
  return `supply-capital-dormido|${loteId}|${semanaIso(ahora)}`
}

export function textoCapitalDormido(d: {
  codigo: string
  item: string
  proveedorNombre: string
  compradas: number
  redimidas: number
  costoUnitario: number
  diasRestantes: number
}): { titulo: string; mensaje: string; href: string } {
  const dormido = dineroRD((d.compradas - d.redimidas) * d.costoUnitario)
  const pct = Math.round((d.redimidas / d.compradas) * 100)
  return {
    titulo: `${dormido} parados en ${d.codigo}`,
    mensaje: `${d.redimidas} de ${d.compradas} ${d.item} entregadas (${pct}%) y quedan ${d.diasRestantes} día(s) en ${d.proveedorNombre}. Todavía da tiempo a repartirlo.`,
    href: '/superadmin/supply/lotes',
  }
}
