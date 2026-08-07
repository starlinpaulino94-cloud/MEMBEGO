import { createClient } from '@supabase/supabase-js'
import { prisma } from './prisma'
import { SEED_COMPANIES } from './data/companies'
import { BUSINESS_CATEGORIES } from './data/categories'
import { seedCatalogoGeo } from '@/modules/geo/catalogo/seed'
import { nuevoTokenQr, vencimientoQr } from '@/modules/qr/token'

/**
 * Seed idempotente de MembeGo: empresas, sucursal, métodos de pago, planes y
 * usuarios de prueba. Crea los usuarios en Supabase Auth y en la BD,
 * sincronizando app_metadata (rol, dbUserId, companyId, clienteId) para que el
 * login y los guards funcionen de inmediato.
 *
 * Se ejecuta con `bun run db:seed` (tsx prisma/seed.ts → runSeed).
 */

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.'
    )
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

type SeedRole = 'SUPERADMIN' | 'ADMIN_EMPRESA' | 'EMPLEADO' | 'CLIENTE'

interface SeedUser {
  email: string
  password: string
  nombre: string
  role: SeedRole
  companySlug: string | null
  vehiculo?: {
    marca: string
    modelo: string
    anio: number
    color: string
    placa: string
  }
}

const SEED_USERS: SeedUser[] = [
  {
    email: 'superadmin@membego.com',
    password: 'admin123',
    nombre: 'Super Admin',
    role: 'SUPERADMIN',
    companySlug: null,
  },
  {
    email: 'admin.cartown@membego.com',
    password: 'admin123',
    nombre: 'Carlos Lavado',
    role: 'ADMIN_EMPRESA',
    companySlug: 'cartown',
  },
  {
    email: 'admin.tonis@membego.com',
    password: 'admin123',
    nombre: 'María Sabor',
    role: 'ADMIN_EMPRESA',
    companySlug: 'tonis',
  },
  {
    email: 'empleado.cartown@membego.com',
    password: 'admin123',
    nombre: 'Juan Esponja',
    role: 'EMPLEADO',
    companySlug: 'cartown',
  },
  {
    email: 'cliente@membego.com',
    password: 'cliente123',
    nombre: 'Pedro Cliente',
    role: 'CLIENTE',
    companySlug: 'cartown',
    vehiculo: {
      marca: 'Toyota',
      modelo: 'Corolla',
      anio: 2021,
      color: 'Blanco',
      placa: 'A123456',
    },
  },
]

async function upsertAuthUser(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  u: { email: string; password: string; nombre: string }
): Promise<string> {
  const { data: existing } = await supabaseAdmin.auth.admin.listUsers()
  const found = existing?.users?.find((x) => x.email === u.email)

  if (found) {
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
      found.id,
      {
        password: u.password,
        email_confirm: true,
        user_metadata: { name: u.nombre },
      }
    )
    if (error) throw new Error(`updateUserById ${u.email}: ${error.message}`)
    return data.user!.id
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: u.email,
    password: u.password,
    email_confirm: true,
    user_metadata: { name: u.nombre },
  })
  if (error) throw new Error(`createUser ${u.email}: ${error.message}`)
  return data.user!.id
}

export interface SeedResult {
  companies: number
  plans: number
  users: number
  clientes: number
  details: string[]
}

