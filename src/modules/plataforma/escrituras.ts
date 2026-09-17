import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { customerDTO, type CustomerDTO } from '@/modules/plataforma/dto'
import { mismoTelefono } from '@/modules/plataforma/consultas-nucleo'
import { normalizarEdicion, type EntradaEdicion } from '@/modules/plataforma/alta-cliente-nucleo'
import { emitirEventoEstrategia } from '@/modules/estrategias/eventos'

/**
 * ESCRITURAS de la API que edita registros de la propia empresa (B-5).
 *
 * Es la escritura de TRASTIENDA, distinta de la del satélite. El satélite crea
 * clientes que llegan sin cuenta y su alta queda atada al sistema que la
 * respalda; esto lo hace una clave de empresa —una integración, un Zapier— que
 * mantiene al día fichas que la empresa YA tiene. No mueve valor, así que no
 * pasa por idempotencia ni canal de origen: pone unos campos y devuelve la
 * ficha.
 */

export type ResultadoEdicion =
  | { ok: true; cliente: CustomerDTO }
  | { ok: false; motivo: 'no_existe' }
  | { ok: false; motivo: 'validacion'; detalle: string }
  | { ok: false; motivo: 'conflicto'; campo: 'telefono' | 'email' }

/**
 * Edita el nombre, el teléfono o el correo de un cliente existente.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CHOQUE SE COMPRUEBA ANTES DE ESCRIBIR
 *
 * El teléfono y el correo no son únicos en la base a nivel de columna —un
 * cliente puede no tener ninguno—, pero son con lo que `resolveCustomer`
 * encuentra a una persona. Si dos fichas de la misma empresa acabaran con el
 * mismo teléfono, resolver por ese teléfono devolvería una cualquiera, y el
 * historial de la persona quedaría partido entre las dos sin que nadie lo
 * decidiera. Así que poner un teléfono o un correo que YA es de otro cliente se
 * rechaza con un conflicto, no se acepta en silencio.
 *
 * El `nombreBusqueda` no se toca a mano: un trigger de la base lo recalcula en
 * cada UPDATE del nombre (`20260907_busqueda_sin_acentos`). Escribirlo aquí
 * además sería una segunda fuente de la misma verdad, y la que se olvida es la
 * que rompe la búsqueda.
 */
export async function editarCliente(
  companyId: string,
  id: string,
  entrada: EntradaEdicion
): Promise<ResultadoEdicion> {
  const norm = normalizarEdicion(entrada)
  if (!norm.ok) return { ok: false, motivo: 'validacion', detalle: norm.motivo }
  const { campos } = norm

  const resultado = await conEmpresa(companyId, async (tx) => {
    // Acotado por empresa: el id viaja en la URL. Sin el `companyId` en el
    // `where`, un id de otra empresa se editaría con solo conocerlo.
    const actual = await tx.cliente.findFirst({
      where: { id, companyId },
      select: { id: true },
    })
    if (!actual) return { ok: false, motivo: 'no_existe' } as const

    // Correo: choque exacto (ya viene en minúsculas del normalizador).
    if (campos.email) {
      const otro = await tx.cliente.findFirst({
        where: { companyId, email: campos.email, id: { not: id } },
        select: { id: true },
      })
      if (otro) return { ok: false, motivo: 'conflicto', campo: 'email' } as const
    }

    // Teléfono: choque por DÍGITOS, no por texto —«809-555» y «8095550000» son
    // el mismo número—. Se comparan en memoria los pocos que tienen teléfono,
    // igual que hace la resolución por teléfono.
    if (campos.telefono) {
      const conTelefono = await tx.cliente.findMany({
        where: { companyId, telefono: { not: null }, id: { not: id } },
        select: { id: true, telefono: true },
      })
      if (conTelefono.some((c) => mismoTelefono(c.telefono ?? '', campos.telefono!))) {
        return { ok: false, motivo: 'conflicto', campo: 'telefono' } as const
      }
    }

    const cliente = await tx.cliente.update({
      where: { id },
      data: campos,
      select: { id: true, nombre: true, email: true, telefono: true },
    })
    return { ok: true, cliente: customerDTO(cliente) } as const
  }).catch(() => ({ ok: false, motivo: 'no_existe' }) as const)

  /**
   * AVISA de que la ficha cambió (B-4 · `customer.updated`).
   *
   * Un satélite que mantiene su copia local de `Customer` (proyección CORE) la
   * refresca con este evento; sin él, su copia se quedaba con el dato viejo tras
   * cada edición. Va FUERA de la transacción y nunca lanza: el bus no puede
   * convertir un fallo de aviso en un fallo de la edición, que ya está escrita.
   * Se manda la ficha ya guardada —los mismos campos que el contrato de
   * proyección permite— para que quien la reciba no tenga que volver a pedirla.
   */
  if (resultado.ok) {
    const c = resultado.cliente
    await emitirEventoEstrategia({
      companyId,
      type: 'cliente.actualizado',
      subjectId: c.id,
      payload: { cliente: { id: c.id, nombre: c.nombre, email: c.email, telefono: c.telefono } },
    })
  }
  return resultado
}
