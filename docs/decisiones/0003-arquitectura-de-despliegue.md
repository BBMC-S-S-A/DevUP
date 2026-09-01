# 0003 · Arquitectura de despliegue: monolito, VPS y qué falta en la guía

**Estado:** propuesto — pendiente de visto bueno · **Fecha:** agosto de 2026 ·
**Decide sobre:** si separar `apps/api` y `apps/web` en microservicios en
distintas plataformas, qué VPS usar (con y sin coste), y qué le falta a
[`DESPLIEGUE.md`](../DESPLIEGUE.md) para desplegar con seguridad de verdad.

> **Corrección del 1 de septiembre de 2026. La recomendación de VPS de este
> documento ya no es aplicable**, por dos motivos distintos:
>
> - **Oracle «Always Free» está descartado**: la cuenta no salió adelante. Y,
>   además, desde el 18 de agosto de 2026 da **2 núcleos y 12 GB**, no los 4 y 24
>   que se dicen aquí.
> - **No hay presupuesto**: Hetzner y Vultr quedan fuera por la premisa de que
>   todo tiene que ser gratuito.
>
> Sin máquina propia, `docker-compose.prod.yml` deja de ser la unidad de
> despliegue y la §1.3 de este documento —separar `web` y `api` en plataformas
> distintas, con el problema de cookies entre dominios— **deja de ser una
> optimización futura y pasa a ser obligatoria**. El plan vigente está en
> [`plan-salir-del-portatil.md`](../plan-salir-del-portatil.md).
>
> Lo que **sí** sigue vigente de aquí: no migrar a microservicios, el análisis de
> cookies de la §1.3, y que el rol de aplicación no sea dueño de las tablas
> tampoco en un Postgres gestionado.

---

## Resumen para quien no vaya a leer el resto

**No se recomienda migrar a microservicios ahora.** El diseño actual —dos
contenedores (`api`, `web`) sobre un único Postgres con RLS— ya es la
separación correcta para el tamaño del equipo y la etapa del producto.
Partirlo en más servicios no resuelve ningún problema real hoy y sí rompe la
propiedad arquitectónica más cara del proyecto: el aislamiento vive en un
solo Postgres (§5.1 de `CONTEXTO-COMPLETO.md`).

**Para el despliegue:** la variante ya documentada en `DESPLIEGUE.md`
—Cloudflare Tunnel sin abrir puertos, TURN gestionado (Metered.ca)— es la
correcta para esta fase. Para la máquina detrás del túnel, la recomendación
de pago es **Hetzner CX22**; existe además una opción **genuinamente
gratuita y permanente** (Oracle Cloud "Always Free", 4 núcleos ARM y 24 GB
de RAM) que alcanza sobrada para todo el stack — con una advertencia
importante sobre su fiabilidad para producción real (§2.3).

**Lo que a la guía de despliegue le falta de verdad** está en §4: no hay
copia de seguridad automatizada, no hay pipeline de despliegue (CI prueba,
no despliega), no hay plan de rotación de secretos, y `VAULT_MASTER_KEY` no
tiene ruta de recuperación si se pierde.

---

## 1. ¿Microservicios, o seguir con el monolito de dos piezas?

### 1.1 Lo que hay hoy

`apps/api` y `apps/web` ya son dos contenedores desplegables por separado
(dos `Dockerfile`, dos imágenes). No es un monolito en el sentido estricto
— es **una API + un frontend**, con Postgres como única fuente de verdad y
S3 como único almacén de archivos. Eso ya es la separación que casi
cualquier arquitectura moderna considera suficiente para un equipo de 2
personas.

### 1.2 Por qué no conviene partir en microservicios ahora

