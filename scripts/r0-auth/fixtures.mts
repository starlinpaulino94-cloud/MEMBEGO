import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

export class VerificationFailure extends Error {
  constructor(readonly code: string) { super(code) }
}

export class RunFixtures {
  readonly suffix = randomUUID().replaceAll('-', '')
  readonly companyA = `r0_${this.suffix}_a`
  readonly companyB = `r0_${this.suffix}_b`
  readonly clientA = `r0_${this.suffix}_client_a`
  readonly clientB = `r0_${this.suffix}_client_b`
  readonly password = `${randomUUID()}!Qa9`
  readonly accounts: { readonly id: string; readonly localId: string; readonly email: string;
    readonly role: 'ADMIN_EMPRESA' | 'CLIENTE' | 'MARKETING' }[] = []
  constructor(readonly db: PrismaClient, readonly auth: SupabaseClient) {}

  async create() {
    for (const [id, label] of [[this.companyA, 'A'], [this.companyB, 'B']]) {
      if (!id || !label) throw new VerificationFailure('FIXTURE_ID_REQUIRED')
      await this.db.company.create({ data: { id, name: `R0 TEST ${label} ${this.suffix}`,
        slug: id, type: 'carwash', isActive: true, isPublished: false, isFeatured: false } })
    }
    for (const role of ['ADMIN_EMPRESA', 'CLIENTE', 'MARKETING'] as const) {
      const email = `r0-${this.suffix}-${role.toLowerCase()}@example.com`
      const created = await this.auth.auth.admin.createUser({ email, password: this.password, email_confirm: true })
      if (created.error || !created.data.user) throw new VerificationFailure('AUTH_CREATE_FAILED')
      const id = created.data.user.id
      const localId = `r0_${this.suffix}_${role.toLowerCase()}`
      this.accounts.push({ id, localId, email, role })
      await this.db.user.create({ data: { id: localId, supabaseId: id, email,
        name: `R0 ${role}`, role, companyId: this.companyA } })
      if (role === 'CLIENTE') {
        await this.db.cliente.create({ data: { id: this.clientA, companyId: this.companyA,
          supabaseId: id, email, nombre: `R0 cliente A ${this.suffix}`,
          notifPromos: false, notifRecordatorios: false } })
      }
      const metadata = await this.auth.auth.admin.updateUserById(id, { app_metadata: {
        role, dbUserId: localId, companyId: this.companyA,
        clienteId: role === 'CLIENTE' ? this.clientA : null,
      } })
      if (metadata.error) throw new VerificationFailure('AUTH_METADATA_FAILED')
    }
    await this.db.cliente.create({ data: { id: this.clientB, companyId: this.companyB,
      supabaseId: `local:r0_${this.suffix}`, esLocal: true, email: '',
      nombre: `R0 cliente B ${this.suffix}`, notifPromos: false, notifRecordatorios: false } })
    return { companyIds: [this.companyA, this.companyB], clientIds: [this.clientA, this.clientB],
      accounts: this.accounts.map(({ id, localId, role }) => ({ id, localId, role })) }
  }

  async cleanup() {
    const failures: string[] = []
    const identities = z.array(z.object({ id: z.string() })).parse(await this.db.$queryRaw`
      SELECT id::text FROM auth.users WHERE email LIKE ${`r0-${this.suffix}-%@example.com`}`)
    const companies = [this.companyA, this.companyB]
    try {
      await this.db.$transaction(async (tx) => {
        await tx.auditLog.deleteMany({ where: { companyId: { in: companies } } })
        await tx.referralEvent.deleteMany({ where: { clienteId: { in: [this.clientA, this.clientB] } } })
        await tx.cliente.deleteMany({ where: { id: { in: [this.clientA, this.clientB] } } })
        await tx.user.deleteMany({ where: { companyId: { in: companies } } })
        await tx.company.deleteMany({ where: { id: { in: companies } } })
      }, { timeout: 30_000 })
    } catch (error) {
      failures.push(error instanceof Prisma.PrismaClientKnownRequestError ? error.code : 'ROW_CLEANUP_FAILED')
    }
    for (const { id } of identities) {
      const deleted = await this.auth.auth.admin.deleteUser(id)
      if (deleted.error) failures.push('AUTH_CLEANUP_FAILED')
    }
    const remaining = z.array(z.object({ count: z.number() })).parse(await this.db.$queryRaw`
      SELECT (
        (SELECT count(*) FROM auth.users WHERE email LIKE ${`r0-${this.suffix}-%@example.com`}) +
        (SELECT count(*) FROM companies WHERE id IN (${this.companyA},${this.companyB})) +
        (SELECT count(*) FROM users WHERE "companyId" IN (${this.companyA},${this.companyB})) +
        (SELECT count(*) FROM clientes WHERE "companyId" IN (${this.companyA},${this.companyB})) +
        (SELECT count(*) FROM audit_logs WHERE "companyId" IN (${this.companyA},${this.companyB}))
      )::int AS count`)
    return { status: failures.length || remaining[0]?.count !== 0 ? 'FAIL' : 'PASS',
      ownedAuthIds: identities.map(({ id }) => id), companyIds: companies,
      clientIds: [this.clientA, this.clientB], remaining: remaining[0]?.count, failures }
  }
}
