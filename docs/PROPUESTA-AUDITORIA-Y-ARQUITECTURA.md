# Propuesta · Zona de auditoría, arquitecturas enlazables y crear desde la plataforma

11 de septiembre de 2026. Responde a cuatro peticiones:

1. Una **zona de auditoría**.
2. Poder **enlazar estructuras, arquitecturas y demás**.
3. Poder **migrar bases de datos y arquitecturas**.
4. Poder **crear todo desde la misma plataforma**.

Escrito después de mirar qué hay. Dos de las cuatro están mucho más cerca de lo
que parece; una tiene una barrera que no es de esfuerzo; y una es peligrosa y
hay que acotarla antes de empezarla.

---

## 1. La zona de auditoría ya está construida. Está escondida

Este es el hallazgo que cambia el orden de todo lo demás.

En `connectors/migraciones.ts` (319 líneas) hay **un auditor de verdad**: tres
reglas —aditiva, idempotente, aislamiento—, cada hallazgo con severidad
(`error` / `aviso`) y la peor severidad decidiendo el color de la fila. Está
probado en CI contra nuestras propias migraciones, que es el único banco de
pruebas honesto que hay para esto.

En `connectors/integraciones.ts` hay **otro auditor**, con seis diagnósticos que
son exactamente lo que un consultor cobra por decir:

| Detecta |
|---|
| Hay un archivo de entorno dentro del repositorio |
| Estáis escribiendo la autenticación a mano |
| Los archivos que sube la gente viven en el disco del servidor |
| Hay base de datos y no hay migraciones |
| No hay nada que compruebe los cambios antes de que entren |
| Hay tareas periódicas dentro del proceso que atiende peticiones |

**El problema no es que falte la auditoría: es que está repartida en dos
pantallas que se llaman «Base de datos» e «Integraciones», cada una atada a un
repositorio, y ninguna de las dos se llama auditoría.** Nadie que entre
buscando «auditar mi proyecto» va a encontrarlas.

### Lo que propongo, y es barato

**Una pantalla «Auditoría» que sea la portada de lo que ya existe**: un solo
sitio, todos los repositorios de la organización, todos los hallazgos juntos,
ordenados por severidad, con el archivo y la línea delante.

No hay que escribir analizadores. Hay que **agregar** los dos que hay y darles
un sitio con nombre. Es la misma lección que el tablero: antes de construir lo
que falta, hacer visible lo que ya está.

Y tiene un efecto comercial inmediato: *«esto es lo que estáis resolviendo a
mano en vuestro propio repositorio, con el archivo y la línea»* es una demo
buena. Mucho mejor que enseñar una pantalla llamada «Integraciones» que promete
montarlas y no las monta.

> **Coste: días, no semanas.** No toca la base de datos ni espera al grafo.

---

## 2. Enlazar estructuras y arquitecturas — eso es el grafo

Lo que pides aquí ya tiene diseño: es la columna vertebral de **nodo + enlace
con procedencia** de la propuesta de arquitectura, y estoy de acuerdo con ella
por los tres motivos que dejé escritos en el
[estudio](ESTUDIO-ARQUITECTURA-2026-09-11.md): el nodo da dirección y no copia
el dato, el tipo de relación vive en el enlace, y la procedencia —humano, regla,
agente— es lo que hace que enlazar solo sea aceptable en vez de temerario.

Lo que tu petición **añade** es un tipo de nodo que no estaba en la lista: la
**arquitectura** como objeto de primera clase. No un diagrama suelto, sino algo
que se puede enlazar a un repositorio, a un entorno, a un despliegue y a una
tarea.

Eso encaja bien y no rompe el modelo. Pero hay que decir tres cosas antes de
crear la tabla:

- **El aislamiento de un enlace no es el de una fila normal.** Un enlace toca
  dos nodos y quien ve uno puede no ver el otro. Un enlace entre un mensaje de
  un canal privado y una arquitectura lo vería cualquiera con acceso a
  arquitecturas — y con él, la existencia del canal privado. Hace falta
  `puede_ver_nodo(tipo, id)`, y es trabajo real. Es la quinta decisión abierta.
- **La arquitectura se va a quedar vieja igual que el título del nodo.** Si se
  dibuja a mano, miente en cuanto alguien renombra un servicio. Si se deriva del
  repositorio, no miente pero no se puede editar. **Mi recomendación: las dos
  capas, separadas** — lo derivado se recalcula, lo dibujado encima se conserva
  y se marca como propuesto. Es la misma frontera que actividad/enlaces.
- **Empezarlo y no terminarlo deja el producto peor que ahora.** No entra en la
  semana del cliente. Ni un día.