| Razón | Detalle |
|---|---|
| **RLS es la decisión que sostiene todo el aislamiento** | `CONTEXTO-COMPLETO.md` §5.1: el aislamiento entre organizaciones vive en un único Postgres con políticas de fila. Partir en microservicios con bases de datos propias por servicio (el patrón habitual) obliga a rehacer esa disciplina en cada servicio, o a centralizar el acceso a datos detrás de otra capa — ninguna de las dos es gratis, y la decisión de RLS ya está cerrada (§10, "Decisiones ya cerradas"). |
| **El equipo es de 2 personas** | El propio plan de 12 semanas asume 2 personas full-stack, 22 puntos/semana. Microservicios multiplican el número de despliegues, de configuraciones de entorno, de puntos de fallo y de superficies de log — coste operativo que no tiene con quién repartirse. |
| **No hay un cuello de botella que lo justifique** | Partir en servicios se paga cuando una parte del sistema necesita escalar, desplegarse o fallar de forma independiente del resto. Hoy no hay evidencia de eso: la app corre para el equipo interno, en una sola instancia, y el propio roadmap (§7 de `CONTEXTO-COMPLETO.md`) dice que Redis para presencia y límite de peticiones es "el día que haya más de una instancia de API" — no hoy. |
| **Contradice la tesis del producto** | DevUP se vende como la capa que coordina infraestructura ajena sin alojarla (BYOI, §1). Cuantos más servicios propios haya que operar, más se parece DevUP a lo que critica en sus competidores. |
| **Ya existe una costura correcta si hace falta separar algo** | `apps/api/src/realtime/hub.ts` es, por diseño, el único archivo que hay que tocar para respaldar presencia con Redis cuando haya más de una instancia (§5.3). Esa costura ya resuelve el caso real de escalar sin migrar a microservicios. |

**Veredicto: no.** La pregunta correcta no es "microservicios sí o no", es
"¿qué se gana desplegando `api` y `web` en plataformas distintas sin tocar
el código?" — eso sí es barato y ya es posible hoy (ver §1.3).

### 1.3 Lo que sí es razonable: separar plataformas de despliegue sin separar código

`apps/web` (Next.js) y `apps/api` (Fastify) ya son artefactos independientes.
Se pueden desplegar en sitios distintos sin ningún cambio de arquitectura:

| Componente | Dónde | Por qué |
|---|---|---|
| `apps/web` | Vercel o Cloudflare Pages | Next.js corre nativo ahí, CDN de borde gratis, cero mantenimiento |
| `apps/api` + Postgres + MinIO/R2 | VPS (o Postgres gestionado aparte) | Necesita WebSocket persistente (`/ws/voice`, `/ws/files`, `/ws/world`) y acceso directo a Postgres — eso no encaja bien en el modelo serverless de un Vercel/Pages |

**El obstáculo real de este split, y por qué no es el movimiento de esta
fase:** las cookies de sesión. `COOKIE_SECURE=true` en producción, y si
`apps/web` vive en `algo.vercel.app` y `apps/api` en `api.hytrex.co`, son
dominios de nivel superior distintos (*cross-site*, no solo *cross-origin*).
Eso exige `SameSite=None` en la cookie y choca con el bloqueo de cookies de
terceros que Chrome y Safari ya aplican por defecto — el login dejaría de
funcionar de forma intermitente y difícil de diagnosticar. Si se quiere este
split, hace falta que `web` cuelgue de un subdominio del **mismo dominio
raíz** que `api` (p. ej. `app.hytrex.co` en Vercel + `api.hytrex.co` en el
VPS) — técnicamente viable, pero es una optimización futura, no la prioridad
de esta fase. **Recomendación: mantener `web` y `api` juntos detrás del
mismo túnel/dominio**, tal como ya lo describe `docker-compose.prod.yml`
(`hytrex.co` → web, `api.hytrex.co` → api, mismo dominio raíz, cookies ya
correctas).

---

## 2. VPS: opciones y recomendación

`DESPLIEGUE.md` ya documenta la variante **sin VPS** (Cloudflare Tunnel,
sin abrir puertos, TURN gestionado con Metered.ca). Esa es la variante más
segura por diseño —nunca hay un puerto de entrada expuesto— y no cambia.
La pregunta que falta responder es **dónde corre la máquina que aloja los
contenedores** detrás de ese túnel.

