import type {
  SupplyAcuerdoEstado,
  SupplyAsientoTipo,
  SupplyConciliacionEstado,
  SupplyCuentaEstado,
  SupplyCuentaPorCobrarOrigen,
  SupplyCuentaPorPagarOrigen,
  SupplyDepositoEstado,
  SupplyDepositoMovimientoTipo,
  SupplyDiscrepanciaEstado,
  SupplyDiscrepanciaTipo,
  SupplyFacturaEstado,
  SupplyFacturaTipo,
  SupplyFrecuenciaCorte,
  SupplyLiquidacionEstado,
  SupplyLiquidacionLineaTipo,
  SupplyProveedorOrigen,
  SupplyVentaEstado,
  SupplyCubeta,
  SupplyDerechoEstado,
  SupplyIncidenciaEstado,
  SupplyIncidenciaTipo,
  SupplyLoteEstado,
  SupplyModalidadPago,
  SupplyModeloComercial,
  SupplyMovimientoTipo,
  SupplyOrdenEstado,
  SupplyOrigenDerecho,
  SupplyPagoTipo,
  SupplyPoliticaSobrante,
  SupplyTipo,
  SupplyVoucherEstado,
} from '@prisma/client'

/**
 * MEMBEGO SUPPLY · vocabulario del dominio.
 *
 * PURO: sin Prisma en tiempo de ejecución (solo `import type`), sin React, sin
 * `next/*`. Lo consumen el ledger, las server actions, las pantallas del
 * superadmin, el portal del comercio y las pruebas — y por eso no puede
 * arrastrar nada que solo exista en el servidor.
 *
 * Es la traducción de `docs/membego-supply-architecture.md` a código: si una
 * etiqueta o un estado no está aquí, no existe en el producto.
 */

// ── Tipos de supply ─────────────────────────────────────────────────────────

export const SUPPLY_TIPOS = [
  'ON_DEMAND',
  'STOCK_RESERVADO',
  'CAPACIDAD_SERVICIO',
  'CAPACIDAD_AGENDADA',
] as const satisfies readonly SupplyTipo[]

export const SUPPLY_TIPO_LABELS: Record<SupplyTipo, string> = {
  ON_DEMAND: 'Bajo demanda',
  STOCK_RESERVADO: 'Stock físico reservado',
  CAPACIDAD_SERVICIO: 'Capacidad de servicio',
  CAPACIDAD_AGENDADA: 'Capacidad agendada',
}

export const SUPPLY_TIPO_EJEMPLOS: Record<SupplyTipo, string> = {
  ON_DEMAND: 'Una pizza: se prepara cuando llega el cliente.',
  STOCK_RESERVADO: '500 termos apartados físicamente en el comercio.',
  CAPACIDAD_SERVICIO: '500 lavados que el comercio compromete.',
  CAPACIDAD_AGENDADA: '100 excursiones con fecha y cupo.',
}

/**
 * Tipos que EXIGEN reserva previa (sucursal, día y hora) antes de poder
 * enseñar el QR. Una excursión sin cupo reservado no es un derecho utilizable:
 * es una promesa que revienta en el muelle.
 */
export const TIPOS_CON_RESERVA_OBLIGATORIA: readonly SupplyTipo[] = ['CAPACIDAD_AGENDADA']

/** ¿Este tipo de supply puede consumir cupo de capacidad diaria/horaria? */
export function usaCapacidad(tipo: SupplyTipo): boolean {
  return tipo !== 'STOCK_RESERVADO'
}

// ── Modelo comercial ────────────────────────────────────────────────────────

export const SUPPLY_MODELO_LABELS: Record<SupplyModeloComercial, string> = {
  COMPRA_UNIDAD_COMPLETA: 'Compra de unidad completa',
  SUBSIDIO: 'Oferta subsidiada',
  COMISION: 'Venta sin precompra (comisión)',
}

export const SUPPLY_MODELOS = [
  'COMPRA_UNIDAD_COMPLETA',
  'SUBSIDIO',
  'COMISION',
] as const satisfies readonly SupplyModeloComercial[]

