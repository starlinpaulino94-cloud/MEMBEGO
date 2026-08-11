import { cache } from 'react'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'

/**
 * `getCampanaActiva(companyId)` vivía aquí y ya no: su único llamador era la
 * pantalla de «Invita y gana», que preguntaba por la campaña de la EMPRESA
 * ACTIVA. Ahora pregunta por las de todos sus negocios con
 * `misCampanasDisponibles`, así que la vieja quedó sin nadie que la llamara.
 * Se borra en lugar de dejarla: una función que devuelve «la campaña de la
 * empresa activa» es justo la forma de pensar que esta fase quita de en medio.
 */

/**
 * LAS CAMPAÑAS DE TODOS SUS NEGOCIOS, cada una con SU ficha.
 *
 * Invitar es de un negocio concreto: el premio lo pone él y la atribución va
 * por el código de la ficha de esa empresa. Por eso esto no devuelve «la
 * campaña de la persona» sino una lista de pares (campaña, ficha) — y la
 * pantalla deja elegir.
 *
 * Antes solo existía la de la empresa activa: quien es cliente de tres
 * negocios podía invitar al que tuviera abierto y a ninguno más, aunque su
 * ficha y su código en los otros dos existieran igual.
 */
export async function misCampanasDisponibles(supabaseId: string) {
  const ahora = new Date()
  const fichas = await sinEmpresa('invitaciones: mis fichas para buscar sus campañas', (tx) =>
    tx.cliente.findMany({
      where: { supabaseId },
      select: {
        id: true,
        company: { select: { id: true, name: true, slug: true, logoUrl: true } },
      },
    })
  ).catch(() => [])
  if (fichas.length === 0) return []

  const campanas = await sinEmpresa('invitaciones: campañas vivas de mis empresas', (tx) =>
    tx.campanaInvitacion.findMany({
      where: {
        // Acotado a SUS empresas: la lista sale de sus fichas, no de un
        // parámetro de la vista.
        companyId: { in: fichas.map((f) => f.company.id) },
        estado: 'ACTIVA',
        fechaInicio: { lte: ahora },
        fechaFin: { gte: ahora },
      },
      orderBy: { orden: 'asc' },
    })
  ).catch(() => [])

  // Una por empresa: la primera por `orden`, igual que hacía la pantalla.
  const vistas = new Set<string>()
  const salida = []
  for (const campana of campanas) {
    if (vistas.has(campana.companyId)) continue
    const ficha = fichas.find((f) => f.company.id === campana.companyId)
    if (!ficha) continue
    vistas.add(campana.companyId)
    salida.push({ campana, clienteId: ficha.id, company: ficha.company })
  }
  return salida
}

const CAMPANA_CON_EMPRESA = {
  company: {
    select: { id: true, name: true, slug: true, logoUrl: true, colorPrimario: true, type: true },
  },
} as const

/**
 * ENLACE CORTO PERSONAL /invitar/[code] — y QUÉ CAMPAÑA PROMETE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA: EL ENLACE NO DECÍA QUÉ OFRECÍA
 *
 * Antes esto resolvía «la campaña que esté ACTIVA en la empresa de esa ficha
 * AHORA MISMO». El enlace no llevaba la campaña dentro, así que el negocio
 * podía cambiarla y todos los enlaces ya compartidos cambiaban con ella: la
 * tarjeta que la gente vio en WhatsApp prometía dos lavados gratis y, al
 * tocarla, la landing ofrecía otra cosa. Nadie tocó el enlace; cambió debajo.
 *
 * Peor con dos campañas activas a la vez: `orderBy: { orden: 'asc' }` elegía
 * una, y cuál dependía de un campo de ordenación pensado para el panel.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AHORA LA CAMPAÑA VIAJA EN EL ENLACE
 *
 * `/invitar/CODIGO?c=<slug-de-campaña>`. Con `c`, se sirve ESA campaña; sin
 * `c` —los enlaces repartidos antes de este cambio—, la activa, como siempre.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS COMPROBACIONES QUE NO SON OPCIONALES
 *
 * 1 · La campaña pedida tiene que ser DE LA MISMA EMPRESA que la ficha del
 *     código. Sin esto, `?c=` sería un parámetro de la URL eligiendo qué
 *     negocio anunciar: cualquiera podría pegar el slug de la campaña de otra
 *     empresa detrás de un código ajeno y publicar una landing con el nombre y
 *     el logo de un negocio que no ofreció nada. La atribución seguiría yendo
 *     al dueño del código.
 *
 * 2 · Tiene que seguir siendo válida (ACTIVA y en fechas). Una campaña
 *     terminada no puede prometer nada; si la de `c` ya venció, se cae a la
 *     activa, que es el comportamiento que había.
 */
