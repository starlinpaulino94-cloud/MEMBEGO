import { sinEmpresa, type Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { fallo } from '../core/errores'
import {
  CAPACIDADES,
  ETIQUETA_CAPACIDAD,
  QUE_APAGA,
  banderaActiva,
  capacidadEfectiva,
  type Capacidad,
} from './salud-dominio'

/**
 * MEMBEGO SUPPLY · SLICE 9 · BLOQUE 4 · BANDERAS E INTERRUPTORES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO SON LO MISMO, Y CONFUNDIRLOS ES EL PROBLEMA
 *
 *   BANDERA (entorno)        ¿existe esta capacidad en este despliegue?
 *                            Cambiarla pide un despliegue. Es una decisión de
 *                            configuración, no de operación.
 *
 *   INTERRUPTOR (base)       ¿está permitida AHORA?
 *                            Se cambia desde el panel, surte efecto en la
 *                            siguiente petición y queda con nombre y motivo.
 *
 * Para que algo funcione hacen falta las dos a favor; para apagarlo basta una.
 * En una emergencia, apagar tiene que ser fácil y encender, deliberado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE UN INTERRUPTOR NO PUEDE APAGAR
 *
 * La lectura. Apagar los pagos externos corta el PROCESAMIENTO y deja intactos
 * el Centro de Operaciones, la búsqueda, la investigación y la resolución
 * manual. Si apagar la integración apagara también el panel, nadie podría ver
 * por qué la apagó —y eso es exactamente el momento en que hace falta verlo—.
 */

export interface EstadoDeCapacidad {
  clave: Capacidad
  etiqueta: string
  /** La decisión del despliegue (entorno). */
  bandera: boolean
  /** La decisión de ahora (base). `null` = nadie la ha tocado. */
  interruptor: boolean | null
  /** Lo que de verdad pasa: bandera Y interruptor. */
  activa: boolean
  /** Por qué se apagó, si alguien lo apagó. */
  motivo: string | null
  cambiadoAt: Date | null
  cambiadoPor: string | null
  corta: readonly string[]
  conserva: readonly string[]
}

/**
 * ¿Está activa esta capacidad?
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE LEE DE LA BASE CADA VEZ, Y ESO ES DELIBERADO
 *
 * Esto estuvo con una caché de proceso de cinco segundos, con el argumento de
 * que preguntar por un booleano en cada aviso de pago es latencia regalada. El
 * recorrido E lo tumbó: se apagaba el interruptor, el webhook respondía 503
 * —correcto—, se volvía a encender, el panel YA decía que estaba encendido… y
 * el webhook seguía respondiendo 503.
 *
 * La razón es que una caché de proceso no se puede invalidar desde otro
 * proceso, y en Next el manejador de ruta del webhook y la server action que
 * mueve el interruptor no comparten necesariamente la misma instancia del
 * módulo. En producción es peor: con varias instancias, cada una se queda con
 * su copia y NO hay forma de avisarlas. Un interruptor de emergencia que puede
 * quedarse atrás —en cualquiera de las dos direcciones— no es un interruptor de
 * emergencia; y encenderlo de nuevo sin poder confiar en cuándo surte efecto es
 * justo lo que no se quiere a las tres de la mañana.
 *
 * El coste real: un `SELECT` de cuatro filas por clave primaria sobre una tabla
 * de cuatro filas, dentro de una petición que ya abre una transacción, verifica
 * una firma HMAC y escribe en el inbox. No es medible al lado de eso.
 */
export async function capacidadActiva(clave: Capacidad): Promise<boolean> {
  // Si la bandera del despliegue dice que no, no hace falta ni mirar la base.
  if (!banderaActiva(clave)) return false
  // `sinEmpresa` y no `prisma` a pelo, y aquí no es higiene: es FAIL-OPEN.
  //
  // La política de capa 2 de `supply_v2_operational_switches` solo deja leerla
  // en modo omnisciente —es un control de plataforma, no de un inquilino—. Con
  // RLS encendida, una consulta sin contexto NO falla: devuelve cero filas. Y
  // cero filas aquí significa `undefined`, que `capacidadEfectiva` interpreta
  // como «nadie lo apagó». Resultado: un interruptor de emergencia APAGADO a
  // propósito se leería como ENCENDIDO, y los pagos externos seguirían
  // procesándose después de que alguien los cortara.
  //
  // El gate `rls:cobertura` no lo cazó porque mira por ARCHIVO y este ya tenía
  // un `sinEmpresa` más abajo (`cambiarInterruptor`). Es el mismo punto ciego
  // que dejó pasar `worker.ts` y `entrada.ts`.
  const fila = await sinEmpresa('Supply: leer un interruptor operativo', (tx) =>
    tx.supplyV2OperationalSwitch.findUnique({ where: { key: clave }, select: { enabled: true } })
  )
  return capacidadEfectiva(clave, fila?.enabled)
}

/** El estado completo de las cuatro capacidades, para el panel. */
export async function estadoDeCapacidades(): Promise<EstadoDeCapacidad[]> {
  // Mismo motivo que arriba: sin contexto, cero filas, y el panel mostraría
  // los cinco interruptores como si nadie los hubiera tocado nunca.
  const filas = await sinEmpresa('Supply: leer los interruptores operativos', (tx) =>
    tx.supplyV2OperationalSwitch.findMany({
      select: { key: true, enabled: true, reason: true, changedAt: true, changedBy: { select: { name: true, email: true } } },
    })
  )
  const porClave = new Map(filas.map((f) => [f.key, f]))

  return CAPACIDADES.map((clave) => {
    const fila = porClave.get(clave)
    const bandera = banderaActiva(clave)
    const interruptor = fila ? fila.enabled : null
    return {
      clave,
      etiqueta: ETIQUETA_CAPACIDAD[clave],
      bandera,
      interruptor,
      activa: capacidadEfectiva(clave, fila?.enabled),
      motivo: fila?.reason ?? null,
      cambiadoAt: fila?.changedAt ?? null,
      cambiadoPor: fila?.changedBy?.name ?? fila?.changedBy?.email ?? null,
      corta: QUE_APAGA[clave].corta,
      conserva: QUE_APAGA[clave].conserva,
    }
  })
}

/**
 * TOCAR UN INTERRUPTOR.
 *
 * Apagar exige motivo —un interruptor sin motivo es una avería que nadie sabe
 * explicar tres semanas después, y la base lo impone con un CHECK— y las dos
 * direcciones quedan auditadas: apagar el procesamiento de pagos es una
 * decisión con consecuencias de dinero.
 */
export async function cambiarInterruptor(
  d: { clave: Capacidad; encender: boolean; motivo?: string | null },
  ctx: ContextoAuditoria
): Promise<EstadoDeCapacidad> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Cambiar un interruptor necesita quién lo hace.')
  if (!CAPACIDADES.includes(d.clave)) fallo('CAPACIDAD_DESCONOCIDA', 'Esa capacidad no existe.')
  const motivo = d.motivo?.trim() || null
  if (!d.encender && (!motivo || motivo.length < 3)) {
    fallo('MOTIVO_OBLIGATORIO', 'Apagar una capacidad exige explicar por qué.')
  }

  await sinEmpresa('Supply: cambiar un interruptor operativo', async (tx: Tx) => {
    await tx.supplyV2OperationalSwitch.upsert({
      where: { key: d.clave },
      create: { key: d.clave, enabled: d.encender, reason: motivo, changedById: ctx.actorId },
      update: { enabled: d.encender, reason: motivo, changedById: ctx.actorId, changedAt: new Date() },
    })
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_OPERATIONS_SWITCH_CHANGED', 'SupplyV2OperationalSwitch', d.clave, {
      capacidad: d.clave,
      encendida: d.encender,
      motivo,
      banderaDelDespliegue: banderaActiva(d.clave),
    }, null)
  })

  const estados = await estadoDeCapacidades()
  return estados.find((e) => e.clave === d.clave)!
}
