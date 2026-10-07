import { conEmpresa, sinEmpresa, type Tx } from '@/lib/tenant'
import { armarCsv } from '@/lib/csv'
import { normalizarBusqueda } from '@/modules/busqueda/normalizar'

/**
 * Bitácora de actividad (AuditLog).
 *
 * TODA acción registrable de la app queda en `audit_logs` con `createdAt`
 * completo (fecha Y HORA, hasta el segundo, en UTC — se muestra en la zona
 * horaria de la empresa). Este módulo solo LEE: quien escribe es cada acción
 * en su propio flujo. Multi-tenant: `companyId` filtra siempre, salvo el
 * superadmin que puede ver todas las empresas.
 */

/**
 * A QUÉ se le hizo. Los nombres de modelo son de la base, no del negocio:
 * «Membership» no significa nada para quien lee la bitácora, y sin esto una
 * línea dice qué pasó pero no sobre qué. Lo que no esté aquí sale tal cual —
 * peor que traducido, mejor que oculto.
 */
export const ENTIDAD_LABEL: Record<string, string> = {
  CajaSesion: 'Caja',
  CampanaGlobal: 'Campaña conjunta',
  Cliente: 'Cliente',
  ColaVehiculo: 'Cola',
  Company: 'Empresa',
  EvidenciaFoto: 'Foto',
  Membership: 'Membresía',
  Plan: 'Plan',
  MovimientoCaja: 'Movimiento de caja',
  ProductoCompra: 'Compra',
  ProductoInventario: 'Inventario',
  QrToken: 'QR',
  ReceiptTemplate: 'Plantilla de recibo',
  Referido: 'Referido',
  ReferralRecompensa: 'Recompensa',
  Sucursal: 'Sucursal',
  Transaction: 'Transacción',
  User: 'Usuario',
  Visit: 'Visita',
}

/**
 * Etiquetas legibles de cada acción registrada.
 *
 * TIENE QUE ESTAR COMPLETO, y `tests/bitacora-etiquetas.test.ts` lo obliga:
 * compara este mapa contra el enum `AuditAccion` del esquema y falla si sobra o
 * falta uno. Sin esa guardia el mapa se quedaba atrás en silencio — trece de
 * los treinta y tres valores no estaban, y entre ellos los TRES que registran
 * privilegio: `ENTRAR_COMO_GENERADO`, `SUPERADMIN_OTORGADO` y
 * `SUPERADMIN_RETIRADO`. Salían en crudo, en mayúsculas con guiones bajos,
 * justo las líneas que alguien busca cuando investiga algo.
 *
 * Y no es solo cosmético: la pantalla de Auditoría construye su desplegable de
 * filtros con `Object.entries(ACCION_LABEL)`. Una acción sin etiqueta no se
 * podía FILTRAR.
 */
