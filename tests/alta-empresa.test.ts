import './support/sin-server-only'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { darDeAltaEmpresa, datosParaLaBase, slugLibre, slugify, type PuertosDeAlta, type EntradaDeAlta } from '../src/modules/empresas/alta'
import { empresaDesdeSolicitud, precargaDeSolicitud, type SolicitudDatos } from '../src/modules/solicitudes/nucleo'
import { CAPACIDADES_OVERRIDE_TENANT_NUEVO } from '../src/modules/capacidades/catalogo'

/**
 * UN SOLO ALTA DE EMPRESA (auditoría admin · fase 7, tarea 7.3; 04 · F-02).
 *
 * Tres caminos —el superadmin, la solicitud aprobada y el registro público— creaban la empresa y su administrador con el mismo guion
 * copiado. Aquí se prueba el guion único con puertos falsos: el ORDEN de lo que hace y, sobre todo, lo que DESHACE cuando algo falla
 * (que es lo que no se podía probar con tres copias y servicios reales).
 */

const leer = (r: string) => readFileSync(r, 'utf8')
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** Puertos que anotan lo que se les pide y fallan donde se les diga. */
function puertos(fallaEn?: keyof PuertosDeAlta, ocupados: string[] = []) {
  const llamadas: string[] = []
  const datos: Record<string, unknown> = {}
  const paso = <T,>(nombre: keyof PuertosDeAlta, valor: T, detalle?: unknown) => async (): Promise<T> => {
    llamadas.push(nombre)
    if (detalle !== undefined) datos[nombre] = detalle
    if (fallaEn === nombre) throw new Error(`falla ${nombre}`)
    return valor
  }
  const p: PuertosDeAlta = {
    slugOcupado: async (s) => (llamadas.push('slugOcupado'), ocupados.includes(s)),
    crearEmpresa: async (data) => {
      llamadas.push('crearEmpresa')
      datos.crearEmpresa = data
      if (fallaEn === 'crearEmpresa') throw new Error('falla crearEmpresa')
      return { id: 'emp1' }
    },
    asegurarSucursalPrincipal: paso('asegurarSucursalPrincipal', undefined),
    vincularCategorias: async (id, cats) => {
      await paso('vincularCategorias', undefined, { id, cats })()
    },
    darAcceso: async (a, c, actual) => {
      await paso('darAcceso', undefined, { a, c, actual })()
    },
    crearCuenta: async (c) => {
      await paso('crearCuenta', undefined, c)()
      return 'sb1'
    },
    asegurarIdentidad: paso('asegurarIdentidad', undefined),
    crearUsuario: async (_c, u) => {
      await paso('crearUsuario', undefined, u)()
      return { id: 'u1' }
    },
    fijarRolEnLaSesion: async (s, r) => {
      await paso('fijarRolEnLaSesion', undefined, { s, r })()
    },
    borrarCuenta: async (s) => {
      await paso('borrarCuenta', undefined, s)()
    },
    borrarEmpresa: async (c) => {
      await paso('borrarEmpresa', undefined, c)()
    },
  }
  return { p, llamadas, datos }
}

const nuevo: EntradaDeAlta['administrador'] = { modo: 'nuevo', nombre: 'Ana', email: 'ana@x.com', password: 'secreta1', confirmarCorreo: true }
const existente: EntradaDeAlta['administrador'] = { modo: 'existente', id: 'adm1', companyId: 'otra' }
const entrada = (administrador: EntradaDeAlta['administrador'], extra: Partial<EntradaDeAlta> = {}): EntradaDeAlta => ({
  empresa: { nombre: 'Hotel Sol', tipo: 'HOTEL', categoryIds: ['c1', '', 'c2'] },
  administrador,
  ...extra,
})

// ── El orden ────────────────────────────────────────────────────────────────────────────────────────────────────────

test('con cuenta nueva: slug, empresa, sucursal, categorías, cuenta, identidad, usuario y rol, en ese orden', async () => {
  const { p, llamadas, datos } = puertos()
  const r = await darDeAltaEmpresa(entrada(nuevo), p)
  assert.deepEqual(llamadas, ['slugOcupado', 'crearEmpresa', 'asegurarSucursalPrincipal', 'vincularCategorias', 'crearCuenta', 'asegurarIdentidad', 'crearUsuario', 'fijarRolEnLaSesion'])
  assert.deepEqual(r, { companyId: 'emp1', slug: 'hotel-sol', adminId: 'u1' })
  assert.deepEqual(datos.vincularCategorias, { id: 'emp1', cats: ['c1', 'c2'] }, 'los vacíos se descartan')
  assert.deepEqual(datos.fijarRolEnLaSesion, { s: 'sb1', r: { dbUserId: 'u1', companyId: 'emp1' } })
})

