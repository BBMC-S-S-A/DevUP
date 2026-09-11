# Plan de desarrollo · el marco y el vocabulario

Abierto el 11 de septiembre de 2026. Es la lista de trabajo viva que sale de
[PROPUESTA-UNA-SOLA-VENTANA.md](PROPUESTA-UNA-SOLA-VENTANA.md) y
[PROPUESTA-UNA-SOLA-PLATAFORMA.md](PROPUESTA-UNA-SOLA-PLATAFORMA.md).

Se actualiza al terminar cada punto. Lo que no está aquí, no se está haciendo.

---

## Estado

| | Trabajo | Estado |
|---|---|---|
| 1 | **Riel de organizaciones**, en el armazón que no se repinta | **Hecho** |
| 2 | **El ancho, por la forma del contenido** | **Hecho** |
| 3 | **`/app` deja de ser aterrizaje** y te devuelve donde estabas | **Hecho** |
| 4 | **Buscar en todas las organizaciones**, desde ⌘K | **Hecho** |
| 5 | **Estado terminal en las columnas** — que «hecha» exista | **Hecho** |
| 6 | **Las capturas de error mudas** del camino que se usa a diario | **Hecho, en parte** |
| 7 | **Las primeras pruebas de `apps/web`**, y fuera una duplicación | **Hecho** |
| 8 | Una superficie por nivel, y el acento reservado | Después |

**Pendiente de verificación visual:** 1, 2 y 3 pasan typecheck y build, pero sin
Docker en este entorno no se ha podido levantar la pila y verlos pintados. Es la
comprobación que falta, y en cambios de marco es la que importa.

---

## 4 · Buscar en todas las organizaciones

**El problema.** `global_search(_organization_id, …)` está atada a una
organización, y la pantalla dice «Todo lo de la organización». Quien tiene tres
tiene que saber de antemano en cuál está lo que busca, que es exactamente lo que
no se sabe cuando se busca.

**Por qué es barato.** La propia migración 0014 lo deja escrito: ese
`where organization_id` **solo acota, no protege** — la función no es
`security definer` y el aislamiento lo ponen las políticas de cada tabla. Así
que buscar en todas es *dejar de acotar*, no abrir nada.

**Qué hay que tocar:**

1. Migración: `_organization_id` admite nulo —«todas las mías»— y el resultado
   dice de qué organización viene cada fila.
2. `GET /search`, sin organización en la ruta.
3. La paleta de comandos (⌘K), que es donde buscar debe vivir: un gesto y no un
   sitio al que llegar.
4. La pantalla `/buscar`, que deja de mentir en su título.
5. La herramienta `buscar` del MCP, que **fallaba** cuando había varias
   organizaciones y no se decía cuál: le pedía elegir a quien todavía no puede
   saberlo.

**Hecho.** Con su caso en `isolation.test.ts`: pasarle nulo quita el `where
organization_id`, así que si el aislamiento dependiera de ese `where` —y no de
las políticas— sería una fuga entre clientes. Esa prueba es la que lo demuestra,
y queda pendiente de correrse contra una base de verdad.

---

## 5 · Que «hecha» exista

Una tarea tiene columna, y una columna tiene nombre. No hay estado terminal, así
que `mis_tareas` del MCP devuelve también las terminadas, el panel no puede
contar, el grafo no podrá cerrar nada y no se puede notificar que algo se
completó. **Un campo que falta rompe cuatro funciones que parecen sanas.**

Es una columna en una tabla y es el mejor retorno del proyecto.

**Hecho** (migración 0037). La marca vive en la COLUMNA y no en la tarea: una
marca en la tarea permitiría que estuviera «hecha» dentro de «En curso», un
estado que nadie sabe dibujar. El valor por defecto es `false` porque marcar de
más hace desaparecer tareas de «lo que me queda» sin que nadie lo pida, y eso no
se nota; no marcar sí. A los tableros que ya existen se les adivina por el
nombre, y solo con los que no admiten otra lectura — «listo» queda fuera a
propósito, porque en medio tablero significa terminado y en el otro medio «listo
para empezar».

Consumidores arreglados: `mis_tareas` del MCP deja fuera lo terminado salvo que
se pida, el tablero lo enseña y deja cambiarlo en el sitio, y una tarea
terminada se ve terminada. Con su caso en `isolation.test.ts`: es una escritura
nueva, y una escritura que nadie comprueba se descubre el día que alguien de
otra organización cierra las tareas de la tuya.

---

## 6 · Las capturas mudas

Eran 42 fuera de la zona restringida. La regla que se aplicó, y que ahora vive
escrita en `lib/fallo.ts`: **si quien lo usa no se entera, tiene que enterarse
quien lo mantiene.**

- **`ignorar(motivo)`** para lo que de verdad no cambia lo que puedes hacer —un
  logo que no carga, marcar un canal como leído al entrar—. Se anota y se sigue.
  El motivo es obligatorio a propósito: escribirlo obliga a contestar «¿y si
  esto falla, qué?», que es la pregunta que no se hizo las 42 veces.
- **Aviso de verdad** donde la persona acaba de pedir algo y no ha pasado:
  guardar la disposición de la mesa, marcar todo como leído. Ahí callarse es
  mentir.
- **En el servidor, al registro**: la asignación de una tarea y la invitación
  por campana. «Nunca me entero de lo que me asignan» es una queja que hay que
  poder rastrear.
- **Y uno se queda mudo a propósito**: el `rollback` de `pool.ts`. Si falla es
  porque la conexión ya está rota, y anotarlo taparía la causa con su
  consecuencia.

**Lo que queda:** Spotify (7), la voz (6) y `signaling.ts` (5). Son de medios,
donde muchos fallos sí son ignorables de verdad —permiso denegado,
reproducción automática bloqueada— y merecen una pasada propia con criterio, no
un cambio mecánico. Y las 6 de `world/**`, que es zona restringida.

---

## 7 · Las primeras pruebas de la web

`apps/web` no tenía ni una, y eso no es solo una carencia: es lo que bloquea
partir `ventas`, que lleva un mes marcada para dividirse y en ese mes creció.
Mover código sin red se hace a ciegas.

Se empezó por la navegación porque era la lógica **duplicada** —`destino()`
estaba escrita dos veces y ya distinta entre las dos copias— y porque falla de
la peor manera: aterrizar en el sitio equivocado no se parece a un error, así
que nadie lo reporta como tal.

Ahora vive una vez en `lib/enlaces.ts`, con 13 comprobaciones, y corre en CI.
Sin marco de pruebas, igual que el resto del repositorio: `tsx` y un contador.

---

## Lo que NO entra en este plan

- Tocar colores o tipografía: ya está resuelto y demostrado en `landing.css`.
- Hacer el panel configurable: ya fue una rejilla configurable y se quitó.
- Alojar repositorios, el grafo y DevVerse: tienen su propio diseño y van
  después del vocabulario.