export const ACCION_LABEL: Record<string, string> = {
  VISITA_CONFIRMADA: 'Visita confirmada',
  VISITA_REVERTIDA: 'Visita revertida',
  PAGO_APROBADO: 'Pago aprobado',
  PAGO_RECHAZADO: 'Pago rechazado',
  MEMBRESIA_CANCELADA: 'Membresía cancelada',
  MEMBRESIA_DESACTIVADA: 'Membresía desactivada',
  MEMBRESIA_RENOVADA: 'Membresía renovada',
  MEMBRESIA_ELIMINADA: 'Membresía eliminada',
  QR_GENERADO: 'QR generado',
  QR_USADO: 'QR usado',
  QR_COMPARTIDO: 'QR compartido',
  CAJA_ABIERTA: 'Caja abierta',
  CAJA_CERRADA: 'Caja cerrada',
  CAJA_MOVIMIENTO: 'Movimiento de caja',
  COBRO_REGISTRADO: 'Cobro registrado',
  COMPROBANTE_IMPRESO: 'Comprobante impreso',
  TRANSACCION_ANULADA: 'Transacción anulada',
  REFERIDO_COMPLETADO: 'Referido completado',
  RECOMPENSA_OTORGADA: 'Recompensa otorgada',
  NOTA_INTERNA: 'Nota interna',
  PLANTILLA_RECIBO_ACTUALIZADA: 'Plantilla de recibo actualizada',
  CUENTA_ELIMINADA: 'Cuenta eliminada',
  // Empresas de práctica.
  EMPRESA_DEMO_CAMBIADA: 'Empresa de práctica: cambió su condición',
  EMPRESA_DEMO_REINICIADA: 'Empresa de práctica reiniciada',
  // Privilegio y suplantación. Los nombres dicen QUÉ PASÓ, no qué se guardó:
  // «Entró como otro usuario» es lo que busca quien investiga; «enlace
  // generado» es un paso intermedio y por eso lleva su propia etiqueta.
  SUPERADMIN_OTORGADO: 'Superadmin otorgado',
  SUPERADMIN_RETIRADO: 'Superadmin retirado',
  ENTRAR_COMO_GENERADO: 'Enlace para entrar como otro usuario',
  ENTRAR_COMO_USADO: 'Entró como otro usuario',
  // Qué módulos tiene encendidos cada empresa: decide a qué secciones entra.
  CAPACIDADES_ACTUALIZADAS: 'Módulos de la empresa actualizados',
  // Catálogo de planes: lo que los clientes compran.
  PLAN_CREADO: 'Plan creado',
  PROMOCION_CREADA: 'Promoción creada',
  PLAN_ACTUALIZADO: 'Plan actualizado',
  PLAN_PAUSADO: 'Plan pausado',
  PLAN_REANUDADO: 'Plan reanudado',
  PLAN_ELIMINADO: 'Plan eliminado',
  // Geolocalización (docs/GEOLOCALIZACION.md).
  UBICACION_GUARDADA: 'Ubicación guardada',
  UBICACION_ELIMINADA: 'Ubicación eliminada',
  CONSENTIMIENTO_GEO_OTORGADO: 'Permiso de ubicación otorgado',
  CONSENTIMIENTO_GEO_REVOCADO: 'Permiso de ubicación revocado',
  SUCURSAL_UBICACION_GUARDADA: 'Ubicación de sucursal guardada',
  SUCURSAL_UBICACION_VERIFICADA: 'Ubicación de sucursal verificada',
  CATALOGO_GEO_APROBADO: 'Sector o ciudad aprobado',
  // Membego Connect (Fase 9): concesiones y catálogo.
  CONNECT_CONCEDIDO: 'Límite de integraciones concedido',
  CONNECT_CONECTOR_ESTADO: 'Estado de un conector cambiado',
  // Cola de trabajos (Connect · Fase 2): decisiones sobre difuntos.
  COLA_REENCOLADA: 'Trabajo de la cola reencolado',
  COLA_DESCARTADA: 'Trabajo de la cola descartado',
  // Campañas por segmento.
  SEGMENTO_EVALUADO: 'Segmento evaluado',
  CAMPANA_DIRIGIDA_ENVIADA: 'Campaña dirigida enviada',
  // Membego Supply (docs/membego-supply-architecture.md). Todas mueven dinero,
  // supply o el derecho de una persona a recibir algo.
  SUPPLY_ACUERDO_CREADO: 'Supply · acuerdo creado',
  SUPPLY_ACUERDO_ESTADO: 'Supply · acuerdo cambió de estado',
  SUPPLY_ENMIENDA_REGISTRADA: 'Supply · enmienda de contrato',
  SUPPLY_ORDEN_CREADA: 'Supply · orden de compra creada',
  SUPPLY_ORDEN_ESTADO: 'Supply · orden cambió de estado',
  SUPPLY_LOTE_ACTIVADO: 'Supply · lote activado',
  SUPPLY_ASIGNACION_CREADA: 'Supply · unidades asignadas',
  SUPPLY_ASIGNACION_LIBERADA: 'Supply · unidades liberadas',
  SUPPLY_DERECHO_EMITIDO: 'Supply · beneficio emitido',
  SUPPLY_DERECHO_CANCELADO: 'Supply · beneficio cancelado',
  SUPPLY_VOUCHER_EMITIDO: 'Supply · voucher emitido',
  SUPPLY_REDENCION_REGISTRADA: 'Supply · entrega registrada',
  SUPPLY_REDENCION_REVERSADA: 'Supply · entrega reversada',
  SUPPLY_INCIDENCIA_ABIERTA: 'Supply · incidencia abierta',
  SUPPLY_INCIDENCIA_RESUELTA: 'Supply · incidencia resuelta',
  SUPPLY_PAGO_REGISTRADO: 'Supply · pago a proveedor registrado',
  SUPPLY_PAGO_CONFIRMADO: 'Supply · pago a proveedor confirmado',
  SUPPLY_PEDIDO_ABIERTO: 'Supply · pedido de cliente abierto',
  SUPPLY_PEDIDO_COBRADO: 'Supply · pago de cliente confirmado',
  SUPPLY_PEDIDO_RECHAZADO: 'Supply · pago de cliente rechazado',
  SUPPLY_CUENTA_COBRO_ALTA: 'Supply · cuenta de cobro dada de alta',
  SUPPLY_CUENTA_COBRO_ESTADO: 'Supply · cuenta de cobro activada o desactivada',
  SUPPLY_AJUSTE_LEDGER: 'Supply · ajuste del ledger',
  SUPPLY_LOTE_RECALCULADO: 'Supply · lote recalculado',
  // Capa financiera de supply (29-09-2026).
  SUPPLY_PROVEEDOR_REGISTRADO: 'Supply · proveedor registrado',
  SUPPLY_PROVEEDOR_ACTUALIZADO: 'Supply · ficha de proveedor actualizada',
  SUPPLY_ACUERDO_VERSION: 'Supply · nueva versión de acuerdo',
  SUPPLY_DEPOSITO_REGISTRADO: 'Supply · depósito a proveedor registrado',
  SUPPLY_DEPOSITO_APLICADO: 'Supply · depósito aplicado a una obligación',
  SUPPLY_DEPOSITO_DEVUELTO: 'Supply · saldo de depósito devuelto',
  SUPPLY_DEPOSITO_CERRADO: 'Supply · depósito cerrado',
  SUPPLY_FACTURA_REGISTRADA: 'Supply · factura de proveedor registrada',
  SUPPLY_FACTURA_ESTADO: 'Supply · factura de proveedor cambió de estado',
  SUPPLY_CXP_CREADA: 'Supply · cuenta por pagar creada',
  SUPPLY_CXP_ESTADO: 'Supply · cuenta por pagar cambió de estado',
  SUPPLY_CXC_CREADA: 'Supply · cuenta por cobrar creada',
  SUPPLY_CXC_ESTADO: 'Supply · cuenta por cobrar cambió de estado',
  SUPPLY_LIQUIDACION_CALCULADA: 'Supply · liquidación calculada',
  SUPPLY_LIQUIDACION_ESTADO: 'Supply · liquidación cambió de estado',
  SUPPLY_CONCILIACION_ABIERTA: 'Supply · conciliación con proveedor abierta',
  SUPPLY_CONCILIACION_ESTADO: 'Supply · conciliación cambió de estado',
  SUPPLY_DISCREPANCIA_ESTADO: 'Supply · discrepancia de conciliación actualizada',
  SUPPLY_VENTA_ABIERTA: 'Supply · venta sin precompra abierta',
  SUPPLY_VENTA_ENTREGADA: 'Supply · venta sin precompra entregada',
  SUPPLY_VENTA_CANCELADA: 'Supply · venta sin precompra cancelada',
  SUPPLY_PAGO_ANULADO: 'Supply · pago a proveedor anulado',
  SUPPLY_FEFO_OVERRIDE: 'Supply · entrega saltándose FEFO',
  SUPPLY_PROVEEDOR_HABILITADO: 'Supply · empresa habilitada como proveedora',
  SUPPLY_OFERTA_CREADA: 'Supply · oferta creada',
  SUPPLY_LOTE_TRANSFERENCIA: 'Supply · unidades transferidas entre lotes',
  SUPPLY_LOTE_AJUSTE: 'Supply · ajuste de lote',
  SUPPLY_LOTE_CANCELACION: 'Supply · unidades canceladas',
  SUPPLY_LOTE_VENCIMIENTO_EXTENDIDO: 'Supply · vencimiento de lote extendido',
  SUPPLY_PEDIDO_REEMBOLSADO: 'Supply · cobro reembolsado',
  // Membego Supply · Slice 1 (procurement).
  SUPPLY_V2_SUPPLIER_CREATED: 'Supply · proveedor creado',
  SUPPLY_V2_CATALOG_ITEM_CREATED: 'Supply · producto del proveedor creado',
  SUPPLY_V2_AGREEMENT_CREATED: 'Supply · acuerdo creado',
  SUPPLY_V2_AGREEMENT_ACTIVATED: 'Supply · acuerdo activado',
  SUPPLY_V2_PO_CREATED: 'Supply · orden de compra creada',
  SUPPLY_V2_PO_SUBMITTED: 'Supply · orden enviada a aprobación',
  SUPPLY_V2_PO_APPROVED: 'Supply · orden aprobada',
  SUPPLY_V2_PO_REJECTED: 'Supply · orden rechazada',
  SUPPLY_V2_PO_CANCELLED: 'Supply · orden cancelada',
  SUPPLY_V2_RECEIPT_CONFIRMED: 'Supply · recepción confirmada',
  SUPPLY_V2_LOT_CREATED: 'Supply · lote creado',
  // Membego Supply · Slice 2 (oferta, checkout, pago, derecho).
  SUPPLY_V2_ALLOCATION_CREATED: 'Supply · supply apartado para una oferta',
  SUPPLY_V2_ALLOCATION_RELEASED: 'Supply · supply apartado liberado',
  SUPPLY_V2_OFFER_CREATED: 'Supply · oferta creada',
  SUPPLY_V2_OFFER_PUBLISHED: 'Supply · oferta publicada',
  SUPPLY_V2_OFFER_PAUSED: 'Supply · oferta pausada',
  SUPPLY_V2_OFFER_RESUMED: 'Supply · oferta reactivada',
  SUPPLY_V2_OFFER_ENDED: 'Supply · oferta finalizada',
  SUPPLY_V2_OFFER_CANCELLED: 'Supply · oferta cancelada',
  SUPPLY_V2_OFFER_UPDATED: 'Supply · oferta editada',
  SUPPLY_V2_VEHICLE_CATEGORY_CHANGED: 'Supply · categoría de vehículo modificada',
  CATALOG_ITEM_CREATED: 'Catálogo · producto creado',
  CATALOG_ITEM_UPDATED: 'Catálogo · producto editado',
  CATALOG_ITEM_STATUS_CHANGED: 'Catálogo · estado del producto cambiado',
  CATALOG_VARIANT_CHANGED: 'Catálogo · variante modificada (precio, estado o alta/baja)',
  INVENTORY_STOCK_CHANGED: 'Inventario · existencias movidas (entrada, ajuste, daño o devolución)',
  INVENTORY_TRANSFERRED: 'Inventario · transferencia entre sucursales',
  INVENTORY_CONFIGURED: 'Inventario · umbral de stock bajo modificado',
  SUPPLY_BRIDGE_HOUSE_CHANGED: 'Puente Supply → Catálogo · empresa de la casa designada o retirada',
  ORDER_CREATED: 'Pedidos Membego · pedido creado',
  ORDER_ACCEPTED: 'Pedidos Membego · pedido aceptado por la empresa',
  ORDER_ADJUSTED: 'Pedidos Membego · monto del pedido ajustado',
  ORDER_READY: 'Pedidos Membego · pedido listo (QR emitido)',
  ORDER_CONFIRMED: 'Pedidos Membego · el cliente confirmó el monto',
  ORDER_COMPLETED: 'Pedidos Membego · pedido completado (QR escaneado)',
  ORDER_CANCELLED: 'Pedidos Membego · pedido cancelado',
  ORDER_REFUNDED: 'Pedidos Membego · pedido reembolsado',
  ORDER_PAYMENT_RECORDED: 'Pedidos Membego · pago registrado',
  BILLING_CONFIG_CHANGED: 'Cuenta Membego · configuración de cobro cambiada',
  BILLING_ENTRY_RECORDED: 'Cuenta Membego · pago, ajuste o crédito asentado',
  BILLING_STATUS_CHANGED: 'Cuenta Membego · estado de la cuenta cambiado',
  DEAL_CREATED: 'Oferta con presupuesto creada',
  DEAL_UPDATED: 'Oferta con presupuesto editada',
  DEAL_STATUS_CHANGED: 'Oferta con presupuesto · estado cambiado',
  DEAL_CLAIMED: 'Oferta reclamada por un cliente',
  DEAL_REDEEMED: 'Oferta canjeada (cuota cobrada)',
  DEAL_CLAIM_CLOSED: 'Cupón de oferta cerrado sin canje (venció, se canceló o se reembolsó)',
  SUPPLY_V2_ORDER_CREATED: 'Supply · compra de cliente creada',
  SUPPLY_V2_ORDER_RESERVED: 'Supply · unidades reservadas para una compra',
  SUPPLY_V2_ORDER_PAYMENT_SUBMITTED: 'Supply · cliente avisó su pago',
  SUPPLY_V2_ORDER_CANCELLED: 'Supply · compra cancelada',
  SUPPLY_V2_ORDER_EXPIRED: 'Supply · reserva de compra expirada',
  SUPPLY_V2_ORDER_PAID: 'Supply · pago de cliente confirmado',
  SUPPLY_V2_ORDER_PAYMENT_REJECTED: 'Supply · pago de cliente rechazado',
  SUPPLY_V2_ENTITLEMENT_ISSUED: 'Supply · derecho emitido',
  SUPPLY_V2_VOUCHER_CREATED: 'Supply: voucher emitido',
  SUPPLY_V2_VOUCHER_REISSUED: 'Supply: voucher reemitido',
  SUPPLY_V2_VOUCHER_EXPIRED: 'Supply: voucher vencido',
  SUPPLY_V2_QR_SESSION_CREATED: 'Supply: QR generado',
  SUPPLY_V2_QR_SESSION_EXPIRED: 'Supply: QR expirado',
  SUPPLY_V2_QR_SESSION_CONSUMED: 'Supply: QR consumido',
  SUPPLY_V2_REDEMPTION_PREVIEWED: 'Supply: beneficio escaneado',
  SUPPLY_V2_REDEMPTION_CONFIRMED: 'Supply: entrega confirmada',
  SUPPLY_V2_REDEMPTION_REJECTED: 'Supply: escaneo rechazado',
  SUPPLY_V2_REDEMPTION_REVERSED: 'Supply: redención reversada',
  SUPPLY_V2_REDEMPTION_INCIDENT: 'Supply: incidencia en entrega',
  SUPPLY_V2_ENTITLEMENT_EXPIRED: 'Supply: derecho vencido',
  // Membego Supply · Slice 4 (finanzas del proveedor y economía del supply).
  SUPPLY_V2_INVOICE_CREATED: 'Supply · factura de proveedor registrada',
  SUPPLY_V2_INVOICE_APPROVED: 'Supply · factura de proveedor aprobada',
  SUPPLY_V2_INVOICE_CANCELLED: 'Supply · factura de proveedor cancelada',
  SUPPLY_V2_DEPOSIT_CREATED: 'Supply · depósito a proveedor creado',
  SUPPLY_V2_DEPOSIT_APPLIED: 'Supply · depósito aplicado a una deuda',
  SUPPLY_V2_DEPOSIT_REVERSED: 'Supply · aplicación de depósito reversada',
  SUPPLY_V2_PAYMENT_CREATED: 'Supply · pago a proveedor registrado',
  SUPPLY_V2_PAYMENT_CONFIRMED: 'Supply · pago a proveedor confirmado',
  SUPPLY_V2_PAYMENT_APPLIED: 'Supply · pago aplicado a una deuda',
  SUPPLY_V2_PAYMENT_REVERSED: 'Supply · aplicación de pago reversada',
  SUPPLY_V2_PAYMENT_CANCELLED: 'Supply · pago a proveedor cancelado',
  SUPPLY_V2_OBLIGATION_RECOGNIZED: 'Supply · obligación con proveedor reconocida',
  SUPPLY_V2_OBLIGATION_PAID: 'Supply · obligación con proveedor pagada',
  SUPPLY_V2_OBLIGATION_CANCELLED: 'Supply · obligación con proveedor cancelada',
  SUPPLY_V2_ECONOMIC_EVENT_CREATED: 'Supply · evento económico registrado',
  SUPPLY_V2_RECONCILIATION_CREATED: 'Supply · conciliación con proveedor abierta',
  SUPPLY_V2_RECONCILIATION_RESOLVED: 'Supply · conciliación con proveedor resuelta',
  SUPPLY_V2_LOT_EXPIRED: 'Supply · lote vencido cerrado',
  // Slice 5 · comisión + liquidaciones
  SUPPLY_V2_COMMISSION_OFFER_CREATED: 'Supply · oferta a comisión creada',
  SUPPLY_V2_COMMISSION_ORDER_PAID: 'Supply · venta a comisión pagada',
  SUPPLY_V2_COMMISSION_OBLIGATION_CREATED: 'Supply · neto de proveedor reconocido (comisión)',
  SUPPLY_V2_SETTLEMENT_CREATED: 'Supply · liquidación generada',
  SUPPLY_V2_SETTLEMENT_APPROVED: 'Supply · liquidación aprobada',
  SUPPLY_V2_SETTLEMENT_PAYMENT_APPLIED: 'Supply · pago aplicado a liquidación',
  SUPPLY_V2_SETTLEMENT_PAID: 'Supply · liquidación pagada',
  SUPPLY_V2_SETTLEMENT_CANCELLED: 'Supply · liquidación cancelada',
  SUPPLY_V2_COMMISSION_RECONCILIATION_CREATED: 'Supply · conciliación de comisión abierta',
  SUPPLY_V2_COMMISSION_RECONCILIATION_RESOLVED: 'Supply · conciliación de comisión resuelta',
  SUPPLY_V2_FINANCE_INCIDENT_CREATED: 'Supply · incidencia financiera abierta',
  SUPPLY_V2_FINANCE_INCIDENT_RESOLVED: 'Supply · incidencia financiera resuelta',
  // Slice 6 · beneficios económicos
  SUPPLY_V2_BENEFIT_CREATED: 'Supply · beneficio creado',
  SUPPLY_V2_BENEFIT_APPROVED: 'Supply · beneficio aprobado',
  SUPPLY_V2_BENEFIT_PAUSED: 'Supply · beneficio pausado',
  SUPPLY_V2_BENEFIT_RESUMED: 'Supply · beneficio reactivado',
  SUPPLY_V2_BENEFIT_CANCELLED: 'Supply · beneficio cancelado',
  SUPPLY_V2_BENEFIT_GRANTED: 'Supply · beneficio asignado a un cliente',
  SUPPLY_V2_BENEFIT_GRANT_CANCELLED: 'Supply · asignación de beneficio cancelada',
  SUPPLY_V2_BENEFIT_RESERVED: 'Supply · beneficio reservado en un checkout',
  SUPPLY_V2_BENEFIT_APPLIED: 'Supply · beneficio aplicado a una compra',
  SUPPLY_V2_BENEFIT_RELEASED: 'Supply · reserva de beneficio liberada',
  SUPPLY_V2_BENEFIT_REVERSED: 'Supply · aplicación de beneficio reversada',
  SUPPLY_V2_ORDER_COVERED_BY_BENEFIT: 'Supply · compra cubierta por completo con un beneficio',
  // Slice 7 · campañas, promociones y cupones
  SUPPLY_V2_CAMPAIGN_CREATED: 'Supply · campaña creada',
  SUPPLY_V2_CAMPAIGN_SUBMITTED: 'Supply · campaña enviada a revisión',
  SUPPLY_V2_CAMPAIGN_APPROVED: 'Supply · campaña aprobada',
  SUPPLY_V2_CAMPAIGN_REJECTED: 'Supply · campaña devuelta a borrador',
  SUPPLY_V2_CAMPAIGN_PUBLISHED: 'Supply · campaña publicada',
  SUPPLY_V2_CAMPAIGN_PAUSED: 'Supply · campaña pausada',
  SUPPLY_V2_CAMPAIGN_RESUMED: 'Supply · campaña reactivada',
  SUPPLY_V2_CAMPAIGN_CANCELLED: 'Supply · campaña cancelada',
  SUPPLY_V2_CAMPAIGN_COMPLETED: 'Supply · campaña terminada',
  SUPPLY_V2_CAMPAIGN_BUDGET_WAIVED: 'Supply · campaña autorizada sin presupuesto máximo',
  SUPPLY_V2_COUPONS_GENERATED: 'Supply · cupones generados',
  SUPPLY_V2_COUPON_CANCELLED: 'Supply · cupón cancelado',
  SUPPLY_V2_COUPON_APPLIED: 'Supply · cupón aplicado en una compra',
  SUPPLY_V2_COUPON_RELEASED: 'Supply · cupón liberado',
  SUPPLY_V2_EXTERNAL_EVENT_RECEIVED: 'Supply · evento externo recibido',
  SUPPLY_V2_EXTERNAL_EVENT_PROCESSED: 'Supply · evento externo procesado',
  SUPPLY_V2_EXTERNAL_EVENT_IGNORED: 'Supply · evento externo ignorado',
  SUPPLY_V2_EXTERNAL_EVENT_FAILED: 'Supply · evento externo fallido',
  SUPPLY_V2_EXTERNAL_EVENT_DEAD_LETTER: 'Supply · evento externo sin salida',
  SUPPLY_V2_EXTERNAL_EVENT_RETRIED: 'Supply · evento externo reintentado a mano',
  SUPPLY_V2_OUTBOX_DEAD_LETTER: 'Supply · efecto pendiente sin salida',
  SUPPLY_V2_OUTBOX_RETRIED: 'Supply · efecto pendiente reintentado a mano',
  SUPPLY_V2_PAYMENT_RECONCILIATION_CREATED: 'Supply · pago externo conciliado',
  SUPPLY_V2_FINANCE_INCIDENT_INVESTIGATING: 'Supply · incidencia en investigación',
  SUPPLY_V2_OPERATIONS_SWITCH_CHANGED: 'Supply · interruptor operativo cambiado',
  SUPPLY_V2_OPERATIONS_RECONCILE_RUN: 'Supply · conciliación lanzada a mano',
  SUPPLY_V2_OPERATIONS_ALERT_ACKNOWLEDGED: 'Supply · alerta reconocida',
  // Slice 8 · fidelización
  SUPPLY_V2_LOYALTY_PROGRAM_CREATED: 'Supply · programa de fidelización creado',
  SUPPLY_V2_LOYALTY_PROGRAM_SUBMITTED: 'Supply · programa de fidelización enviado a revisión',
  SUPPLY_V2_LOYALTY_PROGRAM_APPROVED: 'Supply · programa de fidelización aprobado',
  SUPPLY_V2_LOYALTY_PROGRAM_REJECTED: 'Supply · programa de fidelización devuelto a borrador',
  SUPPLY_V2_LOYALTY_PROGRAM_PAUSED: 'Supply · programa de fidelización pausado',
  SUPPLY_V2_LOYALTY_PROGRAM_RESUMED: 'Supply · programa de fidelización reanudado',
  SUPPLY_V2_LOYALTY_PROGRAM_CANCELLED: 'Supply · programa de fidelización cancelado',
  SUPPLY_V2_LOYALTY_PROGRAM_COMPLETED: 'Supply · programa de fidelización cerrado',
  SUPPLY_V2_LOYALTY_BUDGET_WAIVED: 'Supply · programa de fidelización SIN techo autorizado',
  SUPPLY_V2_MEMBERSHIP_PLAN_CREATED: 'Supply · plan de membresía creado',
  SUPPLY_V2_MEMBERSHIP_PLAN_UPDATED: 'Supply · plan de membresía modificado',
  SUPPLY_V2_MEMBERSHIP_PLAN_PUBLISHED: 'Supply · plan de membresía publicado',
  SUPPLY_V2_MEMBERSHIP_PLAN_PAUSED: 'Supply · plan de membresía pausado',
  SUPPLY_V2_MEMBERSHIP_PLAN_ARCHIVED: 'Supply · plan de membresía archivado',
  SUPPLY_V2_MEMBERSHIP_STARTED: 'Supply · membresía iniciada',
  SUPPLY_V2_MEMBERSHIP_ACTIVATED: 'Supply · membresía activada',
  SUPPLY_V2_MEMBERSHIP_RENEWED: 'Supply · membresía renovada',
  SUPPLY_V2_MEMBERSHIP_GRANTED: 'Supply · membresía otorgada',
  SUPPLY_V2_MEMBERSHIP_CANCELLED: 'Supply · membresía cancelada',
  SUPPLY_V2_MEMBERSHIP_SUSPENDED: 'Supply · membresía suspendida',
  SUPPLY_V2_MEMBERSHIP_EXPIRED: 'Supply · membresía vencida',
  SUPPLY_V2_REFERRAL_CODE_CREATED: 'Supply · código de invitación creado',
  SUPPLY_V2_REFERRAL_SIGNED_UP: 'Supply · registro por invitación',
  SUPPLY_V2_REFERRAL_ELIGIBLE: 'Supply · invitación con compra elegible',
  SUPPLY_V2_REFERRAL_REWARD_APPROVED: 'Supply · recompensa de invitación aprobada',
  SUPPLY_V2_REFERRAL_REWARD_GRANTED: 'Supply · recompensa de invitación concedida',
  SUPPLY_V2_REFERRAL_REWARD_VOIDED: 'Supply · recompensa de invitación anulada',
  SUPPLY_V2_POINTS_EARNED: 'Supply · puntos ganados',
  SUPPLY_V2_POINTS_AVAILABLE: 'Supply · puntos liberados a disponibles',
  SUPPLY_V2_POINTS_EXPIRED: 'Supply · puntos vencidos',
  SUPPLY_V2_POINTS_ADJUSTED: 'Supply · puntos ajustados a mano',
  SUPPLY_V2_REWARD_CREATED: 'Supply · recompensa creada',
  SUPPLY_V2_REWARD_APPROVED: 'Supply · recompensa aprobada',
  SUPPLY_V2_REWARD_CLAIMED: 'Supply · recompensa reclamada',
  SUPPLY_V2_REWARD_DELIVERED: 'Supply · recompensa entregada',
  SUPPLY_V2_REWARD_REVERSED: 'Supply · recompensa reversada',
  // Campañas conjuntas: reparto y retirada en varias empresas a la vez.
  CAMPANA_APLICADA: 'Campaña conjunta aplicada',
  CAMPANA_ARCHIVADA: 'Campaña conjunta archivada',
  COMPOSICION_GUARDADA: 'Inicio guardado (borrador)',
  COMPOSICION_PUBLICADA: 'Inicio publicado',
  COMPOSICION_PAUSADA: 'Inicio pausado',
  COMPOSICION_ARCHIVADA: 'Inicio archivado',
  // CRM: prospectos y las respuestas automáticas que contestan por la empresa.
  PROSPECTO_CREADO: 'Prospecto creado',
  PROSPECTO_ACTUALIZADO: 'Prospecto editado',
  PROSPECTO_DESCARTADO: 'Prospecto descartado',
  PROSPECTO_ETAPA_CAMBIADA: 'Prospecto movido de etapa',
  PROSPECTO_ASIGNADO: 'Prospecto asignado a otra persona',
  AUTO_RESPUESTA_CREADA: 'Respuesta automática creada',
  AUTO_RESPUESTA_ACTUALIZADA: 'Respuesta automática editada',
  AUTO_RESPUESTA_ELIMINADA: 'Respuesta automática eliminada',
  // Integraciones: lo que sale hacia sistemas de terceros.
  INTEGRACION_SONDEADA: 'Webhook probado',
  INTEGRACION_REINTENTADA: 'Cola de eventos reenviada',
  INTEGRACION_REENCOLADA: 'Eventos agotados devueltos a la cola',
}

