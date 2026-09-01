# Salir del portátil, sin pagar nada

**Fecha:** 1 de septiembre de 2026 · **Responde a:** ¿se puede montar lo mínimo
de DevUP sin usar el PC de Juan como servidor, qué habría que dejar fuera, y hay
que romper la regla de no depender de terceros?

**Premisa fijada por Juan:** todo gratuito. Nada de pago.

---

## La respuesta corta

Sí se puede. **No hay que dejar fuera ninguna funcionalidad**, y **no hay
ninguna regla que romper** — de hecho salir del portátil quita un tercero en vez
de añadirlo. Lo que sí hay es **una condición técnica** y **tres avisos**, y uno
de los tres deja desactualizada la decisión
[`0003`](decisiones/0003-arquitectura-de-despliegue.md).

---

## 1. No hay regla que romper

La regla de la propuesta (§10) es «**no construimos infraestructura de
despliegue propia**». Dice lo contrario de lo que parece: significa *no montar
una plataforma de despliegue que compita con Vercel o Railway para nuestros
clientes*, y recomienda explícitamente **orquestar terceros**. Poner DevUP en
una máquina ajena no viola esa regla: **es esa regla**.

Y el portátil nunca fue el plan. La decisión 0003 ya recomendaba una VPS en
agosto. Lo del PC es un provisional que se quedó, con dos síntomas que ya
costaron tiempo: los despliegues automáticos fallan cuando Docker está cerrado,
y el respaldo estuvo tres días fallando en silencio porque la máquina se
reinicia.

## 2. Nada se queda fuera — con una condición

**La condición:** el sitio donde se aloje tiene que poder correr **un proceso
encendido todo el rato, con WebSockets**. No sirve *serverless*.

Es una condición de código, no una preferencia: `@fastify/websocket` se registra
en [`server.ts:98`](../apps/api/src/server.ts) y de ahí cuelgan tres sockets
—`/ws/voice`, `/ws/files`, `/ws/world`—.

**Lo que se perdería yendo a serverless** (funciones de Vercel, Workers de
Cloudflare, cualquier plan gratis de los que solo despiertan con una petición):

| Se pierde | Por qué |
|---|---|
| Llamadas de voz y vídeo | La señalización es una conexión abierta entre los dos lados |
| DevVerse entero | Presencia, movimiento y el reloj del mundo son un `setInterval` dentro del proceso |
| Chat en vivo | Volvería a ser recargar para ver si hay mensajes nuevos |
| Pizarra compartida | Va por el canal de datos de la llamada |
| Música compartida | El estado de reproducción se difunde por socket |

Es decir: **la mitad en tiempo real**, que es justo lo que hace que DevUP no sea
un Trello con más pestañas. Por eso la respuesta a «¿tercerizamos las llamadas?»
es que no hace falta — ver el punto siguiente.

## 3. Salir del portátil **quita** un tercero

Hoy TURN **tiene** que ser Metered porque producción no publica ni un puerto: va
detrás de un túnel de Cloudflare, y un túnel no lleva UDP. Es la razón exacta
por la que `docker-compose.prod.yml` no levanta `coturn`.

Una máquina con IP pública sí puede abrir UDP, así que **coturn propio pasa a
ser posible**. Y el código ya está escrito: [`ice.ts:36`](../apps/api/src/routes/ice.ts)
emite credenciales temporales con HMAC en cuanto hay `TURN_SECRET`. No hay nada
que programar; es cambiar variables de entorno.

De regalo se desbloquean dos cosas que hoy están pendientes por el mismo motivo:
**registrar el ejecutor** de despliegues contra una máquina que sí está siempre
encendida, y dejar de tener que recordarle a Juan que abra Docker.

## 4. Aviso: la decisión 0003 está desactualizada

0003 recomienda Oracle Cloud «Always Free» con **4 núcleos ARM y 24 GB de RAM**.
Ya no es así: **desde el 18 de agosto de 2026 son 2 núcleos y 12 GB**, contados
por cuenta entera, y lo que exceda esa reserva **se termina automáticamente**.

No cambia la conclusión —12 GB siguen siendo unas tres veces lo que piden los
siete contenedores—, pero sí cambia el margen, y había que decirlo antes de que
alguien planifique sobre el número viejo.

Dos avisos más sobre lo gratuito de Oracle, los dos verificados:

- **Reclaman instancias ociosas.** Miran CPU, memoria y red a lo largo del
  tiempo. DevUP con gente dentro no está ocioso; DevUP un mes sin usarse, sí.
- **Puede no haber capacidad Ampere en la región elegida.** El plan figura como
  disponible y la creación falla igual. Se resuelve probando otra región, pero
  hay que saberlo antes para no elegir región por otro criterio.

## 5. La pila gratuita, pieza por pieza

| Pieza | Gratis | Límite real | Veredicto |
|---|---|---|---|
| **Máquina** | Oracle Always Free | 2 núcleos ARM, 12 GB, 10 TB de salida al mes, sin caducidad | Sobra. Es la única capa gratuita permanente con un proceso encendido |
| **Postgres** | En contenedor, en esa misma máquina | El disco de la máquina | **Recomendado.** Es lo que ya hay |
| — alternativa | Neon gratis | 0,5 GB y **100 CU-hora al mes**; se duerme a los 5 minutos | **Ojo:** nuestro pool de conexiones está siempre abierto; si eso impide que se duerma, 100 horas se gastan en cuatro días |
| **Almacén** | MinIO en la misma máquina | El disco | Es lo que ya hay |
| — y además | Cloudflare R2 | 10 GB, 1 M escrituras, 10 M lecturas al mes, **salida siempre gratis** | **Para los respaldos**, que es la pieza que no puede vivir en la misma máquina |
| **TURN** | coturn propio | Ninguno | Deja de hacer falta Metered (§3) |
| **Túnel y dominio** | Cloudflare | — | Ya lo tenemos |
| **Correo** | Capa gratuita de un proveedor | Cientos de correos al día | Sigue pendiente de alta. *Solo Juan* |

