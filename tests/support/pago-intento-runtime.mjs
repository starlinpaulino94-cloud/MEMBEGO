const scenario = () => globalThis.__pagoIntentoScenario

export async function conEmpresa(_companyId, work) {
  return work(scenario().tx)
}

export async function sinEmpresa(_reason, work) {
  return work(scenario().tx)
}

export function anotarFallo() {
  return () => undefined
}

export async function activarCompraPromocion(_compraId, _userId, _meta, options = {}) {
  const current = scenario()
  if (current.beforeActivationClaim) await current.beforeActivationClaim()
  const claim = options.fulfillmentClaim
  if (claim) {
    const result = await current.tx.pagoIntento.updateMany({
      where: {
        id: claim.intentoId,
        estado: 'APROBADO',
        fulfillmentEstado: 'PROCESANDO',
        updatedAt: claim.claimAt,
      },
      data: { fulfillmentEstado: 'COMPLETADA', fulfillmentAt: new Date(), fulfillmentError: null },
    })
    if (result.count !== 1) return { ok: false, error: 'FULFILLMENT_CLAIM_LOST' }
  }
  current.activationCalls += 1
  return { ok: true }
}

export async function activarMembresia(_membershipId, _userId, _meta, claim) {
  const current = scenario()
  if (current.beforeActivationClaim) await current.beforeActivationClaim()
  if (claim) {
    const result = await current.tx.pagoIntento.updateMany({
      where: {
        id: claim.intentoId,
        estado: 'APROBADO',
        fulfillmentEstado: 'PROCESANDO',
        updatedAt: claim.claimAt,
      },
      data: { fulfillmentEstado: 'COMPLETADA', fulfillmentAt: new Date(), fulfillmentError: null },
    })
    if (result.count !== 1) throw new Error('FULFILLMENT_CLAIM_LOST')
  }
  current.activationCalls += 1
  return { ok: true }
}

export async function reintentarEntrega() {
  const current = scenario()
  current.fulfillmentRetryCalls += 1
  return current.fulfillmentRetryResult ?? { ok: true, entrega: 'PENDIENTE' }
}
