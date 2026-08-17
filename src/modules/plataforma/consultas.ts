import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { customerDTO } from '@/modules/plataforma/dto'
import {
  MINIMO_DIGITOS_TELEFONO,
  mismoTelefono,
} from '@/modules/plataforma/consultas-nucleo'
import type { CustomerDTO, VehicleDTO } from '@membego/contracts'

// La regla del teléfono vive en `consultas-nucleo.ts` —pura, sin `server-only`—
// para que se pueda probar caso por caso. Se reexporta para que quien la use no
// tenga que saber que está partida en dos.
export { MINIMO_DIGITOS_TELEFONO, mismoTelefono }

/**
 * PLATAFORMA · Fase 6 — LAS CONSULTAS DE CLIENTE, EN UN SOLO SITIO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 *
 * Estas tres consultas las hacen ahora DOS caminos: la API HTTP (para un
 * satélite) y el cliente en proceso (para Car Wash, que todavía vive dentro).
 *
 * Si cada uno las escribiera por su cuenta, el satélite y el vertical embebido
 * darían respuestas distintas sobre el mismo cliente — y descubrir cuál es la
 * buena exigiría leer los dos. Escritas aquí, la única diferencia entre los dos
 * caminos es el transporte, que es exactamente lo que la Fase 6 viene a
 * demostrar.
 */

/** Mínimo de caracteres para buscar. Con menos, la búsqueda es un listado. */
export const MINIMO_BUSQUEDA = 2
/** Tope de resultados. Buscar sí; descargarse la base a base de probar, no. */
export const MAX_BUSQUEDA = 20

export async function clientePorId(
  companyId: string,
  customerId: string
): Promise<CustomerDTO | null> {
  const c = await conEmpresa(companyId, (tx) =>
    tx.cliente.findFirst({
      where: { id: customerId, companyId },
      select: { id: true, nombre: true, email: true, telefono: true },
    })
  ).catch(() => null)
  return c ? customerDTO(c) : null
}

export async function clientePorEmail(
  companyId: string,
  email: string
): Promise<CustomerDTO | null> {
  const c = await conEmpresa(companyId, (tx) =>
    tx.cliente.findFirst({
      where: { companyId, email: email.trim().toLowerCase() },
      select: { id: true, nombre: true, email: true, telefono: true },
    })
  ).catch(() => null)
  return c ? customerDTO(c) : null
}

/**
 * Por teléfono, comparando SOLO los dígitos. El mismo número está escrito de
 * cinco maneras y exigir el formato exacto haría que la resolución fallara
 * justo cuando el cliente sí existe.
 */
export async function clientePorTelefono(
  companyId: string,
  telefono: string
): Promise<CustomerDTO | null> {
  if (telefono.replace(/\D/g, '').length < MINIMO_DIGITOS_TELEFONO) return null

  const candidatos = await conEmpresa(companyId, (tx) =>
    tx.cliente.findMany({
      where: { companyId, telefono: { not: null } },
      select: { id: true, nombre: true, email: true, telefono: true },
    })
  ).catch(() => [])

  const c = candidatos.find((x) => mismoTelefono(x.telefono ?? '', telefono))
  return c ? customerDTO(c) : null
}

/**
 * Por MATRÍCULA. Es el hueco que destapó meter a Car Wash por el contrato: en
 * un lavadero el cliente se identifica por la placa del coche, y el contrato
 * solo sabía de correos y teléfonos.
 *
 * Se compara sin distinguir mayúsculas porque las matrículas se teclean como
 * salga, y se acota por empresa ANTES de mirar la placa: la misma matrícula
 * puede estar en dos negocios distintos y cada uno solo puede ver la suya.
 */
export async function clientePorPlaca(
  companyId: string,
  placa: string
): Promise<CustomerDTO | null> {
  const limpia = placa.trim()
  if (!limpia) return null

  const v = await conEmpresa(companyId, (tx) =>
    tx.vehiculo.findFirst({
      where: {
        placa: { equals: limpia, mode: 'insensitive' },
        cliente: { companyId },
      },
      select: {
        cliente: { select: { id: true, nombre: true, email: true, telefono: true } },
      },
    })
  ).catch(() => null)

  return v?.cliente ? customerDTO(v.cliente) : null
}

/**
 * BUSCA por texto parcial en nombre, teléfono o correo.
 *
 * Distinto de resolver: aquí el empleado teclea «mar» y espera ver a María. El
 * mínimo de caracteres y el tope son lo que separa «buscar» de «descargarse la
 * base de clientes a base de probar letras».
 */