### 2.1 Opciones de pago

| Proveedor | Precio orientativo (2 vCPU / 4 GB) | Dónde | A favor | En contra |
|---|---|---|---|---|
| **Hetzner Cloud (CX22)** | ~€4.50/mes | Solo UE (Alemania, Finlandia) | Mejor relación precio/rendimiento del mercado; red estable; soporte decente | Sin región en Latinoamérica — la latencia importa poco aquí porque es tráfico del propio equipo, no de clientes finales |
| **Vultr** | ~$12–20/mes | Incluye São Paulo | Región LatAm real si el equipo opera desde ahí; buena red | Más caro que Hetzner por recurso equivalente |
| **DigitalOcean** | ~$18–24/mes | Global, incl. NYC/SFO | Documentación y comunidad enormes, `doctl`, imágenes listas | Más caro que Hetzner/Vultr por el mismo recurso |
| **Contabo** | ~€5–7/mes | UE, EE.UU. | Recursos muy baratos por núcleo/RAM | Red y soporte notoriamente peores; políticas de abuso estrictas; no recomendado para algo que se quiere estable |
| **AWS Lightsail / Google Compute e2** | ~$10–15/mes en adelante | Global | Ruta natural si luego se quiere escalar a RDS/S3 gestionados del mismo proveedor | Más complejidad de IAM/red de la que hace falta para un solo droplet; más caro |

**Recomendación de pago:** **Hetzner CX22** para empezar (o **Vultr São
Paulo** si la latencia del equipo importa más que el precio). Ninguno de
los dos requiere cambiar nada de lo que `docker-compose.prod.yml` ya asume.

### 2.2 Opciones gratuitas — cuáles son reales y cuáles no

La mayoría de los "planes gratis" de VPS son en realidad créditos con
fecha de caducidad (12 meses y luego se cobra), no gratuidad permanente.
Conviene distinguirlos antes de construir nada encima:

| Proveedor | Qué ofrece gratis | ¿Permanente? | ¿Alcanza para todo el stack? |
|---|---|---|---|
| **Oracle Cloud "Always Free"** | Hasta 4 núcleos ARM Ampere A1 + 24 GB de RAM (repartibles en 1 a 4 instancias), más 2 micro-VMs AMD de 1 GB cada una | **Sí, sin fecha de caducidad** — es el único "siempre gratis" de verdad entre los grandes proveedores | **Sí, con margen de sobra.** Postgres + MinIO + API + web + coturn corren cómodos en 24 GB — muy por encima de lo que pide el CX22 de pago |
| **Google Cloud "Always Free"** | 1 instancia `e2-micro` (1 vCPU compartida, 1 GB RAM), solo en regiones concretas de EE.UU. | Sí, permanente | No — 1 GB no alcanza para Postgres + MinIO + API + web + coturn a la vez; serviría solo para una pieza suelta |
| **AWS Free Tier** | `t2.micro`/`t3.micro` | **No** — 12 meses, luego se factura | No recomendable para algo que se piensa mantener |
| **Azure Free** | B1S burstable | **No** — 12 meses de crédito, luego un B1S permanente pero muy limitado (1 GB RAM) | No — insuficiente para el stack completo |
| **Fly.io / Railway (capas gratis)** | Máquinas pequeñas, con cuotas que cambian con frecuencia | Variable — estos planes se han recortado varias veces en los últimos años | Riesgoso construir sobre algo que puede cambiar de condiciones sin aviso |

**Nota técnica que hace viable la opción de Oracle en este proyecto en
concreto:** ninguna imagen del repo está anclada a `amd64` —
`node:22-alpine` en ambos `Dockerfile` es multi-arquitectura, y tanto
`coturn` como `minio` tienen imágenes ARM oficiales. No hace falta tocar
ni una línea de los `Dockerfile` ni de `docker-compose.prod.yml` para
correr todo el stack sobre un VPS ARM.

