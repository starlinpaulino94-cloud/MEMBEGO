import 'server-only'

import type { Prisma } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { DIAS_INACTIVO, POR_PAGINA, type FiltroUsuarios } from './filtros'

/**
 * EL CONTROL DE ACCESOS DE LA PLATAFORMA, LEÍDO EN UNA SOLA TRANSACCIÓN.
 *
 * Sustituye a la consulta suelta que hacía la página: `findMany` de todos los
 * usuarios no-cliente, sin filtro, sin contar y sin paginar. Tres cosas
 * cambian, y ninguna es de presentación:
 *
 *  1. SE FILTRA EN EL SERVIDOR. Buscar por nombre o correo, acotar por rol o
 *     por empresa, y —lo que no se podía preguntar de ninguna manera— pedir
 *     SOLO los superadmins. En la pantalla que decide quién entra a qué, esa
 *     era la primera pregunta y no tenía respuesta.
 *
 *  2. SE VE LA ÚLTIMA ACTIVIDAD de cada cuenta, y se pueden pedir las que
 *     llevan meses en silencio. Es la otra pregunta de un control de accesos:
 *     ¿qué cuentas sobran?
 *
 *  3. TODO VIAJA JUNTO. Una transacción, no una por dato. Es la misma lección
 *     de `panel.ts`: llamar desde dentro de una transacción a algo que abre la
 *     suya pide una segunda conexión del pool, y eso no falla — se degrada.
 */

export interface EmpresaDeUsuario {
  id: string
  name: string
  /** De práctica: se marca, porque no es un negocio real. */
  esDemo: boolean
  /** La que ve al entrar, cuando tiene varias. */
  activa: boolean
}

export interface UsuarioFila {
  id: string
  name: string
  email: string
  role: string
  esSuperadmin: boolean
  empresas: EmpresaDeUsuario[]
  /**
   * Milisegundos desde su última línea en la bitácora; `null` = ninguna.
   *
   * NO ES «último inicio de sesión», y la pantalla no lo llama así. La bitácora
   * registra lo que se HACE, no que se entre a mirar: alguien puede entrar cada
   * día y no aparecer aquí. Sirve para lo que sirve —detectar cuentas que ya no
   * operan— y decirlo de otra manera sería vender una precisión que no hay.
   */
  desdeUltimaActividad: number | null
}

export interface ListadoUsuarios {
  filas: UsuarioFila[]
  /** Cuántos cumplen el filtro (paginación y el «N de M»). */
  total: number
  /** Cuántos hay en total, sin filtros. */
  totalSinFiltro: number
  /** Cuántos superadmins hay. Es una cifra de seguridad, no una estadística. */
  superadmins: number
  /** Cuántas cuentas llevan `DIAS_INACTIVO` sin rastro. */
  inactivos: number
  /** Opciones del desplegable de empresa. */
  empresas: { id: string; name: string; esDemo: boolean }[]
}

/**
 * El `where` del filtro.
 *
 * Todo va dentro de un `AND` explícito en vez de repartido por la raíz del
 * objeto. Con dos filtros que necesitan `OR` —la búsqueda mira nombre y correo;
 * la empresa mira la activa y los accesos extra— escribirlos sueltos hace que
 * el segundo pise al primero, sin error y sin aviso: la pantalla enseña
 * resultados de más y nadie lo nota.
 */
function whereFiltro(f: FiltroUsuarios, corteInactividad: Date): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = [
    // Los clientes nunca: esta pantalla es de staff y privilegio.
    { role: { notIn: ['CLIENTE'] } },
  ]

  if (f.rol !== 'todos') and.push({ role: f.rol as never })

  if (f.q) {
    and.push({
      OR: [
        { name: { contains: f.q, mode: 'insensitive' } },
        { email: { contains: f.q, mode: 'insensitive' } },
      ],
    })
  }

  if (f.empresa) {
    // La empresa activa Y los accesos extra: la tarjeta enseña las dos cosas,
    // así que filtrar solo por una haría que un usuario visible «con» esa
    // empresa desapareciera al filtrar por ella.
    and.push({
      OR: [
        { companyId: f.empresa },
        { empresasAcceso: { some: { companyId: f.empresa } } },
      ],
    })
  }

  // «Sin rastro reciente» se resuelve en la base con un NOT EXISTS, no trayendo
  // a todo el mundo para descartarlo después.
  if (f.inactivos) and.push({ auditLogs: { none: { createdAt: { gte: corteInactividad } } } })

  return { AND: and }
}

