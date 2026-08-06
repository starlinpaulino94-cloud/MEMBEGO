import { conEmpresa } from '@/lib/tenant'
import { normalizarPlaca } from './cuentas'

/**
 * App Car Wash · CLIENTES DE MOSTRADOR.
 *
 * EL PROBLEMA: la mitad de los carros que entran a una pista son de gente que
 * no tiene —ni quiere tener— cuenta en una app. Hasta ahora el sistema solo
 * sabía representar clientes registrados, así que esos lavados se anotaban en
 * un cuaderno o en un programa aparte. El negocio queda partido en dos.
 *
 * LA SOLUCIÓN, Y POR QUÉ ASÍ: un cliente de mostrador es un `Cliente` normal,
 * con `esLocal: true` y un `supabaseId` con prefijo `local:`. No se creó una
 * tabla paralela a propósito:
 *
 *   · Todo lo que ya funciona sobre `Cliente` —historial, vehículos, cola,
 *     incidencias, notas internas, reportes— funciona igual sin tocar nada.
 *   · Una tabla aparte habría obligado a duplicar cada consulta ("busca en
 *     clientes… y también en clientes_locales"), y esa clase de duplicación
 *     es la que termina en pantallas que muestran la mitad de los datos.
 *   · Cuando el cliente de mostrador se registre de verdad, se VINCULAN las
 *     dos fichas y no se pierde su historial.
 *
 * POR QUÉ NO PUEDE INICIAR SESIÓN: Supabase solo emite identificadores UUID.
 * Un `supabaseId` que empieza con `local:` no puede salir jamás de una sesión
 * real, así que la autenticación nunca va a encontrar esta ficha. No es una
 * comprobación que haya que acordarse de escribir: es imposible por forma.
 */

/** Prefijo que marca una identidad que NO viene de Supabase Auth. */
export const PREFIJO_LOCAL = 'local:'