/**
 * LA FRASE QUE EVITA EL LÍO CONTABLE MÁS CARO DEL MÓDULO.
 *
 * En compra completa el proveedor YA cobró (o cobrará) la unidad por contrato:
 * el cliente no se la vuelve a pagar al comercio. En subsidio el cliente sí
 * paga al comercio la diferencia. Son operaciones distintas y no se mezclan.
 */
export const SUPPLY_MODELO_EXPLICACION: Record<SupplyModeloComercial, string> = {
  COMPRA_UNIDAD_COMPLETA:
    'Membego compró la unidad entera. El cliente no le paga la unidad base al comercio; solo los extras.',
  SUBSIDIO:
    'Membego financia una parte del precio. El cliente le paga el resto al comercio.',
  COMISION:
    'Membego no compra nada: vende el producto del proveedor, cobra al cliente y, cuando el proveedor entrega, le debe el neto (bruto menos comisión). No hay lote ni derecho.',
}

/** ¿Este modelo compra supply (lotes, ledger de cubetas)? COMISION no. */
export function modeloCompraSupply(modelo: SupplyModeloComercial): boolean {
  return modelo !== 'COMISION'
}

/** ¿El cliente le paga la unidad base al comercio en este modelo? */
export function clientePagaAlComercio(modelo: SupplyModeloComercial): boolean {
  return modelo === 'SUBSIDIO'
}

// ── Pago al proveedor ───────────────────────────────────────────────────────

export const SUPPLY_MODALIDAD_PAGO_LABELS: Record<SupplyModalidadPago, string> = {
  PREPAGO_TOTAL: '100% por adelantado',
  PREPAGO_PARCIAL: 'Anticipo + saldo',
  PAGO_POR_REDENCION: 'Se paga al redimirse',
  SUBSIDIO: 'Solo se financia una parte',
}

/** Clave de `SUPPLY_POLITICA_SOBRANTE_LABELS`, para pantallas que reciben texto. */
export type SupplyPoliticaSobranteLabelKey = SupplyPoliticaSobrante

export const SUPPLY_POLITICA_SOBRANTE_LABELS: Record<SupplyPoliticaSobrante, string> = {
  EXPIRAR: 'Se pierde al vencer',
  EXTENDER: 'Se extiende la vigencia',
  REEMBOLSO: 'El proveedor reembolsa',
  CREDITO_COMERCIO: 'Queda como crédito con el comercio',
  CONVERTIR: 'Se convierte a otro producto',
  RENEGOCIAR: 'Renegociación manual',
}

/**
 * Acciones que el motor de vencimientos PROPONE para cada política. Proponer,
 * no aplicar: extender un contrato o pedir un reembolso son conversaciones con
 * una empresa, no efectos laterales de un cron.
 */
export const ACCIONES_POR_POLITICA: Record<SupplyPoliticaSobrante, readonly string[]> = {
  EXPIRAR: ['ASIGNAR_FLASH_DEAL', 'ASIGNAR_RECOMPENSAS', 'CREAR_CAMPANA'],
  EXTENDER: ['EXTENDER_CONTRATO', 'ASIGNAR_FLASH_DEAL', 'CREAR_CAMPANA'],
  REEMBOLSO: ['SOLICITAR_REEMBOLSO', 'ASIGNAR_FLASH_DEAL'],
  CREDITO_COMERCIO: ['SOLICITAR_CREDITO', 'ASIGNAR_FLASH_DEAL'],
  CONVERTIR: ['CONVERTIR_PRODUCTO', 'CREAR_CAMPANA'],
  RENEGOCIAR: ['RENEGOCIAR', 'EXTENDER_CONTRATO'],
}

export const ACCION_VENCIMIENTO_LABELS: Record<string, string> = {
  ASIGNAR_FLASH_DEAL: 'Asignar a una oferta relámpago',
  ASIGNAR_RECOMPENSAS: 'Asignar a recompensas',
  CREAR_CAMPANA: 'Crear una campaña',
  EXTENDER_CONTRATO: 'Extender la vigencia (enmienda)',
  SOLICITAR_REEMBOLSO: 'Solicitar reembolso al proveedor',
  SOLICITAR_CREDITO: 'Convertir en crédito comercial',
  CONVERTIR_PRODUCTO: 'Convertir a otro producto',
  RENEGOCIAR: 'Renegociar con el proveedor',
}