### 2.3 La advertencia importante sobre usar gratis en producción

Oracle Cloud es conocido por **suspender cuentas "Always Free" sin previo
aviso** cuando su sistema detecta inactividad, uso considerado atípico, o
simplemente por decisión unilateral de riesgo — hay bastantes casos
documentados de esto en la comunidad. Para un entorno de pruebas o de
desarrollo, ese riesgo es aceptable. **Para producción real, una vez que la
bóveda de credenciales (`connections`/`connection_secrets`) empiece a
guardar tokens reales de clientes (GitHub, Spotify, y en el futuro
Anthropic — ver el otro documento de este mismo tramo), ese riesgo deja de
ser aceptable**: una suspensión sin aviso es indistinguible de una fuga de
disponibilidad total, y no hay manera de apelarla con la urgencia que un
cliente esperaría.

**Recomendación concreta:**
- **Usar Oracle Free Tier para el entorno de pruebas o el primer piloto
  interno** (las dos semanas de uso real que ya son el siguiente paso del
  proyecto, según `CONTEXTO-COMPLETO.md` §7) — es gratis, permanente, y
  sobra en recursos.
- **Migrar a un VPS de pago (Hetzner o Vultr) antes de que haya un solo
  cliente externo o una sola credencial ajena real en la bóveda.** El coste
  —menos de €5 al mes— es irrelevante comparado con el riesgo de una
  suspensión unilateral con datos de producción dentro.

### 2.4 Postgres: ¿contenedor propio o gestionado?

Con equipo de 2 personas, la recomendación es moverlo a un Postgres
gestionado (p. ej. **Neon**, que ya se menciona en `DESPLIEGUE.md` como
opción) en cuanto el uso real empiece: backups automáticos y *point-in-time
recovery* sin que nadie tenga que mantenerlo, a un coste marginal comparado
con el tiempo de alguien configurando `pg_dump` a mano. Neon también tiene
un plan gratis razonable para la fase de pruebas, con las mismas dos
advertencias que arriba: bien para piloto, no para producción con
credenciales reales de clientes sin revisar antes sus límites y su SLA.
**Importante:** el rol `devup_app` sigue sin ser propietario de las tablas
exactamente igual en un Postgres gestionado — eso no cambia con el
proveedor (§5.1).

---

## 3. Seguridad: lo que ya está bien vs. lo que falta

Lo que **ya** hace bien este proyecto (no hay que tocarlo): contenedores
sin root (`USER devup` en ambos `Dockerfile`), imágenes multietapa sin
TypeScript ni devDependencies en producción, `helmet` en la API, secretos
de TURN nunca en `NEXT_PUBLIC_*`, bucket privado con URL firmada, doble rol
de base de datos, `AUTH_SECRET`/`COOKIE_SECURE`/`APP_BASE_URL` bloqueando el
arranque en producción si están mal.

Lo que falta, ordenado por impacto:

