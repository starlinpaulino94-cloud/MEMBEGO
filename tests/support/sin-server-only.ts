/**
 * Neutraliza `server-only` para las pruebas que cargan módulos de servidor con `tsx --test` (Node, no Next).
 *
 * `server-only` lanza al importarse fuera de un componente de servidor. `notificaciones/push.ts` lo declara, y lo arrastran
 * `jobs/ejecutor.ts` y los efectos de supply-v2: sin esto, esas pruebas ni cargan. En producción la guarda sigue en pie; aquí solo se
 * deja el paquete ya «cargado» y vacío en la caché de módulos.
 *
 * Se importa PRIMERO, antes de cualquier módulo de `src/` (los `import` se ejecutan en el orden en que están escritos):
 *
 *   import './support/sin-server-only'
 */
const rutaServerOnly: string = require.resolve('server-only')
require.cache[rutaServerOnly] = { id: rutaServerOnly, filename: rutaServerOnly, loaded: true, exports: {}, children: [], paths: [] } as unknown as NodeJS.Module

export {}
