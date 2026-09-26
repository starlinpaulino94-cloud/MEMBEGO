-- ─────────────────────────────────────────────────────────────────────────────
-- RENOVACIONES ENCADENADAS · el período que empezaba el mes que viene.
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL FALLO
--
-- `renovarMembresia` encadenaba: si la membresía todavía no había vencido, el
-- período nuevo arrancaba donde terminaba el anterior. Y con él movía también
-- `fechaInicio` a esa fecha FUTURA.
--
-- Resultado en el mostrador, reportado con captura: una membresía renovada el
-- 26 de septiembre quedaba con «Inicio 26 oct · Vencimiento 26 nov». Un período
-- que no había empezado, en una membresía que el cliente estaba usando ese
-- mismo día.
--
-- Lo que NO pasó, y conviene saberlo antes de tocar nada: nadie se quedó sin
-- poder usar su membresía. La vigencia se decide con `estado` y
-- `fechaVencimiento` (`membresiaVigente`), y `fechaInicio` no entra en esa
-- cuenta. El daño es la ficha del cliente, el CSV y el historial.
--
-- ════════════════════════════════════════════════════════════════════════════
-- ESTO SIGUE HACIENDO FALTA AUNQUE EL CÓDIGO YA ESTÉ ARREGLADO
--
-- El arreglo de código hace dos cosas: una membresía vigente y con usos ya no
-- se puede renovar, y la que sí se renueva arranca HOY. Ninguna de las dos
-- corrige las filas que ya quedaron con la fecha movida.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CÓMO SE RECONOCE UNA FILA AFECTADA
--
--     "fechaInicio" > "fechaPago"
--
-- En una fila sana eso no puede pasar: `activacion.ts` escribe las dos en el
-- mismo instante, y la renovación por tarjeta no toca `fechaInicio`. La única
-- forma de que el inicio quede DESPUÉS del cobro es el encadenado.
--
-- Y toda fila afectada tiene `fechaPago`: la renovación manual siempre la
-- escribe en el mismo update que movía el inicio. Por eso se puede reconstruir
-- el período bueno — `fechaPago` ES el día en que se renovó.
--
-- ════════════════════════════════════════════════════════════════════════════
-- LA CORRECCIÓN, Y SU ÚNICA CONCESIÓN
--
--   · `fechaInicio` := `fechaPago`            (el día que de verdad empezó)
--   · `fechaVencimiento` := `fechaPago` + la vigencia del plan
--
-- Lo segundo ACORTA la membresía: le quita el mes que el encadenado le había
-- regalado. En la mayoría de las filas eso es sano, pero en algunas el
-- vencimiento corregido YA ESTÁ EN EL PASADO — y aplicarlo dejaría fuera, de
-- golpe, a un cliente que hoy puede lavar.
--
-- A esas NO se les toca el vencimiento: se les corrige solo `fechaInicio` y se
-- listan aparte. Quitarle el acceso a alguien que pagó no es algo que deba
-- hacer un script por su cuenta.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CÓMO SE CORRE
--
-- El bloque 1 NO CAMBIA NADA: enseña qué hay y qué pasaría. Léelo. El bloque 2
-- aplica. El bloque 3 comprueba. Es idempotente: al terminar,
-- `"fechaInicio" = "fechaPago"` en las filas tocadas, así que volver a
-- ejecutarlo no encuentra nada.
-- ─────────────────────────────────────────────────────────────────────────────


-- ════════════════════════════════════════════════════════════════════════════
-- LA CUENTA DE FECHAS, UNA SOLA VEZ
--
-- Esto es `periodEnd()` de `src/lib/periodos.ts`, replicado: los mismos tramos
-- de meses que `RANGOS_MESES` y el mismo cierre del día en la zona del negocio.
--
-- Va en una función y no copiada en cada consulta a propósito. Estaba tres
-- veces, y con tres copias basta con actualizar dos para que el script corrija
-- un plan trimestral como si fuera mensual — sin que nada se queje. Vive en
-- `pg_temp`, así que desaparece sola al cerrar la sesión: no deja nada puesto
-- en la base.
--
-- Las columnas son TIMESTAMP sin zona y guardan UTC, de ahí el doble salto:
-- se interpreta como UTC, se pasa a la hora del negocio para cortar el día, y
-- se vuelve a UTC para guardar.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION pg_temp.fin_periodo(desde timestamp, dias int)
RETURNS timestamp
LANGUAGE sql IMMUTABLE AS $$
  SELECT (
    (
      date_trunc(
        'day',
        (desde AT TIME ZONE 'UTC' AT TIME ZONE 'America/Santo_Domingo')
        + CASE
            WHEN dias < 1                 THEN interval '1 month'
            WHEN dias BETWEEN 28  AND 31  THEN interval '1 month'
            WHEN dias BETWEEN 89  AND 92  THEN interval '3 months'
            WHEN dias BETWEEN 180 AND 184 THEN interval '6 months'
            WHEN dias BETWEEN 364 AND 366 THEN interval '12 months'
            ELSE make_interval(days => dias)
          END
      )
      + interval '1 day' - interval '1 millisecond'
    ) AT TIME ZONE 'America/Santo_Domingo' AT TIME ZONE 'UTC'
  );
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 · QUÉ HAY (solo lectura)
-- ════════════════════════════════════════════════════════════════════════════

