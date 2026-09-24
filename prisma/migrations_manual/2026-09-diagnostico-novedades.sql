-- ─────────────────────────────────────────────────────────────────────────────
-- ¿POR QUÉ NO SALE X EN NOVEDADES?  ·  NO CAMBIA NADA
--
-- El feed de Novedades tiene tres condiciones, y basta que falle una para que
-- la pantalla salga vacía:
--
--   1. El CLIENTE tiene que SEGUIR a la empresa. Es una decisión del producto:
--      «Novedades» es lo de los negocios que sigo. Para descubrir otros está
--      Explorar.
--   2. La empresa no puede ser de práctica (`esDemo`).
--   3. Lo que se enseña tiene que estar VIGENTE:
--        · promociones → activa, no archivada, pública y sin vencer
--        · membresías  → plan activo
--        · noticias    → publicadas en los últimos 14 días
--        · eventos     → con fecha futura
--
-- Estas consultas dicen, para cada empresa, qué tiene y cuánta gente la sigue.
-- Van enteras, de una vez, en el SQL Editor de Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1 · Qué tiene cada empresa, y cuántos la siguen ─────────────────────────
-- `seguidores` en 0 explica por sí solo una pantalla vacía, por muchas
-- promociones activas que haya.
select c.name                                   as empresa,
       c."esDemo"                               as es_de_practica,
       (select count(*) from company_follows f
         where f."companyId" = c.id)            as seguidores,
       (select count(*) from plans p
         where p."companyId" = c.id
           and p.activo)                        as membresias_activas,
       (select count(*) from promociones pr
         where pr."companyId" = c.id
           and pr.activo
           and not pr.archivada
           and pr.visibilidad = 'publica'
           and (pr."vigenciaHasta" is null or pr."vigenciaHasta" >= now()))
                                                as promos_vigentes
  from companies c
 where c."isActive"
 order by c.name;

-- ── 2 · Las promociones que NO pasan el filtro, y por qué ───────────────────
-- Para cada una, la primera columna que diga «NO» es el motivo.
select c.name                          as empresa,
       pr.titulo,
       case when pr.activo then 'si' else 'NO - inactiva' end            as activa,
       case when not pr.archivada then 'si' else 'NO - archivada' end    as sin_archivar,
       case when pr.visibilidad = 'publica' then 'si'
            else 'NO - ' || pr.visibilidad end                           as publica,
       case when pr."vigenciaHasta" is null then 'si (sin fecha)'
            when pr."vigenciaHasta" >= now() then 'si'
            else 'NO - vencio el ' || to_char(pr."vigenciaHasta", 'DD/MM/YYYY') end as vigente
  from promociones pr
  join companies c on c.id = pr."companyId"
 where c."isActive"
 order by c.name, pr.titulo;

-- ── 3 · A quién sigue cada cliente ──────────────────────────────────────────
-- Si la cuenta con la que estás probando no aparece siguiendo a las dos
-- empresas, ese es el motivo y no hay nada roto: se sigue desde la ficha de la
-- empresa, con el botón Seguir.
select u.email                as cliente,
       coalesce(string_agg(c.name, ', ' order by c.name), '(no sigue a nadie)') as sigue_a
  from users u
  left join company_follows f on f."userId" = u.id
  left join companies c       on c.id = f."companyId"
 where u.role = 'CLIENTE'
 group by u.email
 order by u.email;
