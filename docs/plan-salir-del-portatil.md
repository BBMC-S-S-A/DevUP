# Salir del portátil, sin pagar nada

**Fecha:** 1 de septiembre de 2026 · **Responde a:** ¿se puede montar lo mínimo
de DevUP sin usar el PC de Juan como servidor, qué habría que dejar fuera, y hay
que romper la regla de no depender de terceros?

**Dos premisas fijadas por Juan:** todo gratuito, nada de pago. Y **Oracle Cloud
queda descartado**: la cuenta no salió adelante.

> **Corrige a una versión anterior de este mismo documento.** La primera versión
> daba por hecho Oracle y concluía que salir del portátil *quitaba* un tercero,
> porque una máquina con IP pública permite `coturn` propio. **Sin Oracle eso ya
> no es verdad**, y es el cambio más importante de esta revisión.

---

## La respuesta corta

**Sigue siendo que sí, y sigue sin perderse ninguna funcionalidad.** Pero el
precio cambia, y conviene decirlo de frente antes que la solución:

- **`docker-compose.prod.yml` deja de ser la unidad de despliegue.** Sin una
  máquina propia no hay dónde ponerlo; cada pieza pasa a ser un servicio suelto
  en un sitio distinto.
- **La API se duerme** tras 15 minutos sin nadie, y tarda ~1 minuto en volver.
- **Sí aumentan los terceros**, incluido TURN — que con una máquina propia nos
  habríamos ahorrado.

Ninguna de las tres rompe nada. Pero son tres cosas que con una VM no pasaban,
así que si en algún momento aparece una máquina gratuita, **volver a ella es
estrictamente mejor y el `docker-compose.prod.yml` sigue sirviendo sin tocarlo**.

---

## 1. Por qué Oracle era otra cosa, y qué perdemos sin él

Una máquina de verdad daba tres cosas que ninguna capa gratuita gestionada da:

| Daba | Y sin ella |
|---|---|
| Correr el `docker-compose.prod.yml` tal cual | Cada pieza se contrata aparte, y desplegar deja de ser un comando |
| **Puertos UDP** → `coturn` propio | TURN vuelve a ser obligatoriamente de un tercero (Metered) |
| Estar encendida siempre | La API se duerme cuando no hay nadie |

Ese segundo punto es el que invalida lo que decía la versión anterior. El código
de `coturn` propio sigue estando ([`ice.ts:36`](../apps/api/src/routes/ice.ts))
y sigue siendo la opción buena — simplemente hoy no hay dónde ponerlo, igual que
no lo había en el PC porque el túnel de Cloudflare no lleva UDP.

## 2. Qué queda realmente gratis, a 1 de septiembre de 2026

Fui a mirar en vez de suponer, porque estas capas se recortan cada pocos meses:

| Candidato para la API | Estado real | ¿Sirve? |
|---|---|---|
| **Oracle Always Free** | La cuenta no salió. Además bajó de 4 núcleos/24 GB a **2/12** el 18 de agosto | Descartado |
| **Fly.io** | **Ya no hay capa gratuita para cuentas nuevas** — solo una prueba de 2 horas de VM o 7 días. Las cuentas antiguas conservan la suya | No |
| **Google Cloud `e2-micro`** | Sigue siendo permanente, pero: 1 GB de RAM, solo regiones de EE.UU., y **1 GB de salida al mes**. Un GB al mes son 33 MB al día | Solo si la web sale de ahí. Y exige tarjeta, con el mismo riesgo de rechazo que Oracle |
| **Render, servicio web gratuito** | **750 horas de instancia al mes** por espacio de trabajo — un mes son ~730, así que da para **un** servicio encendido. Desde febrero de 2026 los mensajes de WebSocket **también** cuentan como actividad y evitan que se duerma. **No pide tarjeta** | **Sí.** Es la recomendación |

**Render tiene tres límites que hay que conocer antes**, no después:

1. **Se duerme** a los 15 minutos sin peticiones HTTP ni mensajes de socket, y
   tarda cerca de un minuto en despertar.
2. **No hay UDP**, así que no hay `coturn` propio.
3. **Bloquea los puertos 25, 465 y 587** de salida — los de SMTP. El correo
   tiene que salir por la API HTTP de un proveedor, no por SMTP.

