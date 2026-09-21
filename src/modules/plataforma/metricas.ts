import 'server-only'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import {
  inicioDelDiaUTC,
  inicioDeVentana,
  normalizarEndpoint,
  resumirUso,
  type FilaMetrica,
  type Resultado,
  type ResumenUso,
} from '@/modules/plataforma/metricas-nucleo'

/**
 * PLATAFORMA · MÉTRICAS DE USO POR CREDENCIAL (B-7) — servidor.
 *
 * La parte que habla con la base. Lo que decide qué se cuenta y cómo se resume
 * vive en `metricas-nucleo.ts`, puro y probado. Aquí solo se escribe el
 * agregado y se lee para las pantallas.
 */

export type OrigenCredencial = 'CLAVE_API' | 'SISTEMA'

/**
 * SUMA UNA petición al agregado del día. Best-effort y SIN await en el camino
 * de la petición: una escritura de telemetría no puede añadir latencia a cada
 * llamada de la API, ni tumbarla si falla. El mismo contrato que `anotarUsoClave`
 * y que la bitácora.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ `sinEmpresa` PARA ESCRIBIR
 *
 * El agregado cruza inquilinos por naturaleza: una fila de satélite no es de
 * ninguna empresa (`companyId` null), y las de clave de empresa se leen luego
 * bajo `conEmpresa`, que sí las aísla por su `companyId`. Escribir siempre por
 * el camino omnisciente es lo único que satisface el `WITH CHECK` de RLS para
 * los dos casos a la vez, y esta escritura no es una pantalla de empresa: es
 * telemetría de plataforma.
 *
 * El `endpoint` se NORMALIZA aquí dentro, pase lo que pase, para que ningún id
 * de cliente llegue nunca a la tabla aunque quien llame se despiste.
 */
export function registrarUso(input: {
  origen: OrigenCredencial
  credencialId: string
  /** La empresa dueña de la clave. Null para un satélite. */
  companyId: string | null
  /** Ruta cruda de la petición; se normaliza aquí. */
  endpoint: string
  metodo: string
  resultado: Resultado
}): void {
  const dia = inicioDelDiaUTC(new Date())
  const endpoint = normalizarEndpoint(input.endpoint)
  const metodo = (input.metodo || 'GET').toUpperCase().slice(0, 10)

  void sinEmpresa('métricas: uso por credencial (agregado cross-tenant, best-effort)', (tx) =>
    tx.metricaUsoCredencial.upsert({
      where: {
        combinacion: {
          dia,
          origen: input.origen,
          credencialId: input.credencialId,
          endpoint,
          metodo,
          resultado: input.resultado,
        },
      },
      create: {
        dia,
        origen: input.origen,
        credencialId: input.credencialId,
        companyId: input.companyId,
        endpoint,
        metodo,
        resultado: input.resultado,
        peticiones: 1,
      },
      update: { peticiones: { increment: 1 } },
    })
  ).catch(anotarFallo('metricas:uso', { credencialId: input.credencialId }))
}

const SELECT_FILA = {
  dia: true,
  endpoint: true,
  metodo: true,
  resultado: true,
  peticiones: true,
} as const

function aFila(r: {
  dia: Date
  endpoint: string
  metodo: string
  resultado: string
  peticiones: number
}): FilaMetrica {
  // El día se guarda como DATE; se sirve como `YYYY-MM-DD`, que es con lo que
  // la pantalla agrupa y ordena sin arrastrar husos horarios.
  return {
    dia: r.dia.toISOString().slice(0, 10),
    endpoint: r.endpoint,
    metodo: r.metodo,
    resultado: r.resultado,
    peticiones: r.peticiones,
  }
}

/**
 * El uso de UNA clave de empresa en los últimos `dias`, resumido.
 *
 * Se lee bajo `conEmpresa`: RLS es la segunda barrera —solo devuelve filas de
 * esta empresa aunque el `where` se despistara— y el `credencialId` acota a la
 * clave concreta. La pantalla del hub de desarrolladores llama aquí.
 */
export async function usoDeClave(
  companyId: string,
  claveId: string,
  dias = 30
): Promise<ResumenUso> {
  const desde = inicioDeVentana(dias, new Date())
  const filas = await conEmpresa(companyId, (tx) =>
    tx.metricaUsoCredencial.findMany({
      where: { companyId, origen: 'CLAVE_API', credencialId: claveId, dia: { gte: desde } },
      select: SELECT_FILA,
    })
  ).catch(() => [])
  return resumirUso(filas.map(aFila))
}

/**
 * El uso de VARIAS claves de una empresa de un tirón, indexado por claveId.
 *
 * Una consulta y no una por clave: el panel enseña la lista entera y pedir por
 * separado sería N viajes a la base para pintar una pantalla.
 */
