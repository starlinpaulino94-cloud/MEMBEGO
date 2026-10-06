import type { AdminSection } from '@/lib/auth/permissions'

/**
 * CATÁLOGO de funciones controlables por sección (módulo de Permisos).
 *
 * Regla de honestidad: aquí SOLO se listan funciones que las server actions
 * hacen cumplir de verdad (su `requireSection(seccion, funcion)` existe).
 * Listar una función sin cablear su guardia sería un interruptor pintado:
 * el panel diría "negado" y la acción seguiría pasando. Todo lo que no está
 * en la lista obedece al interruptor del MÓDULO completo.
 */

export interface FuncionPermiso {
  codigo: string
  label: string
}

/** Nombre de cada sección TAL COMO SE LEE en el panel (para el editor). */
export const SECCION_LABELS: Record<AdminSection, string> = {
  dashboard: 'Resumen',
  clientes: 'Clientes',
  membresias: 'Membresías',
  promociones: 'Promociones',
  publicaciones: 'Publicaciones',
  campanas: 'Campañas',
  referidos: 'Referidos',
  crecimiento: 'Crecimiento',
  scanner: 'Escanear QR',
  pagos: 'Pagos',
  facturas: 'Comprobantes',
  citas: 'Citas',
  ofertas: 'Regalos VIP',
  perfil: 'Perfil público',
  sucursales: 'Sucursales',
  'metodos-pago': 'Métodos de pago',
  planes: 'Planes',
  notificaciones: 'Notificaciones',
  automatizaciones: 'Automatizaciones',
  comunicacion: 'Comunicación',
  tickets: 'Tickets',
  empleados: 'Empleados',
  registros: 'Registros',
  regalos: 'Regalos y gift cards',
  seguimiento: 'Seguimiento',
  reportes: 'Reportes',
  actividad: 'Actividad',
  riesgo: 'Riesgo',
  retencion: 'Retención',
  conciliacion: 'Conciliación',
  adquisicion: 'Adquisición',
  audiencia: 'Audiencia',
  invitaciones: 'Invitaciones',
  marketing: 'Marketing',
  gamificacion: 'Gamificación',
  personalizacion: 'Personalización',
  sinonimos: 'Sinónimos de búsqueda',
  app: 'App Car Wash',
  excursiones: 'Excursiones',
  leads: 'Prospectos (todo el CRM)',
  integraciones: 'Integraciones',
  supply: 'Membego Supply (compromisos con la plataforma)',
}