// ── Cubetas ─────────────────────────────────────────────────────────────────

export const SUPPLY_CUBETAS = [
  'DISPONIBLE',
  'ASIGNADO',
  'RETENIDO',
  'EMITIDO',
  'REDIMIDO',
  'CERRADO',
] as const satisfies readonly SupplyCubeta[]

export const SUPPLY_CUBETA_LABELS: Record<SupplyCubeta, string> = {
  DISPONIBLE: 'Disponible',
  ASIGNADO: 'Asignado a campaña',
  RETENIDO: 'Retenido temporalmente',
  EMITIDO: 'Emitido a clientes',
  REDIMIDO: 'Redimido',
  CERRADO: 'Vencido o cancelado',
}

/**
 * Cubetas TERMINALES: una unidad que llega aquí no vuelve por el camino normal.
 * Solo una REVERSA o un AJUSTE explícitos, con motivo y actor, la sacan.
 */
export const CUBETAS_TERMINALES: readonly SupplyCubeta[] = ['REDIMIDO', 'CERRADO']

/**
 * Cubetas que cuentan como COSTO YA CONSUMIDO por Membego.
 *
 * Solo REDIMIDO. Una unidad emitida que nadie canjeó no le costó nada todavía:
 * el proveedor no entregó nada. Contarla como gasto infla el CAC de todas las
 * campañas y hace que regalar parezca más caro de lo que es (Fase 61).
 */
export const CUBETAS_CONSUMIDAS: readonly SupplyCubeta[] = ['REDIMIDO']

/**
 * Cubetas con EXPOSICIÓN viva: unidades comprometidas cuyo desenlace no se
 * conoce. Es la cifra que un director financiero pide cuando pregunta «¿cuánto
 * dinero tengo en el aire?».
 */
export const CUBETAS_EXPUESTAS: readonly SupplyCubeta[] = ['ASIGNADO', 'RETENIDO', 'EMITIDO']

// ── Movimientos ─────────────────────────────────────────────────────────────

export const SUPPLY_MOVIMIENTO_LABELS: Record<SupplyMovimientoTipo, string> = {
  COMPRA: 'Compra',
  ASIGNACION: 'Asignación a campaña',
  LIBERACION_ASIGNACION: 'Liberación de asignación',
  RETENCION: 'Retención temporal',
  LIBERACION_RETENCION: 'Liberación de retención',
  EMISION: 'Emisión a cliente',
  DEVOLUCION_EMISION: 'Devolución de emisión',
  REDENCION: 'Redención',
  REVERSA_REDENCION: 'Reversa de redención',
  EXPIRACION: 'Expiración',
  CANCELACION: 'Cancelación',
  AJUSTE: 'Ajuste',
  TRANSFERENCIA: 'Transferencia entre lotes',
}

// ── Estados ─────────────────────────────────────────────────────────────────

export const SUPPLY_ACUERDO_ESTADO_LABELS: Record<SupplyAcuerdoEstado, string> = {
  BORRADOR: 'Borrador',
  PENDIENTE_APROBACION: 'Pendiente de aprobación',
  APROBADO: 'Aprobado',
  ACTIVO: 'Activo',
  SUSPENDIDO: 'Suspendido',
  COMPLETADO: 'Completado',
  VENCIDO: 'Vencido',
  CANCELADO: 'Cancelado',
}

export const SUPPLY_ORDEN_ESTADO_LABELS: Record<SupplyOrdenEstado, string> = {
  BORRADOR: 'Borrador',
  PENDIENTE_APROBACION: 'Pendiente de aprobación',
  APROBADA: 'Aprobada',
  CONFIRMADA: 'Confirmada',
  PARCIALMENTE_FONDEADA: 'Parcialmente fondeada',
  FONDEADA: 'Fondeada',
  ACTIVA: 'Activa',
  COMPLETADA: 'Completada',
  CANCELADA: 'Cancelada',
}

