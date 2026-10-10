import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { hayCookieDeSesion, interpretarSesion, puertaDeCasa, respuestaDeSesion } from '../src/lib/auth/sesion-ligera'
import { ROLE_HOME } from '../src/types'

/**
 * SEPARACIÓN LANDING · APP — F5: la landing sabe si hay sesión (sin volverse dinámica) y el orden en auth.
 */

const leer = (f: string) => readFileSync(f, 'utf8')
const sinComentarios = (f: string) => leer(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
function archivosDe(dir: string): string[] {
  if (!existsSync(dir)) return []
  const acc: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) acc.push(...archivosDe(p))
    else if (/\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p)) acc.push(relative('.', p))
  }
  return acc.sort()
}

test('la pista de cookie: solo una cookie de sesión de Supabase con valor cuenta, en cualquiera de sus trozos', () => {
  assert.equal(hayCookieDeSesion('sb-abcdef-auth-token=base64-xyz'), true)
  assert.equal(hayCookieDeSesion('a=1; sb-abcdef-auth-token.0=aaa; sb-abcdef-auth-token.1=bbb'), true)
  assert.equal(hayCookieDeSesion('theme=dark; mg_canal=fb'), false)
  assert.equal(hayCookieDeSesion('sb-abcdef-auth-token='), false, 'una cookie vacía no es una sesión')
  assert.equal(hayCookieDeSesion('sb-abcdef-other=1'), false, 'otra cookie de Supabase no es la de sesión')
  assert.equal(hayCookieDeSesion('xsb-abcdef-auth-token=1'), false)
  assert.equal(hayCookieDeSesion(''), false)
  assert.equal(hayCookieDeSesion(null), false)
  assert.equal(hayCookieDeSesion(undefined), false)
  assert.equal(hayCookieDeSesion('novalor'), false)
})

test('la puerta a «lo mío» según quién mire: cliente a su app, equipo a su panel, visitante a ninguna', () => {
  assert.equal(puertaDeCasa({ estado: 'visitante' }), null)
  assert.equal(puertaDeCasa({ estado: 'cargando' }), null)
  assert.deepEqual(puertaDeCasa(interpretarSesion(respuestaDeSesion('CLIENTE'))), { href: ROLE_HOME.CLIENTE, etiqueta: 'Ir a mi app' })
  for (const rol of ['ADMINISTRADOR', 'EMPLEADO', 'VENDEDOR', 'SUPERADMIN'] as const) {
    assert.deepEqual(puertaDeCasa(interpretarSesion(respuestaDeSesion(rol))), { href: ROLE_HOME[rol], etiqueta: 'Ir a mi panel' }, rol)
  }
  // Una respuesta rara cae en visitante: nunca una puerta inventada.
  assert.equal(puertaDeCasa(interpretarSesion({ autenticado: true, rol: 'HACKER', casa: '//evil.example' })), null)
})

test('el hook solo pregunta al servidor si el navegador trae la cookie, y comprueba antes de mirar el caché', () => {
  const hook = sinComentarios('src/components/public/useSesionLigera.ts')
  assert.match(hook, /if \(!hayCookieDeSesion\(document\.cookie\)\) \{\s*cache = null\s*setSesion\(\{ estado: 'visitante' \}\)\s*return\s*\}\s*consultar\(\)/)
})

