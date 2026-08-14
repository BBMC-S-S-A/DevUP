# DevUP

Centro de mando para la operación comercial y la infraestructura técnica de un
equipo de desarrollo.

La iteración actual cubre: **identidad y multi-tenencia**, **workspaces
compartidos o personales**, **canales**, **llamadas con voz, vídeo y pantalla
compartida**, **grabación con consentimiento**, una **biblioteca de archivos**
con etiquetas, búsqueda y previsualización, un **tablero de tareas** por
workspace, **mensajería de texto** en tiempo real con hilos y no leídos, y
**altas por invitación** con notificaciones.

Documentación:
- [`docs/CONTEXTO-COMPLETO.md`](docs/CONTEXTO-COMPLETO.md) — decisiones, motivos
  y trampas conocidas. Léelo antes de tocar el esquema.
- [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md) — lista de comprobación antes de
  exponerlo a internet.
- [`docs/TURN.md`](docs/TURN.md) — lo único que separa la voz de funcionar
  fuera de una red local.

---

## Puesta en marcha

```bash
cp .env.example .env      # los valores por defecto ya sirven en local
npm install
npm run db:up             # Postgres 17 y MinIO en Docker
npm run db:migrate        # aplica migraciones y privilegios
npm run dev               # API en :4000, web en :3000
```

Comprobación de que el aislamiento entre organizaciones funciona:

```bash
npm run test:rls
```

Levanta dos organizaciones con usuarios distintos y verifica que ninguna ve
nada de la otra. Ninguna de sus consultas lleva `where organization_id`: si RLS
falla, esto se pone rojo.

---

## Cómo está montado

| Pieza | Elección |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript estricto, Tailwind 4 |
| API | Fastify 5, TypeScript |
| Datos | Postgres 17 con RLS, acceso directo con `pg` |
| Archivos | Almacén compatible con S3 (MinIO en local; R2, S3 o el bucket del cliente en producción) |
| Tiempo real | WebSocket propio para señalización y presencia |
| Voz | WebRTC en malla, sin servidor de medios |

```
apps/api      API, señalización y almacenamiento
apps/web      interfaz
db/migrations esquema, en orden
db/grants.sql privilegios del rol de la aplicación
```

### Lo que hay que saber antes de tocar nada

**La API se conecta con el rol `devup_app`, que no es propietario de las
tablas.** Postgres salta RLS para el propietario: si alguien apunta
`DATABASE_URL` al rol que ejecuta las migraciones, todas las políticas dejan de
aplicarse y el aislamiento entre clientes desaparece sin un solo error en los
registros. `DATABASE_ADMIN_URL` es solo para el runner de migraciones.

**TURN es opcional en desarrollo y obligatorio en producción.** Sin él la
señalización conecta y la interfaz parece correcta, pero en NAT simétrico y en
buena parte de las redes móviles el audio no llega nunca. `docker compose up -d`
levanta un `coturn` local; para producción, [`docs/TURN.md`](docs/TURN.md) —
y ojo con las credenciales fijas, que acaban en el bundle del navegador.

**Las llamadas van cifradas extremo a extremo y no se pueden grabar desde el
servidor.** La grabación ocurre en el navegador de un participante y necesita
el permiso de todos los presentes. Es una decisión tomada, no una carencia:
[`docs/decisiones/0001-cifrado-de-salas.md`](docs/decisiones/0001-cifrado-de-salas.md).

**La primera carpeta de la clave de un objeto es la frontera de seguridad.**
`{organization_id}/{workspace_id}/{uuid}.{ext}`, y la comprobación de
pertenencia va siempre antes de firmar una URL.

---

## Guion de comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | API y web a la vez |
| `npm run dev:api` / `npm run dev:web` | por separado |
| `npm run db:up` / `npm run db:down` | infraestructura local |
| `npm run db:migrate` | aplica lo pendiente y reaplica privilegios |
| `npm run db:reset` | borra el esquema y lo reconstruye (solo desarrollo) |
| `npm run test:rls` | prueba de aislamiento entre organizaciones |
| `npm run typecheck` | TypeScript en los dos paquetes |
