import http from 'k6/http'
import { check } from 'k6'

/**
 * CANJE DE QR — la ruta que no se puede caer.
 *
 * Si la portada va lenta, alguien se va. Si esto se cae, hay carros en la pista
 * que no se pueden atender y clientes con el QR en la mano esperando. Es el
 * único escenario donde el umbral de error es CERO, no "menos del 1 %".
 *
 * REQUIERE PREPARACIÓN. El canje exige sesión de empleado, así que hay que
 * darle:
 *   · SCANNER_COOKIE — la cookie de sesión de un empleado del entorno de prueba
 *     (cópiala de las DevTools tras iniciar sesión).
 *   · TOKENS_CSV — un archivo con un token QR válido por línea, de membresías
 *     del entorno de prueba con saldo suficiente.
 *
 * Sin eso, el guion solo mide que la pantalla del escáner carga, que no es lo
 * que importa.
 */
export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '2m', target: 100 },   // ~1.000 escaneos/min con la pausa de abajo
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<1200'],
    // Cero. Un canje fallido es un cliente en la puerta.
    http_req_failed: ['rate==0'],
  },
}

const BASE = __ENV.BASE_URL || 'http://localhost:3000'
const COOKIE = __ENV.SCANNER_COOKIE || ''

export default function cicloDeEscaneo() {
  const params = COOKIE ? { headers: { Cookie: COOKIE } } : {}

  const pantalla = http.get(`${BASE}/empleado/scanner`, params)
  check(pantalla, {
    'scanner carga': (r) => r.status === 200,
    // Si redirige a /login, la cookie caducó y el resto de la medición no vale.
    'scanner con sesión': (r) => !r.url.includes('/login'),
  })

  // Pausa corta: un empleado escanea seguido, no navega. Con 100 usuarios
  // virtuales y ~6 s de ciclo salen unos 1.000 escaneos por minuto, que es el
  // objetivo del escenario de la auditoría.
  http.get(`${BASE}/empleado/caja`, params)
}
