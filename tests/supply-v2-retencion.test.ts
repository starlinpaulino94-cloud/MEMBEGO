import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * MEMBEGO SUPPLY · SLICE 9 · BLOQUE 5 · §22 · LO QUE NO SE BORRA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTA PRUEBA EXISTE
 *
 * `docs/supply-v2-retencion-y-privacidad.md` afirma que un registro financiero
 * de Supply no se puede perder por descuido, y que lo que lo garantiza es
 * el esquema —`onDelete: Restrict` sobre el cliente— y no la buena voluntad de
 * quien escriba el próximo modelo.
 *
 * Una afirmación así en un documento envejece sola: alguien añade un modelo
 * nuevo, pone `Cascade` porque es lo que más se escribe, y el documento sigue
 * diciendo que no puede pasar. Esto lo convierte en una puerta: si alguien lo
 * hace, la prueba falla y nombra el modelo.
 *
 * Lee los esquemas como texto a propósito. Lo que se quiere comprobar es lo que
 * está ESCRITO en `prisma/schema/`, que es lo que la base acaba aplicando: un
 * cliente de Prisma generado no sabe decir qué `onDelete` tiene una relación.
 */

const DIR = join(process.cwd(), 'prisma', 'schema')

const esquemas = readdirSync(DIR)
  .filter((f) => f.startsWith('supply-v2') && f.endsWith('.prisma'))
  .map((f) => ({ archivo: f, texto: readFileSync(join(DIR, f), 'utf8') }))

/**
 * Las relaciones de Supply que apuntan a un `User`. Una por línea, que es
 * cómo las escribe Prisma: el nombre del campo, el modelo y el `onDelete`.
 */
function relacionesAUsuario() {
  const salida: { archivo: string; linea: number; modelo: string; campo: string; onDelete: string }[] = []
  for (const { archivo, texto } of esquemas) {
    let modelo = ''
    texto.split('\n').forEach((linea, i) => {
      const m = /^model\s+(\w+)\s*\{/.exec(linea)
      if (m) modelo = m[1]
      // `campo  User  @relation(...)` o `campo  User?  @relation(...)`
      const r = /^\s*(\w+)\s+User\??\s+@relation\(/.exec(linea)
      if (!r) return
      const d = /onDelete:\s*(\w+)/.exec(linea)
      salida.push({ archivo, linea: i + 1, modelo, campo: r[1], onDelete: d ? d[1] : 'SetNull(por defecto)' })
    })
  }
  return salida
}

/**
 * Lo que guarda dinero o derechos. Si un modelo de estos deja de existir o
 * cambia de nombre, esta prueba falla —y debe fallar—: la lista no puede
 * quedarse desfasada en silencio, porque entonces no comprobaría nada.
 */
const FINANCIEROS = [
  'SupplyV2CustomerOrder',
  'SupplyV2Entitlement',
  'SupplyV2Voucher',
  'SupplyV2Redemption',
  'SupplyV2CustomerBenefit',
  'SupplyV2BenefitReservation',
  'SupplyV2CouponRedemption',
  'SupplyV2ExternalEvent',
  'SupplyV2OutboxEvent',
  'SupplyV2FinanceIncident',
  'SupplyV2PaymentReconciliation',
] as const

test('§22 · los modelos financieros de Supply existen con ese nombre', () => {
  const todos = esquemas.map((e) => e.texto).join('\n')
  for (const m of FINANCIEROS) {
    assert.match(todos, new RegExp(`^model\\s+${m}\\s*\\{`, 'm'), `falta el modelo ${m}: si se renombró, actualiza esta lista`)
  }
})

test('§22 · ninguna tabla financiera se borra en cascada al borrar un usuario', () => {
  const malas = relacionesAUsuario().filter(
    (r) => FINANCIEROS.includes(r.modelo as (typeof FINANCIEROS)[number]) && r.onDelete === 'Cascade'
  )
  assert.deepEqual(
    malas,
    [],
    `Un Cascade sobre una tabla financiera deja borrar dinero al borrar una cuenta:\n` +
      malas.map((m) => `  · ${m.modelo}.${m.campo} (${m.archivo}:${m.linea})`).join('\n')
  )
})

test('§22 · el cliente de una compra está protegido con Restrict, no con SetNull', () => {
  // La diferencia importa: `SetNull` dejaría borrar la cuenta y la compra
  // quedaría huérfana —sin saber de quién era—, que es perder el dato sin
  // borrar la fila. `Restrict` hace fallar el borrado, y eso fuerza una
  // decisión humana.
  const r = relacionesAUsuario().filter((x) => x.modelo === 'SupplyV2CustomerOrder' && x.campo === 'customer')
  assert.equal(r.length, 1, 'SupplyV2CustomerOrder.customer tiene que estar declarado una vez')
  assert.equal(r[0].onDelete, 'Restrict')
})

test('§22 · el único Cascade desde un usuario en Supply es el código de referido', () => {
  // No es que un Cascade esté prohibido: es que cada uno tiene que ser una
  // decisión. Hoy hay exactamente uno y no guarda dinero. Si aparece otro, esta
  // prueba lo nombra y alguien decide si está bien.
  const cascadas = relacionesAUsuario().filter((r) => r.onDelete === 'Cascade')
  assert.deepEqual(
    cascadas.map((c) => `${c.modelo}.${c.campo}`),
    ['SupplyV2ReferralCode.owner'],
    'apareció un Cascade nuevo desde User: decide si ese dato puede desaparecer con la cuenta'
  )
})

test('§22 · la bitácora sobrevive al borrado de quien actuó', () => {
  // `audit_logs.userId` es opcional y sin `onDelete` explícito, que en Prisma
  // es `SetNull`: se pierde el nombre, no el hecho. Un `Cascade` aquí sería el
  // peor de todos: bastaría borrar una cuenta para borrar lo que hizo.
  const identidad = readFileSync(join(DIR, 'identidad.prisma'), 'utf8')
  const modelo = /model AuditLog \{[\s\S]*?\n\}/.exec(identidad)
  assert.ok(modelo, 'el modelo AuditLog tiene que existir')
  const relacion = /user\s+User\?\s+@relation\([^)]*\)/.exec(modelo![0])
  assert.ok(relacion, 'AuditLog.user tiene que estar declarado')
  assert.ok(!/onDelete:\s*Cascade/.test(relacion![0]), 'un Cascade aquí borraría la auditoría con la cuenta')
  assert.match(modelo![0], /userId\s+String\?/, 'el actor es opcional para que la fila sobreviva sin él')
})

test('§22 · no hay ninguna purga automática de datos de Supply', () => {
  // El documento afirma que no existe y que es deliberado. Si alguien añade
  // una, esta prueba falla y obliga a actualizar la política antes de borrar
  // nada —no después—.
  const dir = join(process.cwd(), 'src', 'modules', 'supply-v2')
  const sospechosas: string[] = []
  const recorrer = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) recorrer(p)
      else if (e.name.endsWith('.ts')) {
        const t = readFileSync(p, 'utf8')
        // Un borrado por antigüedad: `deleteMany` con una fecha de corte.
        if (/deleteMany\(\{[^}]*(createdAt|processedAt|deliveredAt|receivedAt)[^}]*(lt|lte)/.test(t)) {
          sospechosas.push(p.replace(process.cwd() + '/', ''))
        }
      }
    }
  }
  recorrer(dir)
  assert.deepEqual(
    sospechosas,
    [],
    'hay un borrado por antigüedad; documéntalo en docs/supply-v2-retencion-y-privacidad.md y ponlo detrás de un interruptor'
  )
})