| Falta | Por qué importa | Coste de arreglarlo |
|---|---|---|
| **Cortafuegos + SSH endurecido en la VPS** | `DESPLIEGUE.md` no dice nada del sistema operativo del host: `ufw` con solo el puerto SSH abierto (el túnel de Cloudflare no necesita 80/443), acceso solo por clave, `fail2ban`, actualizaciones automáticas de seguridad. Con Cloudflare Tunnel, SSH del host es la única puerta de entrada directa que queda | Bajo — un script de una tarde |
| **Copias de seguridad automatizadas y probadas** | `DESPLIEGUE.md` dice "prueba la restauración, no la copia" pero no da ningún mecanismo — no hay cron de `pg_dump`, ni destino (R2/S3), ni retención | Bajo-medio |
| **Pipeline de despliegue** | `ci.yml` solo prueba y compila; no hay job que construya y publique imágenes a un registro, ni que las despliegue. Hoy "desplegar" es `docker compose --build` a mano en el servidor — sin registro de imágenes no hay forma fácil de hacer *rollback* a la versión anterior | Medio |
| **Rotación de secretos, en particular `VAULT_MASTER_KEY`** | `env.ts` ya bloquea el arranque si sigue con el valor de ejemplo, pero no existe ningún procedimiento para *rotar* la clave sin perder lo ya cifrado en `connection_secrets`. Hoy, perder o cambiar `VAULT_MASTER_KEY` sin migrar antes = todas las credenciales guardadas (GitHub, Spotify) quedan indescifrables para siempre | Medio — hay que escribir un script de re-cifrado, decidirlo antes de que haya credenciales reales en producción |
| **Sin métricas ni trazas** | Ya reconocido en `DESPLIEGUE.md` §"Lo que todavía no está resuelto". Sin esto, un incidente de seguridad (acceso indebido, fuga) se detecta solo si alguien mira los logs de stdout a mano | Medio — algo como Grafana Cloud gratuito, o simplemente exportar logs a un sitio con retención y alerta |
| **Sin entorno de staging** | El checklist de después-de-desplegar (§"Después de levantarlo") se ejecuta directamente contra producción. Un entorno de prueba desechable evitaría estrenar el checklist en la instancia real | Bajo-medio |
| **Sin escaneo de imágenes / `npm audit` en CI** | Nada en `ci.yml` corre `npm audit` ni escanea las imágenes Docker en busca de CVEs conocidas | Bajo — un job más en el workflow |

---

## 4. Actualización propuesta para `DESPLIEGUE.md`

Los puntos de la tabla anterior deberían pasar de "documento de decisión"
a una sección accionable dentro de `docs/DESPLIEGUE.md`, con el mismo tono
directo que ya usa el documento (qué hacer, no solo qué falta). Concretamente
propongo añadir, tras "Lo que todavía no está resuelto":

- Un bloque **"Endurecer el host"** con los comandos de `ufw`/`fail2ban`/
  actualizaciones automáticas para la variante con VPS propia.
- Un bloque **"Copias de seguridad"** con un `cron` de ejemplo que hace
  `pg_dump` cifrado a R2/S3 cada noche y purga lo anterior a N días.
- Una nota explícita sobre que `VAULT_MASTER_KEY` no tiene recuperación —
  ya está implícito en `.env.example`, pero no en `DESPLIEGUE.md`, que es
  donde alguien desplegando por primera vez realmente lee.
- Una nota sobre las opciones gratis (§2.2–2.3 de este documento): válidas
  para pruebas, no para producción con credenciales reales.

---

## 5. Decisiones propuestas

- **No migrar a microservicios.** Revisar esta decisión únicamente si
  aparece una necesidad real de escalar una pieza de forma independiente
  del resto — y en ese caso, empezar por `apps/api/src/realtime/hub.ts` +
  Redis, no por partir en servicios nuevos.
- **VPS para pruebas/piloto: Oracle Cloud Always Free** (ARM, 4 núcleos /
  24 GB, gratis y permanente).
- **VPS para producción real: Hetzner CX22** (o Vultr São Paulo si la
  latencia hacia LatAm pesa más que el precio) — migrar antes de que haya
  una sola credencial de cliente ajena en la bóveda.
- **Postgres:** empezar en contenedor propio (como ya está), migrar a Neon
  en cuanto el despliegue real empiece.
- Actualizar `DESPLIEGUE.md` con los puntos de §4 antes de considerar el
  despliegue "listo para exponerse a internet" en el sentido estricto que
  el propio documento se propone.

## Preguntas abiertas

1. ¿Se aprueba usar Oracle Free Tier para las dos semanas de piloto interno,
   con el compromiso explícito de migrar a Hetzner antes de sumar clientes
   externos?
2. ¿Postgres gestionado desde ya, o esperar a que termine el periodo de
   prueba interno para no gastar en algo que podría no necesitarse todavía?
3. ¿Quién es dueño de escribir y probar el script de rotación de
   `VAULT_MASTER_KEY` antes de que haya credenciales reales de clientes en
   la bóveda?
