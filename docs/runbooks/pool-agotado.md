# Runbook · Se agotaron las conexiones (P2024)

**Síntoma:** errores **intermitentes**. Unos usuarios cargan bien y otros no.
La misma página falla y a los diez segundos funciona. Empeora en las horas
punta. En los logs aparece `P2024`, `Timed out fetching a new connection from
the connection pool` o `too many connections`.

Esto es lo que más se confunde con "la base está caída". No lo es: la base está
perfectamente viva y no le queda por dónde atenderte.

---

## 1 · Confirmar

```bash
curl -s -H "x-health-secret: $BOOTSTRAP_SECRET" https://<dominio>/api/health | jq \
  '{db_latency_first_ms: .diagnostics.db_latency_first_ms,
    db_latency_warm_ms: .diagnostics.db_latency_warm_ms,
    pgbouncer: .diagnostics.db_has_pgbouncer}'
```

- `db_latency_warm_ms` por encima de 150 ms de forma sostenida → saturación.
- `pgbouncer: false` → **estás conectando por el puerto directo**, que es la
  causa raíz más común y la más fácil de arreglar.

En Vercel → Logs, busca `P2024`. Si aparece en ráfagas coincidiendo con las
horas de más tráfico, es este runbook.

En Supabase → Database → Roles / Connection pooling puedes ver las conexiones
activas.

---

## 2 · Por qué pasa

Prisma abre por defecto `num_cpus * 2 + 1` conexiones **por instancia**. En
Vercel cada instancia serverless caliente es una más. Con unas 5-9 conexiones
por instancia y un pooler de ~200, bastan **unas 25 instancias simultáneas**
para agotarlo — y 25 instancias no es tráfico enorme: es un sábado por la
mañana con una campaña de WhatsApp recién enviada.

La aritmética completa está escrita al lado del código en `src/lib/prisma.ts`.

---

## 3 · Arreglo (en este orden)

### a) `connection_limit=1` en `DATABASE_URL`

Este es **el** arreglo. Vercel → Environment Variables → `DATABASE_URL`:

```
postgresql://…@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&pool_timeout=20
```

Tres cosas que tienen que estar las tres:

- **puerto 6543** — el pooler, no el 5432 directo.
- **`pgbouncer=true`** — sin esto Prisma usa sentencias preparadas que
  pgBouncer no soporta en modo transacción.
- **`connection_limit=1`** — una conexión por instancia. Suena poco y no lo es:
  una función serverless atiende una petición a la vez.

Redespliega después de cambiarla. Las instancias calientes conservan el valor
viejo.

**No toques `DIRECT_URL`.** Esa es la conexión directa (5432) y la usan las
migraciones, que sí necesitan DDL sin pooler.

### b) Si ya estaba puesto y sigue pasando

Entonces no es el pool: es una **consulta lenta** que retiene la conexión.
Busca en los logs de Supabase (Database → Query Performance) las consultas con
mayor tiempo total. Candidatos habituales en este proyecto: reportes por rango
de fechas sobre `visits`, y listados sin paginar.

Comprueba que están los índices de la Fase 2:

```sql
select indexname from pg_indexes
 where tablename = 'visits'
   and indexname like '%membership%' or indexname like '%cliente%';
```

Si faltan, la migración `20260768_visitas_indices` no se aplicó →
[`migracion-fallida.md`](migracion-fallida.md).

### c) Alivio inmediato mientras arreglas

Supabase → Settings → Database → **Restart project** tira todas las conexiones
abiertas y da aire. Es un parche de minutos, no una solución: si la causa sigue
ahí, vuelve. Úsalo solo para ganar tiempo, nunca como el arreglo.

---

## 4 · No hagas esto

- **No subas `connection_limit`.** El instinto es "necesito más conexiones";
  el efecto es agotar el pooler más rápido.
- **No pases a `DIRECT_URL` en producción.** Sin pooler el techo es mucho más
  bajo.
- **No reinicies en bucle.** Cada reinicio corta transacciones a medias.

---

## 5 · Después

- Confirma con `db_latency_warm_ms` a lo largo de un día completo, no solo al
  terminar.
- Este incidente es una de las cosas que el flujo de la Fase 6 (métricas y
  alertas) debería avisar antes de que se note. Hoy no existe: te enteras por
  los errores.
- Si el arreglo fue `connection_limit`, anota la fecha: es el tipo de variable
  que alguien "limpia" en una migración de proyecto y reintroduce el incidente
  seis meses después.
