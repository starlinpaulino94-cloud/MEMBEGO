import type { AppRole } from '@/types'
import {
  ADMIN_SECTIONS,
  ROLES_EXENTOS_PERMISOS,
  canAccessAdminSection,
  seccionConcedida,
  seccionPermitida,
  type AdminSection,
  type PermisosUsuario,
} from '@/lib/auth/permissions'
import { FUNCIONES_POR_SECCION, SECCION_LABELS } from '@/lib/auth/funciones'

/**
 * QUÉ VE CADA EMPLEADO, resuelto en puro.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 *
 * Saber si a alguien le falta un módulo obligaba a abrir su ficha de Permisos
 * y leer cuarenta y cuatro casillas, una por una, sabiéndose de memoria qué
 * trae su rol de serie. Y aun así la ficha no contestaba la pregunta que de
 * verdad se hace —«¿por qué esta persona no ve Campañas?»—, porque la
 * respuesta puede estar en tres sitios distintos: su rol no lo trae, alguien
 * se lo negó, o la empresa no tiene esa capacidad encendida.
 *
 * Aquí se contesta una sola vez, con el MISMO orden de decisión que
 * `requireSection`, que es la barrera real:
 *
 *   1. `seccionPermitida(rol, seccion, permisos)` — rol como base, ajuste
 *      encima.
 *   2. la capa de CAPACIDADES de la empresa, que el superadmin no pisa.
 *
 * Si este orden se separa del de la guardia, la pantalla miente: diría que
 * alguien ve un módulo al que la guardia le cierra la puerta. Una prueba
 * estructural vigila que ambas sigan mirando lo mismo.
 */

/** Por qué SÍ lo ve: lo trae su rol, o alguien se lo concedió a mano. */
export type OrigenAcceso = 'rol' | 'concedido'

/**
 * Por qué NO lo ve:
 *  · `rol` — su rol no trae ese módulo y nadie se lo ha concedido.
 *  · `negado` — su rol sí lo trae, pero alguien se lo quitó.
 *  · `capacidad` — el módulo está apagado para la empresa entera, así que no
 *    lo ve NADIE: no es cosa de esta persona ni se arregla en su ficha.
 */
export type MotivoSinAcceso = 'rol' | 'negado' | 'capacidad'

export interface AccesoSeccion {
  section: AdminSection
  /** El nombre tal como se lee en el menú. */
  label: string
  puede: boolean
  origen: OrigenAcceso | null
  motivo: MotivoSinAcceso | null
  /**
   * Funciones del módulo negadas a esta persona, ya con su nombre legible.
   * Solo dice algo cuando `puede`: negar una función dentro de un módulo que
   * no se puede abrir no cambia nada.
   */
  funcionesNegadas: string[]
}

/**
 * ¿La empresa tiene encendida la capacidad que gobierna esta sección?
 *
 * Se recibe resuelto y en síncrono a propósito: así este módulo no toca la
 * base ni la caché, y la misma función sirve para una pantalla y para una
 * prueba. Quien llama lo construye con `filtroDeCapacidades`.
 */
export type SeccionEncendida = (section: AdminSection) => boolean

function funcionesNegadasDe(
  section: AdminSection,
  permisos: PermisosUsuario | null | undefined
): string[] {
  const negadas = permisos?.funciones?.[section]
  if (!negadas) return []
  const catalogo = FUNCIONES_POR_SECCION[section] ?? []
  /**
   * Solo las que están en el CATÁLOGO, y solo con su nombre.
   *
   * `resolverPermisosUsuario` guarda el código tal cual llega —no puede
   * cotejarlo contra `funciones.ts` sin un ciclo de imports—, así que en la
   * columna pueden quedar negaciones de funciones que ya no existen: una que
   * se renombró, una que se retiró con su guardia. Ninguna de esas niega nada
   * hoy, porque no hay acción que pregunte por ese código.
   *
   * Enseñarlas sería el «interruptor pintado» de `funciones.ts` al revés: la
   * pantalla diría que a alguien le falta algo que en realidad puede hacer.
   */
  return catalogo.filter((f) => negadas[f.codigo] === false).map((f) => f.label)
}