## 3. La pila recomendada, y por qué cada pieza

Todo lo de esta tabla **se da de alta sin tarjeta**, que después de lo de Oracle
dejó de ser un detalle:

| Pieza | Dónde | Límite | Por qué esa y no otra |
|---|---|---|---|
| **API** | Render, servicio gratuito | 750 h/mes; se duerme a los 15 min | Único sitio gratis, sin tarjeta y con proceso encendido y WebSockets |
| **Web** | Cloudflare Pages | Generoso y con **uso comercial permitido** | Vercel Hobby es gratis pero su licencia es solo para uso personal, y DevUP es un producto |
| **Postgres** | Supabase | 500 MB, 5 GB de salida; **se pausa tras 1 semana sin uso** | **Cambia lo que dije ayer:** recomendaba Neon, pero sus 100 CU-hora al mes chocan con nuestro pool siempre abierto. Supabase no mide horas de cómputo |
| **Almacén** | Supabase Storage | 1 GB, compatible con S3 | La API ya habla S3; es cambiar el `endpoint`. R2 sería mejor, pero **exige método de pago** |
| **TURN** | Metered | **0,5 GB/mes sin tarjeta, 20 GB con ella** | Aquí sí hay un tercero inevitable. El relevo solo se usa cuando falla la conexión directa |
| **Túnel y dominio** | Cloudflare | — | Ya lo tenemos |
| **Correo** | API HTTP de un proveedor | Cientos al día | Render bloquea los puertos SMTP. *Solo Juan* |

Nuestra base de datos son 4,7 MB, así que los 500 MB de Supabase no son la
restricción; la pausa a la semana sí, y se resuelve sola en cuanto haya gente
usándolo a diario.

## 4. Los cuatro cambios que esto obliga

No es solo mover contenedores. Estos cuatro sí son trabajo, y conviene tenerlos
contados antes de empezar:

1. **Separar web y API a dominios distintos.** La web pasa a `app.hytrex.co` y
   la API se queda en `api.hytrex.co`. **Tienen que colgar del mismo dominio
   raíz**: si la web acabara en `algo.pages.dev`, las cookies de sesión serían
   de terceros y el login fallaría de forma intermitente en Chrome y Safari. Es
   el obstáculo que la [decisión 0003 §1.3](decisiones/0003-arquitectura-de-despliegue.md)
   ya había identificado; ahora deja de ser opcional. Hay que revisar
   `APP_BASE_URL`, CORS y el dominio de la cookie.
2. **Comprobar que la web corre en Pages.** Next.js con enrutador de aplicación
   funciona ahí, pero cualquier parte que dependa del entorno Node de servidor
   no. **Es la incógnita más grande del plan** y hay que probarla antes de
   comprometerse, no después.
3. **Cambiar el envío de correo** de SMTP a la API HTTP de un proveedor, porque
   Render cierra esos puertos. Toca el módulo de correo y `npm run correo:probar`.
4. **Aceptar que desplegar cambia.** Hoy es un `docker compose up`; pasa a ser un
   `git push` por servicio. Los scripts de respaldo, que hoy son contenedores del
   compose, hay que reubicarlos.

## 5. Lo que se pierde y lo que no

**No se pierde ninguna funcionalidad.** Las llamadas, DevVerse, el chat en vivo,
la pizarra y la música siguen funcionando: todo eso necesita un proceso encendido
con WebSockets, y Render lo es. Son **cinco** sockets —`/ws/voice`, `/ws/files`,
`/ws/channel`, `/ws/user` y `/ws/world`— más el reloj del mundo. Lo que **no**
valdría es *serverless* —funciones de Vercel, Workers— porque ahí no hay proceso
donde vivan las conexiones abiertas ni el reloj, y eso sí costaría la mitad en
tiempo real de DevUP.

Lo que sí se pierde es comodidad, en tres sitios concretos:

- **El primero que entra por la mañana espera un minuto.** Mientras la API duerme
  no hay presencia ni reloj del mundo — pero tampoco hay nadie a quien mostrárselo.
- **TURN es de un tercero.** Con 0,5 GB al mes (sin tarjeta) alcanza para probar;
  para uso real hacen falta los 20 GB, y eso pide tarjeta aunque no cobre.
