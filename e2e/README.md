# Prueba de punta a punta de la oficina

Levanta la pila real —Postgres, la API y Next—, crea una cuenta por la API,
entra por el formulario y recorre la oficina con dos pestañas.

**Existe porque encontró cosas que nada más las encontraba.** Los tipos, las
45 comprobaciones de aislamiento, las 13 del socket y las capturas del
renderizador aislado estaban todas en verde mientras la aplicación entera
entraba en un bucle infinito de renderizado al abrir la oficina. Tres fallos
salieron de aquí:

| Síntoma | Causa |
|---|---|
| `Maximum update depth exceeded`, cientos por segundo | Un efecto con `leaveChannel` como dependencia, y `leaveChannel` se recrea en cada renderizado del proveedor |
| Se veían seis casillas en pantalla | La cámara a 2× la densidad del dispositivo; en el renderizador aislado la cámara la fija la propia prueba |
| Se aparecía en un descampado | El punto de aparición era el centro geométrico de la planta, que con pocos canales está vacío |

No está en CI: necesita los dos servidores levantados y Chromium, y eso es
más de lo que justifica una comprobación por cada push. Se corre a mano
antes de tocar la vista inmersiva.

## Cómo se corre

```bash
npm run dev                       # API en :4000, web en :3000
npm install --no-save playwright  # no es dependencia del proyecto

node e2e/sembrar.mjs              # imprime email, contraseña y workspaceId
node e2e/oficina.mjs <email> <contraseña> <workspaceId> x /ruta/para/capturas
```

`sembrar.mjs` crea una organización, un workspace y cinco canales con nombres
que disparan los cinco temas de sala (desarrollo, música, videojuegos, general
y reunión), que es lo que hace falta para mirar si el amueblado tiene sentido.

## Qué comprueba

- Que se puede entrar con el formulario de acceso.
- Que la oficina carga y el lienzo se dibuja.
- Que la cabecera dice cuánta gente hay dentro.
- Que se camina con el teclado.
- **Que con dos pestañas la cabecera pasa a «2 en la oficina»** — la presencia
  funcionando de verdad contra el socket, no un mensaje fijo.
- Que el editor de personaje abre.
- Que no hay ni un error de consola en todo el recorrido.

Deja capturas en la ruta que se le pase. Mirarlas es parte de la prueba: el
zoom y el punto de aparición no fallaban, se veían mal, y eso ninguna
aserción lo dice.
