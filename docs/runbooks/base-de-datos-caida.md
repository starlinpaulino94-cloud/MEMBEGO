# Runbook · La base de datos no responde

**Síntoma:** todas las pantallas fallan a la vez. "No pudimos cargar tu
información" en el portal del cliente, panel de empresa en blanco, el escáner
no valida nada.

---

## 1 · Confirmar (2 minutos)

```bash
curl -s https://<dominio>/api/health
```

| Respuesta | Qué significa | A dónde ir |
|---|---|---|
| `{"status":"ok"}` | La base responde. **No es este runbook** | Si los usuarios se quejan igual → [`pool-agotado.md`](pool-agotado.md) |
| `{"status":"degraded"}` | La base no responde o falta configuración | Sigue aquí |
| No responde nada / 502 / 504 | Cayó Vercel o la aplicación no arranca | § 4 |

Detalle con el secreto:

```bash
curl -s -H "x-health-secret: $BOOTSTRAP_SECRET" https://<dominio>/api/health | jq
```

Mira `checks.database`, `diagnostics.raw_query_error` y
`diagnostics.db_latency_first_ms`.

Y el panel del proveedor, que es la respuesta más rápida de todas:
**https://status.supabase.com** y el propio panel del proyecto.

---

## 2 · Las tres causas, en orden de probabilidad

### a) Supabase está caído o el proyecto está pausado

Los proyectos del plan Free **se pausan solos** tras una semana sin actividad.
El panel lo dice y se reanuda con un botón, pero tarda unos minutos.

También: factura impagada → proyecto suspendido. Comprueba Billing.

**Qué hacer:** reanudar o esperar. No hay atajo. Si es un incidente del
proveedor, la única acción útil es avisar a la pista de que cobren a mano y
apuntar en papel.

### b) Se agotaron las conexiones

`diagnostics.raw_query_error` menciona `too many connections`, `P2024` o
*timeout*. Es un incidente distinto disfrazado de caída →
[`pool-agotado.md`](pool-agotado.md).

### c) Cambió la configuración

¿Se rotó la contraseña de la base? ¿Se tocó `DATABASE_URL` en Vercel?
`checks.database_url` = `MISSING` lo delata. `diagnostics.db_host` te dice a
qué host está apuntando de verdad — compáralo con el de Supabase.

---

## 3 · Actuar

**Si la caída va a durar más de unos minutos**, cierra la aplicación:
[`modo-mantenimiento.md`](modo-mantenimiento.md). Una pantalla que dice "volvemos
en unos minutos" es infinitamente mejor que cincuenta pantallas rotas distintas,
y evita que la gente reintente pagos y registros que no se están guardando.

**Mientras tanto, en la pista:** los lavados se cobran y se apuntan en papel
(matrícula, servicio, monto, hora). Se cargan en caja al volver. Esto no es
improvisación: es el plan.

**Cuando vuelva:**

```bash
curl -s -H "x-health-secret: $BOOTSTRAP_SECRET" https://<dominio>/api/health | jq '.checks'
```

Todo en `ok` y `schema` sin `DRIFT`. Después, reabrir.

---

## 4 · Si lo que no responde es la aplicación, no la base

502 / 504 / nada, y Supabase está bien.

- Vercel → Deployments: ¿el último despliegue está en *Error*? Haz **Rollback**
  al anterior que estuviera bien. Es el botón más útil de todo el panel.
- Vercel → Logs: busca errores en el arranque. Una variable de entorno que
  falta tumba la función entera, no una página.
- **https://www.vercel-status.com**

---

## 5 · No hagas esto

- **No borres ni recrees el proyecto de Supabase.** Es irreversible y en el 99%
  de los casos el problema es temporal.
- **No cambies `DATABASE_URL` "a ver si así funciona".** Si no sabes qué valor
  poner, ese no es el problema.
- **No corras migraciones** para arreglar una caída. Una migración sobre una
  base inestable es cómo un incidente de una hora se convierte en uno de un día.
- **No reinicies el proyecto repetidamente.** Cada reinicio tira las conexiones
  abiertas y alarga la recuperación.

---

## 6 · Después

- Anota en `docs/RECUPERACION.md` § 7: hora de inicio, hora de vuelta, causa.
- Si la causa fue el plan Free (pausa automática), eso es un argumento concreto
  para subir de plan — el mismo cambio que habilita PITR
  (`docs/RECUPERACION.md` § 3.1).
- Si no te enteraste hasta que llamó un cliente, monta el monitor de uptime
  (`docs/RECUPERACION.md` § 6). Es gratis y es la diferencia entre 10 minutos
  y dos horas.
