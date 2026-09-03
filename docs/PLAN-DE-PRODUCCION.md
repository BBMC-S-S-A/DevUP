# DevUP · Plan de producción

Cómo se trabaja, cómo se despliega y en qué orden se hacen las cosas. El estado
de cada pieza está en [LO-QUE-HAY-Y-LO-QUE-FALTA.md](LO-QUE-HAY-Y-LO-QUE-FALTA.md).

---

## Cómo se trabaja

### El ciclo
1. Rama desde `claude/sales-control-workspace-platform-i99syv` (la principal).
2. Cambio + prueba que lo cubra.
3. `npm run typecheck` y las pruebas que toquen. **Antes de desplegar**, no
   después.
4. Pull request. CI corre typecheck, migraciones, RLS, mundo, integraciones y
   el build entero.
5. Fusionar cuando esté en verde.

### Lo que CI no perdona
- Una tabla nueva sin política de RLS **y** sin caso en `isolation.test.ts`.
- Un archivo de pruebas sin un solo `import`/`export`: TypeScript lo trata como
  script y prohíbe el `await` de arriba.
- Cualquier cosa que rompa `npm run build` de la API o de la web.

### Estilo
El código de este repositorio explica **por qué**, no qué. Un comentario que
repite lo que hace la línea siguiente sobra; uno que cuenta por qué se
descartó lo obvio vale su peso. Si algo costó horas de encontrar, se anota
donde se encontró y en «Trampas» del otro documento.

---

## Cómo se despliega

### API y tiempo real (Railway)
```bash
railway up --detach --service api  -e production
railway up --detach --service live -e production
```
Necesita `RAILWAY_API_TOKEN` en el entorno. `live` es el mismo código con
`REALTIME_ENABLED=true`: un solo repositorio, dos instancias.

### Web (Cloudflare Workers)
```bash
cd apps/web
NEXT_PUBLIC_API_URL=https://api-production-7b95.up.railway.app \
NEXT_PUBLIC_WS_URL=wss://live-production-976a.up.railway.app \
npm run cf:deploy
```
**Esas dos variables se incrustan al compilar.** Cambiarlas en un panel no hace
nada: hay que reconstruir.

### Base de datos
La base está en la red privada de Railway, así que desde fuera hace falta un
túnel:
```bash
railway connect Postgres --tunnel-only --port 55432
```
Y entonces, **con mucho cuidado con las dos variables**:
```bash
DATABASE_ADMIN_URL="postgres://postgres:<pass>@127.0.0.1:55432/railway" \
DATABASE_URL="postgres://devup_app:<SU pass>@127.0.0.1:55432/railway" \
npm run db:migrate
```
`migrate.ts` hace `alter role devup_app login password <la de DATABASE_URL>`.
Pasarle ahí la del superusuario deja la API fuera de su propia base. Ver
«Trampas».

**Antes de una migración con datos dentro, un volcado:**
```bash
docker run --rm -e PGPASSWORD=<pass> postgres:18-alpine \
  pg_dump -h host.docker.internal -p 55432 -U postgres -d railway --no-owner --no-acl \
  > respaldo-antes-de-NNNN.sql
```
La versión de `pg_dump` tiene que coincidir con la del servidor (hoy 18).

### Orden cuando hay migración
Migración y código **van juntos**. Si el código nuevo llama a una función que
la migración crea, desplegar uno sin el otro rompe producción. Primero la
migración, y el despliegue inmediatamente después.

---

## En qué orden hacer lo que falta

### Ahora
1. **Respaldo del almacén de archivos**, y rehacer el de la base contra Railway
   (el actual apunta a Supabase, de donde ya nos fuimos). Es lo único que hoy
   nos dejaría sin red si algo se cae.
2. **Apuntar `hytrex.co` a la landing.** Está desplegada y el apex da 530.

### Después
3. **Dominios propios** (`api.hytrex.co`, `live.hytrex.co`) cuando Railway
   emita sus certificados, con la reconstrucción de la web que eso implica.
4. **Partir `ventas`**, con las pruebas de navegador delante.
5. **Responsive dentro de las pantallas grandes.**
6. **Higiene de la base**: `search_path` en las seis funciones, y decidir qué
   se hace con `user_tokens`.

### Cuando haya gente usándolo
7. **Más fuentes de música** si YouTube y Spotify se quedan cortos: la cola ya
   es agnóstica —guarda canciones, no enlaces de un servicio— así que añadir
   una tercera es escribir su buscador y su reproductor, no tocar la cola.
8. **Segundo proveedor de despliegues**: hasta que no haya otro no se sabrá si
   la traducción de estados aguanta.
9. **Economía de monedas** del DevVerse. Bloqueada hasta que estén decididos
   los ritos que acuñan moneda y el techo semanal por persona.

---

## Lo que NO se hace

Decisiones ya tomadas, para no volver a discutirlas cada mes.

- **El audio de la voz no pasa por el servidor.** Va cifrado entre pares. Eso
  descarta grabar en servidor y descarta un bot de música que inyecte audio en
  la llamada, al estilo de Discord — Discord puede porque su servidor ve el
  audio. El porqué completo, en
  [decisiones/0001-cifrado-de-salas.md](decisiones/0001-cifrado-de-salas.md).
- **La música se sincroniza, no se comparte.** Se reparte «qué suena y en qué
  segundo»; cada quien reproduce en su navegador. Es lo que la mantiene
  compatible con el cifrado.
- **`devup_app` no es dueño de nada y no salta RLS.** El aislamiento entre
  organizaciones es de la base, no de la aplicación.
- **Nada de servicios de pago.** Todo lo que corre hoy está en capas gratuitas.
