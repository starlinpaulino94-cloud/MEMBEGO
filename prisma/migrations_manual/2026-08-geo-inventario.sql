-- Inventario: qué objetos de la fase de geolocalización existen ya en esta base.
-- Solo lee; no cambia nada. Sirve para saber qué migración falta aplicar.
SELECT t.esperada AS objeto,
       CASE WHEN to_regclass('public.' || quote_ident(t.esperada)) IS NULL
            THEN 'FALTA' ELSE 'existe' END AS estado
FROM (VALUES
  ('geo_countries'), ('geo_regions'), ('geo_cities'), ('geo_sectors'),
  ('customer_locations'), ('geo_consents'), ('location_search_events'),
  ('saved_segments'), ('campanas_dirigidas')
) AS t(esperada)
ORDER BY 2, 1;
