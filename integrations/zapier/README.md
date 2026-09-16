# App de MembeGo para Zapier

> Hallazgo **B-2** de `docs/AUDITORIA-INTEGRACIONES-2026-09.md`.

Esto **no es parte del despliegue de MembeGo**. Es una aplicación separada que
vive en la infraestructura de Zapier y que llama a nuestra API pública. Está en
este repositorio porque su contrato es el nuestro: si cambia un evento o un
campo, el cambio tiene que verse en el mismo commit que lo provoca.

## Por qué existe

La auditoría lo dijo así: el atajo a «conectamos con lo que uses» no es escribir
treinta conectores, es enchufarse a quien ya los escribió. Una app de Zapier con
tres disparadores y una búsqueda abre miles de destinos sin que nosotros
integremos ninguno.

Y estaba casi todo hecho: OpenAPI público, claves de API por empresa, y una
maquinaria de entrega de webhooks con firma, reintentos y registro. Lo único que
faltaba era poder crear y retirar suscripciones **por API**, que es lo que un
constructor de flujos necesita para no obligar a nadie a entrar al panel a mano.

## Cómo está construida

**Autenticación: clave de API.** La empresa pega su clave `mbk_…` y viaja como
`Authorization: Bearer`. No usamos OAuth2 y no es pereza: OAuth exige que
MembeGo sea servidor de autorización —pantalla de consentimiento, apps
registradas, tokens de refresco—, que es el hallazgo A-3 y un programa entero.
Con clave de API la empresa controla el acceso desde su propio panel y puede
revocarlo en un clic.

**Disparadores por REST Hook, no por sondeo.** Zapier llama a `subscribeHook` al
encender el Zap y a `unsubscribeHook` al apagarlo; nosotros creamos y retiramos
la suscripción. Así el aviso llega en el momento en vez de con hasta quince
minutos de retraso, y de paso heredamos los reintentos, la firma y el registro
de entregas que ya existen.

Cada disparador necesita además una lista de ejemplo (`performList`) para que
Zapier pueda enseñar datos al configurar el Zap. Ahí sí se consulta la API.

## Instalar y publicar

```bash
cd integrations/zapier
npm install
npx zapier login
npx zapier register "MembeGo"   # solo la primera vez
npx zapier push
```

Para probar sin publicar: `npx zapier invite` comparte la versión con quien
quieras. La revisión de Zapier solo hace falta para aparecer en su directorio
público.

## Lo que hay que saber antes de publicarla

- La empresa necesita una clave con el permiso **«Crear y retirar avisos»**
  (`webhooks:manage`) además de los de lectura que vaya a usar. Sin él los Zaps
  se pueden configurar y no se encienden.
- Y necesita `webhooks.max` concedido en su plan, o crear la suscripción
  devuelve `QUOTA_EXCEEDED`. Cada Zap encendido consume una.