test('con cuenta existente: solo se le da acceso; no se crea cuenta, ni usuario, ni se toca su rol', async () => {
  const { p, llamadas, datos } = puertos()
  const r = await darDeAltaEmpresa(entrada(existente), p)
  assert.deepEqual(llamadas, ['slugOcupado', 'crearEmpresa', 'asegurarSucursalPrincipal', 'vincularCategorias', 'darAcceso'])
  assert.deepEqual(datos.darAcceso, { a: 'adm1', c: 'emp1', actual: 'otra' }, 'conserva su camino de vuelta a la empresa de siempre')
  assert.equal(r.adminId, undefined)
})

test('sin categorías no se llama a vincularlas', async () => {
  const { p, llamadas } = puertos()
  await darDeAltaEmpresa({ empresa: { nombre: 'X', tipo: 'otro' }, administrador: existente }, p)
  assert.equal(llamadas.includes('vincularCategorias'), false)
})

test('el consentimiento de quien se registra llega al usuario; el del superadmin no lo lleva', async () => {
  const consentimiento = { terminosVersion: 'v3', marketing: true, en: new Date('2026-10-22T10:00:00Z') }
  const a = puertos()
  await darDeAltaEmpresa(entrada({ ...(nuevo as Extract<typeof nuevo, { modo: 'nuevo' }>), consentimiento }), a.p)
  assert.deepEqual((a.datos.crearUsuario as { consentimiento: unknown }).consentimiento, consentimiento)
  const b = puertos()
  await darDeAltaEmpresa(entrada(nuevo), b.p)
  assert.equal((b.datos.crearUsuario as { consentimiento?: unknown }).consentimiento, undefined)
})

test('la cuenta nace sin confirmar el correo solo cuando se pide (registro con verificación)', async () => {
  const a = puertos()
  await darDeAltaEmpresa(entrada({ ...(nuevo as Extract<typeof nuevo, { modo: 'nuevo' }>), confirmarCorreo: false }), a.p)
  assert.equal((a.datos.crearCuenta as { confirmarCorreo: boolean }).confirmarCorreo, false)
})

test('los slugs ocupados se saltan: nombre, nombre-2, nombre-3', async () => {
  assert.equal(await slugLibre('Hotel Sol', async (s) => ['hotel-sol', 'hotel-sol-2'].includes(s)), 'hotel-sol-3')
  assert.equal(await slugLibre('¡¡¡', async () => false), 'empresa', 'un nombre sin letras cae a «empresa»')
  assert.equal(slugify('Café  “Ñandú” & Co.'), 'cafe-nandu-co')
  const { p } = puertos(undefined, ['hotel-sol'])
  assert.equal((await darDeAltaEmpresa(entrada(existente), p)).slug, 'hotel-sol-2')
})

// ── Lo que se deshace ───────────────────────────────────────────────────────────────────────────────────────────────

test('si falla la empresa, no hay nada que deshacer', async () => {
  const { p, llamadas } = puertos('crearEmpresa')
  await assert.rejects(() => darDeAltaEmpresa(entrada(nuevo), p), /falla crearEmpresa/)
  assert.deepEqual(llamadas.filter((l) => l.startsWith('borrar')), [])
})

test('si falla después de crear la empresa y antes de la cuenta, se borra la empresa y NO se intenta borrar una cuenta que no existe', async () => {
  const { p, llamadas } = puertos('asegurarSucursalPrincipal')
  await assert.rejects(() => darDeAltaEmpresa(entrada(nuevo), p), /falla asegurarSucursalPrincipal/)
  assert.deepEqual(llamadas.filter((l) => l.startsWith('borrar')), ['borrarEmpresa'])
})

test('si falla después de crear la cuenta, se borran la cuenta y la empresa', async () => {
  for (const etapa of ['asegurarIdentidad', 'crearUsuario', 'fijarRolEnLaSesion'] as const) {
    const { p, llamadas, datos } = puertos(etapa)
    await assert.rejects(() => darDeAltaEmpresa(entrada(nuevo), p), new RegExp(`falla ${etapa}`))
    assert.deepEqual(llamadas.filter((l) => l.startsWith('borrar')), ['borrarCuenta', 'borrarEmpresa'], etapa)
    assert.equal(datos.borrarCuenta, 'sb1')
    assert.equal(datos.borrarEmpresa, 'emp1')
  }
})

