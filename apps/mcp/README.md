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

Todas se registran en un solo sitio —`src/registro.ts`— y se sirven por los dos
transportes. Si añades una, `npm run test:mcp` se pone rojo hasta que la
apuntes también en la lista que comprueba el registro.

### Leer

| Herramienta | Qué hace |
|---|---|
| `buscar` | Busca por texto en mensajes, archivos, tareas, clientes, servicios y oportunidades a la vez. |
| `mis_tareas` | Las tareas asignadas a quien conectó el agente. |
| `ver_tablero` | El tablero de un espacio, con sus columnas y tarjetas. |
| `ver_tarea` | Una tarea con su detalle, y sus imágenes adjuntas incrustadas. |
| `ver_arquitectura` | Los componentes del diagrama de un espacio y cómo se conectan. |
| `que_ha_pasado` | La historia de un espacio o de la organización: quién creó, movió, cerró o asignó qué, y cuándo. Agrupada por día y en el orden en que ocurrió. Distingue lo que hizo una persona de lo que hizo su asistente. |
| `ver_entornos` | Dónde corre lo que escribe el equipo y cómo quedó el último despliegue. Dice cuáles no pueden leer nada por faltarles repositorio o token. |
| `sincronizar_entornos` | Vuelve a preguntarle a GitHub por los despliegues, sin esperar a la pasada automática. Va aquí aunque escriba: lo que guarda es un reflejo de lo que dijo el proveedor. |

### Escribir

Todo lo que crean en el tablero lleva la etiqueta `agente`, que es lo que
permite verlo, filtrarlo y deshacerlo en bloque. **No hay ninguna de borrar, y
es deliberado**: equivocarse creando deja trabajo que revisar, equivocarse
borrando deja trabajo perdido.

| Herramienta | Qué hace |
|---|---|
| `crear_tarea` | Una tarea en el tablero, con responsable y fecha si se dicen. |
| `crear_area` | Un área del tablero, con su delegado. Lo que se cree en ella se le asigna solo. |
| `crear_columna` | Una columna nueva en el tablero. |
| `mover_tarea` | Pasa una tarea de columna. |
| `enlazar_rama` | Apunta en una tarea la rama donde se trabaja, o cambia su estado. Varias, si el trabajo va por varios caminos. |
| `marcar_hecha` | Cierra una tarea y, si se le pasa, deja en ella la prueba de que se hizo —el PR, el commit, el enlace o una nota—. Las dos cosas caen juntas. |
| `actualizar_tarea` | Cambia título, descripción, responsable o fecha. |
| `dibujar_arquitectura` | Vuelca un diagrama entero —componentes y conexiones— en un espacio. Coloca las cajas ella: no hay que darle coordenadas. Reutiliza lo que ya exista con ese nombre en vez de duplicarlo. |
| `crear_entorno` | Crea un entorno y lo engancha a un repositorio de GitHub, leyendo sus despliegues en la misma llamada. Si al espacio le falta el token, lo crea igual y **lo dice**: sin token no sincroniza nunca, y callarlo deja esperando despliegues que no llegan. |

## Dos maneras de conectarlo, y cuál elegir

| | Remoto (una URL) | Local (este paquete, stdio) |
|---|---|---|
| Qué hay que instalar | Nada | Node y el repositorio clonado |
| Cómo se configura | Se pega la URL en el conector de Claude | Editando un JSON con la ruta de tu copia |
| Dónde corre | En la API de DevUP | En tu máquina |
| Para quién | Cualquiera del equipo | Quien ya desarrolla aquí |

**El remoto es el camino normal.** Se pega

    https://api-production-7b95.up.railway.app/mcp

en Claude → Conectores → Añadir conector personalizado, y Claude hace el resto:
descubre el servidor de autorización, se registra, y manda a DevUP a pedir el
consentimiento. No hay token que copiar ni archivo que editar.

**La URL es la fea a propósito.** `api.hytrex.co` todavía no sirve: sus
certificados se quedaron atascados en Railway con el DNS ya correcto, y todo
apunta mientras tanto a `*.up.railway.app` — está contado en
`docs/LO-QUE-HAY-Y-LO-QUE-FALTA.md`. El día que el dominio bonito emita, se
cambia aquí y en el `.mcp.json` de la raíz.

**Y es el que usa el repositorio.** El `.mcp.json` de la raíz apunta a esta
misma URL, así que quien abra el proyecto en Claude Code tiene las herramientas
sin instalar ni configurar nada: las autoriza una vez con su propia cuenta y
listo. Antes arrancaba el paquete local, que exige un archivo de token que casi
nadie tiene creado — y el síntoma era «no hay token con el que entrar a DevUP»
sin que nada dijera qué token ni de dónde.

> **Ojo, y es deliberado:** esa URL es **producción**. Una sesión de desarrollo
> que use estas herramientas escribe en el tablero de verdad. Es lo que se
> quiere para trabajar, pero si lo que hace falta es probar la puerta contra
> una API local, entonces sí es el camino de abajo — y entonces el token local
> tiene sentido.

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