**Recomendación: todo en la misma máquina**, exactamente igual que hoy. Es el
mismo `docker-compose.prod.yml` sin tocar una línea, y es la única combinación
que no obliga a aprender nada nuevo. La única pieza que **sí** debe salir de ahí
son los respaldos → R2: un respaldo guardado dentro de la máquina que puede
desaparecer no es un respaldo. Son 4,7 MB.

## 6. La restricción que hay que anotar: **una sola instancia**

Tres cosas viven en la memoria del proceso: los hubs de tiempo real
([`hub.ts:61`](../apps/api/src/realtime/hub.ts)), el reloj del mundo, y el
límite de peticiones de `@fastify/rate-limit`. Con dos instancias habría dos
relojes, la presencia se partiría en dos mitades que no se ven, y el límite
dejaría pasar el doble.

La capa gratuita da una máquina, así que encaja. Pero conviene dejarlo escrito
para que nadie «escale» esto sin poner Redis delante — la costura para hacerlo
ya existe y es ese único archivo.

## 7. Qué hay que cambiar en el repositorio: casi nada

Comprobado, no supuesto:

- **Ninguna imagen está anclada a `amd64`.** `node:22-alpine`, `postgres:17-alpine`,
  `minio` y `coturn` son todas multiarquitectura. En ARM arrancan igual.
- **La API no escribe en disco local.** Todo va a Postgres o al almacén: se
  mueve sin arrastrar estado.
- **Postgres solo usa `pgcrypto` y `citext`**, que están en cualquier Postgres.
- **El túnel se queda** — mantiene 80 y 443 cerrados. La única excepción
  deliberada es el UDP de coturn, que sí hay que abrir en la lista de seguridad.

## 8. El orden de la mudanza

El orden importa, y el paso 1 no se salta.

1. **Sacar `.env.production` a un gestor de contraseñas.** Lleva la clave que
   descifra la bóveda, y hoy existe en un solo archivo de un solo ordenador. Una
   mudanza es exactamente el momento en que eso se pierde. *Solo Juan.*
2. Crear la cuenta de Oracle, en una región **con capacidad Ampere**. Ubuntu ARM.
3. Endurecer el sistema: `ufw` con solo SSH, acceso por clave, actualizaciones
   automáticas de seguridad.
4. Copiar el repositorio y `.env.production` — el segundo **nunca** por git.
5. Levantar con `docker-compose.prod.yml` y aplicar migraciones.
6. **Restaurar el último respaldo y contar filas**, no dar por bueno que arrancó.
7. Apuntar el túnel a la máquina nueva. De paso se arregla el apex `hytrex.co`,
   que hoy devuelve la página aparcada de Hostinger y ya estaba pendiente.
8. coturn: abrir UDP, poner `TURN_URLS` y `TURN_SECRET`, borrar `METERED_*`.
9. Respaldos apuntando a R2.
10. Registrar el ejecutor allí.
11. **Y solo entonces**, apagar el PC.

## 9. Qué cuesta que sea gratis

Oracle puede suspender una cuenta gratuita sin aviso. 0003 ya lo decía y sigue
siendo verdad: con credenciales de clientes reales en la bóveda eso es
inaceptable, porque una suspensión es indistinguible de una caída total y no hay
a quién reclamarle con la urgencia que un cliente esperaría.

Lo que lo hace soportable mientras tanto son dos cosas de esta misma lista: los
**respaldos fuera** (paso 9) y **`.env.production` en un gestor** (paso 1). Con
las dos, una suspensión cuesta una tarde de volver a levantarlo en otro sitio.
Sin ellas, cuesta el producto. La regla práctica: **gratis vale hasta la primera
credencial real de un cliente externo**.

---

## Lo que hay que confirmar

| Pregunta | Recomendación |
|---|---|
| ¿Postgres en la máquina o Neon gratis? | **En la máquina.** El límite de horas de Neon choca con un pool siempre abierto |
| ¿Los respaldos a R2 desde ya? | **Sí.** Es la única pieza que no puede vivir donde vive todo lo demás |
| ¿Se mantiene el túnel de Cloudflare? | **Sí.** Salir del portátil no es motivo para abrir 80 y 443 |
| ¿Se cancela el alta de Metered? | **Sí**, si se hace esta mudanza: deja de hacer falta |

---

## Fuentes de los límites citados

Los números de las capas gratuitas se comprobaron el 1 de septiembre de 2026 y
caducan rápido; conviene reverificarlos antes de actuar sobre ellos.

- Oracle, recorte a 2 núcleos / 12 GB y reclamación de instancias ociosas:
  [documentación de Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
  y [el aviso del recorte](https://zeli.app/en/story/49183750)
- [Cloudflare R2: 10 GB y salida sin coste](https://freetier.co/directory/products/cloudflare-r2)
- [Neon: 0,5 GB y 100 CU-hora al mes](https://agentdeals.dev/vendor/neon)