export const SUPPLY_LOTE_ESTADO_LABELS: Record<SupplyLoteEstado, string> = {
  PROGRAMADO: 'Programado',
  ACTIVO: 'Activo',
  AGOTADO: 'Agotado',
  VENCIDO: 'Vencido',
  CANCELADO: 'Cancelado',
  CERRADO: 'Cerrado',
}

export const SUPPLY_DERECHO_ESTADO_LABELS: Record<SupplyDerechoEstado, string> = {
  RETENIDO: 'Retenido',
  ACTIVO: 'Disponible',
  REDIMIDO: 'Utilizado',
  VENCIDO: 'Vencido',
  CANCELADO: 'Cancelado',
  REVOCADO: 'Revocado',
}

export const SUPPLY_VOUCHER_ESTADO_LABELS: Record<SupplyVoucherEstado, string> = {
  ACTIVO: 'Activo',
  REDIMIDO: 'Redimido',
  VENCIDO: 'Vencido',
  CANCELADO: 'Cancelado',
  REVOCADO: 'Revocado',
}

// ── Origen de los derechos ──────────────────────────────────────────────────

/** Clave de `SUPPLY_ORIGEN_LABELS`, para pantallas que reciben texto. */
export type SupplyOrigenLabelKey = SupplyOrigenDerecho

export const SUPPLY_ORIGEN_LABELS: Record<SupplyOrigenDerecho, string> = {
  CAMPANA_BIENVENIDA: 'Campaña de bienvenida',
  REGALO: 'Regalo',
  OFERTA: 'Oferta con descuento',
  COMPRA: 'Compra del cliente',
  MEMBRESIA: 'Beneficio de membresía',
  RECOMPENSA: 'Recompensa por puntos',
  REFERIDO: 'Programa de referidos',
  INFLUENCER: 'Campaña con influencers',
  SOPORTE: 'Atención al cliente',
  MANUAL: 'Entrega manual',
}

/**
 * Orígenes que cuentan como ADQUISICIÓN de cliente. El resto son retención,
 * fidelización o servicio: mezclarlos hace que el CAC deje de significar nada.
 */
export const ORIGENES_ADQUISICION: readonly SupplyOrigenDerecho[] = [
  'CAMPANA_BIENVENIDA',
  'REFERIDO',
  'INFLUENCER',
]

// ── Destinos de una asignación ──────────────────────────────────────────────

export const SUPPLY_DESTINOS = [
  'CAMPANA',
  'OFERTA',
  'MEMBRESIA',
  'RECOMPENSA',
  'REFERIDO',
  'INFLUENCER',
  'REGALO',
  'RESERVA',
] as const
export type SupplyDestino = (typeof SUPPLY_DESTINOS)[number]

export const SUPPLY_DESTINO_LABELS: Record<SupplyDestino, string> = {
  CAMPANA: 'Campaña',
  OFERTA: 'Oferta / venta con descuento',
  MEMBRESIA: 'Beneficio de membresía',
  RECOMPENSA: 'Recompensas por puntos',
  REFERIDO: 'Programa de referidos',
  INFLUENCER: 'Influencers',
  REGALO: 'Regalos',
  RESERVA: 'Reserva estratégica',
}

/** Origen que se le pone al derecho emitido desde cada destino. */
export const ORIGEN_POR_DESTINO: Record<SupplyDestino, SupplyOrigenDerecho> = {
  CAMPANA: 'CAMPANA_BIENVENIDA',
  OFERTA: 'OFERTA',
  MEMBRESIA: 'MEMBRESIA',
  RECOMPENSA: 'RECOMPENSA',
  REFERIDO: 'REFERIDO',
  INFLUENCER: 'INFLUENCER',
  REGALO: 'REGALO',
  RESERVA: 'MANUAL',
}

export function esDestino(valor: string): valor is SupplyDestino {
  return (SUPPLY_DESTINOS as readonly string[]).includes(valor)
}

// ── Incidencias ─────────────────────────────────────────────────────────────

