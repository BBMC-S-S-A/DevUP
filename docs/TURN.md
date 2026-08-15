# TURN: lo único que separa la voz de funcionar de verdad

Sin TURN, DevUP conecta la llamada, la interfaz dice «en directo», los
participantes aparecen en pantalla… y no se oye nada. Todo lo demás funciona,
que es justo lo que lo hace tan difícil de diagnosticar.

Este documento explica por qué pasa, cómo levantarlo en local y qué hay que
hacer distinto en producción.

---

## Por qué hace falta

WebRTC intenta que los dos extremos hablen **directamente**. Para eso necesita
descubrir por qué dirección y puerto es alcanzable cada uno:

- **STUN** solo pregunta «¿cómo me ven desde fuera?». Es gratis y basta cuando
  el NAT de ambos extremos asigna un puerto público estable.
- **TURN** es un **relé**: cuando no hay camino directo, el audio pasa por él.
  Cuesta ancho de banda, y por eso solo se usa cuando hace falta.

Los casos donde STUN no basta no son raros:

| Situación | Qué pasa |
|---|---|
| NAT simétrico | El NAT abre un puerto distinto por cada destino, así que lo que STUN averiguó no sirve para el otro par |
| Redes móviles (CGNAT) | Miles de abonados comparten IP pública; el operador no deja entrar conexiones nuevas |
| Redes corporativas | El cortafuegos bloquea UDP saliente salvo a puertos conocidos |
| VPN corporativa | El tráfico sale por un extremo que no coincide con lo que descubrió STUN |

Entre dos portátiles de la misma oficina casi siempre funciona sin TURN. Fuera
de ahí, **la mitad de las llamadas o más van a fallar**.

---

## En local

Ya está en `docker-compose.yml`:

```bash
docker compose up -d coturn
```

Y en `.env`, descomenta:

```bash
NEXT_PUBLIC_TURN_URL=turn:localhost:3478
NEXT_PUBLIC_TURN_USERNAME=devup
NEXT_PUBLIC_TURN_CREDENTIAL=devup-turn-local
```

Sirve para comprobar que el camino de relé funciona. **No lo expongas a
internet**: usa una credencial fija, sin TLS, y con eso cualquiera que la lea
tiene un relé gratis pagado por ti.

### Comprobar que el relé se usa de verdad

En `chrome://webrtc-internals`, con una llamada abierta, busca el par de
candidatos activo. Si el tipo es `relay`, el audio va por TURN. Si es `host` o
`srflx`, va directo y TURN no llegó a hacer falta.

Para forzar el relé y comprobar que funciona, cambia temporalmente en
`buildIceConfig()` (`apps/web/src/lib/voice/useVoiceRoom.ts`) la configuración
para incluir `iceTransportPolicy: "relay"`. Si con eso la llamada sigue
oyéndose, TURN está bien puesto.

---

## En producción

Tres cosas cambian, y las tres importan.

### 1. Credenciales temporales, nunca fijas

Una credencial fija en `NEXT_PUBLIC_*` **acaba en el bundle de JavaScript**, que
cualquiera puede leer. Es un relé abierto a internet con tu factura de ancho de
banda.

Lo correcto es el mecanismo de credenciales de tiempo limitado de coturn: la
API firma un usuario efímero con un secreto compartido que el navegador nunca
ve.

```
--use-auth-secret --static-auth-secret=<secreto largo>
```

Y en la API, un endpoint que devuelva credenciales válidas unas horas:

```ts
// username = <caducidad unix>:<userId>
// password = base64(hmac_sha1(secreto, username))
const username = `${Math.floor(Date.now() / 1000) + 12 * 3600}:${userId}`;
const password = createHmac("sha1", TURN_SECRET).update(username).digest("base64");
```

El frontend las pide al entrar en la sala en vez de leerlas del entorno. **Ya
está implementado**: lo sirve `GET /calls/ice-servers`
(`apps/api/src/routes/ice.ts`). Basta con poner `TURN_SECRET` y `TURN_URLS`; si
hay `TURN_SECRET`, la rama de credencial fija ni se toca, y `env.ts` aborta el
arranque en producción si se intenta lo contrario.

El usuario emitido es `<caducidad>:<userId>`, no un genérico: si hay que
investigar un abuso del relé, los registros de coturn dicen de quién era la
credencial.

### 2. TLS y el puerto 443

Las redes más restrictivas —hoteles, oficinas, aeropuertos— solo dejan salir
tráfico por 443. Un TURN escuchando también en `turns:` sobre 443/TCP es lo que
salva esas llamadas:

```
--listening-port=3478
--tls-listening-port=443
--cert=/etc/letsencrypt/live/turn.tu-dominio/fullchain.pem
--pkey=/etc/letsencrypt/live/turn.tu-dominio/privkey.pem
```

En el cliente se declaran los dos, y el navegador elige:

```
NEXT_PUBLIC_TURN_URL=turn:turn.tu-dominio:3478,turns:turn.tu-dominio:443
```

### 3. Restringir hacia dónde puede abrir conexiones

TURN es un proxy. Sin restricciones, quien tenga una credencial puede pedirle
que abra conexiones **hacia tu red interna** — bases de datos, paneles de
administración, el metadata endpoint del proveedor de nube.

Los `--denied-peer-ip` del `docker-compose.yml` ya cubren los rangos privados.
En la nube, añade también el rango de metadatos:

```
--denied-peer-ip=169.254.0.0-169.254.255.255
```

---

## Cuánto cuesta

TURN solo interviene cuando no hay camino directo, y en la mayoría de las redes
sí lo hay. Una regla de dedo razonable: **entre el 10 % y el 20 % de las
llamadas** acaban por relé.

Con audio a ~40 kbps por sentido, una llamada de dos personas relevada gasta
unos 36 MB a la hora. Con vídeo a 720p sube a unos 30–40 veces más. Un servidor
pequeño aguanta muchas llamadas simultáneas; lo que se paga es el tráfico.

**Alternativas gestionadas** si no se quiere operar el servidor: Cloudflare
Calls, Twilio Network Traversal, Metered. Encajan bien con la tesis del
producto —no es infraestructura del cliente, es una pieza de la nuestra— y
evitan una guardia más.

---

## Cuando se migre a SFU

Un SFU (LiveKit, mediasoup) suele traer su propio TURN integrado, y entonces
este documento se queda en la parte de por qué hace falta. Pero ojo con lo que
se pierde por el camino: **con un SFU el audio deja de ir cifrado extremo a
extremo**, aunque nadie tome esa decisión explícitamente. Ver
[`decisiones/0001-cifrado-de-salas.md`](decisiones/0001-cifrado-de-salas.md).
