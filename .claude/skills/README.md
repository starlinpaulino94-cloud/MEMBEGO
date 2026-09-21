# Skills del proyecto

Skills de agente (Claude Code y compatibles) instaladas en este repositorio para
que el trabajo salga con **menos errores y más eficiencia**. Se activan solas
según lo que estés haciendo, o se pueden invocar con `/<nombre>`.

## Qué hay y para qué

Se instaló una **selección curada** —no todo el catálogo— enfocada en cazar los
bugs ocultos y no introducir nuevos:

| Skill | Cuándo ayuda |
|---|---|
| `doubt-driven-development` | Antes de dar por buena una decisión no trivial: monta un revisor adversario con contexto fresco que intenta REFUTAR el supuesto. Es la que más caza «bugs que se leían como aciertos». |
| `debugging-and-error-recovery` | Cuando algo se rompe: para la línea, preserva la evidencia y busca la CAUSA RAÍZ en vez de parchear el síntoma. |
| `code-review-and-quality` | Antes de fusionar: revisión en cinco ejes (corrección, legibilidad, arquitectura, seguridad, rendimiento). |
| `security-and-hardening` | Al tocar entrada de usuario, autenticación, secretos, SSO, RLS o webhooks — justo la superficie sensible de este proyecto. |
| `test-driven-development` | Al implementar lógica o arreglar un bug: la prueba primero, como prueba de que el arreglo de verdad arregla. |
| `incremental-implementation` | Cambios en rebanadas finas y verificables, una a una, en vez de un diff grande que nadie puede revisar. |
| `code-simplification` | Cuando el código funciona pero cuesta leerlo: claridad sin cambiar el comportamiento. |

## Origen y licencia

Vienen de [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
(MIT, © 2025 Addy Osmani). El catálogo completo trae 25; aquí solo están las 7
elegidas para este proyecto. Para añadir más o actualizarlas:

```bash
npx skills add addyosmani/agent-skills --list          # ver todas
npx skills add addyosmani/agent-skills --skill <nombre> # instalar una
```

O copiar a mano el directorio de la skill desde el repositorio de origen a
`.claude/skills/`.