export const SUPPLY_INCIDENCIA_TIPO_LABELS: Record<SupplyIncidenciaTipo, string> = {
  BENEFICIO_NEGADO: 'Me negaron el beneficio',
  PRODUCTO_NO_DISPONIBLE: 'El producto no estaba disponible',
  PRODUCTO_INCORRECTO: 'Me entregaron otro producto',
  COBRO_INDEBIDO: 'Me cobraron de más',
  EMPRESA_CERRADA: 'La empresa estaba cerrada',
  CALIDAD_INSUFICIENTE: 'La calidad no era la ofrecida',
  SUCURSAL_NO_ACEPTO: 'La sucursal no aceptó el voucher',
  QR_INVALIDO: 'El código QR no era válido',
  CANTIDAD_INCORRECTA: 'La cantidad entregada no era la correcta',
  DERECHO_VENCIDO: 'El beneficio ya estaba vencido',
  DOBLE_REDENCION: 'Se intentó usar dos veces la misma unidad',
  SOSPECHA_FRAUDE: 'Sospecha de fraude',
  ERROR_HUMANO: 'Error de quien operó',
  RECLAMO_CLIENTE: 'Reclamo del cliente',
  OTRO: 'Otro',
}

export const SUPPLY_INCIDENCIA_ESTADO_LABELS: Record<SupplyIncidenciaEstado, string> = {
  ABIERTA: 'Abierta',
  EN_REVISION: 'En revisión',
  ESPERANDO_PROVEEDOR: 'Esperando al proveedor',
  ESPERANDO_CLIENTE: 'Esperando al cliente',
  RESUELTA_CLIENTE: 'Resuelta a favor del cliente',
  RESUELTA_COMERCIO: 'Resuelta a favor del comercio',
  RESUELTA_MEMBEGO: 'Resuelta por Membego',
  RECHAZADA: 'Rechazada (no procede)',
  CERRADA: 'Cerrada',
}

/** Estados de incidencia que siguen exigiendo atención. */
export const INCIDENCIA_VIVA: readonly SupplyIncidenciaEstado[] = [
  'ABIERTA',
  'EN_REVISION',
  'ESPERANDO_PROVEEDOR',
  'ESPERANDO_CLIENTE',
]

/**
 * Incidencias que, por sí solas, ponen en duda que la unidad se entregara.
 * Son las que alimentan la tasa de incumplimiento del scorecard: «me cobraron
 * de más» es un problema real, pero la pizza salió.
 */
export const INCIDENCIAS_DE_INCUMPLIMIENTO: readonly SupplyIncidenciaTipo[] = [
  'BENEFICIO_NEGADO',
  'PRODUCTO_NO_DISPONIBLE',
  'SUCURSAL_NO_ACEPTO',
  'EMPRESA_CERRADA',
  'CANTIDAD_INCORRECTA',
  'DOBLE_REDENCION',
]

// ── Dinero con el proveedor ─────────────────────────────────────────────────

export const SUPPLY_PAGO_TIPO_LABELS: Record<SupplyPagoTipo, string> = {
  ANTICIPO: 'Anticipo',
  DEPOSITO: 'Depósito',
  LIQUIDACION_REDENCIONES: 'Liquidación por redenciones',
  LIQUIDACION_FINAL: 'Liquidación final',
  REEMBOLSO: 'Reembolso',
  AJUSTE: 'Ajuste',
  CREDITO: 'Crédito',
}

export const SUPPLY_ASIENTO_TIPO_LABELS: Record<SupplyAsientoTipo, string> = {
  COMPROMISO_COMPRA: 'Compromiso de compra',
  DEPOSITO: 'Depósito',
  REDENCION_POR_PAGAR: 'Redención por pagar',
  PAGO: 'Pago',
  REEMBOLSO: 'Reembolso',
  CREDITO: 'Crédito',
  AJUSTE: 'Ajuste',
  REVERSA: 'Reversa',
  CUENTA_POR_PAGAR: 'Cuenta por pagar',
  CUENTA_POR_COBRAR: 'Cuenta por cobrar',
}

/**
 * Asientos que NO mueven el saldo por pagar.
 *
 * `COMPROMISO_COMPRA` es un memorando: registra que se firmó un contrato por
 * RD$300.000 para poder contrastar contratado contra pagado, pero deber ese
 * dinero depende de la modalidad. En PAGO_POR_REDENCION no se debe nada hasta
 * que alguien se coma una pizza. Sumarlo al saldo haría que Membego apareciera
 * debiendo el contrato entero el día de la firma.
 */
