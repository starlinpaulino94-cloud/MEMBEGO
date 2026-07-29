import path from 'node:path'
import { defineConfig } from 'prisma/config'

// Con un `prisma.config.ts` presente, la CLI de Prisma DEJA de leer `.env` sola.
// Sin esta línea, `npx prisma migrate deploy` en local fallaría con
// "Environment variable not found: DATABASE_URL" aunque el `.env` esté ahí.
// En CI las variables vienen del entorno y esto no hace nada.
import 'dotenv/config'

/**
 * CONFIGURACIÓN DE PRISMA
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE ESTE ARCHIVO (y no basta con `package.json#prisma`)
 *
 * Dos razones, y la segunda es un fallo real que este archivo corrige:
 *
 * 1. `package.json#prisma` está DEPRECADO y desaparece en Prisma 7. La propia
 *    CLI lo avisa en cada comando.
 *
 * 2. Y la importante: al pasar el esquema a una CARPETA (`prisma/schema/`),
 *    Prisma dejó de encontrar las migraciones. Resuelve la ruta de migraciones
 *    a partir de la del esquema, así que empezó a buscarlas en
 *    `prisma/schema/migrations/` en vez de `prisma/migrations/`.
 *
 *    El síntoma era silencioso y peligroso: `prisma migrate deploy` decía
 *    "No migration found" y no aplicaba nada. En el flujo de despliegue eso
 *    significa que una migración nueva NO se aplicaría y el código saldría a
 *    producción por delante de la base — exactamente el fallo C-03 de la
 *    auditoría, reintroducido por la puerta de atrás.
 *
 *    Aquí se declaran las dos rutas por separado y el problema desaparece.
 * ────────────────────────────────────────────────────────────────────────────
 */
export default defineConfig({
  // Un archivo por dominio. El índice está en prisma/schema/base.prisma.
  schema: path.join('prisma', 'schema'),

  migrations: {
    // Se quedan donde siempre han estado. Moverlas invalidaría las rutas de
    // toda la documentación y del historial de git sin ganar nada.
    path: path.join('prisma', 'migrations'),
    // `npm run db:seed` sigue funcionando igual.
    seed: 'tsx prisma/seed.ts',
  },
})
