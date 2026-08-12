import { sinEmpresa } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEmpresaPrincipal } from '@/modules/marketplace/marcaUnica'
import { otorgarBienvenidaDirecta } from '@/modules/invitaciones/beneficios'
import { vincularRegalosPorContacto } from '@/modules/regalos/entrega'
import { capturarCanalRegistro } from '@/modules/adquisicion/canal'
import type { AppRole, SessionUser } from '@/types'
import { anotarFallo } from '@/lib/prisma-errors'

/**
 * Lo que la transacción decide, para que lo de fuera lo ejecute.
 *
 * La transacción SOLO toca la base. Todo lo demás —la llamada HTTP a Supabase
 * para persistir el metadata, y los tres efectos de bienvenida, que abren sus
 * propias transacciones— ocurre después, con la conexión ya devuelta al pool.
 *
 * Antes iba todo dentro. Eso significaba mantener una conexión abierta durante
 * una ida y vuelta HTTP a Supabase, y pedir hasta tres conexiones más desde
 * dentro de ella. Y esto corre en `getUser()`: en el peor momento, cuando un
 * grupo de sesiones rotas se repara a la vez.
 */
interface Reparacion {
  sesion: SessionUser
  /** Metadata a persistir en Supabase Auth, si cambió. */
  metadata: SessionUser['metadata'] | null
  /** Ficha recién creada a la que hay que darle la bienvenida. */
  bienvenida: { clienteId: string; companyId: string; email: string | null } | null
}

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
    // `getEmpresaPrincipal` también abre transacción (va envuelta en
    // `unstable_cache` sobre un `sinEmpresa`), así que se resuelve antes.
    // Devuelve null sin romper nada si no hay empresa publicada.
    const empresaPrincipal = await getEmpresaPrincipal().catch(() => null)

    const rep = await sinEmpresa('reparar contexto de sesión (busca el usuario sin conocer su empresa aún)', async (tx): Promise<Reparacion> => {
      const sinCambios = (s: SessionUser): Reparacion => ({
        sesion: s,
        metadata: null,
        bienvenida: null,
      })
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

      // ── Staff con metadata rota: restaurar rol/empresa y salir ────────────────
      if (dbUser.role !== 'CLIENTE') {
        const metadata = {
          role: dbUser.role as AppRole,
          dbUserId: dbUser.id,
          clienteId: null,
          companyId: dbUser.companyId,
        }
        return { sesion: { ...user, metadata }, metadata, bienvenida: null }
      }

      let nuevaFicha: Reparacion['bienvenida'] = null

      // ── Cliente: ¿ya tiene ficha en alguna empresa? ──────────────────────────
      let cliente = await tx.cliente.findFirst({
        where: { supabaseId: user.supabaseId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, companyId: true },
      })

      // ── Sin ficha: afiliarlo a la empresa principal (marca única) ────────────
      if (!cliente) {
        if (!user.email) return sinCambios(user) // la ficha requiere correo
        const empresa = empresaPrincipal
        if (!empresa) return sinCambios(user) // sin empresa publicada no hay a qué afiliar

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
        if (!cliente) return sinCambios(user)

        await tx.companyFollow
          .upsert({
            where: { userId_companyId: { userId: dbUser.id, companyId: cliente.companyId } },
            update: {},
            create: { userId: dbUser.id, companyId: cliente.companyId },
          })
          .catch(anotarFallo('auth:companyFollow.upsert'))

        // La bienvenida se anota y se entrega FUERA: las tres funciones abren
        // su propia transacción.
        nuevaFicha = { clienteId: cliente.id, companyId: cliente.companyId, email: user.email }
      }

      // ── Persistir el metadata para las próximas sesiones ─────────────────────
      const metadata = {
        role: 'CLIENTE' as AppRole,
        dbUserId: dbUser.id,
        clienteId: cliente.id,
        companyId: cliente.companyId,
      }
      return { sesion: { ...user, metadata }, metadata, bienvenida: nuevaFicha }
    })

    // ── Fuera de la transacción, con la conexión ya devuelta ──────────────────
    if (rep.metadata) {
      await createAdminClient()
        .auth.admin.updateUserById(user.supabaseId, { app_metadata: rep.metadata })
        .catch((e) => console.error('[auth] reparar metadata:', e))
    }

    if (rep.bienvenida) {
      // Misma experiencia que un registro normal: canal de marketing (?src=),
      // regalo de bienvenida de la campaña activa + regalos P2P que esperaban a
      // este correo. Cada uno falla por su cuenta: que no llegue un regalo no
      // puede dejar la sesión sin reparar, que era el trabajo de verdad.
      const { clienteId, companyId, email } = rep.bienvenida
      await capturarCanalRegistro(clienteId).catch(anotarFallo('auth:canalRegistro'))
      await otorgarBienvenidaDirecta(clienteId, companyId).catch(anotarFallo('auth:bienvenida'))
      if (email) {
        await vincularRegalosPorContacto({ clienteId, companyId, email })
          .catch(anotarFallo('auth:regalosPorContacto'))
      }
    }

    return rep.sesion
  } catch (e) {
    console.error('[auth] repararContextoCliente:', e)
    return user
  }
}
