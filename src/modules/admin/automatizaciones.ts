import { conEmpresa, sinEmpresa, type Tx } from '@/lib/tenant'
import { membresiaVigente } from '@/modules/membresia/vigencia'
import { getUmbralesRetencion } from '@/modules/riesgo/umbrales'

// F4.7: motor de automatizaciones. Reglas basadas en tiempo que generan
// notificaciones a clientes. Sin tablas nuevas: la deduplicación usa un
// marcador único en `href` (si ya existe una notificación con ese href para
// el usuario, la regla no se repite).
// Módulo interno sin 'use server' — se invoca desde una action guarded y
// desde el endpoint de cron protegido.

export interface ResultadoAutomatizaciones {
  cumpleanos: number
  porVencer: number
  inactivos: number
  /** Bloque 3: clientes que el semáforo dio por dormidos y no reaccionaron. */
  vigilancia: number
}

/** userIds por supabaseId de clientes (solo los que tienen cuenta). */
async function mapaUserIds(tx: Tx, supabaseIds: string[]): Promise<Map<string, string>> {
  if (supabaseIds.length === 0) return new Map()
  const users = await tx.user.findMany({
    where: { supabaseId: { in: [...new Set(supabaseIds)] } },
    select: { id: true, supabaseId: true },
  })
  return new Map(users.map((u) => [u.supabaseId, u.id]))
}

interface NotifPendiente {
  userId: string
  tipo: 'SISTEMA' | 'MEMBRESIA_POR_VENCER'
  titulo: string
  mensaje: string
  href: string
}

/**
 * Crea en lote las notificaciones cuyo par (userId, href) no exista aún.
 * 2 queries por lote (antes: findFirst + create POR USUARIO, es decir,
 * 2×clientes round-trips que retenían conexiones durante todo el cron).
 */
async function notificarLote(tx: Tx, items: NotifPendiente[]): Promise<number> {
  if (items.length === 0) return 0
  const existentes = await tx.notificacion.findMany({
    where: {
      userId: { in: [...new Set(items.map((i) => i.userId))] },
      href: { in: [...new Set(items.map((i) => i.href))] },
    },
    select: { userId: true, href: true },
  })
  const ya = new Set(existentes.map((e) => `${e.userId}|${e.href}`))
  const nuevos = items.filter((i) => !ya.has(`${i.userId}|${i.href}`))
  if (nuevos.length === 0) return 0
  const res = await tx.notificacion.createMany({ data: nuevos })
  return res.count
}

/**
 * Ejecuta las 3 reglas de automatización para una empresa. Idempotente:
 * puede correrse cuantas veces se quiera sin duplicar avisos.
 */
