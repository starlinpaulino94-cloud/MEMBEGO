import { Prisma } from '@prisma/client'

/**
 * Clasificación de errores de Prisma para logs accionables.
 *
 * El síntoma "No pudimos cargar tu información" puede tener causas muy
 * distintas con remedios muy distintos. Este helper convierte la excepción en
 * un diagnóstico que dice QUÉ pasó y QUÉ hacer, para que el log de Vercel no
 * sea un mensaje genérico. Úsalo en todo `catch` de páginas/acciones que
 * consultan la BD.
 */

export type PrismaErrorTipo =
  /** La BD no tiene una tabla/columna/enum que el código espera → faltan migraciones. */
  | 'SCHEMA_DRIFT'
  /** No se pudo hablar con la BD (caída, pool agotado, timeout). Transitorio. */
  | 'CONEXION'
  /** Violación de restricción (unique, FK). Error de datos, no de esquema. */
  | 'RESTRICCION'
  | 'OTRO'

export interface PrismaErrorInfo {
  tipo: PrismaErrorTipo
  codigo: string | null
  mensaje: string
  /** Qué hacer: se imprime en el log para que el remedio sea inmediato. */
  remedio: string
}

const DRIFT_CODES = new Set([
  'P2021', // la tabla no existe
  'P2022', // la columna no existe
  'P2010', // raw query failed (suele envolver columnas faltantes)
])
const CONN_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024'])
const CONSTRAINT_CODES = new Set(['P2002', 'P2003', 'P2025'])

export function clasificarErrorPrisma(e: unknown): PrismaErrorInfo {
  const mensaje = e instanceof Error ? e.message : String(e)

  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (DRIFT_CODES.has(e.code)) {
      return {
        tipo: 'SCHEMA_DRIFT',
        codigo: e.code,
        mensaje,
        remedio:
          'La base de datos NO tiene el esquema que este deploy espera. ' +
          'Corre `npm run db:doctor` (o db:doctor:sql y pégalo en Supabase) ' +
          'para ver exactamente qué falta, y aplica las migraciones pendientes de prisma/migrations.',
      }
    }
    if (CONN_CODES.has(e.code)) {
      return {
        tipo: 'CONEXION',
        codigo: e.code,
        mensaje,
        remedio:
          'Fallo de conexión con la base de datos (transitorio). Verifica el estado de Supabase y el pool.',
      }
    }
    if (CONSTRAINT_CODES.has(e.code)) {
      return { tipo: 'RESTRICCION', codigo: e.code, mensaje, remedio: 'Revisa los datos de la operación.' }
    }
    return { tipo: 'OTRO', codigo: e.code, mensaje, remedio: 'Revisa el mensaje del error.' }
  }

  if (e instanceof Prisma.PrismaClientInitializationError) {
    return {
      tipo: 'CONEXION',
      codigo: e.errorCode ?? null,
      mensaje,
      remedio: 'Prisma no pudo inicializar la conexión: revisa DATABASE_URL y el estado de la BD.',
    }
  }

  // El mensaje de columna faltante también puede llegar como error genérico.
  if (/column .* does not exist|relation .* does not exist/i.test(mensaje)) {
    return {
      tipo: 'SCHEMA_DRIFT',
      codigo: null,
      mensaje,
      remedio: 'Faltan migraciones en la BD: corre `npm run db:doctor` y aplica lo pendiente.',
    }
  }

  return { tipo: 'OTRO', codigo: null, mensaje, remedio: 'Revisa el mensaje del error.' }
}

/** Log estructurado y accionable de un error de BD, con contexto del caller. */
export function logErrorBd(contexto: string, e: unknown, extra?: Record<string, unknown>) {
  const info = clasificarErrorPrisma(e)
  console.error(`[${contexto}] ${info.tipo}${info.codigo ? ` (${info.codigo})` : ''}: ${info.mensaje}`, {
    remedio: info.remedio,
    ...extra,
  })
  return info
}

/**
 * Manejador para fallos NO fatales que igual deben dejar rastro.
 *
 * Sustituye al patrón `.catch(() => {})`, que se traga el error sin dejar nada
 * en el log. Ese patrón ya nos costó caro: una migración sin correr dejó las
 * capacidades apagadas en silencio durante días, porque el código es fail-open
 * a propósito y nadie vio un solo error.
 *
 * El flujo sigue sin romperse (es justo lo que buscamos al ignorar el fallo),
 * pero queda registrado con su contexto y, si el error es de Prisma, con la
 * clasificación y el remedio (`SCHEMA_DRIFT` → «corre db-doctor»).
 *
 * Uso:
 *   await prisma.auditLog.create({ ... }).catch(anotarFallo('campanas:auditoria'))
 *
 * @param contexto  `modulo:operacion`, para poder grepear el log.
 * @param extra     Datos útiles para diagnosticar (ids, no datos personales).
 */
export function anotarFallo(contexto: string, extra?: Record<string, unknown>) {
  return (e: unknown): void => {
    logErrorBd(contexto, e, extra)
  }
}
