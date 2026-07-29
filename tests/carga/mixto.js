import http from 'k6/http'
import { check, sleep } from 'k6'

/**
 * LOS TRES PERFILES A LA VEZ — el escenario real del lanzamiento.
 *
 * Medir cada ruta por separado da números bonitos y engañosos: los tres
 * perfiles compiten por el MISMO pool de conexiones de Postgres. El cuello de
 * botella aparece en la suma, no en las partes, y por eso este es el guion que
 * de verdad responde a "¿aguanta 5.000 concurrentes?".
 *
 * Proporciones tomadas del escenario de la auditoría (20.000 activos diarios):
 * la mayoría son visitantes anónimos, una parte clientes con sesión, y unos
 * pocos empleados escaneando sin parar.
 */
export const options = {
  scenarios: {
    anonimos: {
      executor: 'ramping-vus',
      exec: 'anonimo',
      stages: [
        { duration: '2m', target: 500 },
        { duration: '3m', target: 3500 },
        { duration: '5m', target: 3500 },
        { duration: '2m', target: 0 },
      ],
    },
    clientes: {
      executor: 'ramping-vus',
      exec: 'cliente',
      stages: [
        { duration: '2m', target: 200 },
        { duration: '3m', target: 1400 },
        { duration: '5m', target: 1400 },
        { duration: '2m', target: 0 },
      ],
    },
    empleados: {
      executor: 'constant-vus',
      exec: 'empleado',
      vus: 100,
      duration: '12m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
    // Por escenario: si solo se degrada uno, el promedio global lo esconde.
    'http_req_duration{scenario:empleados}': ['p(95)<1500'],
  },
}

const BASE = __ENV.BASE_URL || 'http://localhost:3000'
const COOKIE_CLIENTE = __ENV.CLIENTE_COOKIE || ''
const COOKIE_EMPLEADO = __ENV.SCANNER_COOKIE || ''

export function anonimo() {
  check(http.get(`${BASE}/`), { 'portada ok': (r) => r.status === 200 })
  sleep(Math.random() * 4 + 2)
}

export function cliente() {
  const p = COOKIE_CLIENTE ? { headers: { Cookie: COOKIE_CLIENTE } } : {}
  check(http.get(`${BASE}/cliente/inicio`, p), { 'inicio ok': (r) => r.status === 200 })
  sleep(1)
  http.get(`${BASE}/cliente/promociones`, p)
  sleep(Math.random() * 5 + 3)
}

export function empleado() {
  const p = COOKIE_EMPLEADO ? { headers: { Cookie: COOKIE_EMPLEADO } } : {}
  check(http.get(`${BASE}/empleado/scanner`, p), { 'scanner ok': (r) => r.status === 200 })
  sleep(4)
}
