const scenario = () => globalThis.__cardnetServiceScenario

export async function conEmpresa(_companyId, work) {
  return work(scenario().tx)
}

export async function sinEmpresa(_reason, work) {
  return work(scenario().tx)
}

export async function getApiClientUser() {
  return scenario().authUser ?? null
}

export async function getUser() {
  return scenario().authUser ?? null
}

export function getTokensPublicConfig() {
  scenario().providerCalls += 1
  return scenario().config ?? null
}

export async function obtenerCustomerId() {
  scenario().providerCalls += 1
  scenario().customerIdLookups += 1
  return { ok: true, customerId: 'cardnet-customer-test' }
}

export async function consultarClienteCardnet() {
  scenario().providerCalls += 1
  scenario().customerGets += 1
  return scenario().customerResponse ?? null
}

export async function consultarComprasCardnet(params) {
  scenario().providerCalls += 1
  scenario().purchaseSearches.push(params)
  return scenario().searchResponse ?? { ok: true, json: { Response: { Purchases: [] } } }
}

export async function cobrarConToken(params) {
  scenario().providerCalls += 1
  scenario().chargeRequests.push({
    purchaseUniqueId: params.purchaseUniqueId,
    order: params.orden,
    amount: params.pesos,
    token: params.trxToken,
  })
  scenario().chargeCalls += 1
  return scenario().chargeResults.shift() ?? null
}

export async function activarPerfilCardnet() {
  scenario().providerCalls += 1
  return scenario().activationResult ?? null
}

export async function montoDeObjetivo() {
  scenario().amountLookups += 1
  return scenario().amountResult ?? { ok: true, pesos: 1000 }
}

export async function puedeCobrarToken() {
  scenario().providerCalls += 1
  return scenario().canCharge ?? true
}

export async function confirmarIntento() {
  return scenario().confirmationResult ?? { ok: true, entrega: 'COMPLETADA' }
}

export async function adquirirPromocion(user, promotionId) {
  scenario().promotionCalls.push({ user, promotionId })
  return scenario().promotionResult ?? null
}

export async function misClienteIds() {
  const clienteId = scenario().authUser?.metadata.clienteId
  return clienteId ? [clienteId] : []
}

export async function registrarTransicionCompra() {
  return undefined
}

export function revalidatePath() {
  return undefined
}

export function corsHeaders() {
  return new Headers()
}

export async function handleCorsPreflight() {
  return new Response(null, { status: 204 })
}

export async function paymentSessionLimiter() {
  return true
}

export async function paymentLimiter() {
  return true
}

export async function formSubmitLimiter() {
  return true
}

export async function rutaValida() {
  return true
}

export async function notificarAdmins() {
  return undefined
}