test('la landing sigue siendo estática: ni su layout ni sus componentes leen cookies, cabeceras ni la sesión en servidor', () => {
  const archivos = [...archivosDe('src/app/(public)'), ...archivosDe('src/components/public')]
  assert.ok(archivos.length > 30)
  for (const f of archivos) {
    const c = sinComentarios(f)
    assert.doesNotMatch(c, /from 'next\/headers'|\bcookies\(\)|\bheaders\(\)/, `${f}: leer cookies o cabeceras vuelve dinámica la página`)
    assert.doesNotMatch(c, /\bgetUser\s*\(|\bgetSession\s*\(|from '@\/lib\/auth'/, `${f}: la sesión se lee en el navegador, no en servidor`)
  }
  assert.doesNotMatch(sinComentarios('src/app/(public)/layout.tsx'), /force-dynamic/)
  assert.match(leer('src/app/(public)/page.tsx'), /export const revalidate = 600/, 'la portada sigue siendo ISR')
})

test('la barra, el héroe, el cierre de la portada y el pie salen del mismo componente de sesión', () => {
  assert.match(sinComentarios('src/components/public/PublicNav.tsx'), /<AccionesDeLaBarra \/>/)
  assert.match(sinComentarios('src/components/public/PublicNav.tsx'), /<AccionesDeLaBarra movil/)
  assert.doesNotMatch(sinComentarios('src/components/public/PublicNav.tsx'), /Registrarse|Ingresar/, 'la barra ya no escribe esos CTA: los decide el componente de sesión')
  assert.match(sinComentarios('src/components/public/HeroSection.tsx'), /<EnlaceDeCuenta[\s\S]*href="\/registro"/)
  assert.match(sinComentarios('src/app/(public)/page.tsx'), /<EnlaceDeCuenta[\s\S]*href="\/registro"/)
  assert.match(sinComentarios('src/app/(public)/page.tsx'), /<SoloVisitante>[\s\S]*Ya tengo cuenta/)
  assert.match(sinComentarios('src/components/public/PublicFooter.tsx'), /<ColumnaDeCuentaDelPie/)
  const sesion = sinComentarios('src/components/public/AccionesDeSesion.tsx')
  assert.match(sesion, /^'use client'/m)
  assert.match(sesion, /pendiente && 'invisible'/, 'sin salto de diseño para quien trae cookie')
})

test('las pantallas de «no encontrada» y de error llevan a la casa de quien tiene sesión', () => {
  assert.match(sinComentarios('src/app/not-found.tsx'), /<EnlaceDeInicio/)
  assert.match(sinComentarios('src/app/(public)/error.tsx'), /<EnlaceDeInicio/)
  const enlace = sinComentarios('src/components/public/EnlaceDeInicio.tsx')
  assert.match(enlace, /puerta\?\.href \?\? '\/'/)
})

test('/registro es una pieza del acceso: vive en (auth), conserva la URL y la consulta', () => {
  assert.equal(existsSync('src/app/(public)/registro'), false, 'ya no está en la landing')
  assert.equal(existsSync('src/app/(public)/registro/page.tsx'), false)
  const pagina = sinComentarios('src/app/(auth)/registro/page.tsx')
  assert.match(pagina, /searchParams/)
  assert.match(pagina, /redirect\(`\/registro\/\$\{empresa\.slug\}\$\{consulta\}`\)/)
  assert.match(pagina, /redirect\(`\/registro\/cuenta\$\{consulta\}`\)/)
  assert.ok(existsSync('src/app/(auth)/registro/cuenta/page.tsx'))
  assert.ok(existsSync('src/app/(auth)/registro/[companySlug]/page.tsx'))
})

test('las excepciones permanentes de la landing son exactamente estas, y cada una tiene su razón', () => {
  // Páginas y componentes de la landing que envían algo al servidor (formularios con acción o `fetch`). Las búsquedas son
  // formularios GET y no cuentan. Cada una se queda por una razón de producto o de las tiendas de apps, no por pendiente.
  const PERMANENTES: Record<string, string> = {
    'src/app/(public)/eliminar-cuenta/page.tsx': 'las tiendas de apps exigen una URL pública para borrar la cuenta',
    'src/app/(public)/eliminar-cuenta/confirmar/page.tsx': 'la confirmación del borrado de cuenta',
    'src/components/public/RegistroEmpresaForm.tsx': 'captación B2B: el alta de un negocio',
    'src/components/public/SolicitudEmpresaForm.tsx': 'captación B2B: la solicitud de un negocio',
    'src/components/public/useSesionLigera.ts': 'consulta GET de solo lectura del estado de sesión',
  }
  const reales = [...archivosDe('src/app/(public)'), ...archivosDe('src/components/public')]
    .filter((f) => /useActionState|\bfetch\(/.test(sinComentarios(f)))
    .sort()
  assert.deepEqual(reales, Object.keys(PERMANENTES).sort(), 'una pieza nueva de la landing envía datos al servidor: ¿es captación o es una operación del cliente (que va en /cliente)?')
})

test('/mis-membresias y /membresia/[id] se quedan donde están: la app móvil y los avisos guardados los usan', () => {
  assert.ok(existsSync('src/app/(cliente)/mis-membresias/page.tsx'))
  assert.ok(existsSync('src/app/(cliente)/membresia/[membresiaId]/page.tsx'))
  assert.match(leer('src/types/index.ts'), /prefix: '\/mis-membresias', roles: \['CLIENTE'\]/)
  assert.match(leer('src/types/index.ts'), /prefix: '\/membresia', roles: \['CLIENTE'\]/)
  assert.match(leer('apps/client/src/lib/rutas.ts'), /'\/mis-membresias': '\/mis-membresias'/)
})
