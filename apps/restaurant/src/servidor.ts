import { createServer } from 'node:http'
import { recibirWebhook, type AlmacenInboxPersistente } from './webhook'
import type { AlmacenProyeccion } from './proyeccion'
import { tareaReconciliar, type Cerrojo, type OpcionesTarea } from './tarea-reconciliar'
import type { AlmacenReconciliacion } from './reconciliacion'
import type { MembegoClient } from '@membego/platform-sdk'

/**
 * EL SERVIDOR DEL SATÉLITE.
 *
 * Node pelado, sin framework, a propósito: lo que hay que demostrar es que un
 * sistema aparte se integra con MembeGo por HTTP y nada más. Un framework aquí
 * añadiría magia que no es de la plataforma y taparía la única parte delicada
 * — leer el cuerpo CRUDO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CUERPO CRUDO, Y POR QUÉ ESTO NO USA `req.json()`
 *
 * La firma se calcula sobre los bytes EXACTOS que llegaron. Parsear el JSON y
 * volver a serializarlo cambia el orden de las claves y los espacios: los datos
 * son los mismos y la firma ya no cuadra. Falla siempre, en todos los eventos,
 * y el mensaje —«firma inválida»— apunta al sitio equivocado.
 *
 * Es el error más repetido al integrar webhooks firmados, y por eso el cuerpo
 * se acumula como texto y se pasa tal cual.
 */

export interface DepsServidor {
  clavePublicaPem: string
  inbox: AlmacenInboxPersistente
  proyeccion: AlmacenProyeccion
  /**
   * La reconciliación programada. Opcional para poder levantar el servidor solo
   * como receptor de webhooks —en pruebas, o en una instancia que no barre—
   * sin tener que inventarle un cliente del Core.
   */
  reconciliacion?: {
    membego: MembegoClient
    almacen: AlmacenReconciliacion
    cerrojo: Cerrojo
    /** El mismo `Bearer <secreto>` que usan los crons de MembeGo. */
    secreto: string
    opciones?: OpcionesTarea
  }
}

function leerCuerpo(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const trozos: Buffer[] = []
    req.on('data', (t) => trozos.push(t))
    req.on('end', () => resolve(Buffer.concat(trozos).toString('utf8')))
    req.on('error', reject)
  })
}

export function crearServidor(deps: DepsServidor) {
  return createServer(async (req, res) => {
    const responder = (codigo: number, cuerpo: unknown) => {
      res.writeHead(codigo, { 'content-type': 'application/json' })
      res.end(JSON.stringify(cuerpo))
    }

    if (req.method === 'GET' && req.url === '/salud') {
      return responder(200, { ok: true, sistema: 'restaurant' })
    }

    /**
     * DISPARADOR DE LA RECONCILIACIÓN.
     *
     * Es un endpoint y no un temporizador dentro del proceso a propósito: así
     * lo dispara cualquier programador —cron del sistema, un CronJob de
     * Kubernetes, el scheduler de la nube— sin que el satélite tenga que
     * saber cuál. Un temporizador interno además se duplica solo con cada
     * instancia que se levante.
     *
     * El secreto va en `Authorization: Bearer`, igual que los crons de
     * MembeGo. Sin él, cualquiera puede hacer que el satélite martillee al
     * Core llamando a esta URL en bucle.
     */
    if (req.method === 'POST' && req.url === '/tareas/reconciliar') {
      const cfg = deps.reconciliacion
      if (!cfg) return responder(404, { error: 'Esta instancia no reconcilia.' })

      // Comparación de longitud constante no hace falta aquí —no hay oráculo
      // de tiempo útil sobre un secreto largo por HTTP— pero sí que el secreto
      // esté configurado: sin él, `Bearer undefined` abriría la puerta.
      if (!cfg.secreto || req.headers.authorization !== `Bearer ${cfg.secreto}`) {
        return responder(401, { error: 'No autorizado.' })
      }

      try {
        const r = await tareaReconciliar(cfg.membego, cfg.almacen, cfg.cerrojo, cfg.opciones)
        // 200 también cuando se salta por solape: para el programador no es un
        // fallo, y devolver error haría que reintentara justo lo que se acaba
        // de decidir no hacer.
        return responder(200, r)
      } catch (e) {
        console.error('[restaurant] reconciliación:', e)
        return responder(500, { error: 'La reconciliación falló.' })
      }
    }

    if (req.method === 'POST' && req.url === '/webhooks/membego') {
      try {
        const crudo = await leerCuerpo(req)
        const r = await recibirWebhook(crudo, req.headers, deps)
        if (r.estado === 400) return responder(400, { error: r.motivo })
        // 200 en cuanto está decidido: MembeGo reintenta lo que no responde, y
        // el inbox ya garantiza que un reintento no vuelve a aplicar.
        return responder(200, { recibido: true, duplicado: r.duplicado })
      } catch (e) {
        console.error('[restaurant] webhook:', e)
        // 500 y NO 200: un 200 le diría a MembeGo que se procesó algo que se
        // perdió, y el evento no se reintentaría nunca.
        return responder(500, { error: 'Error procesando el evento.' })
      }
    }

    responder(404, { error: 'No encontrado.' })
  })
}

if (process.argv[1]?.endsWith('servidor.ts')) {
  console.error('Este servidor necesita sus dependencias (clave, inbox, proyección).')
  console.error('Ver apps/restaurant/README.md.')
  process.exit(1)
}
