import 'server-only'
import { conEmpresa, type Tx } from '@/lib/tenant'
import { customerDTO } from '@/modules/plataforma/dto'
import { mismoTelefono } from '@/modules/plataforma/consultas-nucleo'
import {
  type AltaNormalizada,
  type EntradaAlta,
  normalizarAlta,
  nuevoIdLocal,
  tieneIdentificador,
} from '@/modules/plataforma/alta-cliente-nucleo'
import type { CustomerDTO } from '@membego/contracts'

/**
 * PLATAFORMA · Fase 7 — DAR DE ALTA UN CLIENTE, UNA SOLA VEZ EN TODO EL CÓDIGO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL HUECO QUE LA FASE 6 DEJÓ ESCRITO
 *
 * La validación de la Fase 6 terminó diciendo esto: «lo que no aguanta todavía
 * es ESCRIBIR — un mostrador crea clientes y el puerto no lo ofrece». Y la
 * razón por la que no lo ofrecía sigue siendo cierta: un vertical que cree
 * clientes por su cuenta empieza a ser dueño de la identidad del cliente, que
 * es justo lo que MembeGo no puede ceder (§14).
 *
 * La salida no es cederla, es que el Core la escriba y el vertical la PIDA. Eso
 * es lo que hay aquí: el satélite manda un nombre, y quien decide cómo queda esa
 * fila —el prefijo `local:`, el correo vacío, el canal de origen, si es un
 * duplicado— es el Core, igual para todos los verticales.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES SITIOS ESCRIBÍAN LO MISMO
 *
 * `mostrador-actions`, `cola-actions` y ahora la API. Tres copias de la misma
 * fila, cada una con su propia idea de qué poner en `email` y de si marcar
 * `esLocal`. La tercera copia era el momento de parar: con filas ya escritas,
 * unificarlas deja de ser un refactor y pasa a ser una migración de datos.
 */

export interface ResultadoAlta {
  cliente: CustomerDTO
  /**
   * `false` cuando ya existía. El vertical necesita distinguirlo: si creía
   * estar registrando a alguien nuevo y resulta que no, ese cliente ya tiene
   * historial y probablemente membresía.
   */
  creado: boolean
}

/**
 * DEDUPLICAR NO ES OPCIONAL.
 *
 * Dos fichas de la misma persona parten su historial en dos, y a partir de ahí
 * nadie vuelve a saber cuántas veces vino ni qué le corresponde. Es la misma
 * regla que ya aplicaba el mostrador con las placas, aplicada al identificador
 * que tenga cada vertical: un restaurante conoce el teléfono, no la matrícula.
 *
 * Se compara el teléfono con la regla de la Fase 6 —simétrica y acotada—, no
 * con una igualdad de cadenas: `+18095551234` y `809-555-1234` son la misma
 * persona, y crear la segunda ficha es exactamente el fallo que se evita.
 */
async function buscarExistente(
  tx: Tx,
  companyId: string,
  datos: AltaNormalizada
): Promise<CustomerDTO | null> {
  if (datos.email) {
    const porEmail = await tx.cliente.findFirst({
      where: { companyId, email: datos.email },
      select: { id: true, nombre: true, email: true, telefono: true },
    })
    if (porEmail) return customerDTO(porEmail)
  }

  if (datos.telefono) {
    const candidatos = await tx.cliente.findMany({
      where: { companyId, telefono: { not: null } },
      select: { id: true, nombre: true, email: true, telefono: true },
    })
    const c = candidatos.find((x) => mismoTelefono(x.telefono ?? '', datos.telefono!))
    if (c) return customerDTO(c)
  }

  return null
}

/**
 * Alta de un cliente que llega sin cuenta.
 *
 * `origen` queda en `canalOrigen` para que una ficha creada por el satélite del
 * restaurante y una creada en el mostrador no sean indistinguibles el día que
 * alguien pregunte de dónde salen los clientes nuevos.
 *
 * `tx` es opcional a propósito: quien ya está dentro de una transacción —el
 * mostrador, que crea cliente y vehículo juntos— la pasa y conserva su
 * atomicidad. Sin ella se abre una propia.
 */
export async function altaCliente(
  companyId: string,
  entrada: EntradaAlta,
  origen: string,
  tx?: Tx
): Promise<ResultadoAlta | { error: string }> {
  const norm = normalizarAlta(entrada)
  if (!norm.ok) return { error: norm.motivo }
  const { datos } = norm

  const trabajo = async (t: Tx): Promise<ResultadoAlta> => {
    if (tieneIdentificador(datos)) {
      const ya = await buscarExistente(t, companyId, datos)
      if (ya) return { cliente: ya, creado: false }
    }

    const creado = await t.cliente.create({
      data: {
        companyId,
        supabaseId: nuevoIdLocal(),
        nombre: datos.nombre,
        telefono: datos.telefono,
        email: datos.email,
        esLocal: true,
        canalOrigen: origen,
      },
      select: { id: true, nombre: true, email: true, telefono: true },
    })
    return { cliente: customerDTO(creado), creado: true }
  }

  return tx ? trabajo(tx) : conEmpresa(companyId, trabajo)
}