function orderBy(f: FiltroUsuarios): Prisma.UserOrderByWithRelationInput[] {
  switch (f.orden) {
    case 'rol':
      // El enum se ordena por su orden de declaración, y `SUPERADMIN` es el
      // primero. Ordenar por rol pone arriba a quien más puede.
      return [{ role: 'asc' }, { name: 'asc' }]
    case 'reciente':
      return [{ createdAt: 'desc' }]
    case 'antiguo':
      return [{ createdAt: 'asc' }]
    default:
      return [{ name: 'asc' }]
  }
}

export async function listarUsuarios(f: FiltroUsuarios): Promise<ListadoUsuarios> {
  const corte = new Date(Date.now() - DIAS_INACTIVO * 24 * 60 * 60 * 1000)
  const where = whereFiltro(f, corte)
  const soloStaff: Prisma.UserWhereInput = { role: { notIn: ['CLIENTE'] } }

  return sinEmpresa(
    'usuarios de la plataforma: el control de accesos abarca todas las empresas',
    async (tx) => {
      const [usuarios, total, totalSinFiltro, superadmins, inactivos, empresas] =
        await Promise.all([
          tx.user.findMany({
            where,
            orderBy: orderBy(f),
            skip: (f.pagina - 1) * POR_PAGINA,
            take: POR_PAGINA,
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              companyId: true,
              company: { select: { id: true, name: true, esDemo: true } },
              empresasAcceso: {
                select: { company: { select: { id: true, name: true, esDemo: true } } },
              },
            },
          }),
          tx.user.count({ where }),
          tx.user.count({ where: soloStaff }),
          tx.user.count({ where: { role: 'SUPERADMIN' } }),
          tx.user.count({
            where: { AND: [soloStaff, { auditLogs: { none: { createdAt: { gte: corte } } } }] },
          }),
          tx.company.findMany({
            orderBy: { name: 'asc' },
            select: { id: true, name: true, esDemo: true },
          }),
        ])

      /**
       * La última actividad, SOLO de los que se van a pintar.
       *
       * Un `groupBy` acotado a los ids de la página. Pedirla usuario por usuario
       * serían veinticuatro consultas más por carga; pedirla de todos sería
       * recorrer la bitácora entera para enseñar veinticuatro números.
       */
      const ids = usuarios.map((u) => u.id)
      const actividad =
        ids.length === 0
          ? []
          : await tx.auditLog.groupBy({
              by: ['userId'],
              where: { userId: { in: ids } },
              _max: { createdAt: true },
            })
      const ultima = new Map(
        actividad.map((a) => [a.userId, a._max.createdAt?.getTime() ?? null])
      )

      // Un solo «ahora» para todas las filas. Leer el reloj por fila daría
      // instantes distintos dentro de la misma pantalla.
      const ahora = Date.now()

      const filas: UsuarioFila[] = usuarios.map((u) => {
        // La activa primero y sin repetirla: viene por dos caminos —el campo
        // `companyId` y la tabla de accesos— y casi siempre por los dos.
        const vistas = new Map<string, EmpresaDeUsuario>()
        if (u.company) {
          vistas.set(u.company.id, { ...u.company, activa: true })
        }
        for (const a of u.empresasAcceso) {
          if (!vistas.has(a.company.id)) {
            vistas.set(a.company.id, { ...a.company, activa: false })
          }
        }

        const ts = ultima.get(u.id) ?? null
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          esSuperadmin: u.role === 'SUPERADMIN',
          empresas: [...vistas.values()],
          desdeUltimaActividad: ts === null ? null : ahora - ts,
        }
      })

      return { filas, total, totalSinFiltro, superadmins, inactivos, empresas }
    }
  )
}
