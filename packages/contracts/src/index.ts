/**
 * @membego/contracts — el vocabulario de la plataforma MembeGo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ES Y POR QUÉ EXISTE
 *
 * Todo lo que viaja por el cable entre MembeGo y un sistema vertical: scopes,
 * códigos de error, el sobre de los eventos y las respuestas de la API.
 *
 * Sin este paquete, cada satélite copiaría estos tipos a mano. Copiar funciona
 * el primer día y falla el tercer mes: MembeGo añade un campo, el satélite no
 * se entera, y el fallo aparece en producción con la forma de un `undefined`
 * que nadie relaciona con un despliegue de hace tres semanas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ES LA FUENTE, NO UNA COPIA
 *
 * El Core NO tiene su propia definición de estas cosas: las reexporta desde
 * aquí. No hay dos listas de scopes ni dos tablas de códigos que puedan
 * separarse, porque solo hay una.
 *
 * Esa dirección importa. Si el paquete copiara del Core, la copia se quedaría
 * atrás en cuanto alguien tuviera prisa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CERO DEPENDENCIAS
 *
 * Ni Prisma, ni Next, ni node. Es TypeScript puro para que un satélite escrito
 * en cualquier cosa —otro framework, otra versión de node, un Deno— pueda
 * instalarlo sin arrastrar la mitad de MembeGo detrás.
 */

export * from './scopes'
export * from './errores'
export * from './eventos'
export * from './api'
