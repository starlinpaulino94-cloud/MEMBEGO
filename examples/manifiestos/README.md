# Manifiestos de sistemas verticales

Un sistema vertical se declara **en datos**, no en código del Core. Este
directorio son ejemplos reales del formato.

```bash
# Comprobar el manifiesto sin tocar la base
tsx scripts/registrar-sistema.ts examples/manifiestos/restaurant.json --validar

# Darlo de alta y habilitarlo para una empresa
tsx scripts/registrar-sistema.ts examples/manifiestos/restaurant.json --empresa mi-restaurante
```

El script imprime `MEMBEGO_CLIENT_ID`, `MEMBEGO_CLIENT_SECRET` y
`MEMBEGO_WEBHOOK_SECRET` **una sola vez**. En la base queda el scrypt del
secreto, no el secreto: si se pierde, se rota.

## Se piden capabilities, no scopes

`"capabilities": ["BENEFIT_REDEMPTION"]` concede `benefits:read` y
`benefits:redeem`. Escribir un scope directamente en el manifiesto no concede
nada — la lista de lo concedible vive en el Core (`@membego/contracts`), y un
valor que no esté en ella falla la validación.

Esa dirección es la que importa el día que alguien añada una línea al archivo de
un satélite: no puede darse permisos a sí mismo.

## Nace en DRAFT

Registrar no es lanzar. El sistema se crea en `DRAFT`: no abre sesiones ni
recibe eventos hasta que alguien lo activa desde el panel de superadmin. Volver
a correr el script para actualizar una URL **no** reactiva un sistema que fue
suspendido.

## Los campos

| Campo | Obligatorio | Qué es |
|---|---|---|
| `slug` | sí | Identificador estable. Viaja en las URLs de SSO: no se renombra |
| `nombre` | sí | Para el panel y el App Launcher |
| `urlBase` | sí | Raíz del satélite. `https` salvo `localhost`, porque por ahí viaja un token SSO |
| `businessTypes` | sí | Verticales a los que sirve. Un tipo que no existe **se crea**: un vertical nuevo no exige un despliegue |
| `capabilities` | sí | Lo que el sistema *hace*. Los scopes se derivan |
| `webhookUrl` | no | Sin esto, el sistema solo recibe SSO |
| `autoHabilitar` | no | ¿Toda empresa compatible lo obtiene sin habilitación explícita? Por defecto `false` |
| `accesoPorUsuario` | no | ¿Hace falta que cada persona tenga acceso explícito? Por defecto `false` |