/** El acceso de una persona a UNA sección, con su porqué. */
export function accesoASeccion(
  role: AppRole,
  permisos: PermisosUsuario | null | undefined,
  section: AdminSection,
  seccionEncendida: SeccionEncendida
): AccesoSeccion {
  const label = SECCION_LABELS[section] ?? section
  const funcionesNegadas = funcionesNegadasDe(section, permisos)

  if (!seccionPermitida(role, section, permisos)) {
    // «Negado» es la negación explícita, la que alguien tuvo que marcar. Si el
    // rol tampoco lo traía, el motivo es el rol y decirlo importa: se arregla
    // concediéndoselo, no buscando quién se lo quitó.
    const motivo: MotivoSinAcceso = permisos?.secciones?.[section] === false ? 'negado' : 'rol'
    return { section, label, puede: false, origen: null, motivo, funcionesNegadas }
  }

  // Capa de CAPACIDADES, en el mismo sitio y con la misma excepción que
  // `requireSection`: al superadmin no se le gatea.
  if (!ROLES_EXENTOS_PERMISOS.includes(role) && !seccionEncendida(section)) {
    return { section, label, puede: false, origen: null, motivo: 'capacidad', funcionesNegadas }
  }

  const origen: OrigenAcceso =
    !ROLES_EXENTOS_PERMISOS.includes(role) && seccionConcedida(section, permisos)
      ? 'concedido'
      : 'rol'
  return { section, label, puede: true, origen, motivo: null, funcionesNegadas }
}

/** El mapa COMPLETO de una persona, sección por sección y en el orden del menú. */
export function accesosDeEmpleado(
  role: AppRole,
  permisos: PermisosUsuario | null | undefined,
  seccionEncendida: SeccionEncendida
): AccesoSeccion[] {
  return ADMIN_SECTIONS.map((s) => accesoASeccion(role, permisos, s, seccionEncendida))
}

export interface ResumenAccesos {
  /** Cuántos módulos ve, de cuántos gobernables. */
  visibles: number
  total: number
  /** Módulos que ve y su rol NO trae (alguien se los dio). */
  concedidos: AccesoSeccion[]
  /** Módulos que su rol trae y alguien le quitó. */
  negados: AccesoSeccion[]
  /** Módulos apagados para la empresa entera. */
  apagados: AccesoSeccion[]
  /** Funciones sueltas negadas dentro de módulos que sí puede abrir. */
  funcionesNegadas: number
}

/**
 * El resumen de una fila del equipo: lo que hay que poder leer de un vistazo
 * sin abrir a nadie. Los ajustes van aparte del total a propósito — «ve 12 de
 * 44» dice el tamaño, «+2 / −1» dice que alguien intervino, y son dos cosas
 * distintas de mirar.
 */
export function resumirAccesos(lista: AccesoSeccion[]): ResumenAccesos {
  const visibles = lista.filter((a) => a.puede)
  return {
    visibles: visibles.length,
    total: lista.length,
    concedidos: visibles.filter((a) => a.origen === 'concedido'),
    negados: lista.filter((a) => a.motivo === 'negado'),
    apagados: lista.filter((a) => a.motivo === 'capacidad'),
    funcionesNegadas: visibles.reduce((n, a) => n + a.funcionesNegadas.length, 0),
  }
}

/** Texto corto del porqué, para enseñarlo sin repetirlo en cada pantalla. */
export function explicarAcceso(a: AccesoSeccion): string {
  if (a.puede) return a.origen === 'concedido' ? 'Concedido a mano' : 'Lo trae su rol'
  if (a.motivo === 'negado') return 'Se lo quitaron'
  if (a.motivo === 'capacidad') return 'Apagado en la empresa'
  return 'Su rol no lo trae'
}

/** ¿Hay alguna sección que su rol no traiga y sí tenga? (para el aviso de la ficha) */
export function tieneAjustes(lista: AccesoSeccion[]): boolean {
  return lista.some((a) => a.origen === 'concedido' || a.motivo === 'negado')
}

/** Solo para que el compilador obligue a pasar por `canAccessAdminSection`. */
export function loQueTraeElRol(role: AppRole): AdminSection[] {
  return ADMIN_SECTIONS.filter((s) => canAccessAdminSection(role, s))
}
