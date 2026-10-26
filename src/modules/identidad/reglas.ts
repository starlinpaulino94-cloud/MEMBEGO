import 'server-only'
import { sinEmpresa } from '@/lib/tenant'
import { compuertaDeIdentidad, estadoDeIdentidadDe, leerReglaDeIdentidad } from '@/modules/identidad/identidad'
import { decidirRequisito, type DecisionDeRequisito, type HechosDelRepresentante } from '@/modules/identidad/reglasCore'

/**
 * LAS REGLAS POR FUNCIÓN, con base de datos (Fase 5). La decisión pura vive en `reglasCore.ts`; aquí solo se juntan los
 * hechos que necesita.
 *
 * Es de lo POCO que consulta la identidad fuera de este módulo, y solo lo llama el sitio donde sale el dinero
 * (`confirmarPagoProveedorEnTx`). Las compras, promociones, membresías, renovaciones y accesos no pasan por aquí: una
 * prueba lo vigila.
 *
 * Con la regla apagada (el estado de serie) no se lee nada de la persona. Con la verificación apagada, las reglas se
 * suspenden: no se le pide a nadie algo que no puede hacer.
 */

const SIN_REPRESENTANTE: HechosDelRepresentante = { userId: null, contacto: null, estado: null, nivel: null }

/**
 * ¿Hay que pedir identidad para ESTE pago a un proveedor y se cumple? `representanteId` es quien aceptó el contrato del
 * proveedor (`SupplyV2Supplier.termsAcceptedById`); `esPrimerPago`, que no hay otro pago confirmado antes.
 *
 * Si no se puede leer la regla o a la persona, lanza: es dinero que sale, y «no sé» no es «sí».
 */
export async function evaluarRequisitoDePagoAProveedor(entrada: { representanteId: string | null; esPrimerPago: boolean }): Promise<DecisionDeRequisito> {
  const regla = await leerReglaDeIdentidad('PAGO_A_PROVEEDOR')
  if (!regla?.activa) return decidirRequisito(regla, { compuertaAbierta: false, esPrimerPago: entrada.esPrimerPago, representante: SIN_REPRESENTANTE })
  const compuertaAbierta = (await compuertaDeIdentidad()).habilitada
  const hayQueMirarlo = compuertaAbierta && (regla.alcance === 'todos' || entrada.esPrimerPago)
  if (!hayQueMirarlo || !entrada.representanteId) {
    return decidirRequisito(regla, { compuertaAbierta, esPrimerPago: entrada.esPrimerPago, representante: SIN_REPRESENTANTE })
  }
  const [estado, usuario] = await Promise.all([
    estadoDeIdentidadDe(entrada.representanteId),
    sinEmpresa('identidad: el equipo ve a quién pedirle la verificación del pago a un proveedor', (tx) =>
      tx.user.findUnique({ where: { id: entrada.representanteId! }, select: { email: true, name: true } })
    ),
  ])
  return decidirRequisito(regla, {
    compuertaAbierta,
    esPrimerPago: entrada.esPrimerPago,
    representante: {
      userId: entrada.representanteId,
      contacto: usuario ? `${usuario.name} · ${usuario.email}` : null,
      estado: estado.estado,
      nivel: estado.nivel,
    },
  })
}
