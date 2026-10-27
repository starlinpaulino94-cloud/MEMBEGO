/**
 * VERIFICACIÓN DE IDENTIDAD · Fase 6 · las POLÍTICAS DE SEGURIDAD POR FILA, probadas como el rol de la aplicación.
 *
 * Hoy la aplicación se conecta como `postgres`, que se salta RLS (ver src/lib/tenant.ts): las políticas son una segunda barrera
 * que entra en vigor el día que `DATABASE_URL` pase a `membego_app`. Una política mal escrita no se notaría hasta ese día,
 * así que aquí se instala el archivo REAL (`prisma/migrations_manual/2026-10-rls-identidad.sql`) y se prueba cada tabla de
 * identidad con `SET LOCAL ROLE membego_app` y el contexto que fija `conUsuario` / `conEmpresa` / `sinEmpresa`.
 *
 * Cada prueba falla si vuelve el defecto que cierra:
 *   1 · una persona lee, cambia o inserta filas de identidad de OTRA persona;
 *   2 · una empresa (o una petición sin contexto) lee algo de identidad de alguien;
 *   3 · las tablas de la plataforma (interruptor, reglas, bandeja de avisos) las toca quien no es el sistema;
 *   4 · una tabla nueva de identidad nace sin RLS o sin política (se quedaría abierta el día del cambio de rol);
 *   5 · el rol de la aplicación puede saltarse las políticas.
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { prisma } from '../../src/lib/prisma'

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const RAIZ = join(__dirname, '..', '..')
const TABLAS_DE_LA_PERSONA = ['identidad_verificaciones', 'identidad_intentos', 'identidad_consentimientos', 'identidad_incidencias'] as const
const TABLAS_DE_LA_PLATAFORMA = ['identidad_interruptores', 'identidad_eventos_externos', 'identidad_reglas'] as const
const TODAS = [...TABLAS_DE_LA_PERSONA, ...TABLAS_DE_LA_PLATAFORMA]

let a = ''
let b = ''
let empresa = ''

type Contexto = { userId?: string; companyId?: string; omnisciente?: boolean }

/** Corre `fn` DENTRO de una transacción como `membego_app` y con el contexto dado, y la deshace al final. */
async function como<T>(ctx: Contexto, fn: (q: (sql: string) => Promise<Record<string, unknown>[]>) => Promise<T>): Promise<T> {
  const SALIDA = Symbol('deshacer')
  let resultado!: T
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE membego_app')
      if (ctx.userId) await tx.$queryRaw`SELECT set_config('app.user_id', ${ctx.userId}, true)`
      if (ctx.companyId) await tx.$queryRaw`SELECT set_config('app.company_id', ${ctx.companyId}, true)`
      if (ctx.omnisciente) await tx.$queryRaw`SELECT set_config('app.omnisciente', 'on', true)`
      resultado = await fn((sql) => tx.$queryRawUnsafe(sql) as Promise<Record<string, unknown>[]>)
      throw SALIDA
    })
  } catch (e) {
    if (e !== SALIDA) throw e
  }
  return resultado
}
const cuenta = async (q: (s: string) => Promise<Record<string, unknown>[]>, tabla: string, donde = 'true') =>
  Number((await q(`SELECT count(*)::int AS n FROM "${tabla}" WHERE ${donde}`))[0]!.n)
const aplica = async (q: (s: string) => Promise<Record<string, unknown>[]>, sql: string) => {
  const r = await q(sql)
  return r.length
}

