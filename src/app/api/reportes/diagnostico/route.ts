import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { FULL_ADMIN_ROLES } from '@/types'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { puedeFuncion, requireSection } from '@/lib/auth/guards'
import { zonaSegura } from '@/lib/zona-horaria'
import { leerRango } from '@/modules/reportes/rango'
import { getReporte } from '@/modules/reportes/queries'
import { misPreferenciasReportes } from '@/modules/reportes/preferenciasActions'
import { paymentSessionLimiter, getClientIdentifier } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * `getReporte` abre una transacción con 20 s para arrancar y 45 s para
 * terminar. Con el corte por defecto de la plataforma, la sonda moriría antes
 * que el propio paso que viene a medir — y el resultado sería un timeout de la
 * sonda disfrazado de timeout del reporte.
 */
export const maxDuration = 90

/**
 * SONDA DE REPORTES — qué paso de la pantalla falla, y cuánto tarda cada uno.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 *
 * `/admin/reportes` lleva días cayéndose en producción con «No se pudo cargar
 * esta sección» y un número: 3403005817, 1087123417, 2878041529. Ese número es
 * el `digest` de Next —un hash del mensaje MÁS el stack—, así que cambia con
 * cada despliegue aunque el error sea el mismo, y no se puede invertir: no dice
 * nada de qué pasó.
 *
 * Mientras tanto, la pantalla es una composición de siete pasos y CUALQUIERA
 * de ellos tumba el render entero. Desde fuera los siete producen exactamente
 * el mismo cartel. Se descartaron tres hipótesis a ciegas —la migración de la
 * Fase 11, el ambiente de la pasarela, la zona horaria de la empresa— y cada
 * descarte costó un viaje de ida y vuelta con el dueño de la plataforma
 * delante de una pantalla rota.
 *
 * Esto hace lo que la sonda de CardNET (`/api/pagos/cardnet-token/estado`) hizo
 * con aquel misterio: recorre los MISMOS pasos que la página, en el MISMO
 * orden, midiendo y atrapando cada uno por separado, y devuelve qué falló y
 * cuánto tardó. Una pregunta que costaba un despliegue pasa a costar una URL.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO REDIRIGE, INFORMA
 *
 * La página usa `requireCompanyContext`, que ante una empresa que no cuadra
 * hace `redirect()`. Aquí eso sería inútil —un 307 no dice qué empresa faltaba—
 * así que la resolución se hace a mano y el problema sale como dato.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUIÉN LA VE
 *
 * `FULL_ADMIN_ROLES`, como la sonda de pagos. Devuelve mensajes de error del
 * servidor sin recortar —es justo lo que hace falta— y eso no es para el
 * equipo de mostrador.
 */

interface Paso {
  paso: string
  ok: boolean
  ms: number
  detalle?: unknown
  error?: { nombre: string; codigo?: string; mensaje: string; pila?: string[] }
}

function describirError(e: unknown): Paso['error'] {
  const err = (e ?? {}) as Partial<Error> & { code?: unknown }
  return {
    nombre: String(err.name ?? typeof e),
    ...(err.code != null ? { codigo: String(err.code) } : {}),
    mensaje: String(err.message ?? e).replace(/\s+/g, ' ').slice(0, 600),
    // Las tres primeras líneas bastan para situarlo; el stack entero de
    // producción está minificado y solo añade ruido.
    pila: String(err.stack ?? '')
      .split('\n')
      .slice(1, 4)
      .map((l) => l.trim()),
  }
}

async function medir<T>(
  paso: string,
  fn: () => Promise<T>,
  detallar?: (v: T) => unknown
): Promise<{ registro: Paso; valor: T | null }> {
  const t0 = Date.now()
  try {
    const valor = await fn()
    return {
      registro: { paso, ok: true, ms: Date.now() - t0, detalle: detallar?.(valor) },
      valor,
    }
  } catch (e) {
    return { registro: { paso, ok: false, ms: Date.now() - t0, error: describirError(e) }, valor: null }
  }
}

