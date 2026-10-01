/**
 * MEMBEGO SUPPLY · DATOS DE DEMOSTRACIÓN (encargo 2026-09 bis, §47).
 *
 * Crea, POR EL DOMINIO y no con inserts sueltos, un caso completo que se puede
 * recorrer desde la interfaz:
 *
 *   Little Pizza Demo (proveedor registrado) · acuerdo de 500 pizzas a RD$300
 *   (precio público RD$600) · orden aprobada, confirmada y recibida (lote de
 *   500) · oferta publicada a RD$399 (100 unidades) · campaña de bienvenida
 *   (50 unidades) con tres clientes ya beneficiados · acuerdo a comisión
 *   (combo familiar a RD$700, 15 %) · depósito abierto de RD$50.000.
 *
 * Idempotente: si la empresa demo ya tiene acuerdos, no hace nada. Nada de
 * esto está en la interfaz como dato fijo: es una base con operación real.
 *
 *   npm run db:seed:supply
 */
import { prisma } from '../src/lib/prisma'
import { PREFIJO_CUENTA_SIN_LOGIN } from '../src/modules/supply-v2/core/autorizadas'
import { habilitarProveedorExistente } from '../src/modules/supply/proveedores'
import { crearAcuerdo, crearOrden, generarLotes, moverAcuerdo, moverOrden } from '../src/modules/supply/procurement'
import { asignar } from '../src/modules/supply/asignaciones'
import { entregar } from '../src/modules/supply/distribucion'
import { registrarPago, confirmarPago } from '../src/modules/supply/finanzas'
import { registrarDeposito } from '../src/modules/supply/depositos'

