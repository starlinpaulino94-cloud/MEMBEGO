import { sinEmpresa } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AppRole, SessionUser } from '@/types'

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
      const cliente = await tx.cliente.findFirst({
        where: { supabaseId: user.supabaseId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, companyId: true },
      })

      /**
       * SIN FICHA: SE QUEDA SIN FICHA. Y eso ahora es un estado válido.
       *
       * ────────────────────────────────────────────────────────────────────
       * QUÉ HABÍA AQUÍ
       *
       * Se le creaba una ficha de `Cliente` en `getEmpresaPrincipal()` —la
       * empresa destacada, o la más antigua publicada—, se la hacía seguir y
       * se le daba su regalo de bienvenida. Todo automático, sin que la
       * persona hubiera oído hablar de ese negocio.
       *
       * Sostenía el modo MARCA ÚNICA: con una sola empresa publicada, «tu
       * cuenta de Membego» y «tu ficha en esa empresa» son lo mismo, así que
       * afiliar por defecto no se notaba.
       *
       * ────────────────────────────────────────────────────────────────────
       * POR QUÉ DEJA DE HACERSE
       *
       * Con dos empresas deja de ser invisible y pasa a ser un error: alguien
       * se registra en Membego y aparece como cliente de un restaurante que no
       * conoce, siguiéndolo, y con un regalo suyo. La relación comercial se la
       * inventó el sistema.
       *
       * Ahora una sesión de CLIENTE puede tener `clienteId: null` y
       * `companyId: null`. Es alguien que tiene cuenta en Membego y todavía no
       * es cliente de ningún negocio — que es exactamente lo que es.
       *
       * ────────────────────────────────────────────────────────────────────
       * LA BIENVENIDA NO SE PIERDE, SE MUEVE
       *
       * El regalo de bienvenida de una empresa se entrega cuando la persona se
       * hace cliente de ella de verdad: al reclamar una recompensa, al
       * afiliarse, al comprar. Lo hace `asegurarClienteEnEmpresa`.
       *
       * Antes se entregaba al registrarse, de una empresa que no había
       * elegido. Sigue habiendo regalo; ahora lo da quien lo ofrece a quien lo
       * quiso.
       */

      // ── Persistir el metadata para las próximas sesiones ─────────────────────
      const metadata = {
        role: 'CLIENTE' as AppRole,
        dbUserId: dbUser.id,
        // Pueden ser null: una cuenta de Membego que aún no es cliente de
        // ningún negocio. Las pantallas lo tratan como estado, no como error.
        clienteId: cliente?.id ?? null,
        companyId: cliente?.companyId ?? null,
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
