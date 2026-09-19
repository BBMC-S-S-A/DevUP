# Cómo trata DevUP tus datos

_Borrador del 19 de septiembre de 2026. Responde, una por una, las doce preguntas
que nos hizo GESTEK (Develovers)._

**Cómo leer este documento.** Cada respuesta dice qué hacemos, de dónde sale y en
qué estado está: **Sí**, **Parcial**, **No** o **Por confirmar**. Cuando algo no
lo hacemos, lo decimos así. Ninguna respuesta afirma algo que no hayamos
comprobado en el código o en la configuración.

**Qué falta para que deje de ser borrador.** Las respuestas marcadas «Por
confirmar» dependen de la configuración de nuestros proveedores (sobre todo la
región y el cifrado en reposo de Railway). Juan Bonilla las está comprobando.
Hasta entonces no hay que leerlas como garantía.

---

## Resumen

| # | Pregunta | Estado |
|---|---|---|
| 1 | Cifrado en tránsito | Sí |
| 2 | Cifrado en reposo | Parcial · por confirmar |
| 3 | Aislamiento entre organizaciones | Sí, con una excepción que estamos cerrando |
| 4 | Acceso interno del equipo de DevUP | Parcial |
| 5 | Adjuntos | Sí |
| 6 | Tokens del conector MCP | Parcial |
| 7 | Modelos de IA | Sí |
| 8 | Retención y borrado | Parcial |
| 9 | Copias y recuperación | Parcial |
| 10 | Incidentes | No |
| 11 | Ubicación de los datos | Por confirmar |
| 12 | Registro de auditoría | Parcial |

**Lo más importante que hay que saber hoy:**

1. **La consola SQL de un espacio deja escribir a cualquier miembro.** Hoy,
   cualquier persona con acceso a un espacio puede ejecutar cualquier sentencia
   contra la base de datos conectada a ese espacio, incluidas las que borran.
   Estamos restringiéndola a quien administra el espacio y a solo lectura. Plazo:
   26 de septiembre.
2. **Borrar una organización no borra sus archivos del almacén.** Se borran sus
   datos de la base, pero los archivos subidos quedan guardados.
3. **No existe todavía una forma de borrar tu cuenta.**
4. **Los datos están, casi con seguridad, fuera de Colombia.** Ver pregunta 11.

---

## 1. Cifrado en tránsito — **Sí**

Todo el tráfico entre tu navegador y DevUP va cifrado con TLS:

- la web, servida por Cloudflare;
- la API y el servidor MCP, en `api.hytrex.co`;
- el tiempo real, por `wss://`.

La API **se niega a arrancar en producción** si la cookie de sesión no va marcada
como segura o si la dirección pública es `http://` (`apps/api/src/env.ts`).

- **Llamadas de voz y vídeo:** van cifradas de extremo a extremo entre los
  participantes (DTLS-SRTP). El audio y el vídeo no pasan por nuestros
  servidores, y por eso no los podemos grabar ni escuchar.
- **Base de datos:** entre la API y la base, el tráfico va por la red privada de
  Railway. Esa conexión no usa TLS propio; nos apoyamos en que la red privada del
  proveedor ya va cifrada entre servicios. Lo explica
  `apps/api/src/db/conexion.ts`.
- **Webhooks:** DevUP no recibe webhooks hoy.
- **Versión mínima de TLS:** la fijan Cloudflare y Railway, no nosotros. **Por
  confirmar** que sea 1.2 o superior.

## 2. Cifrado en reposo — **Parcial · por confirmar**

- **Credenciales de terceros** (tokens de GitHub, Railway, Spotify, claves de IA,
  cadenas de conexión a tu base): cifradas por DevUP con AES-256-GCM antes de
  guardarse. La clave maestra vive como variable de entorno en Railway, separada
  de la base. Un volcado de la base sin esa clave no abre la bóveda. Hay un
  guion para rotarla (`scripts/rotar-clave-boveda.mjs`).
- **Base de datos y archivos:** están en Railway, en un Postgres y un MinIO
  gestionados. Si el disco está cifrado depende de Railway. **Por confirmar.**
  DevUP no añade cifrado propio a los datos de tus tareas, mensajes o archivos.
- **Copias de seguridad:** cifradas con AES-256 antes de salir del servidor. Ver
  la pregunta 9.
- **Llave propia de la organización (BYOK):** no existe.

## 3. Aislamiento entre organizaciones — **Sí, con una excepción que estamos cerrando**