/**
 * Sub-tipos guardados en `payload.tipo` para las acciones que reutilizan
 * NOTA_INTERNA (u otra acción) como contenedor genérico. Permite leer la
 * bitácora sin adivinar qué pasó.
 *
 * TIENE QUE ESTAR COMPLETO, igual que `ACCION_LABEL`, y
 * `tests/bitacora-etiquetas.test.ts` lo obliga: recorre los `tipo: '...'` que el
 * código escribe en payloads de auditoría y falla si alguno no tiene etiqueta.
 * Sin esa guardia, «extender la vigencia de una membresía» salía en la bitácora
 * como `AJUSTE_VENCIMIENTO` en crudo — y como la acción de arriba dice solo
 * «Nota interna», la operación era ilegible e infiltrable justo para quien
 * pregunta «¿cuándo le extendieron el lavado a este cliente?».
 */
export const SUBTIPO_LABEL: Record<string, string> = {
  CAPACIDADES_ACTUALIZADAS: 'Capacidades del negocio actualizadas',
  COLA_REGISTRO: 'Vehículo agregado a la cola',
  COLA_TRANSICION: 'Vehículo avanzó de estado',
  INVENTARIO_MOVIMIENTO: 'Movimiento de inventario',
  EVIDENCIA_SUBIDA: 'Foto de evidencia subida',
  AJUSTE_LAVADOS: 'Lavados de membresía ajustados',
  AJUSTE_VENCIMIENTO: 'Vigencia de membresía extendida o ajustada',
  CAMBIO_PLAN_RECHAZADO: 'Cambio de plan rechazado',
  RECORDATORIO_SEGUIMIENTO: 'Recordatorio de recompensa enviado',
  PERMISOS_ACTUALIZADOS: 'Permisos de un empleado actualizados',
  UMBRALES_RETENCION: 'Umbrales de retención actualizados',
  VENCIMIENTO_AUTOMATICO: 'Membresía vencida automáticamente',
  RESERVA_CREADA_POR_VENDEDOR: 'Reserva creada por un vendedor',
  EMPRESA_CREADA_DESDE_SOLICITUD: 'Empresa creada desde una solicitud',
  DEMO_EXCURSIONES_SEMBRADA: 'Datos de práctica de excursiones sembrados',
}

