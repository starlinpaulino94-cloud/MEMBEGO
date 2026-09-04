import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ETIQUETA_CANAL,
  ETIQUETA_ESTADO_MENSAJE,
  etiquetaContacto,
  explicarEnvio,
  type MotivoEnvio,
} from '../src/modules/mensajeria/nucleo'

/**
 * META · FASE 5 — la bandeja real. Lo que se vigila: que la empresa salga de
 * la sesión y nunca del formulario, que toda lectura cruce `companyId`, que
 * la pantalla no tenga nada simulado, que fuera de la ventana de 24 h no se
 * ofrezca texto libre, y que lo que lee quien atiende esté en su idioma.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const codigo = (r: string) =>
  leer(r).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

test('etiqueta del contacto: nombre si lo hay; número con «+» por WhatsApp; rótulo humano por Messenger e Instagram', () => {
  assert.equal(etiquetaContacto({ nombre: ' Ana Pérez ', idExterno: '18095551234', canal: 'WHATSAPP' }), 'Ana Pérez')
  assert.equal(etiquetaContacto({ nombre: null, telefono: '18095551234', idExterno: '18095551234', canal: 'WHATSAPP' }), '+18095551234')
  assert.equal(etiquetaContacto({ nombre: '', idExterno: '18095551234', canal: 'WHATSAPP' }), '+18095551234')
  assert.equal(etiquetaContacto({ idExterno: '1234567890123456', canal: 'MESSENGER' }), 'Persona de Messenger')
  assert.equal(etiquetaContacto({ idExterno: '1234567890123456', canal: 'INSTAGRAM' }), 'Cuenta de Instagram')
  assert.deepEqual(ETIQUETA_CANAL, { WHATSAPP: 'WhatsApp', MESSENGER: 'Messenger', INSTAGRAM: 'Instagram' })
  assert.equal(ETIQUETA_ESTADO_MENSAJE.FALLIDO, 'No se pudo enviar')
})

test('explicar un envío fallido: cada motivo tiene frase, y ninguna habla en jerga', () => {
  const motivos: MotivoEnvio[] = ['no_existe', 'canal', 'ventana_cerrada', 'sin_conexion', 'sin_credencial', 'telefono_invalido', 'proveedor']
  for (const m of motivos) {
    const t = explicarEnvio(m, 'Meta respondió 400')
    assert.ok(t.length > 15, `${m} sin explicación`)
    assert.ok(!/token|oauth|webhook|api\b|null|http/i.test(t), `${m} habla en jerga: ${t}`)
  }
  assert.match(explicarEnvio('ventana_cerrada'), /24 horas/)
  assert.match(explicarEnvio('proveedor', 'Meta respondió 400'), /Meta respondió 400/)
})

test('acciones: admin pleno, empresa de la sesión, ids validados; nunca companyId del formulario', () => {
  const src = codigo('src/modules/mensajeria/actions.ts')
  assert.match(src, /^'use server'/)
  const acciones = src.match(/export async function (\w+)/g) ?? []
  assert.deepEqual(acciones.map((a) => a.replace('export async function ', '')), [
    'enviarTextoAction',
    'enviarPlantillaAction',
    'marcarLeidaAction',
    'cambiarEstadoConversacionAction',
    'sincronizarPlantillasAction',
  ])
  // Cada acción empieza por `quien()`, que es requireAdminUser + companyId de la sesión.
  for (const a of acciones) {
    const cuerpo = src.slice(src.indexOf(a), src.indexOf('export async function', src.indexOf(a) + 1) === -1 ? undefined : src.indexOf('export async function', src.indexOf(a) + 1))
    assert.match(cuerpo, /const yo = await quien\(\)/, `${a} no pasa por quien()`)
  }
  assert.match(src, /requireAdminUser\(\)/)
  assert.match(src, /companyId: user\.metadata\.companyId/)
  assert.ok(!/formData\.get\(['"]companyId['"]\)/.test(src), 'la empresa nunca sale del formulario')
  assert.match(src, /ID_VALIDO = \/\^\[a-z0-9\]\{10,40\}\$\/i/)
  // Los parámetros de plantilla llegan como lista y no puede faltar ninguno.
  assert.match(src, /\.getAll\('parametro'\)/)
  assert.match(src, /parametros\.some\(\(p\) => !p\)/)
})

test('lecturas: todo pasa por conEmpresa y todo where lleva companyId', () => {
  const src = codigo('src/modules/mensajeria/bandeja.ts')
  assert.match(src, /^import 'server-only'/m)
  const wheres = src.match(/where: \{[^}]*\}/g) ?? []
  assert.ok(wheres.length >= 4, 'faltan consultas')
  for (const w of wheres) assert.match(w, /companyId/, `where sin companyId: ${w}`)
  const conEmpresaUsos = (src.match(/conEmpresa\(companyId/g) ?? []).length
  assert.ok(conEmpresaUsos >= 4, 'alguna lectura no pasa por conEmpresa')
  // Nada de la credencial/sellado sale hacia la pantalla.
  assert.ok(!/sellado|accessToken|access_token/.test(src))
})

test('la pantalla: de servidor, sin nada simulado, con el estado en la URL', () => {
  const src = leer('src/app/(admin)/admin/crm/conversaciones/page.tsx')
  assert.ok(!/'use client'/.test(src))
  assert.ok(!/INITIAL_|MOCK_|MOCK\b|const STATS|FUENTES/.test(src), 'la bandeja no lleva datos inventados')
  assert.match(src, /listarConversaciones\(companyId/)
  assert.match(src, /hiloDeConversacion\(companyId, seleccionadaId\)/)
  assert.match(src, /<EmptyState/)
  assert.match(src, /ID_VALIDO\.test\(sp\.c\)/)
  // Plantillas solo se cargan para un hilo de WhatsApp (son de ese canal).
  assert.match(src, /hilo\?\.conversacion\.canal === 'WHATSAPP' \? await plantillasDeEmpresa\(companyId\) : \[\]/)
})

test('el redactor: texto libre solo con la ventana abierta; plantilla aprobada por WhatsApp; espera por Messenger e Instagram', () => {
  const src = codigo('src/components/crm/bandeja/Redactor.tsx')
  assert.match(src, /if \(ventanaAbierta\) return <RedactorTexto/)
  assert.match(src, /if \(canal === 'WHATSAPP'\) return <RedactorPlantilla/)
  assert.match(src, /Solo se puede responder durante 24 horas/)
  // Solo las aprobadas: `plantillasDeEmpresa` filtra APPROVED por defecto y la
  // pantalla no pide otra cosa.
  const pagina = codigo('src/app/(admin)/admin/crm/conversaciones/page.tsx')
  assert.ok(!/soloAprobadas: false/.test(pagina))
  const plantillas = codigo('src/modules/mensajeria/plantillas.ts')
  assert.match(plantillas, /opciones\.soloAprobadas === false \? \{\} : \{ estado: 'APPROVED' \}/)
  // Un solo campo por parámetro, con su nombre de lista.
  assert.match(src, /name="parametro"/)
  assert.match(src, /maxLength=\{4096\}/)
})

test('el hilo: los estados de los salientes son los que contó Meta, con etiqueta humana', () => {
  const src = codigo('src/components/crm/bandeja/Hilo.tsx')
  assert.match(src, /ETIQUETA_ESTADO_MENSAJE\[m\.estado\] \?\? m\.estado/)
  assert.match(src, /MarcarLeidaAlAbrir conversacionId=\{conversacion\.id\} noLeidos=\{conversacion\.noLeidos\}/)
  // Los mensajes van del más antiguo al más reciente.
  assert.match(codigo('src/modules/mensajeria/bandeja.ts'), /mensajes\.reverse\(\)/)
})
