import type { AdminSection } from '@/lib/auth/permissions'

/**
 * LOS BLOQUES DEL RESUMEN Y QUIÉN LOS VE (auditoría admin · fase 5, tarea 5.1; D-01, D-07, D-13).
 *
 * El Resumen de hoy es el mismo para todos y lo ven todos: un administrador, Marketing, un cajero. Aquí cada bloque
 * DECLARA lo que exige —una sección del panel, a veces una función dentro de ella— y la composición se resuelve por lo que
 * la persona puede abrir, no por una lista de roles: el día que se le conceda o se le niegue un módulo a alguien, su Resumen
 * cambia solo. Es una función PURA, sin base de datos, para poder probar cada rol y cada permiso.
 *
 * La decisión que se toma aquí se usa DOS veces: la página decide qué pintar y el motor (`consultas.ts`) decide qué consultar.
 * Lo que no se concede, ni se pide a la base de datos ni viaja a la página.
 *
 * Es la composición del prototipo aprobado (`docs/auditoria-admin/fase-3/prototipos/resumen.html`):
 *   · «Hoy · requiere acción»: hasta TRES bloques, ordenados por urgencia.
 *   · «Este mes»: hasta CUATRO cifras, cada una con su ventana escrita.
 *   · Una gráfica de 14 días.
 */

export interface PermisosResumen {
  /** ¿Puede abrir esta sección? (rol + permisos vivos + capacidades: `seccionesAbribles`). */
  puede: (seccion: AdminSection) => boolean
  /** `reportes › ver_financieros`: ingresos y montos. */
  conFinanzas: boolean
  /** `reportes › ver_empleados`: el desglose de operación por persona. */
  conEmpleados: boolean
}

export type BloqueHoy = 'pagos' | 'vencen' | 'riesgo' | 'mostrador' | 'promosVencen'
export type CifraMes =
  | 'ingresos'
  | 'membresias'
  | 'canjes'
  | 'clientesNuevos'
  | 'registros'
  | 'seguidores'
  | 'beneficioLider'
  | 'interacciones'
export type TipoGrafica = 'canjes' | 'registros'

export interface BloquesResumen {
  hoy: BloqueHoy[]
  mes: CifraMes[]
  grafica: TipoGrafica | null
  /** Qué lleva el bloque «mostrador» de esta persona: los canjes de hoy, las citas de hoy, o los dos. */
  mostrador: { canjes: boolean; citas: boolean }
}

/** Cuántos bloques de acción y cuántas cifras caben por encima del pliegue (criterio de la fase 5: ≤ 4 acciones y ≤ 8 cifras). */
export const MAX_BLOQUES_HOY = 3
export const MAX_CIFRAS_MES = 4

export function bloquesDelResumen(p: PermisosResumen): BloquesResumen {
  const { puede } = p
  // Quien abre el directorio de clientes ve nombres y puede actuar sobre ellos; quien solo tiene Marketing ve cuántos son.
  const conDirectorio = puede('clientes')

  const hoy: BloqueHoy[] = []
  if (puede('pagos')) hoy.push('pagos')
  if (puede('riesgo')) hoy.push(conDirectorio ? 'vencen' : 'riesgo')
  if (puede('scanner') || puede('citas')) hoy.push('mostrador')
  if (puede('promociones') && !puede('pagos')) hoy.push('promosVencen')

  const mes: CifraMes[] = []
  if (p.conFinanzas) mes.push('ingresos')
  if (puede('membresias')) mes.push('membresias')
  if (puede('scanner')) mes.push('canjes')
  if (conDirectorio) mes.push('clientesNuevos')
  if (!conDirectorio && puede('audiencia')) mes.push('registros', 'seguidores')
  if (!conDirectorio && puede('promociones')) mes.push('beneficioLider', 'interacciones')

  return {
    hoy: hoy.slice(0, MAX_BLOQUES_HOY),
    mes: mes.slice(0, MAX_CIFRAS_MES),
    grafica: puede('scanner') ? 'canjes' : puede('audiencia') ? 'registros' : null,
    mostrador: { canjes: puede('scanner'), citas: puede('citas') },
  }
}