/**
 * Prefijo de los valores de filtro que apuntan a un SUB-TIPO y no a una acción.
 *
 * El desplegable de la bitácora mezcla las dos cosas a propósito: para quien
 * filtra, «Vigencia de membresía extendida» es una acción como cualquier otra —
 * que por dentro viva como `NOTA_INTERNA` + `payload.tipo` es un detalle de
 * almacenamiento que no tiene por qué aprenderse.
 */
export const PREFIJO_SUBTIPO = 'sub:'

/** Las opciones del filtro de acción: acciones de primer nivel + sub-tipos. */
export function opcionesDeAccion(): { valor: string; label: string }[] {
  const acciones = Object.entries(ACCION_LABEL).map(([valor, label]) => ({ valor, label }))
  const subtipos = Object.entries(SUBTIPO_LABEL).map(([tipo, label]) => ({
    valor: `${PREFIJO_SUBTIPO}${tipo}`,
    label,
  }))
  // Un solo orden alfabético: quien busca «Vigencia…» no sabe (ni debe saber)
  // si eso es una acción o un sub-tipo.
  return [...acciones, ...subtipos].sort((a, b) => a.label.localeCompare(b.label, 'es'))
}

export interface AuditoriaFiltro {
  accion?: string
  empresa?: string
  q?: string
  desde?: string
  hasta?: string
}

