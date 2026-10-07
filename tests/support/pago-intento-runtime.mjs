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

export async function activarCompraPromocion() {
  scenario().activationCalls += 1
  return { ok: true }
}

export async function activarMembresia() {
  scenario().activationCalls += 1
  return { ok: true }
}

export async function reintentarEntrega() {
  const current = scenario()
  current.fulfillmentRetryCalls += 1
  return current.fulfillmentRetryResult ?? { ok: true, entrega: 'PENDIENTE' }
}
