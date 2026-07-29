# Runbook · Migración fallida o esquema desfasado

**Síntoma — y es el peligroso, porque no parece un error:** después de un
despliegue, algunos módulos aparecen **vacíos**. No dan error, no muestran una
pantalla roja. Simplemente no hay nada donde antes había datos. O al revés:
"No pudimos cargar tu información" en una pantalla concreta y solo en esa.

Esto ya pasó en producción con `companies.capacidades`: los módulos quedaron
apagados en silencio durante días.

---

## Por qué falla en silencio

El código de MembeGo es deliberadamente tolerante (*fail-open*) para que una
migración pendiente no tumbe la aplicación entera. El efecto secundario es que
una columna que falta **no avisa**: la consulta falla, el módulo devuelve vacío
y la pantalla se pinta como si el negocio no tuviera datos.

Es un compromiso consciente. El precio es este runbook.

---

## 1 · Confirmar

```bash
curl -s -H "x-health-secret: $BOOTSTRAP_SECRET" https://<dominio>/api/health | jq '.checks.schema, .diagnostics.schema_drift'
```

`"DRIFT"` con una lista de objetos → es esto, sin ninguna duda.

El detalle completo, con qué migración crea cada cosa que falta:

```bash
DATABASE_URL="<DIRECT_URL>" npm run db:doctor
```

Si no tienes acceso local a la base:

```bash
npm run db:doctor:sql
```

Imprime un SQL de **solo lectura** para pegar en el SQL Editor de Supabase.
Devuelve una tabla con lo que falta.

El panel del superadmin también muestra un aviso de migraciones pendientes
(`src/modules/superadmin/migraciones.ts`), cacheado 10 minutos.

---

## 2 · Los tres casos

### a) El código va por delante de la base (el habitual)

Se desplegó sin correr la migración.

```bash
DATABASE_URL="<DIRECT_URL>" npx prisma migrate deploy
npm run db:doctor          # debe salir limpio
```

**Usa `DIRECT_URL`, puerto 5432.** El pooler (6543) no sirve para migrar: las
sentencias DDL necesitan conexión directa.

Después, invalida el aviso cacheado del panel o espera 10 minutos.

### b) La migración se ejecutó a medias

Un `ALTER TABLE` largo que se cortó, o un archivo con varias sentencias del que
solo pasaron las primeras.

1. **Cierra la aplicación** ([`modo-mantenimiento.md`](modo-mantenimiento.md)).
   Una base a medio migrar sirviendo tráfico escribe datos que después no
   encajan.
2. Mira en el SQL Editor qué llegó a aplicarse:

   ```sql
   select migration_name, finished_at, logs
     from _prisma_migrations
    order by started_at desc
    limit 10;
   ```

   Una fila con `finished_at` nulo es una migración que empezó y no terminó.
3. Aplica **a mano** las sentencias que faltan, una a una, mirando el resultado
   de cada una. Las migraciones de este proyecto están escritas para tolerar
   repetición (`if not exists`, `create index concurrently`), pero compruébalo
   en el archivo antes de repetir algo.
4. Marca la migración como terminada solo cuando lo esté de verdad.

**Caso especial — índices `CONCURRENTLY`:** `20260768_visitas_indices` usa
`CREATE INDEX CONCURRENTLY`, que **no puede ir dentro de una transacción**.
Ejecuta ese archivo **una sentencia a la vez**, nunca pegándolo entero. Un
índice que quedó en estado `INVALID` se detecta así:

```sql
select indexrelid::regclass from pg_index where not indisvalid;
```

y se arregla con `drop index` + volver a crearlo.

### c) La migración rompió datos

No falta una columna: los datos están mal. Eso ya no es este runbook →
[`restaurar-datos-borrados.md`](restaurar-datos-borrados.md), § 3 (PITR al
instante anterior a la migración).

---

## 3 · Si el despliegue falló en CI

`.github/workflows/deploy-migraciones.yml` aplica las migraciones **antes** de
disparar el despliegue, precisamente para que el código nunca vaya por delante.
Si ese trabajo falló, el despliegue no salió y producción sigue con el código
anterior: **estás en un estado seguro**. No fuerces el despliegue.

Lee el log del trabajo `migrar`, arregla la migración en una rama, y deja que
el flujo vuelva a correr.

---

## 4 · No hagas esto

- **No corras `prisma migrate reset`.** Borra la base entera. En producción es
  un desastre completo, no un arreglo.
- **No uses `prisma db push` en producción.** Sincroniza el esquema sin dejar
  registro en `_prisma_migrations`, y a partir de ahí el historial de
  migraciones miente para siempre.
- **No edites una migración ya aplicada.** Escribe una nueva.
- **No marques a mano una migración como aplicada** para "saltarla". El
  siguiente que mire creerá que ese SQL corrió.

---

## 5 · Después

- `npm run db:doctor` limpio, y `/api/health` sin `DRIFT`.
- Si la migración era manual (de `prisma/migrations_manual/`), anótalo en
  `docs/DEVOPS.md`: esas no las aplica el flujo automático, y olvidarlas es
  exactamente cómo se llega aquí.
- Si esta migración pendiente estuvo días sin detectarse, añade su
  tabla/columna a `OBJETOS_ESPERADOS` en
  `src/modules/superadmin/migraciones.ts` para que la próxima vez avise sola.
