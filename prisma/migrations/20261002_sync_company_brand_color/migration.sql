UPDATE "companies"
SET "colorPrimario" = CASE
  WHEN length("engagementConfig"->>'color') = 4 THEN
    '#' || repeat(substr(lower("engagementConfig"->>'color'), 2, 1), 2)
        || repeat(substr(lower("engagementConfig"->>'color'), 3, 1), 2)
        || repeat(substr(lower("engagementConfig"->>'color'), 4, 1), 2)
  ELSE lower("engagementConfig"->>'color')
END
WHERE "colorPrimario" IS NULL
  AND "engagementConfig" IS NOT NULL
  AND ("engagementConfig"->>'color') ~ '^#[[:xdigit:]]{3}$|^#[[:xdigit:]]{6}$';