export const ASIENTOS_MEMORANDO: readonly SupplyAsientoTipo[] = ['COMPROMISO_COMPRA']

// ── Umbrales de vencimiento (Fase 39) ───────────────────────────────────────

/**
 * Días de antelación con los que el motor de vencimientos avisa (§20 del
 * encargo: 90, 60, 30, 15, 7 y 1). Es el DEFAULT; `umbralesVencimiento()`
 * en `vencimientos.ts` lo lee de `SUPPLY_UMBRALES_VENCIMIENTO` si existe.
 */
export const UMBRALES_VENCIMIENTO = [90, 60, 30, 15, 7, 1] as const

/**
 * Convierte "90,60,30" en umbrales válidos. Puro para poder probarlo: una
 * variable mal escrita tiene que caer en el default, no en cero avisos.
 */
export function parsearUmbrales(texto: string | null | undefined): readonly number[] {
  if (!texto) return UMBRALES_VENCIMIENTO
  const n = [...new Set(texto.split(/[\s,;]+/).map(Number).filter((d) => Number.isInteger(d) && d > 0))]
  return n.length > 0 ? n.sort((a, b) => b - a) : UMBRALES_VENCIMIENTO
}

/** Etiqueta de riesgo por días restantes. Determinista, sin IA (Fase 54). */
export function nivelRiesgoVencimiento(diasRestantes: number): 'CRITICO' | 'ALTO' | 'MEDIO' | 'BAJO' {
  if (diasRestantes <= 3) return 'CRITICO'
  if (diasRestantes <= 7) return 'ALTO'
  if (diasRestantes <= 15) return 'MEDIO'
  return 'BAJO'
}

// ── Capa financiera (29-09-2026) ────────────────────────────────────────────

export const SUPPLY_FRECUENCIA_CORTE_LABELS: Record<SupplyFrecuenciaCorte, string> = {
  SEMANAL: 'Semanal',
  QUINCENAL: 'Quincenal',
  MENSUAL: 'Mensual',
}

export const SUPPLY_PROVEEDOR_ORIGEN_LABELS: Record<SupplyProveedorOrigen, string> = {
  REGISTRADA: 'Empresa registrada en Membego',
  EXTERNA: 'Proveedor externo (sin cuenta)',
}

export const SUPPLY_DEPOSITO_ESTADO_LABELS: Record<SupplyDepositoEstado, string> = {
  PENDIENTE: 'Pendiente de confirmar el pago',
  ABIERTO: 'Abierto',
  PARCIALMENTE_APLICADO: 'Parcialmente aplicado',
  AGOTADO: 'Agotado',
  CERRADO: 'Cerrado',
  CANCELADO: 'Cancelado',
}

export const SUPPLY_DEPOSITO_MOVIMIENTO_LABELS: Record<SupplyDepositoMovimientoTipo, string> = {
  APERTURA: 'Apertura',
  APLICACION: 'Aplicación a una obligación',
  REVERSA_APLICACION: 'Reversa de una aplicación',
  DEVOLUCION: 'Devolución del proveedor',
  AJUSTE: 'Ajuste',
}

/** Depósitos con saldo que todavía se puede aplicar. */
export const DEPOSITO_VIVO: readonly SupplyDepositoEstado[] = ['ABIERTO', 'PARCIALMENTE_APLICADO']

export const SUPPLY_FACTURA_TIPO_LABELS: Record<SupplyFacturaTipo, string> = {
  FACTURA: 'Factura',
  NOTA_CREDITO: 'Nota de crédito',
  NOTA_DEBITO: 'Nota de débito',
}

export const SUPPLY_FACTURA_ESTADO_LABELS: Record<SupplyFacturaEstado, string> = {
  REGISTRADA: 'Registrada',
  PARCIALMENTE_PAGADA: 'Parcialmente pagada',
  PAGADA: 'Pagada',
  DISPUTADA: 'Disputada',
  ANULADA: 'Anulada',
}

