import { prisma } from '@/lib/prisma'
import { sinEmpresa } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEmpresaPrincipal } from '@/modules/marketplace/marcaUnica'
import { otorgarBienvenidaDirecta } from '@/modules/invitaciones/beneficios'
import { vincularRegalosPorContacto } from '@/modules/regalos/entrega'
import { capturarCanalRegistro } from '@/modules/adquisicion/canal'
import type { AppRole, SessionUser } from '@/types'
import { anotarFallo } from '@/lib/prisma-errors'

/**
 * AUTO-REPARACIÓN de sesiones incompletas.
 *
 * Una sesión puede llegar sin `clienteId`/`companyId` (o incluso sin `role`)
 * en el app_metadata por varios caminos reales:
 *  - Registro GENERAL (/registro/cuenta): crea la cuenta sin empresa a
 *    propósito — pero en modo marca única el cliente debe pertenecer a la
 *    empresa principal.
 *  - Un alta donde `updateUserById` (app_metadata) falló tras crear las filas.
 *  - Login con Google de una cuenta que nunca completó su afiliación.
 *
 * Sin reparación, CADA módulo del cliente falla distinto ("cuenta no
 * configurada", "No autorizado", crash). Este helper — invocado una vez por
 * request desde getUser(), solo cuando falta contexto — deja la cuenta
 * consistente:
 *  1. Staff con metadata rota → restaura rol y empresa desde la fila User.
 *  2. Cliente con ficha existente → reapunta metadata a su ficha más reciente.
 *  3. Cliente SIN ficha → lo afilia a la empresa principal (marca única):
 *     crea la ficha, la sigue, entrega el regalo de bienvenida y reclama los
 *     regalos P2P enviados a su correo.
 *
 * Nunca lanza: si no se puede reparar, devuelve la sesión tal cual (las
 * páginas muestran su aviso). Idempotente y seguro ante requests paralelos.
 */
export async function repararContextoCliente(user: SessionUser): Promise<SessionUser> {
  try {
    return await sinEmpresa('reparar contexto de sesión (busca el usuario sin conocer su empresa aún)', async (tx) => {
      let dbUser = await tx.user.findUnique({
        where: { supabaseId: user.supabaseId },
        select: { id: true, name: true, role: true, companyId: true },
      })

      // Usuario de Auth sin fila en BD (alta a medias). Solo lo recreamos si el
      // correo no pertenece ya a otra cuenta (eso requiere soporte humano).
      if (!dbUser) {
        if (!user.email) return user
        const emailOcupado = await tx.user.findUnique({
          where: { email: user.email },
          select: { id: true },
        })
        if (emailOcupado) return user
        dbUser = await tx.user
          .create({
            data: {
              supabaseId: user.supabaseId,
              email: user.email,
              name: user.email.split('@')[0],
              role: 'CLIENTE',
              companyId: null,
            },
            select: { id: true, name: true, role: true, companyId: true },
          })
          .catch(() => null)
        if (!dbUser) return user
      }

      const admin = createAdminClient()

      // ── Staff con metadata rota: restaurar rol/empresa y salir ────────────────
      if (dbUser.role !== 'CLIENTE') {
        const metadata = {
          role: dbUser.role as AppRole,
          dbUserId: dbUser.id,
          clienteId: null,
          companyId: dbUser.companyId,
        }
        await admin.auth.admin
          .updateUserById(user.supabaseId, { app_metadata: metadata })
          .catch((e) => console.error('[auth] reparar staff metadata:', e))
        return { ...user, metadata }
      }

      // ── Cliente: ¿ya tiene ficha en alguna empresa? ──────────────────────────
      let cliente = await tx.cliente.findFirst({
        where: { supabaseId: user.supabaseId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, companyId: true },
      })

      // ── Sin ficha: afiliarlo a la empresa principal (marca única) ────────────
      if (!cliente) {
        if (!user.email) return user // la ficha requiere correo
        const empresa = await getEmpresaPrincipal()
        if (!empresa) return user // sin empresa publicada no hay a qué afiliar

        cliente = await tx.cliente
          .create({
            data: {
              companyId: empresa.id,
              supabaseId: user.supabaseId,
              nombre: dbUser.name || user.email,
              email: user.email,
            },
            select: { id: true, companyId: true },
          })
          // Requests paralelos: si otro ya creó la ficha, la reutilizamos.
          .catch(() =>
            tx.cliente.findFirst({
              where: { supabaseId: user.supabaseId },
              select: { id: true, companyId: true },
            })
          )
        if (!cliente) return user

        await tx.companyFollow
          .upsert({
            where: { userId_companyId: { userId: dbUser.id, companyId: cliente.companyId } },
            update: {},
            create: { userId: dbUser.id, companyId: cliente.companyId },
          })
          .catch(anotarFallo('auth:companyFollow.upsert'))

        // Misma experiencia que un registro normal: canal de marketing (?src=),
        // regalo de bienvenida de la campaña activa + regalos P2P que esperaban
        // a este correo.
        await capturarCanalRegistro(cliente.id)
        await otorgarBienvenidaDirecta(cliente.id, cliente.companyId)
        if (user.email) {
          await vincularRegalosPorContacto({
            clienteId: cliente.id,
            companyId: cliente.companyId,
            email: user.email,
          })
        }
      }

      // ── Persistir el metadata para las próximas sesiones ─────────────────────
      const metadata = {
        role: 'CLIENTE' as AppRole,
        dbUserId: dbUser.id,
        clienteId: cliente.id,
        companyId: cliente.companyId,
      }
      await admin.auth.admin
        .updateUserById(user.supabaseId, { app_metadata: metadata })
        .catch((e) => console.error('[auth] reparar cliente metadata:', e))

      return { ...user, metadata }
    })
  } catch (e) {
    console.error('[auth] repararContextoCliente:', e)
    return user
  }
}
