import { conEmpresa } from '@/lib/tenant'
import { contarColasDePago } from '@/modules/pagos/colasConteo'
import { diaLocal, limiteDiaLocal, sumarDias } from '@/modules/reportes/rango'
import { membresiaVigente } from '@/modules/membresia/vigencia'

// F4.8: métricas del dashboard ejecutivo de la empresa. Módulo interno.
//
// AUDITORÍA 2026-08 (docs/auditoria-clientes-membresias.md). De los números que
// pintaba esta pantalla, seis no eran verdad. Ninguno fallaba por un error de
// cálculo: fallaban porque el mismo concepto estaba definido dos veces en dos
// sitios que nunca se pusieron de acuerdo. Lo que se corrige aquí:
//
// - «Pagos por validar» contaba membresías PENDIENTE, que es «pidió el plan y
//   nunca pagó»: nada que validar. Ahora lo cuenta `modules/pagos/colas.ts`,
//   el MISMO módulo que pinta las pestañas de la pantalla a la que lleva.
// - «Hoy» se calculaba con `setHours` sobre la hora del proceso, que en Vercel
//   es UTC: el día empezaba a las 8 de la noche del día anterior en Santo
//   Domingo. Ahora usa la zona horaria de la empresa, igual que Reportes.
// - «Ingresos estimados» era la lista de precios × membresías activas, con el
//   precio BASE del plan: ignoraba el precio por categoría de vehículo (un SUV
//   grande no paga lo que un sedán) y lo cobrado de verdad. Ahora son dos
//   números distintos y honestos: lo COBRADO y lo RECURRENTE esperado.
// - «Membresía vigente» contaba `estado = ACTIVA` sin mirar la fecha, y nada
//   vence las membresías solas. Ahora se exige también que no haya vencido.

export interface DashboardEjecutivo {
  clientesTotal: number
  clientesNuevos30d: number
  membresiasActivas: number
  porVencer7d: number
  pagosPendientes: number
  seguidores: number
  nuevosSeguidores30d: number
  referidosCompletados: number
  promosActivas: number
  /** Dinero realmente cobrado este mes (membresías con pago confirmado). */
  ingresosCobradosMes: number
  /** Lo que facturarían las membresías vigentes al renovar, a precio de tarifa. */
  recurrenteEsperado: number
  visitasHoy: number
  visitasMes: number
  clientesEnRiesgo: number
  /** Visitas por día, últimos 14 días (viejo → nuevo). */
  visitasPorDia: { fecha: string; total: number }[]
  /** Top 3 promociones por vistas. */
  topPromos: { id: string; titulo: string; vistas: number; guardadas: number }[]
  /** Actividad reciente (auditoría). */
  actividad: { id: string; accion: string; entidadTipo: string; fecha: Date; autor: string | null }[]
  /** Recomendaciones automáticas basadas en los datos. */
  recomendaciones: { texto: string; href: string; cta: string }[]
}

