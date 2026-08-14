# 0001 · Cifrado de las salas y cómo se graba

**Estado:** decidido · **Fecha:** agosto de 2026 · **Sustituye a:** la decisión
abierta de §5.5 de `CONTEXTO-COMPLETO.md`

---

## Decisión

**Todas las salas van cifradas extremo a extremo, siempre. La grabación ocurre
en el navegador de un participante, nunca en el servidor, y requiere que todos
los presentes den su permiso.**

No hay modos de sala. No hay una «sala grabable» con menos cifrado al lado de
una «sala privada». Una sola promesa, la misma en toda la aplicación.

---

## El problema

El cifrado extremo a extremo y la grabación en servidor **se excluyen
mutuamente**. Si el audio va cifrado de punta a punta, el servidor solo ve
paquetes opacos y no puede grabar; si puede grabar es porque tiene la clave, y
entonces no es extremo a extremo por mucho que se le llame así.

No es un detalle de implementación que se pueda dejar para después: es una
promesa que se le hace al usuario, y una promesa de seguridad falsa cuesta más
que una funcionalidad ausente.

## Lo que ya era cierto antes de decidir nada

En una malla WebRTC el audio va cifrado entre pares con DTLS-SRTP y **no pasa
por ningún servidor de DevUP**. La arquitectura que ya teníamos era, de hecho,
extremo a extremo — sin habérnoslo propuesto y sin haberlo anunciado.

Es decir: la pregunta real no era «¿ciframos?», sino «¿renunciamos al cifrado
que ya tenemos gratis para poder grabar?».

## Las tres salidas que había sobre la mesa

### 1. Grabar en el cliente — **la elegida**

Un participante designado graba localmente y sube el archivo. Preserva el
cifrado y no necesita infraestructura nueva.

### 2. Sala sin cifrado extremo a extremo

Cifrado en tránsito y en reposo, con el servidor capaz de grabar. Es lo que
hacen Zoom y Meet por defecto, y es defendible mientras se diga con claridad.

**Descartada**, y no por purismo. Para que un servidor pueda grabar, el audio
tiene que pasar por él: hace falta un SFU o un servidor de medios. Y eso choca
de frente con la regla permanente del producto:

> Si una funcionalidad exige que DevUP mantenga un proceso corriendo, un puerto
> abierto o un disco montado **en nombre del cliente**, está fuera de alcance
> por definición.

Un servidor de medios es exactamente eso: un proceso que hay que alojar, operar,
dimensionar y pagar, con guardias de disponibilidad, para transportar el audio
de otros. Añadirlo para tener grabación sería la primera excepción táctica a la
regla, y la que abre la puerta a las siguientes.

### 3. Participante grabador con clave

Un «bot» del lado servidor entra en la sala como un par más y recibe la clave
de sesión. Conserva la arquitectura de malla pero rompe la promesa: hay una
copia del audio en claro en un servidor nuestro.

**Descartada.** Es la opción que peor envejece: técnicamente parece elegante y
comunicativamente es una trampa. Con ella habría que decir «extremo a extremo,
salvo cuando no».

---

## Por qué la 1 es la correcta para este proyecto

**Es la única coherente con lo que DevUP dice ser.** El producto se vende como
la capa que coordina infraestructura ajena, no como quien la aloja. Grabar en
el cliente es la versión de la grabación que respeta esa tesis: el cómputo
ocurre donde ya está el audio.

**Coste de infraestructura: cero.** Ni SFU, ni almacenamiento intermedio, ni
ancho de banda de servidor. El archivo va del navegador al almacén con una URL
firmada, igual que cualquier otro.

**Superficie regulatoria pequeña.** Nunca custodiamos audio en claro. Ante una
pregunta incómoda —una orden judicial, una auditoría, una filtración— la
respuesta es que no tenemos el contenido, y es verdad.

**La promesa es simple y se puede decir en una frase.** «Las llamadas van
cifradas entre los participantes; DevUP no las puede oír ni grabar.» Sin
asteriscos, sin modos, sin letra pequeña.

---

## Lo que cuesta, dicho sin adornos

Ninguna de estas cosas es un defecto que se vaya a arreglar solo. Son el precio
de la decisión y hay que contarlas al usuario:

- **La grabación depende de quien graba.** Si cierra la pestaña, se le cae la
  red o se le duerme el portátil, se pierde. El archivo vive en su memoria
  hasta que pulsa detener.
- **Es lo que esa persona oyó.** Si el audio de alguien no le llegaba bien,
  tampoco estará bien en la grabación.
- **Solo audio, de momento.** Componer varios vídeos en un canvas mientras el
  mismo navegador sostiene la malla cuesta más de lo que aporta. Cuando haga
  falta, el sitio es `apps/web/src/lib/voice/recorder.ts`.
- **No impide que alguien grabe por su cuenta.** Ningún sistema lo impide: con
  un móvil apuntando a la pantalla basta. Lo que sí se consigue es que grabar
  *dentro de DevUP* sea siempre explícito, visible y anotado.

---

## El consentimiento, y por qué es unánime

Como grabar deja de ser una capacidad del sistema y pasa a ser un acto de una
persona, hace falta que sea un acuerdo:

1. Quien quiere grabar lo pide. Pedirlo ya cuenta como su consentimiento.
2. A todos los demás les sale un diálogo que bloquea, con dos salidas:
   aceptar o salir de la llamada.
3. **Un solo «no» cancela la grabación para todos.** No existe la grabación
   parcial: en una malla, quien graba recibe el audio de todos, así que
   «grabo solo a los que dijeron que sí» no se puede cumplir. Prometerlo sería
   otra promesa falsa.
4. Mientras se graba, todos ven un indicador rojo permanente.
5. Quien entra a una llamada que ya se está grabando pasa por el mismo diálogo.
   Llegar tarde no es consentir.
6. Cada respuesta queda guardada en `call_recording_consents`, con nombre y
   marca de tiempo. Esa tabla no tiene política de UPDATE ni de DELETE: una vez
   dicho que sí o que no, esa fila es prueba y no se reescribe.

La grabación termina en la biblioteca de archivos del canal, como un archivo
más: mismas políticas de acceso, misma URL firmada con caducidad, mismo
borrado.

---

## Cuándo habría que reabrir esto

- **Si un cliente exige grabación garantizada por contrato** — con retención,
  disponibilidad y responsabilidad sobre el archivo. Ahí la opción 2 vuelve a
  la mesa, pero como *producto distinto* con su propia promesa, no como un
  ajuste de este.
- **Cuando la malla se quede corta y haya que meter un SFU** por razones de
  escala. Si ya hay un servidor de medios en el camino, el coste marginal de
  grabar en él es bajo y el cálculo cambia. **Ojo: en ese momento el cifrado
  extremo a extremo se pierde por la puerta de atrás**, aunque nadie lo decida
  explícitamente. Habrá que decirlo antes de desplegarlo, no después.
