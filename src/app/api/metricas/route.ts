import { NextRequest, NextResponse } from 'next/server'
import {
  estadoGeneral,
  leerMetricas,
  saturacionConexiones,
  variacionVisitas,
  type Metricas,
} from '@/modules/observabilidad/metricas'

export const dynamic = 'force-dynamic'

/**
 * GET /api/metricas  (auditoría de producción · A-09, Fase 6)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PARA QUÉ
 *
 * `/api/health` responde "¿está viva?". Esto responde "¿está BIEN?", que no es
 * lo mismo: una aplicación puede estar perfectamente viva mientras el pool de
 * conexiones se llena, los pagos se quedan colgados y las visitas caen a la
 * mitad. Ninguna de esas tres cosas asoma en un `SELECT 1`.
 *
 * Está pensado para que lo lea un monitor externo cada pocos minutos y alerte
 * según `docs/OBSERVABILIDAD.md`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO ES PÚBLICO, A DIFERENCIA DE /api/health
 *
 * `/api/health` devuelve una palabra —`ok` o `degraded`— justamente para no
 * dar información a quien no debe. Esto devuelve cuántos clientes se
 * registraron hoy, cuánto se cobró y cuántas empresas hay activas: es
 * inteligencia de negocio. Un competidor que lo consultara cada día tendría la
 * curva de crecimiento de MembeGo sin pedir permiso.
 *
 * Sin `METRICAS_SECRET` configurado responde 503 y no consulta nada.
 * Fail-closed: una variable que falta no puede convertir esto en un endpoint
 * abierto.
 * ────────────────────────────────────────────────────────────────────────────
 */
export async function GET(req: NextRequest) {
  const secreto = process.env.METRICAS_SECRET
  if (!secreto || secreto.length < 16) {
    return NextResponse.json(
      { error: 'Métricas no configuradas.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  if (!iguales(req.headers.get('x-metricas-secret') ?? '', secreto)) {
    // 404 y no 401: para quien no tiene la llave, este endpoint no existe.
    return NextResponse.json({ error: 'No encontrado.' }, { status: 404 })
  }

  const m = await leerMetricas()
  const formato = req.nextUrl.searchParams.get('formato')

  if (formato === 'prometheus') {
    return new NextResponse(aPrometheus(m), {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  }

  return NextResponse.json(
    {
      estado: estadoGeneral(m),
      medidoEn: m.medidoEn,
      negocio: { ...m.negocio, variacionVisitasPct: variacionVisitas(m.negocio) },
      sistema: { ...m.sistema, saturacionConexiones: saturacionConexiones(m.sistema) },
      // Lo que no se pudo medir se dice. Una métrica ausente mostrada como
      // cero es una mentira, y las mentiras en un panel de operaciones se
      // creen justo el día que importan.
      noMedido: m.fallos,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

/** Comparación en tiempo constante. La longitud se filtra; el contenido no. */
function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let dif = 0
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return dif === 0
}

/**
 * Formato de exposición de Prometheus.
 *
 * Se ofrece porque es el idioma que hablan Grafana Cloud, Better Stack y
 * cualquier recolector serio, y porque escribirlo son treinta líneas. Sin esto,
 * conectar MembeGo a un panel de métricas exigiría un adaptador intermedio.
 *
 * Todo son `gauge` y ninguno `counter`: un contador de Prometheus tiene que ser
 * monótono creciente, y estos números son ventanas móviles de 24 horas que
 * suben y bajan. Declararlos `counter` haría que `rate()` diera resultados sin
 * sentido — un error sutil que después nadie encuentra.
 */
function aPrometheus(m: Metricas): string {
  const lineas: string[] = []
  const g = (nombre: string, ayuda: string, valor: number | null) => {
    if (valor === null || !Number.isFinite(valor)) return
    lineas.push(`# HELP membego_${nombre} ${ayuda}`)
    lineas.push(`# TYPE membego_${nombre} gauge`)
    lineas.push(`membego_${nombre} ${valor}`)
  }

  const n = m.negocio
  g('visitas_24h', 'Visitas registradas en las ultimas 24 h.', n.visitas24h)
  g('visitas_previas_24h', 'Visitas de las 24 h anteriores, para comparar.', n.visitasPrevias24h)
  g('transacciones_24h', 'Transacciones creadas en las ultimas 24 h.', n.transacciones24h)
  g('clientes_nuevos_24h', 'Clientes dados de alta en las ultimas 24 h.', n.clientesNuevos24h)
  g('pagos_aprobados_24h', 'Pagos aprobados por pasarela en 24 h.', n.pagosAprobados24h)
  g('pagos_rechazados_24h', 'Pagos rechazados por pasarela en 24 h.', n.pagosRechazados24h)
  g(
    'pagos_sin_resolver',
    'Cobros iniciados hace mas de 1 h que siguen sin resolverse. Cada uno es un cliente colgado.',
    n.pagosSinResolver
  )
  g('empresas_activas', 'Empresas activas, sin contar las de practica.', n.empresasActivas)
  g('notificaciones_24h', 'Notificaciones creadas en 24 h.', n.notificaciones24h)

  const s = m.sistema
  g('bd_viva', '1 si la base de datos responde.', s.bdViva ? 1 : 0)
  g('bd_latencia_ms', 'Latencia de una consulta trivial contra Postgres.', s.latenciaBdMs)
  g('conexiones_abiertas', 'Conexiones abiertas contra Postgres.', s.conexiones)
  g('conexiones_max', 'Limite de conexiones del servidor.', s.conexionesMax)
  g('conexiones_saturacion', 'Fraccion del limite de conexiones en uso (0-1).', saturacionConexiones(s))
  g(
    'indices_invalidos',
    'Indices en estado invalido (una creacion CONCURRENTLY que se corto).',
    s.indicesInvalidos
  )
  g('metricas_no_medidas', 'Cuantos bloques de metricas no se pudieron leer.', m.fallos.length)

  return lineas.join('\n') + '\n'
}