export async function getDashboardEjecutivo(
  companyId: string,
  /**
   * Zona horaria de la empresa (`Company.zonaHoraria`). Es obligatoria a
   * propósito: el valor por defecto anterior era la hora del proceso, y ese
   * silencio fue exactamente el fallo. Quien llame tiene que decir en qué
   * calendario vive el negocio.
   */
  timeZone: string
): Promise<DashboardEjecutivo> {
  return conEmpresa(companyId, async (tx) => {
  const now = new Date()
  const hace30dias = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const en7dias = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  // El día del NEGOCIO, no el del servidor. En Vercel el proceso corre en UTC:
  // con `setHours(0,0,0,0)`, «hoy» empezaba a las 8 de la noche de ayer en
  // Santo Domingo, y las visitas de anoche contaban como de hoy. Las mismas
  // utilidades que ya usaba Reportes — de ahí que las dos pantallas dieran
  // números distintos de las mismas visitas.
  const hoyDia = diaLocal(now, timeZone)
  const inicioHoy = limiteDiaLocal(hoyDia, timeZone)
  const inicioMes = limiteDiaLocal(`${hoyDia.slice(0, 7)}-01`, timeZone)
  const primerDiaSerie = sumarDias(hoyDia, -13)
  const hace14dias = limiteDiaLocal(primerDiaSerie, timeZone)
  const vigente = membresiaVigente(now)

  // Dos lotes de ≤8 queries (antes 16 en un solo Promise.all, que exigía
  // 16 conexiones simultáneas del pool por cada carga del dashboard).
  const [
    clientesTotal,
    clientesNuevos30d,
    membresiasActivas,
    porVencer7d,
    pagosPendientes,
    seguidores,
    nuevosSeguidores30d,
    referidosCompletados,
  ] = await Promise.all([
    tx.cliente.count({ where: { companyId } }),
    tx.cliente.count({ where: { companyId, createdAt: { gte: hace30dias } } }),
    // VIGENTE, no «activa»: se exige además que la fecha no haya pasado, para
    // que un fallo del job de vencimiento no vuelva a inflar este número.
    tx.membership.count({ where: { companyId, ...vigente } }),
    tx.membership.count({
      where: {
        companyId,
        estado: 'ACTIVA',
        fechaVencimiento: { gte: now, lte: en7dias },
      },
    }),
    // El MISMO recuento que pinta las pestañas de /admin/pagos. Antes eran dos
    // consultas distintas con dos criterios distintos, y el aviso del panel
    // mandaba al administrador a una pantalla que decía cero.
    contarColasDePago(companyId).then((c) => c.porValidar),
    tx.companyFollow.count({ where: { companyId } }),
    tx.companyFollow.count({
      where: { companyId, createdAt: { gte: hace30dias } },
    }),
    tx.referido.count({ where: { companyId, estado: 'COMPLETADO' } }),
  ])

  const [
    promosActivas,
    ingresosCobradosMes,
    visitasHoy,
    visitasMes,
    clientesEnRiesgo,
    visitasPorDiaRaw,
    topPromosRaw,
    actividadRaw,
  ] = await Promise.all([
    tx.promocion.count({
      where: { companyId, activo: true, archivada: false },
    }),
    // DINERO COBRADO, no lista de precios. Es la misma fuente que usa
    // /admin/reportes (`montoPagado` de las membresías con pago confirmado),
    // para que las dos pantallas no den cifras distintas del mismo mes.
    tx.membership
      .aggregate({
        where: {
          companyId,
          pagoConfirmado: true,
          // Igual que Reportes: por `fechaPago`, con respaldo a `updatedAt`
          // para los cobros anteriores a esa columna.
          OR: [
            { fechaPago: { gte: inicioMes } },
            { fechaPago: null, updatedAt: { gte: inicioMes } },
          ],
        },
        _sum: { montoPagado: true },
      })
      .then((a) => Number(a._sum.montoPagado ?? 0)),
    tx.visit.count({
      where: { cliente: { companyId }, fechaVisita: { gte: inicioHoy } },
    }),
    tx.visit.count({
      where: { cliente: { companyId }, fechaVisita: { gte: inicioMes } },
    }),
    tx.cliente.count({
      where: {
        companyId,
        memberships: { some: vigente },
        visits: { none: { fechaVisita: { gte: hace30dias } } },
      },
    }),
    // Agrupación por día en la BD: antes se traían todas las visitas de 14
    // días (filas crudas, sin límite) para agruparlas en JS. El día se calcula
    // en la ZONA HORARIA DE LA EMPRESA (`fechaVisita` es timestamp sin zona y
    // guarda UTC), no en la del proceso ni en la de la sesión de la base: con
    // el corte en UTC, una visita de las 9 de la noche caía en el día
    // siguiente. Las claves salen como 'YYYY-MM-DD' para casar exactamente con
    // las del relleno.
    tx.$queryRaw<{ dia: string; total: number }[]>`
      SELECT to_char(v."fechaVisita" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS dia,
             COUNT(*)::int AS total
      FROM "visits" v
      JOIN "clientes" c ON c."id" = v."clienteId"
      WHERE c."companyId" = ${companyId} AND v."fechaVisita" >= ${hace14dias}
      GROUP BY 1
    `.catch(() => [] as { dia: string; total: number }[]),
    tx.promocion.findMany({
      where: { companyId, archivada: false },
      select: {
        id: true,
        titulo: true,
        viewCount: true,
        _count: { select: { guardadaPor: true } },
      },
      orderBy: { viewCount: 'desc' },
      take: 3,
    }),
    tx.auditLog.findMany({
      where: { companyId },
      select: {
        id: true,
        accion: true,
        entidadTipo: true,
        createdAt: true,
        user: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
  ])

  /**
   * RECURRENTE ESPERADO: lo que facturarían al renovar las membresías que hoy
   * están vigentes, a precio de tarifa.
   *
   * Antes esto se llamaba «ingresos estimados» y multiplicaba las membresías
   * activas por el precio BASE del plan. En un car wash que cobra el mismo plan
   * a un precio para sedán y a otro para SUV grande —que es como vende CARTOWN,
   * y para lo que existe `plan_precios_categoria`— ese número está mal por
   * definición, no por redondeo.
   *
   * Cada membresía paga el precio de la categoría del vehículo que protege; si
   * no tiene vehículo asociado (todas las anteriores al rediseño) o su
   * categoría no tiene tarifa propia, cae al precio base del plan. Es el mismo
   * orden de preferencia que aplica el motor de elegibilidad al vender.
   *
   * Va en SQL porque es una agregación con dos saltos (membresía → vehículo →
   * tarifa) y traerla a memoria significaría cargar todas las membresías
   * vigentes en cada carga del panel. Si falla, cae a 0 y el panel lo dice.
   */
  const recurrenteEsperado = await tx
    .$queryRaw<{ total: number }[]>`
      SELECT COALESCE(SUM(COALESCE(tarifa.precio, p.precio)), 0)::float8 AS total
      FROM "memberships" m
      JOIN "plans" p ON p."id" = m."planId"
      LEFT JOIN LATERAL (
        SELECT ppc."precio"
        FROM "membresia_vehiculos" mv
        JOIN "vehiculos" v ON v."id" = mv."vehiculoId"
        JOIN "plan_precios_categoria" ppc
          ON ppc."planId" = m."planId"
         AND ppc."tipoVehiculoId" = v."tipoVehiculoId"
         AND ppc."activo"
        WHERE mv."membershipId" = m."id"
        ORDER BY ppc."precio" DESC
        LIMIT 1
      ) tarifa ON TRUE
      WHERE m."companyId" = ${companyId}
        AND m."estado" = 'ACTIVA'
        AND (m."fechaVencimiento" IS NULL OR m."fechaVencimiento" >= ${now})
    `
    .then((filas) => Number(filas[0]?.total ?? 0))
    .catch((e) => {
      console.error('[dashboard] recurrente esperado', e)
      return 0
    })

  // Visitas agrupadas por día (14 días), rellenando días sin visitas. Los días
  // son los del NEGOCIO: la consulta convierte a su zona horaria y el relleno
  // recorre el calendario local, así que las barras coinciden con lo que la
  // gente del mostrador recuerda de cada día.
  const porDia = new Map<string, number>()
  for (let i = 0; i < 14; i++) porDia.set(sumarDias(primerDiaSerie, i), 0)
  for (const row of visitasPorDiaRaw) {
    if (porDia.has(row.dia)) porDia.set(row.dia, (porDia.get(row.dia) ?? 0) + row.total)
  }
  const visitasPorDia = [...porDia.entries()].map(([fecha, total]) => ({
    fecha,
    total,
  }))

  const topPromos = topPromosRaw
    .filter((p) => p.viewCount > 0)
    .map((p) => ({
      id: p.id,
      titulo: p.titulo,
      vistas: p.viewCount,
      guardadas: p._count.guardadaPor,
    }))

  const actividad = actividadRaw.map((a) => ({
    id: a.id,
    accion: a.accion,
    entidadTipo: a.entidadTipo,
    fecha: a.createdAt,
    autor: a.user?.name ?? null,
  }))

  // ── Recomendaciones automáticas (BI simple, basado en reglas) ─────────────
  const recomendaciones: DashboardEjecutivo['recomendaciones'] = []
  if (pagosPendientes > 0) {
    recomendaciones.push({
      texto: `Tienes ${pagosPendientes} pago(s) esperando validación — cada hora de espera es un cliente frenado.`,
      href: '/admin/pagos',
      cta: 'Validar pagos',
    })
  }
  if (porVencer7d > 0) {
    recomendaciones.push({
      texto: `${porVencer7d} membresía(s) vencen esta semana. Ejecuta las automatizaciones para recordarles renovar.`,
      href: '/admin/automatizaciones',
      cta: 'Automatizaciones',
    })
  }
  if (clientesEnRiesgo > 0) {
    recomendaciones.push({
      texto: `${clientesEnRiesgo} cliente(s) con membresía activa llevan 30 días sin visitarte. Envíales un incentivo segmentado.`,
      href: '/admin/notificaciones',
      cta: 'Notificar inactivos',
    })
  }
  if (topPromos.length > 0) {
    recomendaciones.push({
      texto: `"${topPromos[0].titulo}" es tu promoción más vista (${topPromos[0].vistas} vistas). Considera duplicarla o extender su vigencia.`,
      href: '/admin/promociones',
      cta: 'Ver promociones',
    })
  }
  if (promosActivas === 0) {
    recomendaciones.push({
      texto: 'No tienes promociones activas: tus seguidores no reciben novedades. Publica una para reactivar el interés.',
      href: '/admin/promociones/nuevo',
      cta: 'Crear promoción',
    })
  }
  if (nuevosSeguidores30d === 0 && seguidores > 0) {
    recomendaciones.push({
      texto: 'Sin seguidores nuevos este mes. Comparte tu página pública o crea una campaña para atraer audiencia.',
      href: '/admin/perfil',
      cta: 'Mi perfil público',
    })
  }

  return {
    clientesTotal,
    clientesNuevos30d,
    membresiasActivas,
    porVencer7d,
    pagosPendientes,
    seguidores,
    nuevosSeguidores30d,
    referidosCompletados,
    promosActivas,
    ingresosCobradosMes,
    recurrenteEsperado,
    visitasHoy,
    visitasMes,
    clientesEnRiesgo,
    visitasPorDia,
    topPromos,
    actividad,
    recomendaciones,
  }
  })
}
