'use server'

import { revalidatePath } from 'next/cache'
import { conEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { requireRole } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { ADMIN_ROLES } from '@/types'
import { COSTO_RULETA } from '@/lib/gamificacion'
import { getGamificacion } from '@/modules/engagement/gamificacion'
import { otorgarBeneficioDirecto } from '@/modules/growth/rewards'

// ─── Cliente: girar la ruleta ───────────────────────────────────────────────

export interface GiroResultado {
  ok: boolean
  error?: string
  gano?: boolean
  premioId?: string | null
  premioNombre?: string
  enWallet?: boolean
  saldoRestante?: number
}

export async function girarRuleta(): Promise<GiroResultado> {
  const user = await getUser()
  const clienteId = user?.metadata.clienteId
  const companyId = user?.metadata.companyId
  if (!user || user.metadata.role !== 'CLIENTE' || !clienteId || !companyId) {
    return { ok: false, error: 'No autorizado.' }
  }

  const game = await getGamificacion(clienteId, companyId)
  if (!game) return { ok: false, error: 'No se pudo calcular tu saldo.' }
  if (game.saldo < COSTO_RULETA) {
    return { ok: false, error: `Necesitas ${COSTO_RULETA} puntos para girar.` }
  }

  const premios = await conEmpresa(companyId, (tx) =>
    tx.ruletaPremio.findMany({
      where: { companyId, activo: true },
      select: { id: true, nombre: true, tipo: true, promocionId: true, probabilidad: true },
    })
  )
  if (premios.length === 0) return { ok: false, error: 'No hay premios disponibles.' }

  // Selección ponderada en el SERVIDOR: el cliente nunca decide el premio.
  const total = premios.reduce((s, p) => s + Math.max(0, p.probabilidad), 0)
  if (total <= 0) return { ok: false, error: 'Configuración de premios inválida.' }
  let r = Math.random() * total
  let elegido = premios[premios.length - 1]
  for (const p of premios) {
    r -= Math.max(0, p.probabilidad)
    if (r <= 0) {
      elegido = p
      break
    }
  }

  // Entrega del premio (si aplica) para guardar el compraId en la jugada.
  let productoCompraId: string | null = null
  let gano = false
  if (elegido.tipo === 'PROMOCION' && elegido.promocionId) {
    productoCompraId = await otorgarBeneficioDirecto({
      companyId,
      clienteId,
      promocionId: elegido.promocionId,
      motivo: `Ruleta: ${elegido.nombre}`,
    })
    gano = productoCompraId !== null
  }

  try {
    await conEmpresa(companyId, (tx) =>
      tx.ruletaJugada.create({
        data: {
          companyId,
          clienteId,
          costoPuntos: COSTO_RULETA,
          premioId: elegido.id,
          premioNombre: elegido.nombre,
          gano,
          productoCompraId,
        },
      })
    )
  } catch (e) {
    console.error('[ruleta] girar:', e)
    return { ok: false, error: 'No se pudo completar el giro.' }
  }

  revalidatePath('/mis-membresias')
  revalidatePath('/cliente/ruleta')

  return {
    ok: true,
    gano,
    premioId: elegido.id,
    premioNombre: elegido.nombre,
    enWallet: gano,
    saldoRestante: game.saldo - COSTO_RULETA,
  }
}

// ─── Admin: CRUD de premios ─────────────────────────────────────────────────

export interface RuletaPremioState {
  error?: string
  success?: boolean
}

function s(fd: FormData, k: string): string {
  return String(fd.get(k) ?? '').trim()
}

function parse(fd: FormData): { data: RuletaPremioData } | { error: string } {
  const nombre = s(fd, 'nombre')
  if (!nombre) return { error: 'El nombre es obligatorio.' }

  const tipo = s(fd, 'tipo') === 'NADA' ? 'NADA' : 'PROMOCION'
  const promocionId = s(fd, 'promocionId') || null
  if (tipo === 'PROMOCION' && !promocionId) {
    return { error: 'Elige la promoción que se entrega como premio (o usa el tipo "Sigue participando").' }
  }

  const probabilidad = Math.max(1, Math.floor(Number(s(fd, 'probabilidad') || '1')) || 1)
  const orden = Math.max(0, Math.floor(Number(s(fd, 'orden') || '0')) || 0)

  return {
    data: {
      nombre: nombre.slice(0, 60),
      tipo,
      promocionId: tipo === 'PROMOCION' ? promocionId : null,
      probabilidad,
      color: s(fd, 'color') || null,
      orden,
    },
  }
}

interface RuletaPremioData {
  nombre: string
  tipo: 'PROMOCION' | 'NADA'
  promocionId: string | null
  probabilidad: number
  color: string | null
  orden: number
}

function revalidar() {
  revalidatePath('/admin/gamificacion')
  revalidatePath('/cliente/ruleta')
  revalidatePath('/mis-membresias')
}

export async function crearRuletaPremio(
  _prev: RuletaPremioState,
  fd: FormData
): Promise<RuletaPremioState> {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await resolveCompanyId(user, fd)
  if (!companyId) return { error: 'Empresa requerida.' }

  const parsed = parse(fd)
  if ('error' in parsed) return { error: parsed.error }

  // Si vincula una promoción, debe ser de la misma empresa.
  if (parsed.data.promocionId) {
    const promocionId = parsed.data.promocionId
    const promo = await conEmpresa(companyId, (tx) =>
      tx.promocion.findFirst({
        where: { id: promocionId, companyId },
        select: { id: true },
      })
    )
    if (!promo) return { error: 'Promoción no encontrada.' }
  }

  try {
    await conEmpresa(companyId, (tx) =>
      tx.ruletaPremio.create({ data: { companyId, ...parsed.data } })
    )
    revalidar()
    return { success: true }
  } catch (e) {
    console.error('[ruleta] crear premio:', e)
    return { error: 'No se pudo crear el premio.' }
  }
}

export async function actualizarRuletaPremio(
  _prev: RuletaPremioState,
  fd: FormData
): Promise<RuletaPremioState> {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await resolveCompanyId(user, fd)
  if (!companyId) return { error: 'Empresa requerida.' }
  const id = s(fd, 'id')
  if (!id) return { error: 'Premio no encontrado.' }

  const existe = await conEmpresa(companyId, (tx) =>
    tx.ruletaPremio.findFirst({
      where: { id, companyId },
      select: { id: true },
    })
  )
  if (!existe) return { error: 'Premio no encontrado.' }

  const parsed = parse(fd)
  if ('error' in parsed) return { error: parsed.error }

  if (parsed.data.promocionId) {
    const promocionId = parsed.data.promocionId
    const promo = await conEmpresa(companyId, (tx) =>
      tx.promocion.findFirst({
        where: { id: promocionId, companyId },
        select: { id: true },
      })
    )
    if (!promo) return { error: 'Promoción no encontrada.' }
  }

  try {
    await conEmpresa(companyId, (tx) =>
      tx.ruletaPremio.update({ where: { id }, data: parsed.data })
    )
    revalidar()
    return { success: true }
  } catch (e) {
    console.error('[ruleta] actualizar premio:', e)
    return { error: 'No se pudo actualizar el premio.' }
  }
}

export async function cambiarActivoRuletaPremio(
  id: string,
  activo: boolean
): Promise<{ ok: boolean }> {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await resolveCompanyId(user)
  if (!companyId) return { ok: false }
  const res = await conEmpresa(companyId, (tx) =>
    tx.ruletaPremio.updateMany({ where: { id, companyId }, data: { activo } })
  )
  revalidar()
  return { ok: res.count > 0 }
}

export async function eliminarRuletaPremio(id: string): Promise<{ ok: boolean }> {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await resolveCompanyId(user)
  if (!companyId) return { ok: false }
  const res = await conEmpresa(companyId, (tx) =>
    tx.ruletaPremio.deleteMany({ where: { id, companyId } })
  )
  revalidar()
  return { ok: res.count > 0 }
}
