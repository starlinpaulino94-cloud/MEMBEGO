# Runbook · Una credencial quedó expuesta

**Síntoma:** una clave apareció donde no debía. Un `.env` subido a Git, una
captura de pantalla compartida, una variable pegada en un chat, un portátil
robado, un colaborador que deja de serlo.

---

## 0 · La regla que rige todo lo demás

**Asume que la credencial ya está siendo usada.** No investigues primero y rotes
después: rota primero. El tiempo entre la exposición y la rotación es el único
número que importa aquí, y todo lo que hagas antes de rotar lo aumenta.

Y una segunda, contraintuitiva: **borrar el commit o el mensaje no es una
medida de seguridad**. Un secreto que estuvo público diez minutos está
comprometido para siempre — Git guarda el objeto aunque se reescriba la
historia, GitHub lo conserva en la caché de la API, y los rastreadores
automáticos escanean commits públicos en cuestión de segundos. Borrarlo solo
sirve para que no se filtre *otra vez*.

---

## 1 · Qué se filtró y qué puede hacer quien la tenga

Ordenadas por daño, de peor a menos malo:

| Credencial | Qué permite | Urgencia |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | **Todo.** Salta cualquier control: leer, modificar y borrar los datos de todas las empresas | Inmediata |
| `DATABASE_URL` / `DIRECT_URL` | Acceso directo a la base con el usuario de la aplicación | Inmediata |
| `CARDNET_AUTH_KEY` | Operar contra la pasarela como el comercio | Inmediata |
| `BOOTSTRAP_SECRET` | Crear un SUPERADMIN o cambiar contraseñas, **si `BOOTSTRAP_ENABLED` está en `true`** | Inmediata si está encendido |
| `QSTASH_*` | Disparar trabajos en segundo plano: escrituras masivas | Alta |
| `UPSTASH_REDIS_REST_TOKEN` | Manipular los contadores de límite de peticiones | Media |
| `RESEND_API_KEY` | Enviar correo **desde tu dominio**. Suplantación | Media |
| `SENTRY_AUTH_TOKEN` | Subir artefactos al proyecto de Sentry | Baja |
| `NEXT_PUBLIC_*` | Nada: son públicas por diseño, van al navegador | Ninguna |

Esa última fila evita el error opuesto — rotar en pánico algo que nunca fue
secreto y romper la aplicación sin motivo. `NEXT_PUBLIC_SUPABASE_ANON_KEY` está
en el código de todos los navegadores que han abierto MembeGo.

---

## 2 · Rotar

### `SUPABASE_SERVICE_ROLE_KEY` o las claves de API

1. Supabase → Settings → API → **Generate new key** (o *Reset*).
2. Actualiza en Vercel: `SUPABASE_SERVICE_ROLE_KEY`.
3. Redespliega. Hasta el redespliegue, las instancias calientes usan la vieja.
4. Verifica: `curl -s https://<dominio>/api/health` → `ok`.

### `DATABASE_URL` / `DIRECT_URL`

1. Supabase → Settings → Database → **Reset database password**.
2. Actualiza en Vercel las dos variables — con sus parámetros:
   `DATABASE_URL` conserva `?pgbouncer=true&connection_limit=1&pool_timeout=20`
   y el puerto **6543**; `DIRECT_URL` va al **5432** sin parámetros.
   Perder `connection_limit` aquí reintroduce el incidente de
   [`pool-agotado.md`](pool-agotado.md) semanas después, cuando nadie lo
   relacione con esto.
3. Actualiza también el secreto `MIGRATIONS_DATABASE_URL` en GitHub →
   Settings → Secrets → Actions, o fallarán el despliegue de migraciones **y**
   el simulacro de restauración semanal.
4. Redespliega.

### `CARDNET_AUTH_KEY`

Solo la puede rotar CardNET: llama a tu ejecutivo de comercio. Mientras tanto,
**desactiva la capacidad `PAGO_CARDNET`** desde el superadmin — es preferible
cobrar por transferencia unos días que dejar viva una credencial de pasarela
comprometida.

### `BOOTSTRAP_SECRET`

1. Comprueba primero `BOOTSTRAP_ENABLED`. Si no está en `true`, los endpoints
   responden 404 y el secreto no sirve de nada. Respira.
2. Genera otro (`openssl rand -base64 32`) y ponlo en Vercel.
3. Asegúrate de que `BOOTSTRAP_ENABLED` queda **sin definir**. En operación
   normal esos endpoints están apagados.

### `QSTASH_*` / `UPSTASH_REDIS_REST_TOKEN`

Consola de Upstash → rotar las claves de firma y el token REST → copiar a
Vercel → redesplegar. Ver [`cola-atascada.md`](cola-atascada.md).

### `RESEND_API_KEY`

Panel de Resend → revocar la clave → crear otra → Vercel → redesplegar.

---

## 3 · Después de rotar: buscar el daño

Ahora sí, con calma.

```sql
-- Accesos y acciones administrativas recientes
select "createdAt", accion, "userId", detalle
  from audit_logs
 order by "createdAt" desc
 limit 200;

-- ¿Aparecieron superadministradores?
select id, email, role, "createdAt" from users
 where role = 'SUPERADMIN' order by "createdAt" desc;

-- ¿Se crearon empresas que nadie recuerda?
select id, name, "createdAt" from companies order by "createdAt" desc limit 20;
```

Supabase → Logs (API y Auth) para el periodo desde la exposición: busca picos
de peticiones o accesos desde países donde no operas.

Si aparece cualquier indicio de uso real, esto deja de ser una rotación
preventiva y pasa a ser una brecha: en República Dominicana la Ley 172-13 de
protección de datos personales obliga a notificar a los afectados. Consulta con
un abogado antes de decidir qué comunicar y a quién.

---

## 4 · Cerrar la vía por la que se filtró

- **Estaba en Git:** el secreto ya está rotado, que es lo que importa. Aparte,
  limpia la historia (`git filter-repo`) y comprueba que `.env` está en
  `.gitignore`. Activa GitHub → Settings → Code security → **Secret scanning**
  y **Push protection**: rechaza el push antes de que el secreto exista.
- **Estaba en una captura o un chat:** borra el mensaje y cuenta a quién llegó.
- **Portátil o teléfono perdido:** rota todo lo de la tabla del § 1 y cierra las
  sesiones abiertas (Supabase → Authentication → Users).
- **Persona que ya no colabora:** rota todo, quítale acceso a Vercel, GitHub,
  Supabase y Upstash, y revisa qué roles tenía en la propia aplicación.

---

## 5 · No hagas esto

- **No "vigiles a ver si pasa algo"** en vez de rotar. Rotar cuesta diez
  minutos; una fuga de datos de clientes no tiene precio de vuelta.
- **No reutilices el secreto anterior** ni una variación (`…-v2`).
- **No rotes todo a la vez sin verificar entre pasos.** Si algo se rompe,
  querrás saber cuál de las siete claves fue.
- **No dejes `BOOTSTRAP_ENABLED=true`** "por si acaso hace falta otra vez".

---

## 6 · Después

- Anota la fecha, qué se filtró y cuánto tardaste en rotar. Ese número es el
  RTO real de este escenario y hoy nunca se ha medido
  (`docs/RECUPERACION.md` § 3).
- Los valores tienen que vivir en un gestor de contraseñas, no en el panel de
  Vercel como única copia (`docs/RECUPERACION.md` § 2.3). Si esta rotación te
  costó reconstruir alguna variable de memoria, eso es exactamente el problema
  que hay que arreglar hoy.
