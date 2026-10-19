const scenario = () => globalThis.__cardnetPostgresScenario

async function waitAtBarrier(name) {
  const barrier = scenario()[name]
  if (!barrier || barrier.arrivals >= barrier.parties) return
  barrier.arrivals += 1
  if (barrier.arrivals === barrier.parties) barrier.release()
  await barrier.promise
}

export function getTokensPublicConfig() {
  scenario().configReads += 1
  return {
    publicKey: 'qa-public-key',
    captureUrl: 'https://lab.cardnet.com.do',
    scriptUrl: 'https://tr-tsp-test.gtp-seglan.com/widget.js',
  }
}

export async function obtenerCustomerId(input) {
  const current = scenario()
  current.customerIdCreates += 1
  await input.guardar?.('qa-customer-id')
  return { ok: true, customerId: 'qa-customer-id' }
}

export async function consultarClienteCardnet() {
  scenario().customerGets += 1
  return {
    denegado: false,
    email: scenario().email,
    captureUrl: 'https://lab.cardnet.com.do',
    uniqueId: 'qa-customer-unique-id',
    perfiles: scenario().profileAvailable
      ? [{
          paymentProfileId: 'qa-payment-profile',
          token: 'qa-local-profile-token',
          marca: 'VISA',
          ultimos4: '4242',
          habilitado: true,
        }]
      : [],
  }
}

export async function puedeCobrarToken() {
  scenario().capabilityChecks += 1
  await waitAtBarrier('reservationBarrier')
  return true
}

export async function montoDeObjetivo() {
  scenario().amountLookups += 1
  await waitAtBarrier('targetBarrier')
  return { ok: true, pesos: 1000 }
}

export async function cobrarConToken() {
  scenario().charges += 1
  if (!scenario().purchaseApproved) throw new Error('Unexpected CardNET Purchase call in PostgreSQL QA')
  return {
    aprobada: true,
    autorizacion: 'qa-authorization',
    codigo: '00',
    motivo: null,
    requiereActivacion: false,
    crudo: approvedPurchasePayload('qa-purchase-order'),
  }
}

export async function consultarComprasCardnet(input) {
  scenario().purchaseSearches += 1
  if (!scenario().purchaseApproved) throw new Error('Unexpected CardNET purchase search in PostgreSQL QA')
  return {
    ok: true,
    status: 200,
    json: {
      Response: [{
        ...approvedPurchasePayload(input.orderNumber).Response,
        CustomerId: input.customerId,
        Order: input.orderNumber,
        UniqueID: input.orderNumber,
        Created: new Date().toISOString(),
      }],
    },
  }
}

export async function activarPerfilCardnet() {
  scenario().profileActivations += 1
  return { ok: true, status: 200, errores: [], crudo: { _http: 200, Response: {} } }
}

function approvedPurchasePayload(order) {
  return {
    _http: 200,
    Response: {
      Order: order,
      UniqueID: order,
      AuthorizationCode: 'qa-authorization',
      Transaction: {
        TransactionStatusId: 1,
        Amount: 100000,
        AuthorizationCode: 'qa-authorization',
      },
    },
    Errors: [],
  }
}
