# Plan de desarrollo · La oficina y la plataforma

**Estado:** propuesto · **Fecha:** agosto de 2026 · **Continúa a:**
[`decisiones/0002-vistas-profesional-e-inmersiva.md`](decisiones/0002-vistas-profesional-e-inmersiva.md)

Qué falta para que la vista inmersiva esté terminada —editor, personajes,
modelos— y cómo encaja eso con terminar el producto. Las dos cosas a la vez,
porque separarlas es lo que hace que una de las dos no se acabe nunca.

---

## 1. Dónde estamos

**Construido y verificado:**

| Capa | Estado |
|---|---|
| Espacio de trabajo | Completo: canales, mensajería, voz, archivos, tareas, grabación, invitaciones, notificaciones |
| Oficina, Fase 1 | Planta, zonas ligadas a canales, presencia, movimiento, audio por proximidad en sala, avatar, interruptor por organización |
| Modelos | 21 muebles, 18 personajes, 5 temas de sala |
| Pruebas | 69 comprobaciones de aislamiento, 13 del socket, recorrido de punta a punta en navegador |
| Control de ventas | **Nada** |
| Infraestructura y agentes | **Nada** |

Es decir: de las tres promesas del producto está entera la primera y no
empezada la segunda ni la tercera. La oficina se ha construido encima de la
primera.

---

## 2. La idea que ordena todo el plan

Hoy la oficina es **una piel**. Bonita, pero si se apaga no se pierde ningún
dato: las salas son canales pintados de colores y los muebles son decorado.

El plan entero se apoya en llevarla al sitio contrario:

> **Un mueble no decora: proyecta algo que ya es cierto.**
>
> La pizarra de una sala muestra su tablero de tareas. La estantería es su
> biblioteca de archivos. El monitor de un escritorio se enciende cuando hay
> alguien trabajando en ese canal. La pantalla de la pared muestra el estado
> del último despliegue.

Eso convierte la oficina en **un panel por el que se camina**, y responde a la
única objeción que de verdad importa —«¿esto aporta algo o solo es bonito?»—
sin romper la regla del documento 0002: sigue proyectando lo que ya existe, no
inventa datos nuevos.

Y tiene una consecuencia de calendario que decide la secuencia de este plan:
**los objetos solo pueden decir algo si hay algo que decir.** Una pizarra puede
mostrar tareas hoy, porque las tareas existen. Un monitor no puede mostrar el
estado de la CI hasta que existan los conectores. Así que la parte más valiosa
de la oficina **depende de que la plataforma avance**, no al revés.

---

## 3. Tres vías

| Vía | Qué persigue | Fase |
|---|---|---|
| **El espacio** | Que la oficina sea *vuestra*: colocar, mover, decidir | 2 |
| **La gente** | Que los avatares se comporten como gente, no como fichas | 3 |
| **Los objetos que dicen algo** | Que el mundo muestre el estado real del trabajo | 4 |

Van en ese orden porque cada una necesita la anterior: no se pueden colocar
muebles que muestran datos si no hay editor, y no tiene sentido sentarse en una
silla si la silla no se puede poner donde uno quiere.

---

## 4. Fase 2 — El editor y el catálogo · ~48 puntos

Lo que hace que la oficina deje de ser un mapa generado y pase a ser un sitio.

### 4.1 Persistir lo que se coloca · 8 pts

Hoy el mobiliario se deduce del nombre del canal y no se guarda. El editor
exige lo contrario: una tabla `world_props` con su RLS y su caso en
`isolation.test.ts`, colgando de `can_access_channel` como las zonas.

**El detalle que hay que hacer bien:** una sala sin nada colocado tiene que
seguir amueblándose sola. Si al abrir el editor una sala se vacía, nadie lo
usa. Lo que se guarda es **la diferencia** con el amueblado por defecto, no el
amueblado entero — y por eso «restaurar» es borrar filas, no recolocar nada.

### 4.2 El editor · 18 pts

- Modo edición con paleta lateral de muebles, arrastrar y soltar sobre la rejilla
- Rotar (4 orientaciones), elevar sobre otro mueble, borrar
- Deshacer y rehacer
- Guardado por lotes, no por movimiento: arrastrar un sofá no son cuarenta escrituras
- Quién puede editar: administrador del workspace. Un canal compartido no lo
  redecora cualquiera que pase

### 4.3 La planta · 10 pts

- Mover y redimensionar salas, con colisión contra las vecinas
- Elegir material de suelo y color de pared por sala, sobreescribiendo el tema deducido
- Puertas colocables: hoy hay una y siempre al sur
- Zonas de pasillo decorables (hoy el pasillo es suelo desnudo)

