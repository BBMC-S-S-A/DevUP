# DevUP · Índice

_Puesta al día del 13 de septiembre de 2026._

Esta carpeta es el vault: **abrir `docs/` en Obsidian y ya está.** Este fichero
es la nota de entrada — de aquí cuelgan los demás con enlaces de Obsidian, que
es lo que hace que su grafo enseñe algo en vez de treinta y una notas sueltas.
(El ejemplo no va escrito aquí a propósito: un enlace de muestra crea un nodo
fantasma en el grafo, que es justo el ruido que este índice viene a quitar.)

> **Por qué existe este índice y no basta con la lista de ficheros.** Hay siete
> documentos que se llaman «plan» y varios se contradicen, porque se escribieron
> en días distintos y ninguno dijo que jubilaba al anterior. Un vault donde no
> se sabe cuál manda es peor que no tener vault: se lee el equivocado con toda
> confianza. Aquí lo único que importa es la columna de la izquierda — **qué
> manda hoy** y qué quedó atrás.

---

## Lo que manda hoy

Si solo se van a leer tres, son estos tres.

- **[[CAMINOS]]** — el contrato entre las dos sesiones de trabajo: quién toca
  qué capa, cómo se piden cosas entre ellas, y en su **§10** lo que queda por
  hacer a 13 de septiembre. **Es el documento vivo.** Sustituye a
  [[PLAN-DOS-SESIONES]] y a [[PLAN-DE-DESARROLLO-2026-09-12]].
- **[[../GRAFO|GRAFO]]** — qué se toca con qué: pantallas, áreas de API, tablas
  y los cruces entre ellas. **Generado con `npm run grafo`, no se edita a
  mano.** Es la foto mecánica del código; los demás son la interpretación.
- **[[PLAN-DE-PRODUCCION]]** — cómo se despliega, y cómo se aplican las
  migraciones contra Railway. Hace falta ahora mismo: hay nueve sin aplicar y el
  guardián de despliegue está parado por eso.

## Qué es DevUP y por qué

- [[PROPUESTA-UNA-SOLA-VENTANA]] — la tesis del producto.
- [[PROPUESTA-UNA-SOLA-PLATAFORMA]] — la misma idea, para fuera.
- [[ALOJAR-EL-REPOSITORIO-Y-EL-MODELO-DE-NEGOCIO]] — de dónde sale el dinero.
- [[plan-agentes-y-participacion]] — de dónde viene la palabra «neuronas»: el
  conocimiento del proyecto puesto donde un agente pueda leerlo.

## Cómo se ve y cómo se mueve

- [[INTERFAZ-EL-FLUJO]] — el rediseño entero, con el porqué de cada decisión.
- [[DISENO-GRAFO-DEL-PROYECTO]] — qué es un nodo y qué es una arista, que es la
  única pregunta que importa en un grafo.
- [[PLAN-LA-MEMORIA-SE-VE]] — las tres preguntas del registro de actividad y
  dónde va cada una en la interfaz.
- [[decisiones/0002-vistas-profesional-e-inmersiva|0002 · Las dos vistas]]

## Estado y auditorías

Ojo con las fechas: estas envejecen más rápido que las demás.

- [[PLAN-Y-OPORTUNIDADES]] — el inventario de lo que falta, sacado del
  repositorio y no de la memoria, más un brainstorm. 12 de septiembre.
- [[ESTUDIO-ARQUITECTURA-2026-09-11]] — 11 de septiembre.
- [[AUDITORIA-DE-LA-APLICACION]] · [[PROPUESTA-AUDITORIA-Y-ARQUITECTURA]]
- [[LO-QUE-HAY-Y-LO-QUE-FALTA]] — 9 de septiembre, pantalla por pantalla,
  probadas a mano. **La más vieja de todas: léela como historia, no como
  estado.**
- [[estudio-viabilidad-y-flujo-2026-09-05]] — 5 de septiembre.

## Infraestructura y decisiones cerradas

- [[TURN]] — por qué hace falta un TURN para que las llamadas funcionen fuera
  de una red amable.
- [[HEARTH-Y-LA-PUERTA-MCP]] — cómo entra un agente al producto.
- [[decisiones/0001-cifrado-de-salas|0001 · Cifrado de salas]]
- [[decisiones/0004-conector-github-embebido-y-agente-ia|0004 · Conector de GitHub embebido]]
- [[DISENO-ALOJAR-REPOSITORIOS]]

## Ya cumplieron, y se quedan por lo que explican

No están mal: están **superados**. Se guardan porque el porqué de una decisión
no se lee en el código que salió de ella, y borrarlos dejaría el resto del vault
sin la mitad de sus referencias.

| Documento | Lo sustituye |
|---|---|
| [[PLAN-DOS-SESIONES]] | [[CAMINOS]] |
| [[PLAN-DE-DESARROLLO-2026-09-12]] | [[CAMINOS]] §10 |
| [[PLAN-DE-DESARROLLO]] | [[CAMINOS]] |
| [[REPARTO-DE-TAREAS]] | el tablero de DevUP, que ya está poblado |
| [[TABLERO-REPARTO]] | el tablero de DevUP |
| [[LA-SEMANA-ANTES-DEL-CLIENTE]] | — (fue para una fecha concreta) |

---

## Cómo llevar esto a las bóvedas de Obsidian

Hay dos bóvedas —la local y la del repositorio `boveda-obsidian`— y la
documentación vive en una tercera parte: este repositorio. **Tres copias a mano
se desincronizan la primera semana**, y entonces cada una dice algo distinto sin
que ninguna avise, que es exactamente el problema que este índice viene a
arreglar.

Así que hay UNA fuente —`docs/`, aquí— y las bóvedas reciben una copia marcada:

```
npm run vault -- /ruta/a/la/boveda-local/DevUP
npm run vault -- /ruta/al/clon/de/boveda-obsidian/DevUP
```

Se puede correr las veces que haga falta: la carpeta de destino se regenera
entera. Cada nota sale con una cabecera que dice de dónde viene y que **no se
edita ahí** — sin eso, alguien corrige una nota en la bóveda, la siguiente
exportación se la lleva, y el trabajo desaparece sin que nada lo diga.

Se copia y no se enlaza a propósito: un enlace simbólico se rompe al clonar en
otra máquina y no sobrevive a Git, y un submódulo mete el repositorio de código
entero dentro de una bóveda de notas.

## Cómo se mantiene esto

Tres reglas, y la tercera es la que suele saltarse.

1. **[[../GRAFO|GRAFO]] se regenera, no se escribe**: `npm run grafo`. Si el
   número de tablas o de migraciones no cuadra con la realidad, es que nadie lo
   ha corrido — pasó entre el 12 y el 13 de septiembre, y el documento llegó a
   decir 37 migraciones cuando había 55.
2. **Un plan nuevo jubila al anterior aquí, en la tabla de arriba.** Si no, en
   una semana hay tres documentos vivos que dicen cosas distintas y el equipo se
   reparte entre los tres sin saberlo.
3. **Lo que se decide se escribe donde se va a buscar.** Una decisión que solo
   vive en una conversación se vuelve a discutir dentro de un mes, con menos
   contexto y peor humor.