El aislamiento lo hace **la base de datos, no el código de la aplicación**. Cada
consulta se ejecuta con la identidad de quien la pide, y Postgres decide fila por
fila qué puede ver (Row Level Security). Un fallo en el código de una pantalla no
puede enseñar datos de otra organización, porque no es ese código quien decide.

Hay una prueba automática con **304 comprobaciones de aislamiento**
(`apps/api/src/db/isolation.test.ts`). Corre contra un Postgres real en cada
cambio del código, y el cambio no entra si una sola falla.

El asistente de IA de DevUP y el conector MCP usan esa misma frontera: un agente
ve exactamente lo que vería la persona que lo conectó, y nada más.

**La excepción:** la consola SQL de un espacio. Su problema no es entre
organizaciones sino dentro de una misma: cualquier miembro puede escribir en la
base conectada al espacio. Ver el resumen.

## 4. Acceso interno del equipo de DevUP — **Parcial**

Hoy el equipo de DevUP son **dos personas**, Juan Medina y Juan Bonilla. Las dos
tienen acceso administrativo a la infraestructura (Railway, GitHub) y, por tanto,
técnicamente podrían ver el contenido de cualquier organización.

- **No existe un registro** de cuándo alguien del equipo accede a la base de
  producción con permisos de administrador.
- **No hay una regla escrita** de en qué casos podemos mirar tu contenido.
  Nuestra práctica es no hacerlo salvo para resolver un problema que tú nos
  pidas resolver. Esto es una práctica, no un control.
- Una persona que formó parte del equipo hasta el 19 de septiembre está en
  proceso de retirada de los accesos.

## 5. Adjuntos — **Sí**

Las imágenes y archivos se guardan en un almacén privado. Tanto para subirlos
como para verlos, DevUP genera un **enlace firmado que caduca a los 15 minutos**
(`apps/api/src/storage/s3.ts`). No hay enlaces públicos permanentes.

Un enlace firmado lo puede abrir cualquiera que lo tenga mientras no caduque. Si
lo copias y lo compartes, se puede ver durante esos 15 minutos.

**Por confirmar** en el proveedor que el almacén esté configurado como privado.

## 6. Tokens del conector MCP — **Parcial**

Un agente se conecta a DevUP de dos formas:

- con una **conexión de agente** creada en Ajustes → Conexiones de agente;
- por **OAuth**, con PKCE, al usar la dirección del servidor MCP.

Qué hay hoy:

- **Caducidad:** una conexión de agente dura 30 días y se renueva sola mientras
  se usa.
- **Revocación:** se revoca una a una desde Ajustes, sin afectar a las demás
  conexiones ni a tu sesión.
- **Rastro:** el registro de actividad guarda, en cada hecho, quién lo pidió y
  si lo hizo la persona o su agente. Ese registro no se puede editar.

Qué **no** hay todavía:

- **Alcance:** un token tiene **todos los permisos de la persona** que lo creó.
  No se puede limitar a un espacio ni a solo lectura. Está en el plan, después de
  decidir los niveles de permiso de un agente (plazo de la decisión: 3 de
  octubre).
- **Qué hizo cada token:** hoy se registra si una acción la hizo un agente, no
  con qué token.

## 7. Modelos de IA — **Sí**

**DevUP no envía tu contenido a ningún proveedor de IA por su cuenta.** La
búsqueda usa la búsqueda de texto de Postgres, no un modelo.

Hay dos casos en los que tu contenido llega a un modelo, y los dos los decides
tú:

- **El asistente de DevUP.** Usa **tu propia clave**, guardada cifrada en la
  bóveda. DevUP no tiene clave propia ni paga inferencia. Admite dos
  proveedores:
  - **Anthropic:** según su política comercial, no entrena con lo que se le
    envía por API.
  - **Google Gemini en su capa gratuita:** Google puede usar ese contenido para
    mejorar sus productos. Si tus tareas contienen datos de clientes, no uses la
    capa gratuita.
- **Tu propio agente conectado por MCP** (Claude, ChatGPT u otro): recibe lo que
  te devuelven las herramientas, bajo el contrato que tú tengas con ese
  proveedor.

## 8. Retención y borrado — **Parcial**

Qué se borra y cuándo:

- **Una tarea, un mensaje o un archivo:** se borran de la base al momento. Un
  archivo borrado desde su pantalla también se borra del almacén.