export const getCampanaPorCodigoInvitacion = cache(
  async (code: string, campanaSlug?: string | null) => {
    const clean = decodeURIComponent(code).trim()
    if (!clean) return null

    const cliente = await sinEmpresa('invitaciones: resolver cliente por código de invitación (códigos únicos globales)', (tx) =>
      tx.cliente
        .findFirst({
          where: {
            OR: [{ codigoCorto: clean.toUpperCase() }, { codigoReferido: clean }],
          },
          select: { companyId: true, codigoCorto: true, codigoReferido: true },
        })
    ).catch(() => null)
    if (!cliente) return null

    const ahora = new Date()
    const vigente = {
      estado: 'ACTIVA' as const,
      fechaInicio: { lte: ahora },
      fechaFin: { gte: ahora },
    }

    const pedida = campanaSlug?.trim()
      ? await conEmpresa(cliente.companyId, (tx) =>
          tx.campanaInvitacion.findFirst({
            where: {
              slug: campanaSlug.trim(),
              // El `companyId` es la comprobación 1: sin él, `?c=` elegiría de
              // qué negocio hablar.
              companyId: cliente.companyId,
              ...vigente,
            },
            include: CAMPANA_CON_EMPRESA,
          })
        ).catch(() => null)
      : null

    const campana =
      pedida ??
      (await conEmpresa(cliente.companyId, (tx) =>
        tx.campanaInvitacion
          .findFirst({
            where: { companyId: cliente.companyId, ...vigente },
            orderBy: { orden: 'asc' },
            include: CAMPANA_CON_EMPRESA,
          })
      ).catch(() => null))
    if (!campana) return null

    return { campana, ref: cliente.codigoCorto ?? cliente.codigoReferido }
  }
)

// React.cache por el mismo motivo que getCampanaPorCodigoInvitacion.
export const getCampanaBySlug = cache(async (slug: string) => {
  return sinEmpresa('invitaciones: resolver campaña por slug único global', (tx) =>
    tx.campanaInvitacion.findUnique({
      where: { slug },
      include: {
        company: {
          select: { id: true, name: true, slug: true, logoUrl: true, colorPrimario: true, type: true },
        },
      },
    })
  )
})

export async function getProgresoCliente(campanaId: string, clienteId: string) {
  return sinEmpresa('invitaciones: consultar progreso por campana+cliente (sin empresa; panel cliente)', (tx) =>
    tx.invitacionProgreso.findUnique({
      where: { campanaId_clienteId: { campanaId, clienteId } },
    })
  )
}

export async function getProgresoOCrear(campanaId: string, clienteId: string, companyId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.invitacionProgreso.upsert({
      where: { campanaId_clienteId: { campanaId, clienteId } },
      update: {},
      create: { campanaId, clienteId, companyId },
    })
  )
}

export async function getCampanasEmpresa(companyId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.campanaInvitacion.findMany({
      where: { companyId },
      orderBy: [{ estado: 'asc' }, { orden: 'asc' }, { createdAt: 'desc' }],
      include: {
        _count: {
          select: {
            progresos: true,
            eventos: true,
            referidos: true,
          },
        },
      },
    })
  )
}

export interface CampanaDashboard {
  campana: Awaited<ReturnType<typeof getCampanaBySlug>>
  embudoStats: {
    compartidas: number
    enlacesAbiertos: number
    landingVistas: number
    registrosIniciados: number
    registrosCompletados: number
    premiosReclamados: number
    membresiasAdquiridas: number
    primerCanje: number
    conversionFinal: number
  }
  participantes: number
  metasAlcanzadas: number
  premiosReclamados: number
  topCompartidores: { nombre: string; compartidas: number; registros: number }[]
}