before(async () => {
  // El rol de la aplicación: en producción lo instala la Capa 2 de RLS; aquí se crea igual de limitado (sin BYPASSRLS).
  await prisma.$executeRawUnsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'membego_app') THEN CREATE ROLE membego_app NOLOGIN NOBYPASSRLS; END IF;
  END $$`)
  await prisma.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO membego_app')
  for (const t of TODAS) await prisma.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${t}" TO membego_app`)
  // Se instala el archivo REAL de políticas (un DO con varias sentencias: se corre con la herramienta de Prisma).
  const r = spawnSync('npx', ['prisma', 'db', 'execute', '--file', join(RAIZ, 'prisma/migrations_manual/2026-10-rls-identidad.sql'), '--url', process.env.DATABASE_URL!], {
    cwd: RAIZ,
    encoding: 'utf8',
    shell: true,
  })
  assert.equal(r.status, 0, `no se pudo instalar el archivo de políticas: ${r.stdout}${r.stderr}`)

  const ua = await prisma.user.create({ data: { supabaseId: `sb-rls-a-${sufijo}`, email: `rls-a-${sufijo}@prueba.test`, name: 'Persona A', role: 'CLIENTE' }, select: { id: true } })
  const ub = await prisma.user.create({ data: { supabaseId: `sb-rls-b-${sufijo}`, email: `rls-b-${sufijo}@prueba.test`, name: 'Persona B', role: 'CLIENTE' }, select: { id: true } })
  a = ua.id
  b = ub.id
  empresa = (await prisma.company.create({ data: { name: `RLS ${sufijo}`, slug: `rls-${sufijo}`, type: 'carwash' }, select: { id: true } })).id
  for (const [u, etiqueta] of [[a, 'a'], [b, 'b']] as const) {
    await prisma.identidadVerificacion.create({ data: { userId: u, estado: 'verificada', nivel: 'documento_selfie', viaVerificacion: 'proveedor_documento_selfie', proveedor: 'didit', verificadaEn: new Date(), expiraEn: new Date(Date.now() + 86_400_000), hashDedupe: `hash-rls-${etiqueta}-${sufijo}` } })
    await prisma.identidadIntento.create({ data: { userId: u, estado: 'aprobada', canal: 'web', resueltoAt: new Date() } })
    await prisma.identidadConsentimiento.create({ data: { userId: u, tipo: 'IDENTIDAD_BIOMETRIA', textoVersion: 'identidad-biometria-v1', canal: 'web' } })
    await prisma.identidadIncidencia.create({ data: { userId: u, tipo: 'otro', mensaje: `incidencia ${etiqueta}`, estado: 'abierta' } })
  }
  await prisma.identidadInterruptor.upsert({ where: { clave: 'VERIFICACION_IDENTIDAD' }, create: { clave: 'VERIFICACION_IDENTIDAD', enabled: false, reason: 'prueba' }, update: {} })
})

test('1 · UNA PERSONA SOLO VE LO SUYO: sus filas en las cuatro tablas, nunca las de otra', async () => {
  await como({ userId: a }, async (q) => {
    for (const t of TABLAS_DE_LA_PERSONA) {
      assert.equal(await cuenta(q, t, `"userId" = '${a}'`), 1, `${t}: lo suyo se ve`)
      assert.equal(await cuenta(q, t, `"userId" = '${b}'`), 0, `${t}: lo de otra persona no se ve`)
    }
  })
  await como({ userId: b }, async (q) => {
    for (const t of TABLAS_DE_LA_PERSONA) assert.equal(await cuenta(q, t, `"userId" = '${a}'`), 0, t)
  })
})

test('1b · NI CAMBIA, NI BORRA, NI INSERTA lo de otra persona (la política también filtra la escritura)', async () => {
  await como({ userId: a }, async (q) => {
    for (const t of TABLAS_DE_LA_PERSONA) {
      assert.equal(await aplica(q, `UPDATE "${t}" SET "userId" = "userId" WHERE "userId" = '${b}' RETURNING 1`), 0, `${t}: no actualiza lo de otra persona`)
      assert.equal(await aplica(q, `DELETE FROM "${t}" WHERE "userId" = '${b}' RETURNING 1`), 0, `${t}: no borra lo de otra persona`)
    }
  })
  // Insertar una fila A NOMBRE de otra persona: la base lo rechaza (WITH CHECK).
  await assert.rejects(
    () =>
      como({ userId: a }, async (q) => {
        await q(`INSERT INTO "identidad_incidencias" ("id","userId","tipo","mensaje","estado","creadaAt","updatedAt") VALUES ('inc-rls-${sufijo}','${b}','otro','suplantada','abierta',now(),now())`)
      }),
    /row-level security|violates/i
  )
  // …y a nombre propio sí entra (la política no bloquea lo legítimo).
  await como({ userId: a }, async (q) => {
    await q(`INSERT INTO "identidad_incidencias" ("id","userId","tipo","mensaje","estado","creadaAt","updatedAt") VALUES ('inc-propia-${sufijo}','${a}','otro','mía','abierta',now(),now())`)
    assert.equal(await cuenta(q, 'identidad_incidencias', `"userId" = '${a}'`), 2)
  })
})

