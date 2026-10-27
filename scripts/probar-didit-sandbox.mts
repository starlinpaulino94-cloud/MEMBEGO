import { randomUUID } from 'node:crypto'
import { getDiditConfig } from '../src/lib/env'
import { crearProveedorDidit } from '../src/modules/identidad/proveedor/didit'
import { ErrorDeProveedor } from '../src/modules/identidad/proveedor/contrato'

/**
 * PRUEBA DE CONTRATO CONTRA EL SANDBOX DE DIDIT (manual, nunca en CI).
 *
 * Las pruebas automáticas usan un Didit FALSO escrito a partir de la documentación. Esta
 * comprobación es la que dice si esa documentación y nuestra lectura de ella son ciertas:
 * crea una sesión REAL en el entorno de pruebas de Didit, pregunta su decisión, la
 * traduce con el mismo código que usa el servidor y la borra. No toca la base de datos de
 * MEMBEGO y no usa ningún documento: la sesión se queda en «Not Started».
 *
 * Qué comprueba (cada paso imprime ✓ o ✗):
 *   1. crear sesión: devuelve `session_id` y una dirección https de didit.me;
 *   2. crearla otra vez con la misma referencia devuelve LA MISMA sesión (idempotencia);
 *   3. la decisión se entiende y se traduce («Not Started» → sin novedad);
 *   4. la decisión devuelve nuestra referencia (`vendor_data`);
 *   5. borrar la sesión (con y sin supresión) y que borrarla otra vez cuente como «ya borrada»;
 *   6. borrar la persona del proveedor por la lista de referencias;
 *   7. que una sesión borrada ya no responde.
 *
 * USO (con las variables de un entorno de PRUEBAS de Didit, nunca las de producción):
 *
 *   DIDIT_API_KEY=… DIDIT_WORKFLOW_ID=… npm run identidad:probar-didit
 *
 * La firma de los avisos se comprueba aparte: en la consola de Didit, «Try Webhook» hacia
 * https://<tu-dominio>/api/webhooks/identidad/didit con el secreto en DIDIT_WEBHOOK_SECRET.
 * Un 200 allí confirma la firma V2, la frescura y la bandeja; un 401 dice que algo no cuadra.
 */

const decir = (texto: string) => void process.stdout.write(texto + '\n')
const config = getDiditConfig()
if (!config) {
  console.error('Faltan DIDIT_API_KEY y DIDIT_WORKFLOW_ID (de un entorno de PRUEBAS).')
  process.exit(2)
}

let fallos = 0
/** Imprime ✓ o ✗ según se cumpla la condición. */
function comprobar(cumple: boolean, bien: string, mal: string, detalle?: unknown) {
  if (cumple) {
    decir('  ✓ ' + bien)
    return
  }
  fallos++
  decir('  ✗ ' + mal + (detalle ? ' — ' + (detalle instanceof Error ? detalle.message : String(detalle)) : ''))
}
async function paso<T>(titulo: string, f: () => Promise<T>): Promise<T | null> {
  decir(titulo)
  try {
    return await f()
  } catch (e) {
    comprobar(false, '', 'lanzó', e instanceof ErrorDeProveedor ? e.codigo + ' (HTTP ' + (e.estadoHttp ?? '-') + ')' : e)
    return null
  }
}

const proveedor = crearProveedorDidit(config)
const referencia = 'prueba-contrato-' + randomUUID()
decir('Probando contra ' + config.apiBase + ' con la referencia ' + referencia + '\n')
const retorno = 'membego://identidad/retorno?intento=prueba'

const sesion = await paso('1. Crear sesión', async () => {
  const s = await proveedor.crearSesion({ intentoId: referencia, callbackUrl: retorno, idioma: 'es' })
  comprobar(Boolean(s.sesionId), 'session_id recibido (' + s.sesionId.slice(0, 8) + '…)', 'sin session_id')
  comprobar(new URL(s.url).hostname.endsWith('didit.me'), 'la dirección es de didit.me por https', 'la dirección no es de didit.me')
  return s
})

if (sesion) {
  await paso('2. Idempotencia por referencia', async () => {
    const otra = await proveedor.crearSesion({ intentoId: referencia, callbackUrl: retorno, idioma: 'es' })
    comprobar(otra.sesionId === sesion.sesionId, 'la misma referencia devuelve la misma sesión', 'devolvió OTRA sesión: la idempotencia no es la que dice la documentación')
  })

  await paso('3-4. Decisión', async () => {
    const d = await proveedor.consultarDecision(sesion.sesionId)
    comprobar(d.decision.resultado === 'iniciada', '«Not Started» se traduce a «sin novedad»', 'resultado inesperado: ' + d.decision.resultado)
    comprobar(d.referenciaDelCliente === referencia, 'la decisión devuelve nuestra referencia (vendor_data)', 'la decisión NO devuelve nuestra referencia', d.referenciaDelCliente)
  })

  await paso('5. Borrar la sesión', async () => {
    const primera = await proveedor.borrarSesion(sesion.sesionId, { motivo: 'operacional', instruccionId: referencia })
    comprobar(primera === 'borrada', 'borrada (borrado operativo)', 'respuesta inesperada: ' + primera)
    const segunda = await proveedor.borrarSesion(sesion.sesionId, { motivo: 'supresion', instruccionId: referencia })
    comprobar(segunda === 'ya_borrada', 'borrarla otra vez cuenta como «ya borrada»', 'respuesta inesperada: ' + segunda)
  })

  await paso('6. Borrar la persona del proveedor', async () => {
    await proveedor.borrarUsuarios([referencia])
    comprobar(true, 'aceptado (idempotente)', '')
  })

  await paso('7. Una sesión borrada ya no responde', async () => {
    try {
      await proveedor.consultarDecision(sesion.sesionId)
      comprobar(false, '', 'la sesión borrada todavía responde')
    } catch (e) {
      comprobar(e instanceof ErrorDeProveedor && e.estadoHttp === 404, '404, como se espera', 'falló, pero no con 404', e)
    }
  })
}

decir(fallos === 0 ? '\nEl contrato con Didit se cumple.' : '\n' + fallos + ' comprobación(es) fallaron: revisa la documentación de Didit y el cliente antes de encender nada.')
process.exit(fallos === 0 ? 0 : 1)