### 4.4 El catálogo · 12 pts

Los 21 de ahora, más ~28. Es el número que hace que dos salas del mismo tema no
se parezcan:

| Tema | Modelos a añadir |
|---|---|
| **Trabajo** | Mesa elevable, rack de servidores, impresora, doble monitor, corcho de notas, archivador, dispensador de agua |
| **Salón** | Cocina americana, cafetera, mesa de comedor, taburete de barra, televisión, consola de recibidor, cojines de suelo, cortinas |
| **Juegos** | Mesa de billar, futbolín, pinball, consola retro con tele, vitrina de trofeos, cartel de neón |
| **Música** | Batería, guitarra en soporte, mesa de mezclas, micrófono de pie, estantería de vinilos, paneles acústicos |
| **Reunión** | Proyector con pantalla, altavoz de videoconferencia, caballete de papel, separador de plantas |
| **Comunes** | Puertas de verdad (que se abren), escaleras, variantes de ventana y alfombra, reloj de pared, acuario, **mascota que deambula** |

La mascota no es un capricho: un elemento que se mueve solo por su cuenta es lo
que hace que un sitio no parezca una foto cuando no hay nadie dentro.

---

## 5. Fase 3 — La gente · ~38 puntos

### 5.1 Sentarse · 10 pts

**Es la pieza más importante de esta fase y la más fácil de subestimar.** Una
sala con seis sillas y seis personas de pie en el pasillo parece un decorado.
Caminar hasta una silla, pulsar una tecla y sentarse cambia por completo la
lectura del sitio.

Exige: casillas de asiento declaradas por mueble, orientación al sentarse,
postura del avatar sentado, y liberar el asiento al desconectarse — que es el
mismo problema del par fantasma de la sala de voz, con la misma solución.

### 5.2 El avatar · 14 pts

- Capas nuevas: gafas, vello facial, gorros, calzado, accesorios
- Ocho orientaciones en vez de cuatro
- Marca de estado sobre la cabeza: en llamada, ocupado, ausente, escribiendo
- Nombre con el rol de la organización

### 5.3 Expresión · 14 pts

- Gestos: saludar, pulgar arriba, aplaudir, levantar la mano
- Burbuja de chat sobre el avatar, enganchada al canal de la sala — **no un chat
  nuevo**: lo que se escribe ahí es un mensaje del canal, y se lee igual desde
  la vista profesional
- «Levantar la mano» en una sala de reunión, que aparece también en la lista de
  participantes de la llamada

La burbuja es donde esta fase toca la regla de §5 del documento 0002. Se
resuelve igual que las zonas: es el canal, con otra ropa.

---

## 6. Fase 4 — Objetos que dicen algo · ~42 puntos

La vía que justifica todo lo demás. Cada mueble se ata a algo que ya existe.

| Mueble | Qué muestra | Depende de |
|---|---|---|
| Pizarra | Tareas por columna del tablero de ese canal | Ya existe |
| Estantería | Nº de archivos del canal; interactuar abre la biblioteca | Ya existe |
| Monitor de escritorio | Encendido si hay actividad reciente en el canal | Ya existe |
| Corcho de notas | Mensajes fijados | Fijar mensajes (pequeño) |
| Reloj de pared | Hora del equipo distribuido | Ya existe |
| Pantalla de pared | Estado del último despliegue | **Conectores (S7)** |
| Rack de servidores | Salud de los entornos | **Conectores (S7)** |
| Vitrina de trofeos | Objetivos trimestrales cumplidos | **Ventas (S5)** |
| Tablón de ventas | Embudo del trimestre | **Ventas (S4)** |

**Cinco de nueve dependen de plataforma que no existe.** Ese es el argumento,
en una tabla, de por qué la secuencia de §8 alterna en vez de terminar la
oficina primero.

Además:

- **Tecla de interacción** sobre cualquier mueble: abre el panel correspondiente
  de la vista profesional, en una lámina lateral. Es el puente entre las dos
  vistas y lo que impide que sean dos productos
- **No molestar** por sala, con puerta cerrada visible desde fuera
- **Llamar a la puerta** en una sala ocupada

---

## 7. La plataforma — lo que falta

Del plan de 12 semanas, sin empezar:

| Semana | Foco | Puntos |
|---|---|---:|
| S4 | Servicios, clientes y embudo de ventas | 22 |
| S5 | Objetivos y seguimiento | 22 |
| S6 | Búsqueda global y notificaciones | 22 |
| S7 | Bóveda de credenciales y conectores | 22 |
| S8 | Base de datos como código | 22 |
| S9 | Migraciones y sincronía con el repo | 22 |
| S10 | Orquestación de agentes | 22 |
| S11 | DevUP ID, MFA y auditoría | 22 |
| S12 | Métricas, endurecimiento y beta | 22 |
| | **Total** | **198** |