- **Un solo servicio encendido.** Las 750 horas dan para uno. Por eso la web tiene
  que irse a Pages: no es una preferencia de arquitectura, es la cuenta de horas.

## 6. Y la restricción de siempre: una sola instancia

Los hubs de tiempo real ([`hub.ts:61`](../apps/api/src/realtime/hub.ts)), el
reloj del mundo y el límite de peticiones viven en la memoria del proceso. Con
dos instancias habría dos relojes, la presencia se partiría en dos mitades que no
se ven, y el límite dejaría pasar el doble. La capa gratuita da una, así que
encaja — pero que quede escrito para que nadie lo «escale» sin poner Redis
delante.

## 7. El orden de la mudanza

El paso 1 no se salta.

1. **Sacar `.env.production` a un gestor de contraseñas.** Lleva la clave que
   descifra la bóveda y hoy existe en un solo archivo de un solo ordenador. Una
   mudanza es exactamente cuando eso se pierde. *Solo Juan.*
2. **Probar que la web compila y corre en Cloudflare Pages.** Antes que nada
   más: si esto no sale, el resto del plan cambia de forma.
3. Alta en Supabase, crear el rol de aplicación **sin que sea dueño de las
   tablas** —eso no cambia con el proveedor— y aplicar las 25 migraciones.
4. **Restaurar el último respaldo y contar filas.** No dar por bueno que arrancó.
5. Almacén a Supabase Storage; cambiar `endpoint` y credenciales.
6. Desplegar la API en Render con las variables de `.env.production`.
7. `app.hytrex.co` → Pages y `api.hytrex.co` → Render. De paso se arregla el
   apex, que hoy devuelve la página aparcada de Hostinger.
8. Correo por API HTTP; TURN con las claves de Metered.
9. **Decidir dónde caen los respaldos** (ver abajo) y programarlos.
10. **Y solo entonces**, apagar el PC.

## 8. Lo que hay que confirmar

| Pregunta | Recomendación |
|---|---|
| **¿Qué falló exactamente en Oracle?** | Si fue la tarjeta, Google `e2-micro` fallará igual y no vale la pena intentarlo. Si fue otra cosa, una VM sigue siendo mejor que todo lo de arriba |
| ¿Dónde caen los respaldos? | **No en Supabase**, que es donde vive la base. R2 sería lo natural pero pide tarjeta. Alternativa sin tarjeta: dump cifrado a un repositorio privado —son 4,7 MB— o seguir bajándolos al PC, que deja de ser servidor pero puede seguir siendo la copia de fuera |
| ¿Se acepta que la API se duerma? | Sí para el equipo interno. Deja de valer con el primer cliente externo |
| ¿Tarjeta en Metered para los 20 GB? | Recomendado sí: no cobra, y 0,5 GB no aguanta uso real |

Y la de siempre, que no cambia: **gratis vale hasta la primera credencial real de
un cliente externo en la bóveda.** A partir de ahí, una suspensión sin aviso deja
de ser un susto y pasa a ser una caída total sin nadie a quien reclamarle.

---

## Fuentes de los límites citados

Comprobados el 1 de septiembre de 2026. Caducan rápido: reverificar antes de
actuar sobre ellos.

- [Render: 750 horas, y los WebSockets ya evitan la suspensión](https://render.com/changelog/free-web-services-now-remain-active-while-receiving-websocket-messages)
  · [límites del plan gratuito](https://render.com/docs/free)
- [Fly.io: sin capa gratuita para cuentas nuevas](https://www.saaspricepulse.com/blog/flyio-free-tier-2026)
- [Supabase: 500 MB, 5 GB de salida, pausa a la semana, sin tarjeta](https://agentdeals.dev/vendor/supabase)
- [Neon: 0,5 GB y 100 CU-hora al mes](https://agentdeals.dev/vendor/neon) — descartado por eso
- [Metered: 0,5 GB sin tarjeta, 20 GB con ella](https://www.metered.ca/tools/openrelay/)
- [Google `e2-micro`: permanente, 1 GB de RAM, 1 GB de salida al mes](https://agentdeals.dev/gcp-free-tier-2026)
- Oracle, por si se reintenta algún día: [recorte a 2 núcleos y 12 GB](https://zeli.app/en/story/49183750)