export async function ejecutarAutomatizacionesEmpresa(
  companyId: string
): Promise<ResultadoAutomatizaciones> {
  return conEmpresa(companyId, async (tx) => {
    const now = new Date()
    const hoyMes = now.getMonth()
    const hoyDia = now.getDate()
    const anio = now.getFullYear()
    const en7dias = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { name: true },
    })
    if (!company) return { cumpleanos: 0, porVencer: 0, inactivos: 0, vigilancia: 0 }

    let cumpleanos = 0
    let porVencer = 0
    let inactivos = 0
    let vigilancia = 0

    // ── Regla 1: cumpleaños hoy → felicitación (una vez por año) ──────────────
    const conNacimiento = await tx.cliente.findMany({
      where: { companyId, fechaNacimiento: { not: null } },
      select: { supabaseId: true, fechaNacimiento: true },
    })
    const cumpleaneros = conNacimiento.filter((c) => {
      const f = new Date(c.fechaNacimiento!)
      return f.getMonth() === hoyMes && f.getDate() === hoyDia
    })
    if (cumpleaneros.length > 0) {
      const usuarios = await mapaUserIds(tx, cumpleaneros.map((c) => c.supabaseId))
      cumpleanos = await notificarLote(
        tx,
        cumpleaneros.flatMap((c) => {
          const userId = usuarios.get(c.supabaseId)
          if (!userId) return []
          return [{
            userId,
            tipo: 'SISTEMA' as const,
            titulo: `¡Feliz cumpleaños! 🎉`,
            mensaje: `${company.name} te desea un excelente día. Revisa tus promociones: puede haber un detalle para ti.`,
            // companyId en el marcador: un cliente con cuenta en varias empresas
            // debe recibir la felicitación de CADA una (el dedupe es por userId+href).
            href: `/cliente/promociones?auto=cumple-${anio}-${companyId}`,
          }]
        })
      )
    }

    // ── Regla 2: membresía por vencer (7 días) → recordatorio ─────────────────
    const proximasAVencer = await tx.membership.findMany({
      where: {
        companyId,
        estado: 'ACTIVA',
        fechaVencimiento: { gte: now, lte: en7dias },
      },
      select: {
        id: true,
        fechaVencimiento: true,
        cliente: { select: { supabaseId: true } },
      },
    })
    if (proximasAVencer.length > 0) {
      const usuarios = await mapaUserIds(tx, proximasAVencer.map((m) => m.cliente.supabaseId))
      porVencer = await notificarLote(
        tx,
        proximasAVencer.flatMap((m) => {
          const userId = usuarios.get(m.cliente.supabaseId)
          if (!userId || !m.fechaVencimiento) return []
          const fechaStr = new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', dateStyle: 'long' }).format(
            m.fechaVencimiento
          )
          const marca = m.fechaVencimiento.toISOString().slice(0, 10)
          return [{
            userId,
            tipo: 'MEMBRESIA_POR_VENCER' as const,
            titulo: 'Tu membresía está por vencer',
            mensaje: `Tu membresía en ${company.name} vence el ${fechaStr}. Renuévala para no perder tus beneficios.`,
            href: `/cliente/pagos?auto=vence-${m.id}-${marca}`,
          }]
        })
      )
    }

    // ── Regla 3: sin visitas en 30 días → incentivo (una vez al mes) ──────────
    // Con el umbral de ESTA empresa, no con un 30 fijo: la frecuencia normal de
    // visita de un car wash y la de un restaurante no se parecen, y el mismo
    // número los trataba igual.
    const umbrales = await getUmbralesRetencion(companyId)
    const limiteRiesgo = new Date(now.getTime() - umbrales.riesgoDias * 86_400_000)
    const inactivosRows = await tx.cliente.findMany({
      where: {
        companyId,
        // VIGENTE, no solo activa: a quien ya se le venció no se le dice «tu
        // membresía sigue activa, pásate» — es la clase de mensaje que hace
        // que el cliente venga y se lleve un no en el mostrador.
        memberships: { some: membresiaVigente(now) },
        visits: { none: { fechaVisita: { gte: limiteRiesgo } } },
      },
      select: { supabaseId: true },
    })
    if (inactivosRows.length > 0) {
      const usuarios = await mapaUserIds(tx, inactivosRows.map((c) => c.supabaseId))
      const mes = String(now.getMonth() + 1).padStart(2, '0')
      inactivos = await notificarLote(
        tx,
        inactivosRows.flatMap((c) => {
          const userId = usuarios.get(c.supabaseId)
          if (!userId) return []
          return [{
            userId,
            tipo: 'SISTEMA' as const,
            titulo: 'Te extrañamos 👋',
            mensaje: `Hace más de ${umbrales.riesgoDias} días que no visitas ${company.name}. Tu membresía sigue vigente: pásate y aprovecha tus beneficios.`,
            // companyId en el marcador: el incentivo mensual es por empresa.
            href: `/cliente/promociones?auto=inactivo-${anio}-${mes}-${companyId}`,
          }]
        })
      )
    }

    // ── Regla 4 · VIGILANCIA: el cliente al que ya se le avisó y no volvió ────
    //
    // Las tres reglas anteriores le hablan al CLIENTE. Esta le habla al
    // NEGOCIO, y por eso existe: un aviso automático que no funciona no deja
    // ningún rastro: el cliente simplemente no vuelve, y nadie se entera hasta
    // que se mira un informe trimestral. Cuando alguien cruza el umbral de
    // «dormido» teniendo cosas pagadas dentro, deja de ser un mensaje más y
    // pasa a ser una llamada que alguien tiene que hacer.
    const dormidos = await tx.cliente.count({
      where: {
        companyId,
        memberships: {
          some: {
            ...membresiaVigente(now),
            // Con saldo: un dormido sin nada dentro se recupera con marketing;
            // uno con usos pagados sin consumir es dinero que el negocio debe.
            OR: [{ plan: { esIlimitado: true } }, { lavadosRestantes: { gt: 0 } }],
          },
        },
        visits: { none: { fechaVisita: { gte: new Date(now.getTime() - umbrales.dormidoDias * 86_400_000) } } },
      },
    })
    if (dormidos > 0) {
      const admins = await tx.user.findMany({
        where: { companyId, role: { in: ['ADMIN_EMPRESA', 'ADMINISTRADOR', 'GERENTE'] } },
        select: { id: true },
      })
      const semana = `${anio}-S${Math.ceil(((now.getTime() - Date.UTC(anio, 0, 1)) / 86_400_000 + 1) / 7)}`
      vigilancia = await notificarLote(
        tx,
        admins.map((a) => ({
          userId: a.id,
          tipo: 'SISTEMA' as const,
          titulo: `${dormidos} cliente(s) llevan ${umbrales.dormidoDias} días sin venir`,
          mensaje:
            'Tienen membresía vigente y usos pagados sin consumir. Ya recibieron el recordatorio automático y no volvieron: toca llamarlos.',
          // Una vez por semana y por empresa: un aviso diario sobre el mismo
          // problema se convierte en ruido, y el ruido se ignora.
          href: `/admin/riesgo?sinVisitas=${umbrales.dormidoDias >= 60 ? 60 : 30}&vence=0&usos=con&auto=vigilancia-${semana}-${companyId}`,
        }))
      )
    }

    return { cumpleanos, porVencer, inactivos, vigilancia }
  })
}