test('si falla crear la cuenta en Auth, se borra la empresa pero no hay cuenta que borrar', async () => {
  const { p, llamadas } = puertos('crearCuenta')
  await assert.rejects(() => darDeAltaEmpresa(entrada(nuevo), p), /falla crearCuenta/)
  assert.deepEqual(llamadas.filter((l) => l.startsWith('borrar')), ['borrarEmpresa'])
})

test('con cuenta existente, el rollback NUNCA toca a esa persona: solo se borra la empresa', async () => {
  const { p, llamadas } = puertos('darAcceso')
  await assert.rejects(() => darDeAltaEmpresa(entrada(existente), p), /falla darAcceso/)
  assert.deepEqual(llamadas.filter((l) => l.startsWith('borrar')), ['borrarEmpresa'])
})

test('lo que cada camino hace al terminar está dentro del rollback: si lanza, todo se deshace y el error llega', async () => {
  const { p, llamadas } = puertos()
  const alTerminar = async () => {
    throw new Error('no se pudo marcar la solicitud')
  }
  await assert.rejects(() => darDeAltaEmpresa(entrada(nuevo, { alTerminar }), p), /no se pudo marcar la solicitud/)
  assert.deepEqual(llamadas.filter((l) => l.startsWith('borrar')), ['borrarCuenta', 'borrarEmpresa'])
  // Y recibe lo que se creó.
  const { p: p2 } = puertos()
  let visto: unknown
  await darDeAltaEmpresa(entrada(nuevo, { alTerminar: async (r) => void (visto = r) }), p2)
  assert.deepEqual(visto, { companyId: 'emp1', slug: 'hotel-sol', adminId: 'u1' })
})

test('si el rollback también falla, el error que sale es el ORIGINAL (no el del rollback)', async () => {
  const { p } = puertos('crearUsuario')
  p.borrarCuenta = async () => {
    throw new Error('Auth caído')
  }
  p.borrarEmpresa = async () => {
    throw new Error('base caída')
  }
  await assert.rejects(() => darDeAltaEmpresa(entrada(nuevo), p), /falla crearUsuario/)
})

// ── Lo que se escribe en la base ────────────────────────────────────────────────────────────────────────────────────

test('la empresa siempre nace con las capacidades de tenant nuevo y activa', () => {
  const d = datosParaLaBase({ nombre: 'X', tipo: 'otro' }, 'x')
  assert.deepEqual(d.capacidades, { overrides: CAPACIDADES_OVERRIDE_TENANT_NUEVO })
  assert.equal(d.isActive, true)
  assert.equal(d.name, 'X')
  assert.equal(d.slug, 'x')
  assert.equal(d.type, 'otro')
})

test('publicada:false → sin publicar; sin decirlo, el valor por defecto de la columna; esDemo solo si se pide; el vertical solo si lo hay', () => {
  assert.equal(datosParaLaBase({ nombre: 'X', tipo: 'o', publicada: false }, 'x').isPublished, false)
  assert.equal('isPublished' in datosParaLaBase({ nombre: 'X', tipo: 'o' }, 'x'), false)
  assert.equal('isPublished' in datosParaLaBase({ nombre: 'X', tipo: 'o', publicada: true }, 'x'), false)
  assert.equal(datosParaLaBase({ nombre: 'X', tipo: 'o', esDemo: true }, 'x').esDemo, true)
  assert.equal('esDemo' in datosParaLaBase({ nombre: 'X', tipo: 'o', esDemo: false }, 'x'), false)
  assert.equal(datosParaLaBase({ nombre: 'X', tipo: 'o', tipoNegocioCodigo: 'GYM' }, 'x').tipoNegocioCodigo, 'GYM')
  assert.equal('tipoNegocioCodigo' in datosParaLaBase({ nombre: 'X', tipo: 'o', tipoNegocioCodigo: null }, 'x'), false)
})

test('un campo ausente no se escribe (la columna conserva su valor) y uno null se escribe vacío', () => {
  const d = datosParaLaBase({ nombre: 'X', tipo: 'o', ciudad: 'Higüey', website: null }, 'x')
  assert.equal(d.ciudad, 'Higüey')
  assert.equal(d.website, null)
  for (const ausente of ['colorPrimario', 'horario', 'logoUrl', 'description', 'pais'] as const) assert.equal(ausente in d, false, ausente)
})