export async function getCampanaDashboard(campanaId: string): Promise<CampanaDashboard | null> {
  const campana = await sinEmpresa('invitaciones: buscar campaña por id (empresa desconocida)', (tx) =>
    tx.campanaInvitacion.findUnique({
      where: { id: campanaId },
      include: {
        company: {
          select: { id: true, name: true, slug: true, logoUrl: true, colorPrimario: true, type: true },
        },
      },
    })
  )
  if (!campana) return null

  const [eventosTipo, progresoAgg, topRaw] = await conEmpresa(campana.companyId, (tx) =>
    Promise.all([
      tx.invitacionEvento.groupBy({
        by: ['tipo'],
        where: { campanaId },
        _count: { id: true },
      }),
      tx.invitacionProgreso.aggregate({
        where: { campanaId },
        _count: { _all: true },
        _sum: { registrosCompletados: true },
      }),
      tx.invitacionEvento.groupBy({
        by: ['clienteId'],
        where: { campanaId, tipo: 'COMPARTIDA', clienteId: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
    ])
  )

  const countTipo = (t: string) =>
    eventosTipo.find((e) => e.tipo === t)?._count.id ?? 0

  const topIds = topRaw
    .map((t) => t.clienteId)
    .filter((id): id is string => id !== null)

  const [nombres, metasCount, premiosCount, registrosPorCliente] = await conEmpresa(
    campana.companyId,
    (tx) =>
      Promise.all([
        tx.cliente.findMany({
          where: { id: { in: topIds } },
          select: { id: true, nombre: true },
        }),
        tx.invitacionProgreso.count({ where: { campanaId, metaAlcanzada: true } }),
        tx.invitacionProgreso.count({ where: { campanaId, premioReclamado: true } }),
        tx.invitacionProgreso.findMany({
          where: { campanaId, clienteId: { in: topIds } },
          select: { clienteId: true, registrosCompletados: true },
        }),
      ])
  )

  const nombreDe = new Map(nombres.map((n) => [n.id, n.nombre]))
  const regDe = new Map(registrosPorCliente.map((r) => [r.clienteId, r.registrosCompletados]))

  return {
    campana,
    embudoStats: {
      compartidas: countTipo('COMPARTIDA'),
      enlacesAbiertos: countTipo('ENLACE_ABIERTO'),
      landingVistas: countTipo('LANDING_VISTA'),
      registrosIniciados: countTipo('REGISTRO_INICIADO'),
      registrosCompletados: countTipo('REGISTRO_COMPLETADO'),
      premiosReclamados: countTipo('PREMIO_RECLAMADO'),
      membresiasAdquiridas: countTipo('MEMBRESIA_ADQUIRIDA'),
      primerCanje: countTipo('PRIMER_CANJE'),
      conversionFinal: countTipo('CONVERSION_FINAL'),
    },
    participantes: progresoAgg._count._all,
    metasAlcanzadas: metasCount,
    premiosReclamados: premiosCount,
    topCompartidores: topRaw.map((t) => ({
      nombre: nombreDe.get(t.clienteId!) ?? 'Cliente',
      compartidas: t._count.id,
      registros: regDe.get(t.clienteId!) ?? 0,
    })),
  }
}

/**
 * MVP "Invita y Gana" · Personas que se registraron gracias a un cliente.
 * Fuente: modelo Referido (auditoría de atribución). Excluye los marcados
 * sospechosos por el anti-fraude para no inflar la lista.
 */
export async function getInvitadosPorCliente(clienteId: string, limit = 50) {
  return sinEmpresa('invitaciones: listar referidos de un cliente (panel cliente, cruza sus empresas)', (tx) =>
    tx.referido.findMany({
      where: { referenteClienteId: clienteId, sospechoso: false },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        estado: true,
        recompensaAplicada: true,
        createdAt: true,
        referidoCliente: { select: { nombre: true } },
      },
    })
  )
}

export interface InvitaYGanaStats {
  invitacionesEnviadas: number
  personasRegistradas: number
  recompensasObtenidas: number
  beneficiosActivos: number
}

/**
 * Unificación Referidos → Invita y Gana · "Mi progreso" del cliente.
 * Reutiliza las fuentes existentes (sin estadísticas duplicadas): eventos
 * COMPARTIDA, atribuciones Referido, recompensas del programa
 * (ReferralRecompensa + premios de campaña) y beneficios activos en wallet.
 */
export async function getInvitaYGanaStats(
  clienteId: string,
  companyId: string
): Promise<InvitaYGanaStats> {
  const [compartidas, registrados, recompensas, premiosCampana, activos] =
    await conEmpresa(companyId, (tx) =>
      Promise.all([
        tx.invitacionEvento.count({
          where: { clienteId, companyId, tipo: 'COMPARTIDA' },
        }),
        tx.referido.count({
          where: { referenteClienteId: clienteId, sospechoso: false },
        }),
        tx.referralRecompensa.count({
          where: { referenteClienteId: clienteId, companyId },
        }),
        tx.invitacionProgreso.count({
          where: { clienteId, companyId, premioReclamado: true },
        }),
        tx.productoCompra.count({
          where: { clienteId, companyId, estado: 'ACTIVA' },
        }),
      ])
    )

  return {
    invitacionesEnviadas: compartidas,
    personasRegistradas: registrados,
    recompensasObtenidas: recompensas + premiosCampana,
    beneficiosActivos: activos,
  }
}