export interface RepartoAutomatizaciones {
  empresas: number
  encoladas: number
  enLinea: number
}

/**
 * REPARTE las automatizaciones: un trabajo por empresa (auditoría · C-06).
 *
 * Antes esto era un bucle `for` con `await` por empresa dentro del cron, que
 * tiene 60 segundos. Con mil empresas a ~200 ms cada una son 200 segundos: la
 * función se cortaba a la mitad y **las empresas restantes no se procesaban
 * nunca**. Sin error visible: el `catch` de dentro solo escribía en consola y
 * el cron devolvía 200 como si todo hubiera ido bien. Cumpleaños, avisos de
 * vencimiento y recuperación de inactivos simplemente dejaban de existir para
 * la mayoría del negocio.
 *
 * Ahora el cron solo lee la lista y encola. Cada empresa se procesa en su
 * propia invocación, con su propio presupuesto de tiempo y con reintentos si
 * falla. El cron termina en un segundo aunque haya diez mil empresas.
 *
 * Las empresas de DEMOSTRACIÓN quedan fuera: sus automatizaciones no le sirven
 * a nadie y gastarían cuota de la cola.
 */
export async function ejecutarAutomatizacionesGlobal(): Promise<RepartoAutomatizaciones> {
  const companies = await sinEmpresa('listar todas las empresas activas (no demo) para repartir', (tx) =>
    tx.company.findMany({
      where: { isActive: true, esDemo: false },
      select: { id: true },
    }).catch(() => tx.company.findMany({ where: { isActive: true }, select: { id: true } }))
  )

  const { encolar } = await import('@/modules/jobs/cola')
  let encoladas = 0
  let enLinea = 0
  for (const c of companies) {
    try {
      const via = await encolar({ tipo: 'automatizaciones', companyId: c.id })
      if (via === 'cola') encoladas++
      else enLinea++
    } catch (e) {
      // Que una empresa no se pueda encolar no puede impedir que se encolen
      // las demás: ese era justo el fallo del bucle anterior.
      console.error('[automatizaciones] no se pudo encolar', c.id, e)
    }
  }
  return { empresas: companies.length, encoladas, enLinea }
}