const SLUG = 'little-pizza-demo'
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
  const empresa = await prisma.company.upsert({
    where: { slug: SLUG },
    update: {},
    create: {
      name: 'Little Pizza Demo',
      slug: SLUG,
      type: 'restaurante',
      ciudad: 'Santo Domingo',
      capacidades: { overrides: { MEMBEGO_SUPPLIER: true } },
    },
    select: { id: true, name: true },
  })
  const yaTiene = await prisma.supplyAcuerdo.count({ where: { proveedorId: empresa.id } })
  if (yaTiene > 0) {
    console.warn(`[seed-supply] ${empresa.name} ya tiene ${yaTiene} acuerdo(s): no se siembra nada más.`)
    return
  }

  const [creador, aprobador] = await Promise.all([
    usuario('supply.compras@membego.com', 'Compras Membego'),
    usuario('supply.finanzas@membego.com', 'Finanzas Membego'),
  ])
  const sucursal = await prisma.sucursal.upsert({
    where: { id: `${SLUG}-sucursal` },
    update: {},
    create: { id: `${SLUG}-sucursal`, companyId: empresa.id, nombre: 'Little Pizza · Naco', direccion: 'Av. Tiradentes 12' },
    select: { id: true },
  })
  await habilitarProveedorExistente(empresa.id, { contactoNombre: 'Laura Peña', contactoTelefono: '809-555-0101', plazoPagoDias: 15, banco: 'Banreservas', cuentaBancaria: '960-000000-1', condicionesPago: '50 % anticipo, resto a 15 días' }, creador.id)

  const clientes = []
  for (const [i, nombre] of ['Ana Demo', 'Luis Demo', 'María Demo'].entries()) {
    const c = await prisma.cliente.upsert({
      where: { id: `${SLUG}-cliente-${i}` },
      update: {},
      create: { id: `${SLUG}-cliente-${i}`, companyId: empresa.id, supabaseId: `demo-cliente-${i}`, nombre, email: `cliente${i}@demo.membego.com` },
      select: { id: true },
    })
    clientes.push(c.id)
  }

  const hoy = new Date()
  const inicio = new Date(hoy.getTime() - DIA)
  const fin = new Date(hoy.getTime() + 120 * DIA)

  // Acuerdo de compra anticipada: 500 pizzas a 300, precio público 600.
  const acuerdo = await crearAcuerdo({
    proveedorId: empresa.id, tipo: 'ON_DEMAND', modeloComercial: 'COMPRA_UNIDAD_COMPLETA', modalidadPago: 'PREPAGO_PARCIAL',
    politicaSobrante: 'EXTENDER', itemNombre: 'Pizza grande', varianteEtiqueta: 'Pepperoni', cantidad: 500, costoUnitario: 300,
    precioReferencia: 600, anticipoPorcentaje: 50, plazoPagoDias: 15, frecuenciaCorte: 'QUINCENAL', inicioAt: inicio, finAt: fin,
    sucursalIds: [sucursal.id], capacidadDiaria: 40, horarioTexto: '11:00-22:00', reglasRedencion: 'QR de Membego obligatorio.',
    creadoPorId: creador.id, tipoAcuerdo: 'COMPRA_PREPAGO', alcance: 'ITEM',
  })
  await moverAcuerdo(acuerdo.id, 'PENDIENTE_APROBACION')
  await moverAcuerdo(acuerdo.id, 'APROBADO', aprobador.id)
  await moverAcuerdo(acuerdo.id, 'ACTIVO')

  const orden = await crearOrden({ acuerdoId: acuerdo.id, lineas: [{ itemNombre: 'Pizza grande', varianteEtiqueta: 'Pepperoni', cantidad: 500, costoUnitario: 300 }], impuestos: 0, creadoPorId: creador.id })
  await moverOrden(orden.id, 'PENDIENTE_APROBACION', creador.id)
  await moverOrden(orden.id, 'APROBADA', aprobador.id)
  await moverOrden(orden.id, 'CONFIRMADA', aprobador.id)
  const anticipo = await registrarPago({ acuerdoId: acuerdo.id, ordenId: orden.id, tipo: 'ANTICIPO', monto: 75_000, metodo: 'TRANSFERENCIA', referencia: 'DEMO-ANT-001', registradoPorId: creador.id })
  await confirmarPago(anticipo.id, aprobador.id)
  const [lote] = await generarLotes(orden.id, aprobador.id)

  // Oferta publicable a 399 y campaña de bienvenida gratis.
  const oferta = await asignar({ loteId: lote!.id, destinoTipo: 'OFERTA', etiqueta: 'Pizza grande a RD$399', cantidad: 100, precioCliente: 399, maxPorCliente: 2, creadoPorId: creador.id })
  const bienvenida = await asignar({ loteId: lote!.id, destinoTipo: 'CAMPANA', etiqueta: 'Bienvenida Membego', cantidad: 50, creadoPorId: creador.id })
  for (const clienteId of clientes) {
    await entregar({ clienteId, destino: 'CAMPANA', asignacionId: bienvenida.id, referencia: 'seed-demo', actorId: creador.id })
  }

  // Acuerdo a comisión: Membego vende el combo del proveedor y retiene 15 %.
  const comision = await crearAcuerdo({
    proveedorId: empresa.id, tipo: 'ON_DEMAND', modeloComercial: 'COMISION', modalidadPago: 'PAGO_POR_REDENCION', politicaSobrante: 'EXPIRAR',
    itemNombre: 'Combo familiar', cantidad: 200, costoUnitario: 0, precioReferencia: 700, comisionPorcentaje: 15, inicioAt: inicio, finAt: fin,
    creadoPorId: creador.id, tipoAcuerdo: 'VENTA_COMISION', alcance: 'ITEM',
  })
  await moverAcuerdo(comision.id, 'PENDIENTE_APROBACION')
  await moverAcuerdo(comision.id, 'APROBADO', aprobador.id)
  await moverAcuerdo(comision.id, 'ACTIVO')

  // Depósito abierto de 50.000 contra el acuerdo de compra.
  const deposito = await registrarDeposito({ proveedorId: empresa.id, acuerdoId: acuerdo.id, monto: 50_000, referencia: 'DEMO-DEP-001', registradoPorId: creador.id })
  await confirmarPago(deposito.pagoId, aprobador.id)

  console.warn(`[seed-supply] listo: ${empresa.name} · acuerdo ${acuerdo.codigo} · orden ${orden.numero} · lote ${lote!.codigo} · oferta ${oferta.id} · comisión ${comision.codigo} · depósito ${deposito.codigo}`)
}

main()
  .catch((e) => {
    console.error('[seed-supply] falló:', e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
