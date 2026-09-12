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
| 6 | **Las capturas de error mudas** | **Hecho** — de 42 a 5, y las 5 explicadas |
| 7 | **Las primeras pruebas de `apps/web`**, y fuera una duplicación | **Hecho** |
| 8 | **El embudo pintaba el día anterior**, y nadie lo veía | **Hecho** |
| 9 | **Grabar una llamada dejó de ser invisible** | **Hecho** |
| 10 | **El dinero, en un solo sitio** — y una decisión que hay que tomar | **Hecho** |
| 11 | **El perfil, que no existía** — nombre y cargo | **Hecho** |
| 12 | **Barrido de rutas muertas** — siete, y tres eran agujeros | **Hecho** |
| 13 | Una superficie por nivel, y el acento reservado | Después |
| 14 | **La sala del agente en DevVerse** — que su trabajo se vea | **Hecho** |

**Cómo se verifica desde aquí.** No hay Docker ni Postgres en el entorno donde
se escribe esto, así que `test:rls` no se puede correr en local — pero **sí
corre en CI**, contra un Postgres 17 de verdad. Empujar es la forma de
verificarlo, y ya sirvió: cazó dos comprobaciones mal planteadas en el mismo día
que se escribieron.

**Lo que sigue sin verificarse es lo visual.** Los puntos 1, 2 y 3 pasan
typecheck y build, pero nadie los ha visto pintados. En cambios de marco esa es
la comprobación que importa, y no la puede hacer CI.

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

**Segunda pasada: Spotify, la voz y el reproductor.** Y ahí la regla se aplicó
en las dos direcciones, que es lo que la hace útil:

- **Con voz** donde el fallo se nota y no se entiende: quitar una pista de la
  cola —si la baja no llega, reaparece para el resto—, poner una pista, el
  token del reproductor de Spotify (sin él el SDK no arranca **y se queda
  callado para siempre**), y el audio o el vídeo de un participante, porque «no
  oigo a Ana» es de las quejas más difíciles de rastrear.
- **Mudas a propósito, pero explicadas**, que era la mitad que faltaba:
  `AudioContext.resume()` rechaza cuando el navegador aún no ha visto un gesto
  —es la política de reproducción automática, no un fallo—; cerrar un contexto
  ya cerrado lanza; retirar la reserva de una subida fallida la recoge el
  barrendero; y cerrar sesión tiene que funcionar aunque el servidor no
  conteste.
- **Y una que es una función de seguridad**, no un descuido: recuperar
  contraseña se calla a propósito. La pantalla dice «enviado» exista el correo o
  no, y anotar el fallo convertiría ese formulario en una forma de averiguar
  quién tiene cuenta.

**De 42 a 5**, y las cinco que quedan —todas en `signaling.ts`— son de la
señalización en tiempo real y merecen mirarse con el protocolo delante. Más las
6 de `world/**`, que es zona restringida.

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

## 8 · El embudo pintaba el día anterior

Encontrado buscando duplicación, no buscando fallos. `expected_close` y
`ends_on` son columnas `date`, así que llegan como «2026-09-11» sin hora.
`new Date("2026-09-11")` no es el once: es **medianoche UTC** del once, y al
oeste de Greenwich eso cae el día anterior.

**En Colombia, UTC−5, un cierre del 11 se pintaba «10 sept».** Sin fallar, sin
avisar, y solo visible comparando la pantalla con lo que se escribió.
`diasParaCerrar` lo tenía doble: además restaba esa medianoche UTC contra un
`Date` con hora, así que el resultado cambiaba según la hora a la que miraras.

`TaskBoard` ya lo tenía resuelto y lo dejó escrito en un comentario. Que la
solución viviera dentro de un componente es justo por lo que el segundo sitio
volvió a caer. Ahora vive en `lib/fechas.ts`, con 24 comprobaciones que **fijan
la zona horaria a una del oeste** — sin eso la prueba pasaría en Madrid y el
fallo seguiría en Bogotá, que es exactamente cómo dura meses.

---

## 9 · Grabar una llamada dejó de ser invisible

`recording` era el único tipo de aviso declarado y **nunca emitido**. Tirando
del hilo salió que el agujero era mayor: `GET /channels/:id/recordings` existe y
no lo llama nadie, y `files.call_session_id` se escribía desde la 0004 sin que
nadie lo leyera.

Resultado: grababas una llamada, el archivo se subía, y para todos los demás era
como si no hubiera pasado — ni aviso, ni pantalla que las liste, ni forma de
distinguirla de cualquier otro archivo de la biblioteca.

Ahora se avisa **solo a quien dio su consentimiento** —avisar a quien dijo que
no sería contarle que se guardó una grabación en la que decidió no salir— y en
la biblioteca lleva su marca. El enlace va a los archivos y no a una pantalla de
grabaciones, porque una grabación es un archivo más y esa pantalla no existe.

---

## 10 · El dinero, y una decisión pendiente

El embudo y el panel tenían cada uno su formateador, y no eran el mismo: uno
enseña los céntimos cuando no son redondos y el otro nunca. La misma venta se
leía distinta según la pantalla. Ahora la regla vive una vez, con diez
comprobaciones.

### Lo que hay que decidir, y no puedo decidir yo

**La moneda está escrita a mano.** Contado contra la base:

- `services.currency` existe (`char(3)`, por defecto `'EUR'`) y la API la
  devuelve con el catálogo.
- `opportunity_items` copia del servicio el nombre y el precio, **pero no la
  moneda**.