export async function buscarClientes(companyId: string, termino: string): Promise<CustomerDTO[]> {
  const q = termino.trim()
  if (q.length < MINIMO_BUSQUEDA) return []

  const filas = await conEmpresa(companyId, (tx) =>
    tx.cliente.findMany({
      where: {
        companyId,
        OR: [
          { nombre: { contains: q, mode: 'insensitive' } },
          { telefono: { contains: q } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { nombre: 'asc' },
      take: MAX_BUSQUEDA,
      select: { id: true, nombre: true, email: true, telefono: true },
    })
  ).catch(() => [])

  return filas.map(customerDTO)
}

// ── Vehículos ───────────────────────────────────────────────────────────────

/**
 * El vehículo es una entidad COMPARTIDA: MembeGo es su dueño —las membresías se
 * atan a vehículos concretos (§13)— y a la vez un lavadero no puede operar sin
 * ella. Estas dos consultas son las que el ejercicio de la Fase 6 destapó.
 */
function vehiculoDTO(v: {
  id: string
  clienteId: string
  placa: string | null
  marca: string
  modelo: string
}): VehicleDTO {
  return {
    id: v.id,
    customerId: v.clienteId,
    placa: v.placa,
    marca: v.marca,
    modelo: v.modelo,
  }
}

export async function vehiculosDeCliente(
  companyId: string,
  customerId: string
): Promise<VehicleDTO[]> {
  const filas = await conEmpresa(companyId, (tx) =>
    tx.vehiculo.findMany({
      // Se acota por la EMPRESA del cliente, no solo por el clienteId: un id
      // copiado de otro negocio no puede sacar sus vehículos.
      where: { clienteId: customerId, cliente: { companyId } },
      select: { id: true, clienteId: true, placa: true, marca: true, modelo: true },
      orderBy: { createdAt: 'asc' },
    })
  ).catch(() => [])
  return filas.map(vehiculoDTO)
}

export async function vehiculoPorPlaca(
  companyId: string,
  placa: string
): Promise<VehicleDTO | null> {
  const limpia = placa.trim()
  if (!limpia) return null
  const v = await conEmpresa(companyId, (tx) =>
    tx.vehiculo.findFirst({
      where: { placa: { equals: limpia, mode: 'insensitive' }, cliente: { companyId } },
      select: { id: true, clienteId: true, placa: true, marca: true, modelo: true },
    })
  ).catch(() => null)
  return v ? vehiculoDTO(v) : null
}

/**
 * Los TIPOS DE VEHÍCULO de la empresa con su nivel tarifario.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO TIENE QUE SALIR AL CONTRATO
 *
 * MembeGo decide la cobertura comparando NÚMEROS: el nivel del vehículo contra
 * el `nivelTarifarioMax` del plan. Un satélite que quiera cobrar la diferencia
 * cuando el carro se sale del plan necesita saber a qué nivel corresponde cada
 * una de SUS categorías, y esa equivalencia la tenía que adivinar: los niveles
 * viven aquí y no había forma de leerlos.
 *
 * Adivinarlos no es un inconveniente menor. Un nivel que no existe en MembeGo
 * no casa con nada, así que el satélite cobraría mal para siempre y nadie
 * sabría por qué — el cliente solo vería «no cubierto».
 *
 * Se sirve con `benefits:read` y no con un ámbito nuevo, a propósito: el nivel
 * solo sirve para decidir cobertura, y un ámbito nuevo obligaría a reemitir las
 * credenciales de todos los satélites que ya evalúan beneficios.
 *
 * Solo los ACTIVOS: un tipo desactivado no se le ofrece a nadie, y mandarlo
 * invitaría al satélite a mapear una categoría contra algo retirado.
 */
export interface VehicleTypeDTO {
  id: string
  nombre: string
  /** El número que se compara con `nivelTarifarioMax` del plan. */
  nivelTarifario: number
}

export async function tiposDeVehiculo(companyId: string): Promise<VehicleTypeDTO[]> {
  const filas = await conEmpresa(companyId, (tx) =>
    tx.tipoVehiculo.findMany({
      where: { companyId, activo: true },
      select: { id: true, nombre: true, nivelTarifario: true },
      orderBy: [{ nivelTarifario: 'asc' }, { orden: 'asc' }, { nombre: 'asc' }],
    })
  ).catch(() => [])
  return filas.map((t) => ({
    id: t.id,
    nombre: t.nombre,
    nivelTarifario: t.nivelTarifario,
  }))
}