export const FUNCIONES_POR_SECCION: Partial<Record<AdminSection, FuncionPermiso[]>> = {
  integraciones: [
    { codigo: 'clave_crear', label: 'Crear claves de API' },
    { codigo: 'clave_revocar', label: 'Revocar claves de API' },
    { codigo: 'webhook_crear', label: 'Crear webhooks' },
    { codigo: 'webhook_estado', label: 'Pausar y reactivar webhooks' },
    { codigo: 'webhook_probar', label: 'Mandar eventos de prueba a un webhook' },
    { codigo: 'webhook_reenviar', label: 'Reenviar entregas de webhook' },
    { codigo: 'webhook_rotar', label: 'Rotar el secreto de un webhook' },
    { codigo: 'entrante_crear', label: 'Crear webhooks entrantes (URLs para recibir)' },
    { codigo: 'entrante_gestionar', label: 'Pausar y eliminar webhooks entrantes' },
    { codigo: 'regla_http', label: 'Crear y gestionar reglas que llaman a otra app' },
    { codigo: 'app_conectar', label: 'Conectar aplicaciones (WhatsApp, Google…)' },
    { codigo: 'app_desconectar', label: 'Desconectar aplicaciones' },
  ],
  promociones: [
    { codigo: 'crear', label: 'Crear promociones' },
    { codigo: 'editar', label: 'Editar promociones' },
    { codigo: 'eliminar', label: 'Eliminar promociones' },
    { codigo: 'pausar', label: 'Pausar y reactivar' },
    { codigo: 'duplicar', label: 'Duplicar promociones' },
    { codigo: 'archivar', label: 'Archivar y desarchivar' },
  ],
  pagos: [
    { codigo: 'confirmar_pago', label: 'Confirmar pagos por transferencia' },
    { codigo: 'rechazar_pago', label: 'Rechazar pagos' },
    { codigo: 'aprobar_compra', label: 'Aprobar compras de promociones' },
    { codigo: 'rechazar_compra', label: 'Rechazar compras de promociones' },
    { codigo: 'aprobar_cambio_plan', label: 'Aprobar cambios de plan' },
    { codigo: 'rechazar_cambio_plan', label: 'Rechazar cambios de plan' },
    { codigo: 'crear_membresia', label: 'Crear membresías (venta directa)' },
    { codigo: 'cancelar_membresia', label: 'Cancelar membresías' },
    { codigo: 'solicitar_evidencia', label: 'Pedir nueva evidencia de pago' },
  ],
  membresias: [
    { codigo: 'cambiar_plan', label: 'Cambiar el plan de una membresía' },
    { codigo: 'renovar', label: 'Renovar membresías' },
    { codigo: 'ajustar_lavados', label: 'Sumar o restar lavados a una membresía' },
  ],
  /**
   * CRM (`/admin/crm/*`). La sección entera se gobierna con `leads`; estas
   * funciones afinan DENTRO de ella, y cada una tiene su guardia viva en
   * `crm/lead-actions.ts` y `connect/autoReply-actions.ts`.
   *
   * Nacieron mal: esas nueve guardias pedían `requireSection('clientes', …)`
   * mientras el layout del CRM y sus otras actions piden `leads`. Eso abría
   * dos huecos a la vez. El grave: CAJERO y SUPERVISOR traen `clientes` y NO
   * `leads`, así que no podían ni abrir el CRM y aun así pasaban estas nueve
   * actions — y una server action se despacha por su id desde cualquier ruta
   * permitida, igual que pasó con `sinonimos`. El otro: al no estar el código
   * en este catálogo, `guardarPermisosEmpleado` lo descartaba al validar, así
   * que la casilla no existía y NADIE podía negar ninguna de las nueve.
   */
  leads: [
    { codigo: 'lead_crear', label: 'Crear prospectos' },
    { codigo: 'lead_editar', label: 'Editar prospectos' },
    { codigo: 'lead_eliminar', label: 'Eliminar prospectos' },
    { codigo: 'lead_mover_etapa', label: 'Mover prospectos de etapa' },
    { codigo: 'lead_asignar', label: 'Asignar prospectos a otra persona' },
    { codigo: 'auto_reply_leer', label: 'Ver las respuestas automáticas' },
    { codigo: 'auto_reply_crear', label: 'Crear respuestas automáticas' },
    { codigo: 'auto_reply_editar', label: 'Editar respuestas automáticas' },
    { codigo: 'auto_reply_eliminar', label: 'Eliminar respuestas automáticas' },
  ],
  clientes: [
    { codigo: 'nota_crear', label: 'Agregar notas al cliente' },
    { codigo: 'nota_eliminar', label: 'Eliminar notas del cliente' },
  ],
  ofertas: [
    { codigo: 'crear', label: 'Crear regalos VIP' },
    { codigo: 'estado', label: 'Pausar / reactivar / finalizar regalos' },
    { codigo: 'invitados', label: 'Agregar o quitar invitados' },
    { codigo: 'registrar_uso', label: 'Registrar un uso manual' },
  ],
  citas: [
    { codigo: 'gestionar', label: 'Gestionar citas (confirmar, completar, cancelar)' },
    { codigo: 'configurar', label: 'Configurar la agenda y sus horarios' },
  ],
  publicaciones: [
    { codigo: 'crear', label: 'Crear publicaciones' },
    { codigo: 'editar', label: 'Editar publicaciones' },
    { codigo: 'eliminar', label: 'Eliminar publicaciones' },
  ],
  sucursales: [
    { codigo: 'editar', label: 'Editar sucursales y su ubicación' },
    { codigo: 'mapa', label: 'Mostrar u ocultar en el mapa' },
  ],
  campanas: [
    { codigo: 'crear', label: 'Crear campañas' },
    { codigo: 'editar', label: 'Editar campañas' },
    { codigo: 'eliminar', label: 'Eliminar campañas' },
  ],
  seguimiento: [
    { codigo: 'recordatorio', label: 'Enviar recordatorios' },
    { codigo: 'configurar', label: 'Configurar el seguimiento' },
  ],
  notificaciones: [{ codigo: 'enviar', label: 'Enviar notificaciones a segmentos' }],
  automatizaciones: [
    { codigo: 'instalar', label: 'Instalar automatizaciones' },
    { codigo: 'publicar', label: 'Publicar automatizaciones' },
    { codigo: 'pausar', label: 'Pausar automatizaciones' },
    { codigo: 'archivar', label: 'Archivar automatizaciones' },
  ],
  marketing: [
    { codigo: 'crear', label: 'Crear campañas de marketing' },
    { codigo: 'editar', label: 'Editar campañas de marketing' },
    { codigo: 'estado', label: 'Activar / pausar campañas' },
    { codigo: 'eliminar', label: 'Eliminar campañas de marketing' },
  ],
  excursiones: [
    { codigo: 'catalogo_crear', label: 'Crear excursiones' },
    { codigo: 'catalogo_editar', label: 'Editar excursiones, variantes y horarios' },
    { codigo: 'catalogo_archivar', label: 'Archivar excursiones' },
    { codigo: 'vendedor_crear', label: 'Crear vendedores' },
    { codigo: 'vendedor_editar', label: 'Editar vendedores' },
    { codigo: 'vendedor_desactivar', label: 'Suspender o desactivar vendedores' },
    { codigo: 'vendedor_acceso', label: 'Dar y quitar acceso al panel del vendedor' },
    { codigo: 'reserva_crear', label: 'Crear reservas' },
    { codigo: 'reserva_editar', label: 'Confirmar y completar reservas' },
    { codigo: 'reserva_cancelar', label: 'Cancelar reservas' },
    { codigo: 'reserva_pago', label: 'Registrar pagos de reservas' },
    { codigo: 'reserva_anular_pago', label: 'Anular pagos ya registrados' },
    { codigo: 'venta_confirmar', label: 'Confirmar ventas (genera la comisión)' },
    { codigo: 'venta_cancelar', label: 'Cancelar ventas confirmadas' },
    { codigo: 'comision_reglas', label: 'Definir reglas de comisión' },
    { codigo: 'comision_aprobar', label: 'Aprobar y marcar comisiones como pagadas' },
    { codigo: 'comision_ajustar', label: 'Ajustar comisiones' },
    { codigo: 'liquidacion_crear', label: 'Preparar y aprobar liquidaciones' },
    { codigo: 'liquidacion_pagar', label: 'Marcar liquidaciones como pagadas' },
    { codigo: 'meta_definir', label: 'Poner y archivar metas de vendedores' },
    { codigo: 'reporte_exportar', label: 'Exportar reportes de excursiones' },
    { codigo: 'checkin_registrar', label: 'Hacer check-in de pasajeros' },
  ],
  /**
   * REPORTES. Hasta ahora la sección era todo o nada: quien entraba veía las
   * cifras de facturación y se las podía descargar. Un encargado de turno
   * necesita el reporte de operación; no necesita saber cuánto factura el
   * negocio.
   *
   * Solo están las que HOY se hacen cumplir de verdad. `ver_empleados` entró
   * con el reporte de operación, que fue el primero que desglosa por persona,
   * y `ver_datos_personales` con el de clientes, que es el primero que pone
   * nombres de personas en una tabla. `ver_auditoria` sigue diseñada en
   * `docs/REPORTES.md` y espera a su reporte: listarla antes sería un
   * interruptor pintado, que es justo lo que la regla de arriba prohíbe.
   */
  reportes: [
    { codigo: 'ver', label: 'Ver los reportes' },
    { codigo: 'ver_financieros', label: 'Ver ingresos y cifras de dinero' },
    // Mide OPERACIONES, no personas: cuántos canjes registró cada mostrador.
    // Va aparte porque saber cuánto trabaja el negocio y saber cuánto trabaja
    // cada quien son dos permisos distintos, y el segundo no lo necesita un
    // encargado de turno para hacer su trabajo.
    { codigo: 'ver_empleados', label: 'Ver el desglose de operación por empleado' },
    // Nombres de clientes dentro de un reporte. Va aparte de `ver` porque
    // saber cuántos clientes hay y saber QUIÉNES son no son la misma
    // pregunta: la primera la necesita cualquiera que mire el negocio, la
    // segunda solo quien trata con ellos.
    { codigo: 'ver_datos_personales', label: 'Ver nombres de clientes en los reportes' },
    { codigo: 'exportar', label: 'Descargar los reportes' },
  ],
}