export interface AuditoriaItem {
  id: string
  /** Momento EXACTO de la acción (fecha y hora, hasta el segundo). */
  fecha: Date
  accion: string
  accionLabel: string
  /** Sub-tipo legible cuando el payload lo trae (NOTA_INTERNA genérica). */
  detalle: string | null
  entidadTipo: string
  entidadId: string
  usuario: string | null
  usuarioEmail: string | null
  empresa: string | null
  ip: string | null
  payload: Record<string, unknown>
}

/** Convierte 'YYYY-MM-DD' a Date; `fin` toma el final del día. */
function limiteDia(fecha: string, fin: boolean): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null
  return new Date(`${fecha}T${fin ? '23:59:59.999' : '00:00:00.000'}Z`)
}

/** Resumen corto de lo que pasó, leído del payload de cada acción. */
function describir(payload: Record<string, unknown>): string | null {
  const tipo = typeof payload.tipo === 'string' ? payload.tipo : null
  const base = tipo ? (SUBTIPO_LABEL[tipo] ?? tipo) : null

  const partes: string[] = []
  if (base) partes.push(base)
  if (typeof payload.motivo === 'string' && payload.motivo) {
    partes.push(payload.motivo)
  }
  if (payload.antes != null && payload.despues != null) {
    partes.push(`${String(payload.antes)} → ${String(payload.despues)}`)
  }
  if (typeof payload.de === 'string' && typeof payload.a === 'string') {
    partes.push(`${payload.de} → ${payload.a}`)
  }
  if (typeof payload.placa === 'string' && payload.placa) {
    partes.push(`placa ${payload.placa}`)
  }
  if (typeof payload.cliente === 'string' && payload.cliente) {
    partes.push(payload.cliente)
  }
  if (typeof payload.nota === 'string' && payload.nota) {
    partes.push(payload.nota)
  }
  return partes.length > 0 ? partes.join(' · ') : null
}

