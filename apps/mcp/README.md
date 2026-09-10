# @devup/mcp

La puerta MCP de DevUP: expone el proyecto a un modelo por stdio, para que se
le pueda preguntar «¿en qué va el cobro de la Clínica Santa Ana?» en vez de
reconstruir el contexto a mano.

El porqué de cada decisión —y el plan completo— está en
[docs/HEARTH-Y-LA-PUERTA-MCP.md](../../docs/HEARTH-Y-LA-PUERTA-MCP.md). Aquí
solo está cómo se usa.

**DevUP no compra inferencia.** No hay ninguna clave de un modelo en el
servidor. Cada persona conecta su propio Claude, este proceso corre en su
máquina con sus credenciales, y el aislamiento entre organizaciones lo sigue
poniendo RLS en la base, igual que para el navegador.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `buscar` | Busca por texto en mensajes, archivos, tareas, clientes, servicios y oportunidades de una organización a la vez. |

De momento una, y de solo lectura. Las siguientes están listadas en la guía.

## Dos maneras de conectarlo, y cuál elegir

| | Remoto (una URL) | Local (este paquete, stdio) |
|---|---|---|
| Qué hay que instalar | Nada | Node y el repositorio clonado |
| Cómo se configura | Se pega la URL en el conector de Claude | Editando un JSON con la ruta de tu copia |
| Dónde corre | En la API de DevUP | En tu máquina |
| Para quién | Cualquiera del equipo | Quien ya desarrolla aquí |

**El remoto es el camino normal.** Se pega
`https://api.hytrex.co/mcp` en Claude → Connectors → Add custom connector, y
Claude hace el resto: descubre el servidor de autorización, se registra, y
manda a DevUP a pedir el consentimiento. No hay token que copiar ni archivo
que editar.

Lo sirve `apps/api` (`src/routes/mcp.ts`), con las herramientas de este mismo
paquete —la lista está en `src/registro.ts` y no se escribe dos veces— y hace
falta `MCP_REMOTE_ENABLED=true` en esa instancia. El flujo OAuth vive en
`apps/api/src/routes/oauth.ts`.

## Conectarlo en local, por stdio

Para desarrollar sobre las herramientas, o para apuntar a una API local. Hace
falta un token de conexión de agente: en DevUP, Ajustes → Conexiones de
agente → crear una. Son sesiones con etiqueta, listables y revocables desde
`/auth/sessions` como cualquier otra.

Con el token en la mano, en la configuración de Claude:

```json
{
  "mcpServers": {
    "devup": {
      "command": "npx",
      "args": ["-y", "tsx", "C:/Users/Juan/DevUP/apps/mcp/src/index.ts"],
      "env": { "DEVUP_TOKEN": "<el token>" }
    }
  }
}
```

`DEVUP_TOKEN` **siembra** el archivo de configuración la primera vez y después
se puede quitar. No lo pises en cada arranque pensando que es lo normal: el
token de refresco **rota** en cada renovación, así que el vivo es el que queda
guardado en `~/.devup/mcp.json`, no el de la variable. Si la variable trae un
token distinto del que sembró, se entiende que es una conexión nueva y se
adopta.

| Variable | Para qué |
|---|---|
| `DEVUP_TOKEN` | Siembra la conexión. Después manda el archivo. |
| `DEVUP_API_URL` | La API. Por defecto `https://api.hytrex.co`. Esta sí pisa siempre. |
| `DEVUP_CONFIG` | Otra ruta para el archivo. Para pruebas, y para no tocar el de verdad. |

## Desarrollo

```bash
npm run test:mcp                       # las pruebas de esta capa
npm run typecheck --workspace apps/mcp
```

Contra la API local, hablándole por stdio como lo haría Claude:

```bash
DEVUP_API_URL=http://localhost:4000 DEVUP_TOKEN=<token> npx tsx apps/mcp/src/index.ts
```

**Nada se imprime por stdout salvo el protocolo.** Un `console.log` de
depuración rompe la conexión sin decir por qué; lo que haya que contar va por
`console.error`.