/** Identidad para un cliente de mostrador. Nunca colisiona con un UUID real. */
export function nuevoIdLocal(): string {
  // Date + azar: no necesita ser criptográfico, solo único. La unicidad real
  // la garantiza el @@unique([supabaseId, companyId]) de la base.
  return `${PREFIJO_LOCAL}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export function esIdLocal(supabaseId: string | null | undefined): boolean {
  return !!supabaseId?.startsWith(PREFIJO_LOCAL)
}

/** Normaliza un teléfono para comparar: solo dígitos. */
export function normalizarTelefono(tel: string): string {
  return tel.replace(/\D/g, '')
}

export interface ClienteBuscado {
  id: string
  nombre: string
  telefono: string | null
  email: string
  esLocal: boolean
  /** Placas conocidas, para reconocerlo de un vistazo. */
  placas: string[]
  visitas: number
  ultimaVisita: Date | null
}

/**
 * Busca clientes de la empresa por nombre, teléfono o PLACA.
 *
 * La placa está incluida porque es lo que el encargado tiene delante: no
 * pregunta "¿cómo se llama?", mira el carro. Buscar solo por nombre obligaría
 * a recordar a la gente, que es justo lo que el sistema debería evitar.
 */
export async function buscarClientes(
  companyId: string,
  q: string,
  limite = 20
): Promise<ClienteBuscado[]> {
  const termino = q.trim()
  if (termino.length < 2) return []

  try {
    const placa = normalizarPlaca(termino)
    const soloDigitos = normalizarTelefono(termino)

    const clientes = await conEmpresa(companyId, (tx) =>
      tx.cliente.findMany({
        where: {
          companyId,
          OR: [
            { nombre: { contains: termino, mode: 'insensitive' } },
            ...(soloDigitos.length >= 3
              ? [{ telefono: { contains: soloDigitos } as const }]
              : []),
            { vehiculos: { some: { placa: { contains: placa, mode: 'insensitive' } } } },
          ],
        },
        orderBy: { nombre: 'asc' },
        take: limite,
        select: {
          id: true,
          nombre: true,
          telefono: true,
          email: true,
          esLocal: true,
          vehiculos: { select: { placa: true }, take: 6 },
          _count: { select: { colaVehiculos: true } },
          colaVehiculos: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { createdAt: true },
          },
        },
      })
    )

    return clientes.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      telefono: c.telefono,
      email: c.email,
      esLocal: c.esLocal,
      placas: c.vehiculos.map((v) => v.placa).filter((p): p is string => !!p),
      visitas: c._count.colaVehiculos,
      ultimaVisita: c.colaVehiculos[0]?.createdAt ?? null,
    }))
  } catch {
    // Columna `esLocal` sin migrar todavía.
    return []
  }
}

/**
 * Encuentra al dueño de una placa, registrado o de mostrador.
 * Es la consulta que hace la pista cuando entra un carro.
 */
export async function duenoDeLaPlaca(companyId: string, placa: string) {
  const limpia = normalizarPlaca(placa)
  if (!limpia) return null
  try {
    const vehiculo = await conEmpresa(companyId, (tx) =>
      tx.vehiculo.findFirst({
        where: {
          placa: { equals: limpia, mode: 'insensitive' },
          cliente: { companyId },
        },
        select: {
          id: true,
          marca: true,
          modelo: true,
          tipoVehiculoId: true,
          cliente: { select: { id: true, nombre: true, telefono: true, esLocal: true } },
        },
      })
    )
    return vehiculo
  } catch {
    return null
  }
}

export interface FichaMostrador {
  id: string
  nombre: string
  telefono: string | null
  email: string
  esLocal: boolean
  createdAt: Date
  vehiculos: { id: string; placa: string | null; marca: string; modelo: string; tipo: string | null }[]
  visitas: {
    id: string
    fecha: Date
    placa: string | null
    estado: string
    servicios: string[]
    total: number
  }[]
  totales: { visitas: number; facturado: number }
}

/** Ficha de un cliente con su historial de lavados. */
export async function getFicha(
  companyId: string,
  clienteId: string
): Promise<FichaMostrador | null> {
  try {
    const c = await conEmpresa(companyId, (tx) =>
      tx.cliente.findFirst({
        where: { id: clienteId, companyId },
        select: {
          id: true,
          nombre: true,
          telefono: true,
          email: true,
          esLocal: true,
          createdAt: true,
          vehiculos: {
            select: {
              id: true,
              placa: true,
              marca: true,
              modelo: true,
              tipoVehiculo: { select: { nombre: true } },
            },
          },
          colaVehiculos: {
            orderBy: { createdAt: 'desc' },
            take: 100,
            select: {
              id: true,
              createdAt: true,
              placa: true,
              estado: true,
              servicios: { select: { nombre: true, precio: true, cantidad: true } },
            },
          },
        },
      })
    )
    if (!c) return null

    const visitas = c.colaVehiculos.map((v) => ({
      id: v.id,
      fecha: v.createdAt,
      placa: v.placa,
      estado: v.estado,
      servicios: v.servicios.map((s) => s.nombre),
      total: v.servicios.reduce((a, s) => a + Number(s.precio) * s.cantidad, 0),
    }))

    return {
      id: c.id,
      nombre: c.nombre,
      telefono: c.telefono,
      email: c.email,
      esLocal: c.esLocal,
      createdAt: c.createdAt,
      vehiculos: c.vehiculos.map((v) => ({
        id: v.id,
        placa: v.placa,
        marca: v.marca,
        modelo: v.modelo,
        tipo: v.tipoVehiculo?.nombre ?? null,
      })),
      visitas,
      totales: {
        visitas: visitas.length,
        // Solo lo entregado cuenta como facturado: un carro cancelado a mitad
        // no se cobró.
        facturado: visitas
          .filter((v) => v.estado === 'ENTREGADO')
          .reduce((a, v) => a + v.total, 0),
      },
    }
  } catch {
    return null
  }
}

/** Últimos clientes de mostrador dados de alta. Lo que se ve al abrir. */
export async function getRecientes(companyId: string, limite = 30) {
  try {
    return await conEmpresa(companyId, (tx) =>
      tx.cliente.findMany({
        where: { companyId, esLocal: true },
        orderBy: { createdAt: 'desc' },
        take: limite,
        select: {
          id: true,
          nombre: true,
          telefono: true,
          createdAt: true,
          vehiculos: { select: { placa: true }, take: 4 },
          _count: { select: { colaVehiculos: true } },
        },
      })
    )
  } catch {
    return null
  }
}