WITH afectadas AS (
  SELECT
    m.id,
    m.estado,
    c.nombre                AS cliente,
    co.name                 AS empresa,
    p.nombre                AS plan,
    m."fechaPago",
    m."fechaInicio",
    m."fechaVencimiento",
    pg_temp.fin_periodo(m."fechaPago", p."vigenciaDias") AS vencimiento_bueno
  FROM memberships m
  JOIN plans    p  ON p.id  = m."planId"
  JOIN clientes c  ON c.id  = m."clienteId"
  JOIN companies co ON co.id = m."companyId"
  WHERE m."fechaPago" IS NOT NULL
    AND m."fechaInicio" IS NOT NULL
    AND m."fechaInicio" > m."fechaPago"
)
SELECT
  CASE
    WHEN vencimiento_bueno > now() THEN '1 · se corrige entera'
    ELSE                                '2 · SOLO el inicio (acortar la dejaría vencida hoy)'
  END                                   AS que_se_hace,
  count(*)                              AS filas,
  count(*) FILTER (WHERE estado = 'ACTIVA') AS de_ellas_activas,
  min("fechaPago")::date                AS renovacion_mas_vieja,
  max("fechaPago")::date                AS renovacion_mas_nueva
FROM afectadas
GROUP BY 1
ORDER BY 1;

-- El detalle, para mirarlas una a una antes de aplicar.
-- (Quita el `LIMIT` si quieres verlas todas.)
WITH afectadas AS (
  SELECT
    m.id, m.estado, c.nombre AS cliente, co.name AS empresa, p.nombre AS plan,
    m."fechaPago", m."fechaInicio", m."fechaVencimiento",
    pg_temp.fin_periodo(m."fechaPago", p."vigenciaDias") AS vencimiento_bueno
  FROM memberships m
  JOIN plans    p  ON p.id  = m."planId"
  JOIN clientes c  ON c.id  = m."clienteId"
  JOIN companies co ON co.id = m."companyId"
  WHERE m."fechaPago" IS NOT NULL
    AND m."fechaInicio" IS NOT NULL
    AND m."fechaInicio" > m."fechaPago"
)
SELECT
  empresa, cliente, plan, estado,
  "fechaPago"::date          AS se_renovo_el,
  "fechaInicio"::date        AS inicio_ahora,
  "fechaVencimiento"::date   AS vence_ahora,
  "fechaPago"::date          AS inicio_corregido,
  vencimiento_bueno::date    AS vence_corregido,
  vencimiento_bueno > now()  AS se_corrige_entera
FROM afectadas
ORDER BY empresa, "fechaPago" DESC
LIMIT 200;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 · APLICAR
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

WITH afectadas AS (
  SELECT
    m.id,
    m."fechaPago",
    pg_temp.fin_periodo(m."fechaPago", p."vigenciaDias") AS vencimiento_bueno
  FROM memberships m
  JOIN plans p ON p.id = m."planId"
  WHERE m."fechaPago" IS NOT NULL
    AND m."fechaInicio" IS NOT NULL
    AND m."fechaInicio" > m."fechaPago"
)
UPDATE memberships m
SET
  "fechaInicio" = a."fechaPago",
  -- El vencimiento solo se acorta cuando el corregido sigue en el futuro.
  -- Si no, se deja el que tiene: nadie se queda fuera por culpa del script.
  "fechaVencimiento" = CASE
    WHEN a.vencimiento_bueno > now() THEN a.vencimiento_bueno
    ELSE m."fechaVencimiento"
  END
FROM afectadas a
WHERE m.id = a.id;

COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 · COMPROBAR
-- ════════════════════════════════════════════════════════════════════════════

-- (a) Ya no queda ninguna con el inicio después del cobro. Tiene que dar 0.
SELECT count(*) AS quedan_con_inicio_movido
FROM memberships
WHERE "fechaPago" IS NOT NULL
  AND "fechaInicio" IS NOT NULL
  AND "fechaInicio" > "fechaPago";

-- (b) Ninguna ACTIVA se quedó con el vencimiento en el pasado por esto.
--     (Puede haber otras vencidas por su cuenta: el job las barre.)
SELECT count(*) AS activas_vencidas_hoy
FROM memberships
WHERE estado = 'ACTIVA'
  AND "fechaVencimiento" IS NOT NULL
  AND "fechaVencimiento" <= now();

-- (c) Las que se quedaron con el período largo a propósito, para tenerlas
--     vistas: su inicio ya es correcto, su vencimiento es el que se les dio.
SELECT co.name AS empresa, c.nombre AS cliente, p.nombre AS plan,
       m."fechaInicio"::date AS inicio, m."fechaVencimiento"::date AS vence,
       p."vigenciaDias"
FROM memberships m
JOIN plans p     ON p.id  = m."planId"
JOIN clientes c  ON c.id  = m."clienteId"
JOIN companies co ON co.id = m."companyId"
WHERE m."fechaInicio" IS NOT NULL
  AND m."fechaVencimiento" IS NOT NULL
  AND m."fechaVencimiento" > m."fechaInicio" + make_interval(days => p."vigenciaDias" + 2)
ORDER BY co.name, m."fechaInicio" DESC
LIMIT 100;