// ── De la solicitud a la empresa ────────────────────────────────────────────────────────────────────────────────────

const SOLICITUD: SolicitudDatos = {
  v: 1,
  negocio: { nombre: 'Aqua Spa', tipo: 'Car Wash', descripcion: 'Lavado y detallado', telefono: '809-555-0100', correo: 'hola@aqua.do', web: 'https://aqua.do' },
  ubicacion: { direccion: 'Calle 1', ciudad: 'Higüey', maps: 'https://maps.example/x' },
  horario: [{ dia: 'Lun', desde: '08:00', hasta: '18:00', cerrado: false }],
  sucursales: [],
  marca: { color: '#0ea5e9' },
  admin: { nombre: 'Luis Peña', correo: 'luis@aqua.do', telefono: '809-555-0101' },
  planes: [],
  promos: [],
  cobros: { efectivo: true, transferencia: false, tarjeta: false, usaCitas: false },
  extras: { ruleta: false, gift: false, referidos: false, sellos: false },
}

test('la solicitud se convierte en la empresa que antes escribía a mano crearEmpresaDesdeSolicitud', () => {
  const e = empresaDesdeSolicitud(SOLICITUD, { codigoVertical: 'CAR_WASH', logoUrl: 'https://x/logo.png', bannerUrl: null })
  assert.equal(e.nombre, 'Aqua Spa')
  assert.equal(e.tipo, 'CAR_WASH', 'con vertical, el tipo es el código')
  assert.equal(e.tipoNegocioCodigo, 'CAR_WASH')
  assert.equal(e.publicada, false, 'nace sin publicar')
  assert.equal(e.horario, 'Lun: 08:00–18:00')
  assert.equal(e.googleMapsUrl, 'https://maps.example/x')
  assert.equal(e.colorPrimario, '#0ea5e9')
  assert.equal(e.logoUrl, 'https://x/logo.png')
  assert.equal(e.bannerUrl, null)
  const otro = empresaDesdeSolicitud({ ...SOLICITUD, negocio: { ...SOLICITUD.negocio, tipo: 'Otro' as never, tipoOtro: 'Hotel boutique' } }, { codigoVertical: null, logoUrl: null, bannerUrl: null })
  assert.equal(otro.tipo, 'Hotel boutique', 'sin vertical, el texto libre')
  assert.equal(empresaDesdeSolicitud({ ...SOLICITUD, negocio: { ...SOLICITUD.negocio, tipo: 'Otro' as never } }, { codigoVertical: null, logoUrl: null, bannerUrl: null }).tipo, 'otro')
})

test('la precarga de «Empresas → Nueva» lleva lo que el formulario tiene, nunca una contraseña', () => {
  const p = precargaDeSolicitud(SOLICITUD)
  assert.deepEqual(p, {
    name: 'Aqua Spa',
    type: 'CAR_WASH',
    email: 'hola@aqua.do',
    telefono: '809-555-0100',
    ciudad: 'Higüey',
    direccion: 'Calle 1',
    website: 'https://aqua.do',
    description: 'Lavado y detallado',
    adminNombre: 'Luis Peña',
    adminEmail: 'luis@aqua.do',
  })
  assert.equal(Object.keys(p).some((k) => /pass|contrase/i.test(k)), false)
  assert.equal(precargaDeSolicitud({ ...SOLICITUD, negocio: { ...SOLICITUD.negocio, tipo: 'Otro' as never, web: undefined } }).type, null)
  assert.equal(precargaDeSolicitud({ ...SOLICITUD, negocio: { ...SOLICITUD.negocio, web: undefined } }).website, '')
})

// ── Los tres caminos usan el alta única ─────────────────────────────────────────────────────────────────────────────

const CAMINOS = ['src/modules/empresas/actions.ts', 'src/modules/solicitudes/actions.ts', 'src/modules/registro/empresaActions.ts']

