import { sinEmpresa } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AppRole, SessionUser } from '@/types'

/**
 * Lo que la transacción decide, para que lo de fuera lo ejecute.
 *
 * La transacción SOLO toca la base. La llamada HTTP a Supabase para persistir el
 * metadata ocurre después, con la conexión ya devuelta al pool.
 *
 * Antes iba dentro. Eso significaba mantener una conexión abierta durante una
 * ida y vuelta de red, y esto corre en `getUser()`: en el peor momento posible,
 * cuando un grupo de sesiones rotas se repara a la vez.
 */
interface Reparacion {
  sesion: SessionUser
  /** Metadata a persistir en Supabase Auth, si cambió. */
  metadata: SessionUser['metadata'] | null
}

/**
 * AUTO-REPARACIÓN de sesiones incompletas.
 *
 * Una sesión puede llegar sin `clienteId`/`companyId` (o incluso sin `role`)
 * en el app_metadata por varios caminos reales:
 *  - Registro GENERAL (/registro/cuenta): crea la cuenta sin empresa a
 *    propósito.
 *  - Un alta donde `updateUserById` (app_metadata) falló tras crear las filas.
 *  - Login con Google de una cuenta que nunca completó su afiliación.
 *
 * Sin reparación, CADA módulo del cliente falla distinto ("cuenta no
 * configurada", "No autorizado", crash). Este helper — invocado una vez por
 * request desde getUser(), solo cuando falta contexto — deja la cuenta
 * consistente:
 *  1. Staff con metadata rota → restaura rol y empresa desde la fila User.
 *  2. Cliente con ficha existente → reapunta metadata a su ficha más reciente.
 *  3. Cliente SIN ficha → se queda sin ficha, y eso es un estado válido: tiene
 *     cuenta en Membego y todavía no es cliente de ningún negocio.
 *
 * Nunca lanza: si no se puede reparar, devuelve la sesión tal cual (las
 * páginas muestran su aviso). Idempotente y seguro ante requests paralelos.
 */
export async function repararContextoCliente(user: SessionUser): Promise<SessionUser> {
  try {
    const rep = await sinEmpresa(
      'reparar contexto de sesión (busca el usuario sin conocer su empresa aún)',
      async (tx): Promise<Reparacion> => {
        const sinCambios = (s: SessionUser): Reparacion => ({ sesion: s, metadata: null })

        let dbUser = await tx.user.findUnique({
          where: { supabaseId: user.supabaseId },
          select: { id: true, name: true, role: true, companyId: true },
        })

        // Usuario de Auth sin fila en BD (alta a medias). Solo lo recreamos si el
        // correo no pertenece ya a otra cuenta (eso requiere soporte humano).
        if (!dbUser) {
          if (!user.email) return sinCambios(user)
          const emailOcupado = await tx.user.findUnique({
            where: { email: user.email },
            select: { id: true },
          })
          if (emailOcupado) return sinCambios(user)
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
          if (!dbUser) return sinCambios(user)
        }

        // ── Staff con metadata rota: restaurar rol/empresa y salir ──────────────
        if (dbUser.role !== 'CLIENTE') {
          const metadata = {
            role: dbUser.role as AppRole,
            dbUserId: dbUser.id,
            clienteId: null,
            companyId: dbUser.companyId,
          }
          return { sesion: { ...user, metadata }, metadata }
        }

        // ── Cliente: ¿ya tiene ficha en alguna empresa? ─────────────────────────
        const cliente = await tx.cliente.findFirst({
          where: { supabaseId: user.supabaseId },
          orderBy: { createdAt: 'desc' },
          select: { id: true, companyId: true },
        })

        /**
         * SIN FICHA: SE QUEDA SIN FICHA. Y eso ahora es un estado válido.
         *
         * ──────────────────────────────────────────────────────────────────
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
         * ──────────────────────────────────────────────────────────────────
         * POR QUÉ DEJA DE HACERSE
         *
         * Con dos empresas deja de ser invisible y pasa a ser un error: alguien
         * se registra en Membego y aparece como cliente de un restaurante que
         * no conoce, siguiéndolo, y con un regalo suyo. La relación comercial
         * se la inventó el sistema.
         *
         * Ahora una sesión de CLIENTE puede tener `clienteId: null` y
         * `companyId: null`. Es alguien que tiene cuenta en Membego y todavía
         * no es cliente de ningún negocio — que es exactamente lo que es.
         *
         * ──────────────────────────────────────────────────────────────────
         * LA BIENVENIDA NO SE PIERDE, SE MUEVE
         *
         * El regalo de bienvenida de una empresa se entrega cuando la persona
         * se hace cliente de ella de verdad: al reclamar una recompensa, al
         * afiliarse, al comprar. Lo hace `asegurarClienteEnEmpresa`.
         *
         * Antes se entregaba al registrarse, de una empresa que no había
         * elegido. Sigue habiendo regalo; ahora lo da quien lo ofrece a quien
         * lo quiso.
         */

        // ── Persistir el metadata para las próximas sesiones ────────────────────
        const metadata = {
          role: 'CLIENTE' as AppRole,
          dbUserId: dbUser.id,
          // Pueden ser null: una cuenta de Membego que aún no es cliente de
          // ningún negocio. Las pantallas lo tratan como estado, no como error.
          clienteId: cliente?.id ?? null,
          companyId: cliente?.companyId ?? null,
        }
        return { sesion: { ...user, metadata }, metadata }
      }
    )

    // ── Fuera de la transacción, con la conexión ya devuelta ──────────────────
    if (rep.metadata) {
      await createAdminClient()
        .auth.admin.updateUserById(user.supabaseId, { app_metadata: rep.metadata })
        .catch((e) => console.error('[auth] reparar metadata:', e))
    }

    return rep.sesion
  } catch (e) {
    console.error('[auth] repararContextoCliente:', e)
    return user
  }
}