---

## 8. La secuencia que propongo

No «terminar la oficina y luego la plataforma». Alternando, y por un motivo
concreto: la Fase 4 —la que hace que la oficina aporte algo— **no se puede
construir antes que la plataforma que proyecta**.

| Bloque | Qué | Puntos | Semanas |
|---|---|---:|---:|
| 1 | **Fase 2**: editor y catálogo | 48 | ~2,2 |
| 2 | **S4 + S5**: control de ventas y objetivos | 44 | ~2 |
| 3 | **Fase 3**: sentarse, avatar, expresión | 38 | ~1,7 |
| 4 | **S6 + S7**: búsqueda global, bóveda y conectores | 44 | ~2 |
| 5 | **Fase 4**: objetos que dicen algo | 42 | ~1,9 |
| 6 | **S8 + S9**: base de datos como código | 44 | ~2 |
| 7 | **S10 + S11 + S12**: agentes, identidad y beta | 66 | ~3 |
| | **Total** | **326** | **~15** |

**Por qué este orden y no otro:**

- **La Fase 2 va primero** porque es la que estáis pidiendo y porque hasta que
  el equipo no pueda montar su propia oficina, la vista inmersiva no se prueba
  de verdad: un mapa generado se mira, uno propio se usa.
- **Ventas va segundo** porque es la segunda promesa del producto y hoy no
  existe. Un centro de mando sin ventas es un chat con avatares.
- **La Fase 4 va después de los conectores** porque sin ellos cinco de sus
  nueve muebles no tienen nada que mostrar.
- **La beta va al final**, y hasta entonces la oficina viaja apagada por defecto
  para las organizaciones que la evalúen (ya existe el interruptor).

---

## 9. Qué significa «plataforma funcional»

Conviene fijarlo antes de empezar, porque es lo que decide cuándo se para.

Una organización nueva puede, sin salir de DevUP y sin ayuda:

1. Darse de alta, crear su equipo e invitar gente
2. Conversar, llamarse, compartir archivos y llevar sus tareas
3. Registrar clientes, servicios y oportunidades, y ver su embudo
4. Fijar objetivos trimestrales que avanzan solos al cerrarse una venta
5. Buscar cualquier cosa —mensaje, archivo, tarea, cliente— desde un solo sitio
6. Conectar su GitHub y su nube, y ver repos, entornos y despliegues juntos
7. Modelar un cambio de esquema, generar la migración y abrir el PR
8. Asignar una tarea a un agente y aprobar su resultado
9. Entrar con identidad propia, con MFA y con auditoría de lo que pasó

Los puntos 1 y 2 están hechos. **Del 3 al 9, nada.** Eso es lo que hay entre el
estado de hoy y la palabra «funcional».

---

## 10. Riesgos

| Riesgo | Respuesta |
|---|---|
| **La oficina se come el producto.** Ya lleva ~55 puntos y pide 128 más | La secuencia de §8 la parte en tres bloques con plataforma entre medias. Ningún bloque de oficina supera las 2,2 semanas seguidas |
| **La Fase 4 no llega y la oficina se queda en piel** | Es el riesgo real. Si hay que recortar, se recorta la Fase 3 —la más vistosa y la menos útil— antes que la 4 |
| **El editor abre la puerta a que cada uno rompa su oficina** | «Restaurar» borra filas y vuelve al amueblado deducido. Nunca se pierde nada porque nunca se sobrescribe el defecto |
| **La malla se rompe con doce personas en una sala** | Pendiente de la Fase 1 y apuntado: histéresis de tres radios dentro del canal. ~8 pts, entra donde haga falta |
| **15 semanas es mucho** | Es el precio de las tres promesas. Recortar significa elegir cuál de las tres no se cuenta |

---

## 11. Lo que necesito que decidas

1. **¿Se acepta la secuencia alterna de §8**, o preferís terminar toda la
   oficina —Fases 2, 3 y 4— antes de tocar ventas?
2. **¿La Fase 4 es el objetivo real de la oficina**, o vale con que sea un
   espacio bonito donde encontrarse? Cambia si los muebles se diseñan atados a
   datos desde el principio o no.
3. **¿Quién edita la oficina**: solo administradores del workspace, o cualquiera
   con acceso al canal?
4. **¿Entra la burbuja de chat en el mundo** sabiendo que tiene que ser un
   mensaje del canal de verdad, con su historial, y no un chat aparte?