- `goals.target_cents` tampoco la tiene.
- `opportunity_amount_cents` suma las líneas sin mirar ninguna moneda.
- Y el endpoint del embudo devuelve `amountCents` **sin decir de qué moneda es**,
  así que la pantalla no puede saberlo ni queriendo.

El modelo soporta monedas a medias y la interfaz no soporta ninguna: todo se
guarda en céntimos de una moneda implícita que se decidió escribiendo `"EUR"` en
dos componentes.

**No se cambia adivinando.** Si la organización factura en otra moneda, lo que
hay que decidir es si DevUP es de **una sola** —y entonces es un ajuste de la
organización, no una constante— o de **varias**, y entonces `opportunity_items`
tiene que llevarla y sumar líneas de monedas distintas deja de ser una suma.

Mientras tanto, está en una línea (`MONEDA` en `lib/dinero.ts`) y no en dos
componentes.

---

## 11 · El perfil, que no existía

Lo señalaste al usarlo: no hay personalización del perfil. Comprobado, y era
literal — «Mi cuenta» tenía tres secciones (clave del asistente, conexiones de
agente, navegadores con sesión) y **ninguna era la persona**.

- **El nombre no se podía cambiar nunca.** `PATCH /me/profile` aceptaba
  presencia y cargo, y nada más. Se fijaba al registrarse o lo ponía Google, y a
  partir de ahí era para siempre.
- **El cargo ya estaba y nadie lo usaba.** La API lo acepta desde que se
  escribió, y la única pantalla que llamaba a esa ruta mandaba solo la
  presencia. Otra función construida que no se podía encontrar.
- **La foto no se añade, y no se finge.** `profiles.avatar_url` existe pero solo
  se escribe al entrar con Google y **no se pinta en ninguna pantalla**: en toda
  la aplicación el avatar es la inicial. Añadir la subida sin cambiar además
  todos los sitios que dibujan esa chapa daría una foto que solo se ve en su
  propia pantalla, que es peor que no tenerla.

---

## 12 · El barrido de rutas muertas

Después de encontrar por accidente tres cosas construidas y sin forma de
llegar a ellas —las grabaciones, el cargo, renombrar una columna— hice el
barrido sistemático: **158 rutas en la API, 7 sin una sola referencia** en la
web ni en el MCP.

Cuatro son correctas: los callbacks de Google y Spotify y las dos rutas de
OAuth del MCP las llaman de fuera, no nuestro cliente.

Las otras tres eran agujeros de verdad:

- **`POST /auth/verify-email/resend`.** Si el correo de verificación no llegaba
  —spam, una errata, el proveedor tardando— no había **ni aviso de que faltaba
  ni forma de pedir otro**. `emailVerified` estaba en el tipo y no lo miraba
  nadie.
- **`GET /environments/:envId/deployments`.** Devuelve los últimos treinta y
  solo se enseñaba el más reciente. La historia entera estaba guardada y no se
  podía ver — que es justo lo que se mira cuando algo se rompió y hace falta
  saber desde cuándo.
- **`PATCH` y `DELETE /columns/:id`**, ya arreglados: una columna no se podía
  renombrar ni borrar.

**Vale la pena repetir este barrido de vez en cuando.** Una ruta sin llamantes
casi nunca es código de más: suele ser una función terminada a la que le falta
la puerta.

---

## 14 · La sala del agente en DevVerse

Desde que la puerta MCP está viva, Claude escribe en el tablero, busca y dibuja
arquitectura — y en DevVerse eso era **invisible**: la oficina solo mostraba
personas. Un canal llamado `agente-ia` tiene ahora su sala, con un muñeco que
dice en qué anda o, si está libre, pregunta.

**La sala es un canal de verdad.** Que una zona sea siempre la proyección de un
canal está grabado cuatro veces en el proyecto, y la 0007 ya dejó dicho que
ante una zona sin canal «la pregunta correcta no es *quito el NOT NULL*». Por
eso **no hay migración ni una línea de SQL**: se crea el canal desde la
interfaz y `ensure_world_room` coloca y amuebla la zona sola.

**La frase es mixta a propósito.** El agente puede declararla con la
herramienta nueva `estoy_haciendo`; si no declara nada, se deduce del nombre de
la última herramienta que usó. Deducir solo deja frases genéricas, y depender
de que el modelo declare deja al muñeco mudo cuando no colabora.

**El estado vive en memoria y caduca**, con el criterio que `hub.ts` ya defiende
para el estado en vivo: esto se limpia solo, y una fila tendría que borrarla
alguien — nadie borra «estaba migrando la base» cuando el proceso del agente se
muere a mitad. Hereda la contrapartida del hub: con dos instancias de la API no
se comparte.

**Qué falta.** `drawAvatar` dibuja una persona y no hay ningún sprite que no lo
sea, así que por ahora lleva el avatar gris de reserva y el cartel «Agente IA».
Un sprite propio es trabajo de dibujo en `atlas.ts`. Y sigue pendiente lo de
siempre en este plan: **nadie lo ha visto pintado** — hay que crear el canal
`agente-ia` en un espacio y entrar a mirar.

---

## Lo que NO entra en este plan

- Tocar colores o tipografía: ya está resuelto y demostrado en `landing.css`.
- Hacer el panel configurable: ya fue una rejilla configurable y se quitó.
- Alojar repositorios, el grafo y DevVerse: tienen su propio diseño y van
  después del vocabulario.
