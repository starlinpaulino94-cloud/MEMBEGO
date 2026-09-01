# WhatsApp · qué hace falta para el Alta Incrustada de Meta

> **Estado: NO VERIFICADO.** Esta lista está escrita desde el conocimiento del
> producto de Meta, **no** comprobada contra el panel de Meta de MembeGo ni
> contra su documentación en el día de hoy. Meta cambia estos requisitos con
> frecuencia. Antes de planificar fechas, confírmelo en
> `developers.facebook.com` con la cuenta real del negocio.

## Por qué existe este documento

Hoy una empresa conecta WhatsApp pegando un **token permanente de Usuario del
Sistema**. Funciona, el secreto se guarda cifrado igual que cualquier otro, y
el envío es idéntico — pero obliga a la dueña de un negocio a entrar en el
panel de Meta, encontrar «API Setup» y copiar dos identificadores. Eso es
configurar infraestructura, no conectar una herramienta.

La experiencia objetivo es el **Alta Incrustada (Embedded Signup)**: un botón,
el diálogo de Meta, elegir la cuenta y el número, y terminar.

## Qué bloquea hoy ese camino

| Requisito | Qué es | Quién lo hace |
|---|---|---|
| Cuenta de empresa en Meta | Meta Business Account con el negocio real | MembeGo |
| **Verificación de Negocio** | Meta comprueba la existencia legal de MembeGo con documentos (registro mercantil, dirección, teléfono, dominio) | MembeGo |
| App de tipo Business | Una app en `developers.facebook.com` con el producto WhatsApp añadido | MembeGo |
| **Revisión de la App** | Meta revisa la app y aprueba los permisos avanzados. Suele pedir un vídeo del flujo funcionando | MembeGo |
| Permisos avanzados | `whatsapp_business_management` y `whatsapp_business_messaging` en modo avanzado, no de desarrollo | Meta aprueba |
| Configuración del alta incrustada | El SDK de JavaScript de Meta con el identificador de configuración del alta | MembeGo |
| Cuenta de WhatsApp Business del cliente | La empresa necesita su propio número, no usado en la app de WhatsApp normal | Cada empresa |

El cuello de botella real son los dos marcados en negrita. Hasta que estén,
los permisos se quedan en modo desarrollo: solo funcionan con números de
prueba y con personas dadas de alta a mano en la app.

## Qué cambia en el código cuando se apruebe

Muy poco, y está diseñado así a propósito.

En `src/modules/connect/proveedores/whatsapp.ts`, el paso `credencial` se
sustituye por uno de tipo `COMPONENTE` con el diálogo de Meta, y
`autorizacion` pasa de `{ tipo: 'API_KEY', patron: 'CREDENCIAL' }` a
`{ tipo: 'OAUTH2', patron: 'POPUP' }`. El patrón es POPUP y no REDIRECCION
porque el alta incrustada **no es una redirección OAuth normal**: es un
diálogo del SDK de Meta que devuelve el resultado a la ventana que lo abrió.

**No cambia nada más**: el token que produzca el alta acaba en la misma
credencial sellada (`credenciales_conexion`, AES-256-GCM con AAD por fila), y
por tanto el envío (`whatsapp.ts`), la salud, las automatizaciones, los
webhooks y la bitácora no se enteran de que el origen del secreto cambió.

Mientras tanto, la marca `provisional` de la definición hace que la interfaz lo
diga en voz alta en vez de disfrazarlo, y una prueba de la suite falla si
alguien la quita.
