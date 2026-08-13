import 'server-only'
import { Prisma } from '@prisma/client'
import { sinEmpresa, type Tx } from '@/lib/tenant'
import { getRequestMeta } from '@/lib/server-utils'
import { anotarFallo } from '@/lib/prisma-errors'

/**
 * Rastro de lo que el panel de integraciones hace HACIA AFUERA.
 *
 * Las tres acciones del panel no escribían absolutamente nada. Y son las tres
 * acciones del superadmin que más salen del sistema:
 *
 *   · «Probar el webhook» manda dos peticiones al dominio de un tercero. Si el
 *     equipo del satélite ve tráfico raro en sus logs y pregunta, la respuesta
 *     era encogerse de hombros.
 *   · «Reenviar ahora» y «devolver los agotados a la cola» mueven eventos de
 *     TODAS las empresas que usan ese satélite. Reencolar mil eventos es una
 *     operación perfectamente legítima y perfectamente indistinguible de un
 *     accidente cuando no queda constancia de quién la pidió.
 *
 * `companyId: null` a propósito: la acción es de plataforma, no de un negocio.
 * Los eventos movidos pertenecen a muchas empresas a la vez y elegir una
 * cualquiera para colgarle la línea sería peor que no colgarla.
 *
 * FAIL-OPEN, y aquí importa más que de costumbre: estas acciones se usan
 * justamente cuando algo ya está roto. Si la migración del enum no está puesta,
 * el `create` revienta — y quedarse sin poder reenviar la cola por no poder
 * anotarla convertiría una mejora de trazabilidad en una avería.
 */
export type AccionIntegracion =
  | 'INTEGRACION_SONDEADA'
  | 'INTEGRACION_REINTENTADA'
  | 'INTEGRACION_REENCOLADA'

export async function auditarIntegracion(
  accion: AccionIntegracion,
  sistemaId: string,
  userId: string | null,
  payload: Prisma.InputJsonObject
): Promise<void> {
  const meta = await getRequestMeta()
  await sinEmpresa('integraciones: registrar la acción del panel del superadmin', (tx) =>
    tx.auditLog.create({
      data: {
        companyId: null,
        userId,
        accion,
        entidadTipo: 'SistemaConectado',
        entidadId: sistemaId,
        payload,
        ...meta,
      },
    })
  ).catch(anotarFallo('integraciones:auditLog.create', { accion, sistemaId }))
}

/** Lo que el panel enseña de la última sonda guardada, por sistema. */
export interface SondaGuardada {
  cuando: Date
  /** Código del POST firmado; 0 = no hubo respuesta. */
  status: number
  /** El veredicto que se calculó entonces, tal cual se enseñó. */
  titulo: string
  gravedad: 'ok' | 'aviso' | 'falla'
  /** Quién la lanzó. Null si el usuario ya no existe. */
  quien: string | null
}

function textoDe(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

/**
 * Última sonda de cada sistema, leída de la bitácora.
 *
 * Se guarda ahí y no en una columna de `sistemas_conectados` por dos razones.
 * La primera es que conserva el HISTORIAL: «lleva fallando desde el martes» es
 * una frase que solo se puede decir con más de una medición. La segunda es
 * operativa — una columna nueva obliga a una migración de la que dependería la
 * consulta del panel, y entre el despliegue del código y el de la migración
 * esta pantalla se quedaría en blanco justo cuando hace falta.
 */
export async function ultimasSondas(
  /**
   * La transacción de quien llama, y no una propia: el panel ya está dentro de
   * `sinEmpresa`, y abrir otra desde ahí pediría una segunda conexión del pool
   * sosteniendo la primera — el patrón que `scripts/transacciones-anidadas.mjs`
   * existe para impedir.
   */
  tx: Tx,
  sistemaIds: string[]
): Promise<Map<string, SondaGuardada>> {
  const fuera = new Map<string, SondaGuardada>()
  if (sistemaIds.length === 0) return fuera

  const filas = await tx.auditLog
    .findMany({
      where: {
        accion: 'INTEGRACION_SONDEADA',
        entidadTipo: 'SistemaConectado',
        entidadId: { in: sistemaIds },
      },
      orderBy: { createdAt: 'desc' },
      // Una sonda por sistema con margen para el desempate: se lee de más
      // nueva a más vieja y solo se queda la primera de cada uno. Traer la
      // tabla entera para descartar el 99 % sería el N+1 al revés.
      take: sistemaIds.length * 8,
      select: {
        entidadId: true,
        createdAt: true,
        payload: true,
        user: { select: { name: true } },
      },
    })
    .catch(() => [])

  for (const f of filas) {
    if (fuera.has(f.entidadId)) continue
    const p = (f.payload ?? {}) as Record<string, unknown>
    const gravedad = textoDe(p.gravedad)
    fuera.set(f.entidadId, {
      cuando: f.createdAt,
      status: typeof p.status === 'number' ? p.status : 0,
      titulo: textoDe(p.titulo) ?? 'Sin veredicto guardado',
      gravedad: gravedad === 'ok' || gravedad === 'aviso' ? gravedad : 'falla',
      quien: f.user?.name ?? null,
    })
  }
  return fuera
}