export const SUPPLY_CUENTA_ESTADO_LABELS: Record<SupplyCuentaEstado, string> = {
  ABIERTA: 'Abierta',
  PARCIALMENTE_SALDADA: 'Parcialmente saldada',
  SALDADA: 'Saldada',
  DISPUTADA: 'Disputada',
  CANCELADA: 'Cancelada',
}

/** Cuentas que todavía deben algo. */
export const CUENTA_VIVA: readonly SupplyCuentaEstado[] = ['ABIERTA', 'PARCIALMENTE_SALDADA']

export const SUPPLY_CXP_ORIGEN_LABELS: Record<SupplyCuentaPorPagarOrigen, string> = {
  FACTURA_PROVEEDOR: 'Factura del proveedor',
  VENTA_DIRECTA: 'Venta sin precompra entregada',
  AJUSTE: 'Ajuste',
  DIFERENCIA_CONCILIACION: 'Diferencia conciliada',
  MANUAL: 'Registro manual',
}

export const SUPPLY_CXC_ORIGEN_LABELS: Record<SupplyCuentaPorCobrarOrigen, string> = {
  REEMBOLSO: 'Reembolso pendiente',
  AJUSTE: 'Ajuste',
  PENALIZACION: 'Penalización',
  DIFERENCIA_CONCILIACION: 'Diferencia conciliada',
  SUBSIDIO: 'Subsidio a recuperar',
  CARGO: 'Cargo',
  NOTA_CREDITO: 'Nota de crédito del proveedor',
  OTRO: 'Otro',
}

export const SUPPLY_LIQUIDACION_ESTADO_LABELS: Record<SupplyLiquidacionEstado, string> = {
  BORRADOR: 'Borrador',
  CALCULADA: 'Calculada',
  EN_REVISION: 'En revisión',
  APROBADA: 'Aprobada',
  PAGADA: 'Pagada',
  CONCILIADA: 'Conciliada',
  DISPUTADA: 'Disputada',
  CANCELADA: 'Cancelada',
}

export const SUPPLY_LIQUIDACION_LINEA_LABELS: Record<SupplyLiquidacionLineaTipo, string> = {
  CUENTA_POR_PAGAR: 'Cuenta por pagar',
  CUENTA_POR_COBRAR: 'Cuenta por cobrar',
  REDENCION: 'Redención por pagar',
  DEPOSITO_APLICADO: 'Depósito aplicado',
  AJUSTE: 'Ajuste',
}

export const SUPPLY_CONCILIACION_ESTADO_LABELS: Record<SupplyConciliacionEstado, string> = {
  ABIERTA: 'Abierta',
  EN_REVISION: 'En revisión',
  CERRADA: 'Cerrada',
}

export const SUPPLY_DISCREPANCIA_TIPO_LABELS: Record<SupplyDiscrepanciaTipo, string> = {
  MISSING_REDEMPTION: 'Redención que el proveedor no registró',
  DUPLICATE: 'Redención duplicada (el proveedor cuenta de más)',
  VALUE_DIFFERENCE: 'Diferencia de valor',
  PRODUCT_DIFFERENCE: 'Diferencia de producto',
  DATE_DIFFERENCE: 'Diferencia de fecha',
  PAYMENT_DIFFERENCE: 'Diferencia de pago',
  INTERNA: 'Descuadre interno (contadores vs ledger)',
}

export const SUPPLY_DISCREPANCIA_ESTADO_LABELS: Record<SupplyDiscrepanciaEstado, string> = {
  ABIERTA: 'Abierta',
  EN_INVESTIGACION: 'En investigación',
  RESUELTA: 'Resuelta',
  AJUSTADA: 'Resuelta con ajuste',
  APROBADA: 'Aprobada',
  RECHAZADA: 'Rechazada',
}

export const SUPPLY_VENTA_ESTADO_LABELS: Record<SupplyVentaEstado, string> = {
  INICIADA: 'Esperando el pago',
  PAGADA: 'Pagada, pendiente de entrega',
  ENTREGADA: 'Entregada',
  CANCELADA: 'Cancelada',
  REEMBOLSADA: 'Reembolsada',
}