test('2 · UNA EMPRESA, O UNA PETICIÓN SIN CONTEXTO, NO VEN NADA DE IDENTIDAD: ni de una persona ni de la plataforma', async () => {
  for (const ctx of [{ companyId: empresa }, {}] as Contexto[]) {
    await como(ctx, async (q) => {
      for (const t of TODAS) assert.equal(await cuenta(q, t), 0, `${t} con contexto ${JSON.stringify(Object.keys(ctx))}`)
    })
  }
  // Una empresa tampoco puede escribir.
  await assert.rejects(
    () =>
      como({ companyId: empresa }, async (q) => {
        await q(`INSERT INTO "identidad_consentimientos" ("id","userId","tipo","textoVersion","canal","otorgadoAt") VALUES ('c-rls-${sufijo}','${a}','IDENTIDAD_DIVULGACION_EMPRESAS','v','web',now())`)
      }),
    /row-level security|violates/i
  )
})

test('3 · LAS TABLAS DE LA PLATAFORMA (interruptor, reglas, bandeja de avisos) SOLO LAS TOCA EL SISTEMA', async () => {
  // Una persona, con su contexto, no ve ni escribe nada de la plataforma.
  await como({ userId: a }, async (q) => {
    for (const t of TABLAS_DE_LA_PLATAFORMA) assert.equal(await cuenta(q, t), 0, t)
    assert.equal(await aplica(q, `UPDATE "identidad_interruptores" SET "enabled" = true RETURNING 1`), 0, 'no enciende el interruptor')
  })
  await assert.rejects(
    () =>
      como({ userId: a }, async (q) => {
        await q(`INSERT INTO "identidad_reglas" ("operacion","activa","alcance","reason") VALUES ('PAGO_A_PROVEEDOR', true, 'todos', 'colada')`)
      }),
    /row-level security|violates/i
  )
  // El sistema (omnisciente: el worker y el equipo) sí.
  await como({ omnisciente: true }, async (q) => {
    assert.ok((await cuenta(q, 'identidad_interruptores')) >= 1)
    await q(`INSERT INTO "identidad_reglas" ("operacion","activa","alcance","reason") VALUES ('PAGO_A_PROVEEDOR', true, 'todos', 'prueba')
             ON CONFLICT ("operacion") DO UPDATE SET "reason" = 'prueba'`)
    assert.equal(await cuenta(q, 'identidad_reglas'), 1)
  })
})

test('4 · LO OMNISCIENTE (worker y equipo) VE A TODOS, y solo con la marca explícita', async () => {
  await como({ omnisciente: true }, async (q) => {
    for (const t of TABLAS_DE_LA_PERSONA) {
      assert.equal(await cuenta(q, t, `"userId" IN ('${a}','${b}')`), 2, t)
    }
  })
  // La marca tiene que ser exactamente «on»: cualquier otro valor no abre nada.
  await assert.rejects(
    () =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE membego_app')
        await tx.$queryRaw`SELECT set_config('app.omnisciente', 'true', true)`
        const n = Number((await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "identidad_verificaciones"`))[0]!.n)
        assert.equal(n, 0, 'omnisciente = «true» no cuenta')
        throw new Error('deshacer')
      }),
    /deshacer/
  )
})

test('5 · NINGUNA TABLA DE IDENTIDAD QUEDA SIN RLS NI SIN POLÍTICA (una nueva nacería abierta el día del cambio de rol)', async () => {
  const tablas = await prisma.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
    SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'identidad\_%'`
  const politicas = await prisma.$queryRaw<{ tablename: string; roles: string[] }[]>`SELECT tablename, roles::text[] AS roles FROM pg_policies WHERE tablename LIKE 'identidad\_%'`
  assert.deepEqual(tablas.map((t) => t.relname).sort(), [...TODAS].sort(), 'las tablas de identidad son exactamente las que estas pruebas cubren')
  for (const t of tablas) {
    assert.equal(t.relrowsecurity, true, `${t.relname} sin RLS`)
    const p = politicas.filter((x) => x.tablename === t.relname)
    assert.ok(p.length >= 1, `${t.relname} sin política`)
    assert.ok(p.every((x) => x.roles.includes('membego_app')), `${t.relname}: la política es para el rol de la aplicación`)
  }
})

test('6 · EL ROL DE LA APLICACIÓN NO SE SALTA LAS POLÍTICAS', async () => {
  const [rol] = await prisma.$queryRaw<{ rolbypassrls: boolean; rolsuper: boolean }[]>`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'membego_app'`
  assert.deepEqual({ ...rol }, { rolbypassrls: false, rolsuper: false })
})
