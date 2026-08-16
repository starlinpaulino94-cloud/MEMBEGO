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
  app: 'App Car Wash',
}

export const FUNCIONES_POR_SECCION: Partial<Record<AdminSection, FuncionPermiso[]>> = {
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
}