export async function GET(req: NextRequest) {
  if (!(await paymentSessionLimiter(getClientIdentifier(req)))) {
    return NextResponse.json({ error: 'Demasiadas consultas. Espera un momento.' }, { status: 429 })
  }

  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Inicia sesión.' }, { status: 401 })
  if (!FULL_ADMIN_ROLES.includes(user.metadata.role)) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  }

  const pasos: Paso[] = []
  const companyId = user.metadata.companyId ?? null

  pasos.push({
    paso: '0 · sesión',
    ok: Boolean(companyId),
    ms: 0,
    detalle: {
      rol: user.metadata.role,
      companyId,
      dbUserId: user.metadata.dbUserId ?? null,
    },
    ...(companyId
      ? {}
      : {
          error: {
            nombre: 'SinEmpresaActiva',
            mensaje: 'La sesión no trae companyId: la página redirige antes de llegar al reporte.',
          },
        }),
  })

  if (!companyId) return NextResponse.json({ pasos })

  // 1 · La empresa existe (lo que comprueba `requireCompanyContext`).
  const { registro: r1 } = await medir(
    '1 · empresa existe',
    () =>
      sinEmpresa('sonda reportes: empresa activa', (tx) =>
        tx.company.findUnique({ where: { id: companyId }, select: { id: true } })
      ),
    (v) => ({ encontrada: v !== null })
  )
  pasos.push(r1)

  // 2 · Nombre y zona horaria. La página lo pide con `.catch(() => null)`, así
  //     que aquí es donde se ve si ese catch estaba tapando algo.
  const { registro: r2, valor: empresa } = await medir(
    '2 · nombre y zona horaria',
    () =>
      conEmpresa(companyId, (tx) =>
        tx.company.findUnique({
          where: { id: companyId },
          select: { name: true, zonaHoraria: true },
        })
      ),
    (v) => ({ name: v?.name ?? null, zonaHoraria: v?.zonaHoraria ?? null })
  )
  pasos.push(r2)

  const zonaCruda = empresa?.zonaHoraria ?? null
  const timeZone = zonaSegura(zonaCruda)

  // 3 · El rango. Puro, pero es quien llama a `Intl` con la zona de la empresa.
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries())
  const { registro: r3, valor: rango } = await medir(
    '3 · rango de fechas',
    async () => leerRango(sp, timeZone),
    (v) => ({
      zonaUsada: timeZone,
      zonaDegradada: zonaCruda !== null && zonaCruda !== timeZone,
      desde: v.desde.toISOString(),
      hasta: v.hasta.toISOString(),
    })
  )
  pasos.push(r3)

  const { registro: r4 } = await medir(
    '4 · preferencias regionales',
    () => getRegionalPrefs(companyId),
    (v) => ({ hay: v !== null })
  )
  pasos.push(r4)

  const { registro: r5, valor: verFinancieros } = await medir(
    '5 · permiso ver_financieros',
    () => puedeFuncion('reportes', 'ver_financieros'),
    (v) => ({ concedido: v })
  )
  pasos.push(r5)

  const { registro: r6 } = await medir(
    '6 · sección actividad',
    async () => (await requireSection('actividad')) !== null,
    (v) => ({ visible: v })
  )
  pasos.push(r6)

  // 7 · EL PASO GORDO. Trece consultas dentro de UNA transacción interactiva,
  //     con `maxWait` 20 s y `timeout` 45 s. Cada consulta va envuelta en
  //     `seguro()` —un fallo suelto no lanza, solo marca `incompleto`— pero la
  //     transacción entera no lo está: un P2028 aquí tumba la página.
  if (rango) {
    const { registro: r7 } = await medir(
      '7 · getReporte (13 consultas en una transacción)',
      () => getReporte(companyId, rango, timeZone, { verFinancieros: verFinancieros !== false }),
      (v) => ({
        incompleto: v.incompleto,
        puntosSerie: v.serie.length,
        porMetodo: v.porMetodo.length,
        porTipo: v.porTipo.length,
        topClientes: v.topClientes.length,
        activasPorPlan: v.activasPorPlan.length,
      })
    )
    pasos.push(r7)
  }

  const { registro: r8 } = await medir(
    '8 · preferencias del usuario (Fase 11)',
    () => misPreferenciasReportes(),
    (v) => ({ columnaDisponible: v.disponible })
  )
  pasos.push(r8)

  const fallidos = pasos.filter((p) => !p.ok)
  return NextResponse.json({
    veredicto:
      fallidos.length === 0
        ? 'Los ocho pasos de la pantalla pasan. Si la página sigue cayendo, el fallo está en el RENDER, no en los datos.'
        : `Falla: ${fallidos.map((p) => p.paso).join(', ')}`,
    msTotal: pasos.reduce((n, p) => n + p.ms, 0),
    pasos,
  })
}
