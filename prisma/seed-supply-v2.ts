/**
 * MEMBEGO SUPPLY 2.0 · DATOS DE DEMOSTRACIÓN (Slice 1, §47).
 *
 * Crea, POR EL DOMINIO y no con inserts sueltos, un caso que se puede
 * recorrer desde la interfaz:
 *
 *   Little Pizza Demo (proveedor externo) · Pizza Grande Pepperoni
 *   (PIZ-PEP-G, precio público RD$600) · acuerdo de compra anticipada a
 *   RD$300 vigente · orden de 1.000 unidades APROBADA y SIN recibir, para
 *   que la recepción parcial se pruebe desde la pantalla.
 *
 * Solo datos V2. Idempotente: si el proveedor demo ya existe, no hace nada.
 *
 *   npm run db:seed:supply-v2
 */
import { prisma } from '../src/lib/prisma'
import { PREFIJO_CUENTA_SIN_LOGIN } from '../src/modules/supply-v2/core/autorizadas'
import { sinEmpresa } from '../src/lib/tenant'
import { crearProveedorExternoEnTx } from '../src/modules/supply-v2/suppliers/service'
import { crearItemCatalogoEnTx } from '../src/modules/supply-v2/catalog/service'
import { activarAcuerdoEnTx, crearAcuerdoEnTx } from '../src/modules/supply-v2/agreements/service'
import { aprobarOrdenEnTx, crearOrdenEnTx, enviarAprobacionEnTx } from '../src/modules/supply-v2/procurement/orders'

const NOMBRE = 'Little Pizza Demo (Supply 2.0)'
const DIA = 86_400_000

/**
 * Cuenta de DEMOSTRACIÓN para atribuir autoría: no existe en Supabase Auth,
 * así que no puede iniciar sesión ni aprobar nada. El prefijo sale de
 * `PREFIJO_CUENTA_SIN_LOGIN` para que el contador de personas autorizadas la
 * descarte sin posibilidad de desincronizarse.
 */
async function usuario(email: string, name: string) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name, role: 'SUPERADMIN', supabaseId: `${PREFIJO_CUENTA_SIN_LOGIN}${email}` },
    select: { id: true },
  })
}

async function main() {
  const existente = await prisma.supplyV2Supplier.findFirst({ where: { commercialName: NOMBRE }, select: { id: true } })
  if (existente) {
    console.warn(`[seed-supply-v2] ${NOMBRE} ya existe: no se siembra nada más.`)
    return
  }
  const [compras, finanzas] = await Promise.all([
    usuario('supply2.compras@membego.com', 'Compras Membego'),
    usuario('supply2.finanzas@membego.com', 'Finanzas Membego'),
  ])
  const como = (actorId: string) => ({ actorId, ipAddress: null, userAgent: 'seed' })
  const hoy = new Date()

  const resultado = await sinEmpresa('Seed Supply 2.0: caso de demostración', async (tx) => {
    const proveedor = await crearProveedorExternoEnTx(
      tx,
      { commercialName: NOMBRE, contactName: 'Laura Peña', whatsapp: '809-555-0101', email: 'compras@littlepizza.demo', city: 'Santo Domingo', currency: 'DOP', paymentTermsDays: 15, paymentTermsText: '50 % anticipo, resto a 15 días' },
      como(compras.id)
    )
    const pizza = await crearItemCatalogoEnTx(
      tx,
      { supplierId: proveedor.id, type: 'PRODUCT', name: 'Pizza Grande Pepperoni', sku: 'PIZ-PEP-G', category: 'Pizzas', publicPrice: 600, currency: 'DOP', unit: 'UNIT' },
      como(compras.id)
    )
    const acuerdo = await crearAcuerdoEnTx(
      tx,
      { supplierId: proveedor.id, type: 'PREPAID_PURCHASE', catalogItemId: pizza.id, negotiatedUnitCost: 300, paymentTermsDays: 15, startsAt: new Date(hoy.getTime() - DIA), endsAt: new Date(hoy.getTime() + 365 * DIA), notes: 'Acuerdo de demostración.' },
      como(compras.id)
    )
    await activarAcuerdoEnTx(tx, acuerdo.id, como(compras.id))
    const orden = await crearOrdenEnTx(
      tx,
      { supplierId: proveedor.id, agreementId: acuerdo.id, lines: [{ catalogItemId: pizza.id, quantity: 1000, unitCost: 300 }], paymentMode: 'PREPAID', notes: 'Orden de demostración: recíbela por partes desde la pantalla.' },
      como(compras.id)
    )
    await enviarAprobacionEnTx(tx, orden.id, como(compras.id))
    await aprobarOrdenEnTx(tx, orden.id, como(finanzas.id))
    return { proveedor, pizza, acuerdo, orden }
  })

  console.warn(`[seed-supply-v2] ${NOMBRE} · ${resultado.pizza.name} · ${resultado.acuerdo.code} · ${resultado.orden.number} (APROBADA, 1.000 unidades sin recibir).`)
  console.warn('[seed-supply-v2] Abre /superadmin/supply-v2/compras y registra la primera recepción.')
}

main()
  .catch((e) => {
    console.error('[seed-supply-v2] falló:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