- **Un espacio o una organización:** al borrarlos se borran sus datos de la base.
  **Sus archivos quedan en el almacén**, porque borrar la organización no los
  toca. Estamos corrigiéndolo.
- **Tu cuenta:** no hay todavía una forma de borrarla. Si necesitas que se
  borre, hay que pedirlo y se hace a mano.
- **Registro de actividad:** no se puede editar ni borrar desde la aplicación a
  propósito, para que sirva como historial fiable. Se borra entero al borrar el
  espacio.
- **Copias de seguridad:** lo borrado sigue en las copias hasta **90 días**
  después, que es lo que duran. No se purgan antes.
- **Exportar tus datos:** no existe todavía. Está en el plan.

## 9. Copias y recuperación — **Parcial**

- **Frecuencia:** una copia diaria, a las 04:00 UTC, de la base de datos y del
  almacén de archivos.
- **Cifrado:** cada copia se cifra con AES-256 (GPG) **antes** de salir del
  servidor.
- **Retención:** 90 días.
- **Dónde:** como artefactos de GitHub Actions en el repositorio de DevUP, que es
  **público**. Eso quiere decir que **cualquiera puede descargar las copias
  cifradas**. Sin la contraseña no se pueden abrir, pero su seguridad depende
  entera de esa contraseña. Las credenciales de terceros van, además, cifradas
  con la clave maestra, que no está en la copia. Estamos evaluando mover las
  copias a un almacenamiento privado.
- **Restauración:** existe un guion que prueba a restaurar una copia
  (`scripts/probar-restauracion.sh`). No tenemos medido cuánto tarda una
  restauración completa.
- **Antes de cambiar la estructura de la base** en un despliegue, se hace un
  volcado adicional, aparte del diario.

## 10. Incidentes — **No**

No tenemos un procedimiento escrito para notificar una fuga de datos.

Proponemos este compromiso, **pendiente de aprobar por el equipo**:

- avisar por correo a quien administra cada organización afectada en un máximo de
  **72 horas** desde que lo sepamos;
- contar qué datos se vieron afectados y qué hicimos.

Hasta que se apruebe, no es un compromiso.

## 11. Ubicación de los datos — **Por confirmar**

| Qué | Dónde |
|---|---|
| API, tiempo real, base de datos y almacén de archivos | Railway |
| Web | Cloudflare, que la sirve desde muchos países |
| Copias de seguridad | GitHub |
| Contenido que pasa por el asistente | El proveedor de IA que elijas |

**Por confirmar** en qué región de Railway está la base. **Railway no tiene
región en Colombia**, así que tus datos se guardan fuera del país.

Para datos personales de personas en Colombia (Ley 1581 de 2012), eso es una
transferencia internacional, y tiene requisitos propios. **No somos asesores
legales**; si tratas datos personales de terceros en DevUP, conviene revisarlo
con quien te asesore.

## 12. Registro de auditoría — **Parcial**

DevUP guarda un **registro de actividad** que no se puede editar: quién creó,
movió, cerró, asignó o borró cada tarea, cuándo, y si fue una persona o su
agente. Se ve en la pantalla de Auditoría y en la historia de cada tarea.

Qué **no** registra:

- **lecturas:** quién abrió o leyó qué;
- **inicios de sesión;**
- **cambios fuera del tablero:** por ejemplo, en canales o archivos, salvo lo que
  cada pantalla cuente.

**No se puede exportar** todavía. Un registro de auditoría completo y exportable
está en el plan.

---

## Lo que estamos arreglando, y cuándo

| Qué | Plazo |
|---|---|
| Restringir la consola SQL a quien administra el espacio, y a solo lectura | 26-sep-2026 |
| Confirmar cifrado en reposo, almacén privado y región con los proveedores | 26-sep-2026 |
| Que borrar una organización borre también sus archivos | 3-oct-2026 |
| Retirar los accesos de quien dejó el equipo | 26-sep-2026 |
| Decidir los niveles de permiso de un agente | 3-oct-2026 |
| Que el MCP marque el texto escrito por terceros como dato y no como orden | 3-oct-2026 |
| Tokens de agente con alcance por espacio y nivel | 10-oct-2026 |
| Aviso al escribir algo que parece un secreto o un dato personal | 17-oct-2026 |
| Auditoría exportable, exportar y borrar un espacio | 19-dic-2026 |

Este documento se actualiza cuando cambia cualquiera de estas respuestas.
