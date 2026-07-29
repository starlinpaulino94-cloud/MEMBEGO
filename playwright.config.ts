import { defineConfig, devices } from '@playwright/test'

/**
 * PRUEBAS DE EXTREMO A EXTREMO (auditoría · Fase 7, punto 26).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ CUBREN Y QUÉ NO — leer antes de confiar en ellas
 *
 * Cubren el RECORRIDO PÚBLICO: la landing, el marketplace, el perfil de una
 * empresa, las páginas legales, el 404 y la pantalla sin conexión. Todo lo que
 * un visitante ve antes de tener cuenta.
 *
 * NO cubren el recorrido autenticado —registro, compra, pago, QR, canje—, que
 * es justamente el que mueve dinero. El motivo es concreto y no se arregla
 * escribiendo más pruebas: la autenticación de MembeGo la hace Supabase Auth,
 * un servicio externo. Sin un proyecto de Supabase real no hay forma de crear
 * una sesión, y usar el de producción para pruebas automáticas significaría
 * crear y borrar usuarios de verdad en la misma base donde están los clientes.
 *
 * Lo que hace falta para cerrar esa mitad está escrito en docs/PRUEBAS-E2E.md:
 * un proyecto de Supabase de pruebas, sus claves como secretos del repositorio,
 * y un juego de datos sembrado antes de cada ejecución.
 *
 * Decirlo así, y no llamar a esto "E2E del recorrido completo del cliente", es
 * la diferencia entre una red de seguridad y una que parece que está.
 * ────────────────────────────────────────────────────────────────────────────
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Sin paralelismo entre archivos: comparten la misma base de datos y el
  // mismo servidor. Con este número de pruebas no compensa la complejidad.
  fullyParallel: false,
  workers: 1,
  // Un reintento: los fallos de arranque del servidor son reales y no son
  // regresiones. Más de uno escondería una prueba de verdad inestable.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3210',
    // Permite usar un Chromium ya instalado en el sistema en vez de que
    // Playwright descargue el suyo. En CI se deja sin definir y `playwright
    // install --with-deps chromium` se encarga; en entornos donde el navegador
    // ya está (contenedores preparados) evita bajar 150 MB por ejecución.
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'es-DO',
    timezoneId: 'America/Santo_Domingo',
  },

  projects: [
    {
      name: 'movil',
      // Móvil primero y no escritorio: el 90% del tráfico de MembeGo es un
      // teléfono. Probar en 1920×1080 sería probar el caso que casi nadie usa.
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'escritorio',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
