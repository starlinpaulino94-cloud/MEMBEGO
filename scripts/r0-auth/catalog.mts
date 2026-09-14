import { PrismaClient } from '@prisma/client'
import { z } from 'zod'

export async function attestCatalog(db: PrismaClient) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`
    await tx.$executeRaw`SET LOCAL statement_timeout = '10s'`
    const roles = z.array(z.object({ name: z.string(), bypass: z.boolean(), superuser: z.boolean(),
      connection: z.boolean() })).parse(await tx.$queryRaw`
      SELECT rolname AS name, rolbypassrls AS bypass, rolsuper AS superuser,
        rolname = current_user AS connection FROM pg_roles
      WHERE rolname = current_user OR rolname = 'membego_app'`)
    const tables = z.array(z.object({ name: z.string(), enabled: z.boolean(), forced: z.boolean(),
      owner: z.string() })).parse(await tx.$queryRaw`
      SELECT c.relname AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
        pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN
        ('companies','users','clientes','plans','memberships','home_revisiones','home_bloques')`)
    const policies = z.array(z.object({ table: z.string(), name: z.string(), command: z.string() }))
      .parse(await tx.$queryRaw`
      SELECT tablename AS table, policyname AS name, cmd AS command FROM pg_policies
      WHERE schemaname = 'public' AND tablename IN
        ('companies','users','clientes','plans','memberships','home_revisiones','home_bloques')`)
    return { roles, tables, policies,
      restrictedRoleAvailable: roles.some((role) => role.name === 'membego_app' && !role.bypass && !role.superuser) }
  }, { maxWait: 10_000, timeout: 20_000 })
}