/**
 * Lee la bitácora. `companyId` null = vista global (solo superadmin).
 * Devuelve como máximo `take` entradas, de la más reciente a la más antigua.
 */
export async function getAuditoria(
  companyId: string | null,
  filtro: AuditoriaFiltro = {},
  take = 200
): Promise<AuditoriaItem[]> {
  const desde = filtro.desde ? limiteDia(filtro.desde, false) : null
  const hasta = filtro.hasta ? limiteDia(filtro.hasta, true) : null
  const q = filtro.q?.trim()

  // `sub:X` filtra por el sub-tipo del payload, venga bajo la acción que venga
  // (los ajustes viven bajo NOTA_INTERNA hoy; si mañana ganan acción propia, el
  // filtro por payload sigue encontrando el historial viejo).
  const esSubtipo = filtro.accion?.startsWith(PREFIJO_SUBTIPO) ?? false
  const subtipo = esSubtipo ? filtro.accion!.slice(PREFIJO_SUBTIPO.length) : null

  const fn = (tx: Tx) =>
    tx.auditLog.findMany({
      where: {
        ...(companyId ? { companyId } : filtro.empresa ? { companyId: filtro.empresa } : {}),
        ...(subtipo
          ? { payload: { path: ['tipo'], equals: subtipo } }
          : filtro.accion
            ? { accion: filtro.accion as never }
            : {}),
        ...(desde || hasta
          ? { createdAt: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } }
          : {}),
        ...(q
          ? {
              OR: [
                { entidadId: { contains: q, mode: 'insensitive' } },
                { entidadTipo: { contains: q, mode: 'insensitive' } },
                { user: { nombreBusqueda: { contains: normalizarBusqueda(q) } } },
                { user: { email: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        createdAt: true,
        accion: true,
        entidadTipo: true,
        entidadId: true,
        ipAddress: true,
        payload: true,
        user: { select: { name: true, email: true } },
        company: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    })

  const logs = companyId
    ? await conEmpresa(companyId, fn)
    : await sinEmpresa('auditoría: bitácora global (superadmin sin empresa)', fn)

  return logs.map((l) => {
    const payload = (l.payload ?? {}) as Record<string, unknown>
    return {
      id: l.id,
      fecha: l.createdAt,
      accion: l.accion,
      accionLabel: ACCION_LABEL[l.accion] ?? l.accion,
      detalle: describir(payload),
      entidadTipo: l.entidadTipo,
      entidadId: l.entidadId,
      usuario: l.user?.name ?? null,
      usuarioEmail: l.user?.email ?? null,
      empresa: l.company?.name ?? null,
      ip: l.ipAddress,
      payload,
    }
  })
}

/**
 * Serializa la bitácora a CSV, por `armarCsv` (`lib/csv.ts`), que es la única
 * puerta: este archivo tenía su propio escapado, y un dialecto por módulo es
 * exactamente lo que hizo que cuatro exportaciones del panel se abrieran mal.
 *
 * La hora va con SEGUNDOS: en un registro de auditoría, el orden exacto de dos
 * acciones seguidas es a menudo lo único que importa.
 */
export function auditoriaToCsv(items: AuditoriaItem[], timeZone: string): string {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('es-DO', {
      timeZone,
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(d)

  return armarCsv(
    [
      'Fecha y hora',
      'Accion',
      'Detalle',
      'Usuario',
      'Correo',
      'Empresa',
      'Entidad',
      'ID entidad',
      'IP',
    ],
    items.map((i) => [
      fmt(i.fecha),
      i.accionLabel,
      i.detalle,
      i.usuario,
      i.usuarioEmail,
      i.empresa,
      i.entidadTipo,
      i.entidadId,
      i.ip,
    ])
  )
}