/**
 * §22 · bis · EL PUNTO CIEGO DEL GATE `rls:cobertura`, cerrado para Supply.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA OTRA PRUEBA SI YA HAY UN GATE
 *
 * `scripts/rls-cobertura.mjs` trabaja por ARCHIVO: basta un `sinEmpresa` en
 * cualquier sitio para que el archivo entero pase, con todas las demás
 * consultas sueltas. Eso dejó pasar cuatro defectos reales del Slice 9, y el
 * peor no era de higiene:
 *
 *   · `flags.ts` leía los interruptores con `prisma` a pelo. Las tablas de
 *     operación tienen política de capa 2 OMNISCIENTE, y con RLS encendida una
 *     consulta sin contexto no falla: devuelve cero filas. Cero filas allí
 *     significaba `undefined`, y `capacidadEfectiva(clave, undefined)` lo lee
 *     como «nadie lo apagó»: un kill switch APAGADO a propósito se habría
 *     leído como ENCENDIDO, y los pagos externos habrían seguido procesándose
 *     después de que alguien los cortara.
 *   · `salud.ts` y `panel-queries.ts` habrían mostrado cero incidentes, cero
 *     difuntos y nada atrasado: el panel en verde justo cuando hace falta que
 *     grite.
 *   · `barrido-conciliacion.ts` habría dicho «revisados: 0» sin quejarse.
 *
 * Así que para estos dos módulos la regla es más estricta que la del gate:
 * NINGUNA consulta directa, ni una. Es comprobable leyendo el texto, y lo que
 * de verdad lo sostiene es que ninguno de los dos importa ya `prisma`.
 */
test('§22 · ni operations ni notifications consultan la base sin contexto', () => {
  const raices = ['src/modules/supply-v2/operations', 'src/modules/supply-v2/notifications']
  const culpables: string[] = []
  for (const raiz of raices) {
    const dir = join(process.cwd(), raiz)
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || !e.name.endsWith('.ts')) continue
      const texto = readFileSync(join(dir, e.name), 'utf8')
      texto.split('\n').forEach((linea, i) => {
        // Solo código: un `prisma.` dentro de un comentario explica el defecto,
        // no lo comete.
        const limpia = linea.trim()
        if (limpia.startsWith('*') || limpia.startsWith('//')) return
        if (/\bprisma\s*\.\s*[a-z]/.test(limpia)) culpables.push(`${raiz}/${e.name}:${i + 1}`)
      })
    }
  }
  assert.deepEqual(
    culpables,
    [],
    'una consulta sin contexto de plataforma devuelve CERO FILAS con RLS encendida, no un error:\n  ' +
      culpables.join('\n  ')
  )
})
