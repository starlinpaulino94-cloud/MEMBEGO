# Runbooks de incidentes

Qué hacer cuando algo se rompe, escrito **antes** de que se rompa.

Un runbook no es documentación de arquitectura. Es una lista de pasos para
alguien que está nervioso, posiblemente medio dormido, con clientes esperando
en la pista. Por eso todos tienen la misma forma y por eso empiezan por cómo
**confirmar** el diagnóstico: la mitad de los incidentes largos son incidentes
cortos que se atacaron por el sitio equivocado.

## Los runbooks

| Síntoma que ves | Runbook |
|---|---|
| Nada carga, "No pudimos cargar tu información" en todas las pantallas | [`base-de-datos-caida.md`](base-de-datos-caida.md) |
| Errores intermitentes, unos usuarios sí y otros no, `P2024` en los logs | [`pool-agotado.md`](pool-agotado.md) |
| Se borraron datos que no se debían borrar | [`restaurar-datos-borrados.md`](restaurar-datos-borrados.md) |
| Módulos vacíos sin dar error después de un despliegue | [`migracion-fallida.md`](migracion-fallida.md) |
| Las notificaciones no salen; los trabajos no se ejecutan | [`cola-atascada.md`](cola-atascada.md) |
| Un cliente pagó y su membresía no se activó | [`pagos-cardnet.md`](pagos-cardnet.md) |
| Una clave o secreto quedó expuesto | [`credencial-filtrada.md`](credencial-filtrada.md) |
| Necesito cerrar la aplicación para trabajar tranquilo | [`modo-mantenimiento.md`](modo-mantenimiento.md) |

## Antes de abrir cualquiera de ellos

**1. Escribe la hora y el síntoma.** Literalmente, en el móvil. Treinta
segundos. Durante el incidente parece tiempo perdido; a las tres horas es lo
único que explica qué estaba pasando y en qué orden.

**2. ¿Qué cambió?** El 80% de los incidentes empiezan justo después de un
despliegue, una migración o un cambio de configuración. Si acabas de tocar algo,
empieza por deshacerlo antes de investigar.

**3. Distingue "está caído" de "está lento".** Son incidentes distintos con
causas distintas. `curl -s https://<dominio>/api/health` responde
`{"status":"ok"}` o `{"status":"degraded"}`. Si responde `ok` y aun así los
usuarios se quejan, no es la base: es rendimiento, y va por
[`pool-agotado.md`](pool-agotado.md).

## Diagnóstico rápido

```bash
# ¿Vive?
curl -s https://<dominio>/api/health

# Detalle (solo con el secreto; devuelve latencias, desfase de esquema y conteos)
curl -s -H "x-health-secret: $BOOTSTRAP_SECRET" https://<dominio>/api/health | jq
```

`schema: "DRIFT"` en esa salida significa que la base está por detrás del
código → [`migracion-fallida.md`](migracion-fallida.md).

## Sobre la guardia

Hay una persona. `docs/RECUPERACION.md` § 6 explica qué significa eso de verdad
y qué se puede montar para compensarlo. Estos runbooks están escritos para que
sirvan tanto a otra persona como a uno mismo a las 3 de la mañana — que a
efectos prácticos es otra persona.

## Mantener esto vivo

Cada vez que ocurra un incidente real: si el runbook sirvió, anota qué faltaba.
Si no había runbook, escríbelo mientras se recuerda. Un runbook que no se toca
en un año describe un sistema que ya no existe.