> **Coste: semanas.** Es la partida grande, y va después de la semana.

---

## 3. «Crear todo desde la plataforma» tiene una barrera concreta

Y no es de esfuerzo, es de arquitectura. Está contada:

> **DevUP no escribe nada hacia el repositorio del cliente. Cero.** Los
> conectores solo leen. La única petición de escritura en todo `connectors/` es
> a Spotify, y es para pedir un token.

Todo lo que hay construido —GitHub, migraciones, integraciones,
infraestructura— es **de solo lectura**. Diagnostica y no actúa. Por eso
Integraciones dice qué estáis resolviendo a mano y no lo monta: no es que falte
esa mitad, es que **no existe el camino de vuelta**.

«Crear desde la plataforma» significa abrir ese camino, y abrirlo bien significa
una sola cosa:

### Que DevUP no escriba en el repositorio del cliente. Que abra un PR

Nunca un commit directo, nunca una escritura silenciosa. Un PR es reversible,
es revisable, y deja a una persona decidiendo. Eso convierte «DevUP toca nuestro
código» —que da miedo y con razón— en «DevUP nos propone un cambio», que es
vendible.

Sobre eso, lo primero que crearía es lo que ya sabemos diagnosticar: los seis
hallazgos de integraciones tienen arreglo conocido. *«Detecto que no tenéis CI →
aquí está el PR con el workflow»* cierra el círculo entre auditar y crear, y
reutiliza todo el §1.

Hace falta además ampliar el enum de proveedores, que hoy solo admite
`github` y `spotify`.

> **Coste: semanas, y pide permisos de escritura del cliente.** Es la segunda
> partida grande. Fuera de la semana.

---

## 4. Migrar bases de datos — aquí sí voy a frenar

Es la petición con más riesgo de las cuatro, y quiero separar dos cosas que
suenan iguales:

| | Qué es | Mi opinión |
|---|---|---|
| **Auditar y proponer migraciones** | Leer el esquema, aplicar las tres reglas que ya existen, generar el SQL de la migración y abrirla como PR | **Sí. Es la continuación natural del §1 y del §3** |
| **Ejecutar la migración contra la base del cliente** | DevUP conectándose a su producción y aplicando DDL | **No, todavía no** |

La segunda no es difícil de escribir — son cincuenta líneas. Es difícil de
**tener**. Significa que DevUP guarda credenciales de producción de otra empresa
y ejecuta DDL con ellas. Un fallo ahí no es un error de la aplicación: es la
base de datos de un cliente.

Y hay una prueba de que todavía no estamos ahí: **44 capturas de error en
silencio** en el código actual, y cero pruebas de interfaz. No es el momento de
darle a este producto la llave de la producción de nadie.

**Lo que sí propongo:** que DevUP genere la migración, la audite con sus propias
reglas, y la entregue como PR. Quien la ejecuta es el cliente, con sus
herramientas. Se recupera casi todo el valor sin ninguna de las noches malas.

Cuando haya pruebas de interfaz, registro de actividad y una auditoría que
funcione con clientes de verdad, se revisa. No antes.

---

## 5. El orden que propongo

| | Qué | Cuándo |
|---|---|---|
| **1** | **Pantalla de Auditoría** agregando los dos analizadores que ya existen | Justo después de la semana del cliente. Días |
| **2** | **Escritura como PR**, empezando por los arreglos de los seis hallazgos | Después. Semanas |
| **3** | **Grafo con arquitectura como tipo de nodo**, con `puede_ver_nodo` resuelto antes de crear la tabla | Después. Es la partida grande |
| **4** | **Generar migraciones y entregarlas como PR** | Cae solo cuando existan 1, 2 y 3 |
| — | **Ejecutar migraciones contra la base del cliente** | No se planifica todavía |

Nada de esto entra en la semana del cliente, y meterlo la pondría en riesgo. Lo
único que tocaría de aquí antes de la demo es **el nombre**: si Integraciones se
presenta como diagnóstico —que es lo que es— el §1 deja de ser una función nueva
y pasa a ser la promesa que ya estabais cumpliendo.

---

## 6. En una frase

Tres de las cuatro cosas que pides están más cerca de lo que parece: la
auditoría **ya está escrita** y solo le falta un sitio con su nombre, enlazar
arquitecturas **ya tiene diseño** en el grafo, y crear desde la plataforma es
**un camino de vuelta que no existe** —abrir PRs— más que una función. La
cuarta, ejecutar migraciones contra la base de un cliente, es la única que yo
dejaría fuera del plan a propósito, y por una razón que no es el esfuerzo.