export async function usoDeClaves(
  companyId: string,
  claveIds: readonly string[],
  dias = 30
): Promise<Record<string, ResumenUso>> {
  if (claveIds.length === 0) return {}
  const desde = inicioDeVentana(dias, new Date())
  const filas = await conEmpresa(companyId, (tx) =>
    tx.metricaUsoCredencial.findMany({
      where: {
        companyId,
        origen: 'CLAVE_API',
        credencialId: { in: [...claveIds] },
        dia: { gte: desde },
      },
      select: { ...SELECT_FILA, credencialId: true },
    })
  ).catch(() => [])

  const porClave = new Map<string, FilaMetrica[]>()
  for (const f of filas) {
    const lista = porClave.get(f.credencialId) ?? []
    lista.push(aFila(f))
    porClave.set(f.credencialId, lista)
  }

  const out: Record<string, ResumenUso> = {}
  for (const id of claveIds) out[id] = resumirUso(porClave.get(id) ?? [])
  return out
}

/**
 * El uso de la credencial de UN satélite en los últimos `dias`, para el
 * superadmin. Cruza inquilinos (un satélite atiende a muchas empresas), así que
 * va por el camino omnisciente con su motivo.
 */
export async function usoDeSistema(credencialId: string, dias = 30): Promise<ResumenUso> {
  const desde = inicioDeVentana(dias, new Date())
  const filas = await sinEmpresa('métricas: uso de la credencial de un satélite (superadmin)', (tx) =>
    tx.metricaUsoCredencial.findMany({
      where: { origen: 'SISTEMA', credencialId, dia: { gte: desde } },
      select: SELECT_FILA,
    })
  ).catch(() => [])
  return resumirUso(filas.map(aFila))
}

/** El uso agregado de un satélite (todas sus credenciales), para el superadmin. */
export interface UsoSatelite {
  sistemaId: string
  slug: string
  nombre: string
  estado: string
  resumen: ResumenUso
}

/**
 * El uso de TODOS los satélites en los últimos `dias`, agregado por sistema.
 *
 * Es la pantalla del superadmin (B-7): el dato ya se recogía (`origen:'SISTEMA'`)
 * y `usoDeSistema` leía UNA credencial, pero faltaba la vista de todos a la vez.
 *
 * Agrega POR SISTEMA y no por credencial porque un satélite puede tener varias
 * (una rotación deja la vieja un tiempo): al superadmin le importa «cuánto usa
 * Car Wash la API», no cada llave por separado. Dos consultas y no una por
 * satélite: la lista de credenciales y el agregado del periodo, y el cruce se
 * hace en memoria. Cruza inquilinos por naturaleza (un satélite atiende a muchas
 * empresas), así que va por el camino omnisciente con su motivo.
 */
export async function usoDeSatelites(dias = 30): Promise<UsoSatelite[]> {
  const desde = inicioDeVentana(dias, new Date())
  return sinEmpresa('métricas: uso de todos los satélites (superadmin)', async (tx) => {
    const credenciales = await tx.credencialSistema.findMany({
      select: {
        id: true,
        sistemaId: true,
        sistema: { select: { slug: true, nombre: true, estado: true } },
      },
    })
    if (credenciales.length === 0) return []

    const filas = await tx.metricaUsoCredencial.findMany({
      where: { origen: 'SISTEMA', dia: { gte: desde } },
      select: { ...SELECT_FILA, credencialId: true },
    })

    // credencialId → sistemaId, para agregar todas las llaves de un satélite.
    const sistemaDeCred = new Map(credenciales.map((c) => [c.id, c.sistemaId]))
    const filasPorSistema = new Map<string, FilaMetrica[]>()
    for (const f of filas) {
      const sid = sistemaDeCred.get(f.credencialId)
      if (!sid) continue // una métrica de una credencial ya borrada: se ignora
      const lista = filasPorSistema.get(sid) ?? []
      lista.push(aFila(f))
      filasPorSistema.set(sid, lista)
    }

    // Un satélite puede tener varias credenciales: se deduplica por sistemaId.
    const sistemas = new Map<string, { slug: string; nombre: string; estado: string }>()
    for (const c of credenciales) {
      if (!sistemas.has(c.sistemaId)) sistemas.set(c.sistemaId, c.sistema)
    }

    return [...sistemas.entries()].map(([sistemaId, s]) => ({
      sistemaId,
      slug: s.slug,
      nombre: s.nombre,
      estado: s.estado,
      resumen: resumirUso(filasPorSistema.get(sistemaId) ?? []),
    }))
  }).catch(() => [] as UsoSatelite[])
}

/**
 * Purga el agregado más viejo que `dias`. Lo llama un cron: aunque cada fila sea
 * un contador y no una petición, un año de días × endpoints × credenciales no
 * tiene por qué guardarse para siempre. Devuelve cuántas filas se borraron.
 */
export async function purgarMetricasViejas(dias = 90): Promise<number> {
  const corte = inicioDeVentana(dias, new Date())
  const r = await sinEmpresa('métricas: purga de agregados viejos (cron)', (tx) =>
    tx.metricaUsoCredencial.deleteMany({ where: { dia: { lt: corte } } })
  ).catch(() => ({ count: 0 }))
  return r.count
}