export async function runSeed(): Promise<SeedResult> {
  const supabaseAdmin = createAdminClient()
  const details: string[] = []
  let plansCount = 0
  let usersCount = 0
  let clientesCount = 0

  // 0. Catálogo geográfico normalizado de RD (ONE/OSM, idempotente).
  const geo = await seedCatalogoGeo()
  details.push(
    `Geo: ${geo.countries} país · ${geo.regions} provincias · ${geo.cities} municipios · ${geo.sectors} sectores (${geo.sectorsVerificados} verificados)`
  )

  // 1. Categorías de negocio del marketplace (idempotente por slug)
  for (const cat of BUSINESS_CATEGORIES) {
    await prisma.businessCategory.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name, icon: null, order: cat.order, active: true },
      create: {
        name: cat.name,
        slug: cat.slug,
        order: cat.order,
      },
    })
  }
  details.push(`Categorías: ${BUSINESS_CATEGORIES.length}`)

  // 1. Empresas + sucursal principal + método de pago + planes
  const companiesBySlug: Record<
    string,
    { id: string; name: string; type: string; firstPlanId: string | null }
  > = {}

  for (const company of SEED_COMPANIES) {
    const c = await prisma.company.upsert({
      where: { slug: company.slug },
      update: {
        name: company.name,
        type: company.type,
        description: company.description,
        isActive: true,
      },
      create: {
        name: company.name,
        slug: company.slug,
        type: company.type,
        description: company.description,
      },
    })
    details.push(`Empresa: ${c.name}`)

    // Sucursal principal (una por empresa para demo)
    const sucursalExistente = await prisma.sucursal.findFirst({
      where: { companyId: c.id, nombre: 'Sucursal Principal' },
    })
    if (!sucursalExistente) {
      await prisma.sucursal.create({
        data: {
          companyId: c.id,
          nombre: 'Sucursal Principal',
          direccion:
            c.type === 'carwash'
              ? 'Av. 27 de Febrero #100, Santiago'
              : 'Calle El Sol #45, Santo Domingo',
          telefono: c.type === 'carwash' ? '809-555-0100' : '809-555-0200',
          activa: true,
        },
      })
      details.push(`  Sucursal Principal creada`)
    }

    // Método de pago por transferencia (reemplaza el antiguo bankAccount)
    const metodoExistente = await prisma.metodoPago.findFirst({
      where: { companyId: c.id, nombre: 'Banco Popular' },
    })
    if (!metodoExistente) {
      await prisma.metodoPago.create({
        data: {
          companyId: c.id,
          tipo: 'TRANSFERENCIA',
          nombre: 'Banco Popular',
          titular: c.name,
          numeroCuenta: '1234567890',
          tipoCuenta: 'Ahorro',
          instrucciones:
            'Realiza la transferencia y envía el comprobante con tu nombre y el plan seleccionado.',
          activo: true,
        },
      })
      details.push(`  Método de pago creado`)
    }

    // Planes
    let firstPlanId: string | null = null
    for (const plan of company.plans) {
      const existing = await prisma.plan.findFirst({
        where: { companyId: c.id, nombre: plan.nombre },
      })
      const data = {
        precio: plan.precio,
        lavadosIncluidos: plan.lavadosIncluidos,
        esIlimitado: plan.esIlimitado,
        descripcion: plan.descripcion,
        beneficios: plan.beneficios,
        activo: true,
      }
      if (existing) {
        await prisma.plan.update({ where: { id: existing.id }, data })
        firstPlanId ??= existing.id
      } else {
        const created = await prisma.plan.create({
          data: { companyId: c.id, nombre: plan.nombre, ...data },
        })
        firstPlanId ??= created.id
        plansCount++
      }
    }

    companiesBySlug[company.slug] = {
      id: c.id,
      name: c.name,
      type: c.type,
      firstPlanId,
    }
  }

  // 2. Usuarios
  for (const u of SEED_USERS) {
    const supabaseId = await upsertAuthUser(supabaseAdmin, u)
    const companyId = u.companySlug
      ? companiesBySlug[u.companySlug]?.id ?? null
      : null

    const dbUser = await prisma.user.upsert({
      where: { supabaseId },
      update: { email: u.email, name: u.nombre, role: u.role, companyId },
      create: {
        supabaseId,
        email: u.email,
        name: u.nombre,
        role: u.role,
        companyId,
      },
    })
    usersCount++

    // Cliente: perfil + vehículo + membresía activa + QR
    let clienteId: string | null = null
    if (u.role === 'CLIENTE' && companyId) {
      const cliente = await prisma.cliente.upsert({
        where: { supabaseId_companyId: { supabaseId, companyId } },
        update: { nombre: u.nombre, email: u.email },
        create: {
          companyId,
          supabaseId,
          nombre: u.nombre,
          email: u.email,
        },
      })
      clienteId = cliente.id
      clientesCount++

      if (u.vehiculo) {
        const existingVeh = await prisma.vehiculo.findFirst({
          where: { clienteId: cliente.id, placa: u.vehiculo.placa },
        })
        if (!existingVeh) {
          await prisma.vehiculo.create({
            data: { clienteId: cliente.id, ...u.vehiculo },
          })
        }
      }

      // Membresía activa sobre el primer plan de la empresa + QR asociado.
      // QrToken requiere una membresía, así que ambos van juntos.
      const firstPlanId = companiesBySlug[u.companySlug!]?.firstPlanId ?? null
      if (firstPlanId) {
        const plan = await prisma.plan.findUnique({ where: { id: firstPlanId } })
        const now = new Date()
        const vencimiento = new Date(now)
        vencimiento.setDate(vencimiento.getDate() + (plan?.vigenciaDias ?? 30))

        const membership = await prisma.membership.upsert({
          where: { clienteId_companyId: { clienteId: cliente.id, companyId } },
          update: {},
          create: {
            clienteId: cliente.id,
            companyId,
            planId: firstPlanId,
            estado: 'ACTIVA',
            pagoConfirmado: true,
            montoPagado: plan?.precio ?? 0,
            fechaInicio: now,
            fechaVencimiento: vencimiento,
            lavadosRestantes: plan?.esIlimitado
              ? 0
              : plan?.lavadosIncluidos ?? 0,
          },
        })

        const existingQr = await prisma.qrToken.findFirst({
          where: { membresiaId: membership.id },
        })
        if (!existingQr) {
          await prisma.qrToken.create({
            data: {
              clienteId: cliente.id,
              membresiaId: membership.id,
              token: nuevoTokenQr(), expiraAt: vencimientoQr(),
              activo: true,
            },
          })
        }
      }
    }

    await supabaseAdmin.auth.admin.updateUserById(supabaseId, {
      app_metadata: {
        role: u.role,
        dbUserId: dbUser.id,
        clienteId,
        companyId,
      },
    })
    details.push(`Usuario: ${u.email} (${u.role})`)
  }

  return {
    companies: SEED_COMPANIES.length,
    plans: plansCount,
    users: usersCount,
    clientes: clientesCount,
    details,
  }
}
