import http from 'k6/http'
import { check, sleep } from 'k6'

/**
 * PORTADA PÚBLICA — el golpe del lanzamiento.
 *
 * Es el escenario que la auditoría señaló como primer punto de colapso:
 * `/api/stats` hacía cuatro recorridos completos de tabla por visita anónima,
 * sin caché. Ya está corregido (caché de 5 min + conteos aproximados); este
 * guion es lo que lo demuestra o lo desmiente.
 *
 * Sube en rampa y no de golpe a propósito: un salto instantáneo mide el
 * arranque en frío de las funciones, no la capacidad sostenida. Lo que
 * interesa aquí es lo segundo.
 */
export const options = {
  stages: [
    { duration: '1m', target: 100 },   // calentar
    { duration: '2m', target: 1000 },  // subida
    { duration: '3m', target: 1000 },  // meseta: aquí se mide de verdad
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    // p95 y no la media: la media esconde que uno de cada veinte usuarios
    // esperó ocho segundos.
    http_req_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
  },
}

const BASE = __ENV.BASE_URL || 'http://localhost:3000'

export default function visitaAnonima() {
  const portada = http.get(`${BASE}/`)
  check(portada, {
    'portada 200': (r) => r.status === 200,
    'portada < 800ms': (r) => r.timings.duration < 800,
  })

  // El endpoint que era el problema. Se pide aparte para poder verlo separado
  // de la portada en los resultados.
  const stats = http.get(`${BASE}/api/stats`)
  check(stats, {
    'stats 200': (r) => r.status === 200,
    // Con la caché puesta esto tiene que ser inmediato. Si sube de 200 ms de
    // forma sostenida, la caché no está funcionando.
    'stats < 200ms': (r) => r.timings.duration < 200,
  })

  sleep(Math.random() * 3 + 1)
}
