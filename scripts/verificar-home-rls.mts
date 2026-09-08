import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const ref = 'ybzhvfmybyyomwpjpaud'
const api = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
const connection = new URL(process.env.DIRECT_URL ?? '')
assert.equal(api.hostname, `${ref}.supabase.co`)
assert.ok(connection.username.endsWith(`.${ref}`) || connection.hostname === `db.${ref}.supabase.co`)
const db = new PrismaClient({ datasourceUrl: connection.toString(), log: [] })
class RollbackPrueba extends Error {}

try {
  await db.$transaction(async (tx) => {
    const suffix = randomUUID()
    const companies = await Promise.all(['a', 'b'].map((label) => tx.company.create({
      data: { name: `QA Home ${label}`, slug: `qa-home-${label}-${suffix}`, type: 'carwash', esDemo: true },
    })))
    const a = companies[0]
    const b = companies[1]
    assert.ok(a && b)
    const revisions = await Promise.all([a, b].map((company) => tx.homeRevision.create({
      data: { companyId: company.id, territorio: 'QA', bloques: { create: { tipo: 'CABECERA', orden: 0 } } },
      include: { bloques: true },
    })))
    const own = revisions[0]
    const other = revisions[1]
    assert.ok(own && other)
    await tx.busquedaSinonimo.createMany({ data: [a, b].map((company) => ({
      companyId: company.id, termino: suffix, equivalencia: company.id,
    })) })

    // Estos permisos son transaccionales y nunca se confirman.
    await tx.$executeRawUnsafe('GRANT SELECT, INSERT, UPDATE, DELETE ON home_revisiones, home_bloques, busqueda_sinonimos TO authenticated')
    await tx.$executeRawUnsafe('SET LOCAL ROLE authenticated')
    const role = await tx.$queryRaw<{ rolbypassrls: boolean; rolsuper: boolean }[]>`
      SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user
    `
    assert.equal(role[0]?.rolbypassrls, false)
    assert.equal(role[0]?.rolsuper, false)
    await tx.$queryRaw`SELECT set_config('app.company_id', ${a.id}, true), set_config('app.omnisciente', 'off', true)`
    assert.deepEqual((await tx.homeRevision.findMany({ where: { id: { in: [own.id, other.id] } } })).map((r) => r.id), [own.id])
    assert.equal(await tx.homeBloque.count({ where: { revisionId: other.id } }), 0)
    assert.equal(await tx.busquedaSinonimo.count({ where: { termino: suffix } }), 1)
    assert.equal((await tx.homeRevision.updateMany({ where: { id: other.id }, data: { territorio: 'ajena' } })).count, 0)
    assert.equal((await tx.homeRevision.updateMany({ where: { id: own.id }, data: { territorio: 'propia' } })).count, 1)

    await tx.$executeRawUnsafe('SAVEPOINT escritura_ajena')
    await assert.rejects(() => tx.homeBloque.create({ data: { revisionId: other.id, tipo: 'HERO', orden: 1 } }))
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT escritura_ajena')
    await tx.$queryRaw`SELECT set_config('app.company_id', '', true)`
    assert.equal(await tx.homeRevision.count({ where: { id: { in: [own.id, other.id] } } }), 0)
    console.log('RLS Home: lectura propia, denegación A/B, escritura ajena rechazada y ausencia de contexto verificadas con rol sin bypass.')
    throw new RollbackPrueba()
  }, { timeout: 30000 })
} catch (error) {
  if (!(error instanceof RollbackPrueba)) throw error
  console.log('Fixtures y permisos temporales revertidos mediante ROLLBACK.')
} finally {
  await db.$disconnect()
}