test('los tres caminos llaman a darDeAltaEmpresa y ya no crean la empresa, la cuenta ni el slug por su cuenta', () => {
  for (const f of CAMINOS) {
    const fuente = leer(f)
    const limpio = sinComentarios(fuente)
    assert.match(limpio, /darDeAltaEmpresa\(/, f)
    assert.doesNotMatch(limpio, /\.admin\.createUser\(/, `${f} crea la cuenta por su cuenta`)
    assert.doesNotMatch(limpio, /\.admin\.deleteUser\(/, `${f} deshace la cuenta por su cuenta`)
    assert.doesNotMatch(limpio, /tx\.user\.create\(/, `${f} crea el usuario por su cuenta`)
    assert.doesNotMatch(limpio, /function slugify\b|function uniqueCompanySlug|function slugUnico/, `${f} trae su propio slug`)
    assert.doesNotMatch(limpio, /ensureSucursalPrincipal\(/, `${f} crea la sucursal por su cuenta`)
  }
  // El alta del superadmin, la solicitud y el registro ya no escriben `company.create`; solo quedan la copia y el Supplier Lite.
  for (const f of CAMINOS.filter((c) => !c.includes('empresas/actions'))) assert.doesNotMatch(sinComentarios(leer(f)), /company\.create\(/, f)
  assert.equal((sinComentarios(leer('src/modules/empresas/actions.ts')).match(/company\.create\(/g) ?? []).length, 1, 'solo duplicarEmpresa')
})

test('cada camino conserva lo que SOLO le toca', () => {
  const registro = leer('src/modules/registro/empresaActions.ts')
  assert.match(registro, /publicada: false/, 'el registro nace sin publicar')
  assert.match(registro, /consentimiento: \{ terminosVersion: TERMS_VERSION/)
  assert.match(registro, /confirmarCorreo: !verificarCorreo/)
  assert.match(registro, /registerLimiter/, 'el límite de intentos sigue en el registro')
  assert.match(registro, /verticalValido\(tipo\)/, 'ahora el registro también escribe el vertical')
  const solicitud = leer('src/modules/solicitudes/actions.ts')
  assert.match(solicitud, /alTerminar: \(r\) => marcarSolicitudCreada\(id, r\.companyId/)
  assert.match(solicitud, /randomBytes\(9\)/, 'la contraseña temporal sigue naciendo aquí')
  const superadmin = leer('src/modules/empresas/actions.ts')
  assert.match(superadmin, /requireSuperadmin/)
  assert.match(superadmin, /adminModo/)
  assert.match(superadmin, /alTerminar: solicitudId \?/)
})

test('«Empresas → Nueva» se puede precargar desde una solicitud y la solicitud lo sabe', () => {
  const pagina = leer('src/app/(superadmin)/superadmin/empresas/nueva/page.tsx')
  assert.match(pagina, /sp\.solicitud/)
  assert.match(pagina, /precargaDeSolicitud\(/)
  assert.match(pagina, /solicitud\.estado === 'CREADA' && solicitud\.companyId/, 'una solicitud ya creada no precarga')
  const form = leer('src/components/superadmin/EmpresaCreateForm.tsx')
  assert.match(form, /name="solicitudId" value=\{inicial\.solicitudId\}/)
  for (const campo of ['name', 'email', 'telefono', 'ciudad', 'direccion', 'website', 'description', 'adminNombre', 'adminEmail']) {
    assert.match(form, new RegExp(`name="${campo}"[^>]*defaultValue=\\{inicial\\?\\.`), `el campo ${campo} no se precarga`)
  }
  assert.match(leer('src/components/superadmin/SolicitudAcciones.tsx'), /empresas\/nueva\?solicitud=\$\{id\}/)
  // El helper que marca la solicitud lo usan los dos finales.
  assert.match(leer('src/modules/solicitudes/creada.ts'), /estado: 'CREADA', companyId/)
})

test('deshacer una empresa recién creada borra antes su sucursal y su administrador (la sucursal es RESTRICT hacia la empresa)', () => {
  // Hallazgo de 7.3, verificado contra la base de QA: `company.delete` a secas falla con `sucursales_companyId_fkey` y el error se
  // tragaba, así que el rollback de los tres caminos antiguos dejaba la empresa huérfana (y, con cuenta nueva, un usuario sin empresa).
  const fuente = sinComentarios(leer('src/modules/empresas/alta.ts'))
  const i = fuente.indexOf('borrarEmpresa: async (companyId)')
  assert.ok(i > 0)
  const cuerpo = fuente.slice(i, i + 500)
  const u = cuerpo.indexOf('tx.user.deleteMany')
  const s = cuerpo.indexOf('tx.sucursal.deleteMany')
  const c = cuerpo.indexOf('tx.company.delete(')
  assert.ok(u > 0 && s > 0 && c > 0, 'faltan pasos')
  assert.ok(u < c && s < c, 'la empresa se borra la última')
})
