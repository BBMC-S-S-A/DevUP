# Continuar aquí

Informe de traspaso. El trabajo empezó en `sekkon0906/DevUP` y se trasladó a
`BBMC-S-S-A/DevUP`. Este archivo existe para que quien retome —persona o
agente— no tenga que redescubrir las decisiones ya tomadas ni volver a
discutirlas.

Referencia completa del proyecto: `docs/DevUP-Plan-de-Desarrollo.pdf`
(12 semanas, 94 tareas con criterio de aceptación). El fuente del PDF es
`docs/plan-desarrollo.html`; se regenera con WeasyPrint.

---

## Objetivo de la iteración en curso

Plataforma inicial: **llamadas de voz** y **un lugar donde alojar imágenes y
archivos**. Corresponde a las semanas 1 a 3 del plan, recortadas a lo mínimo
que se sostiene en pie.

---

## Estado

**Hecho**

- `supabase/migrations/0001_core.sql` — perfiles, organizaciones, miembros,
  workspaces, canales y canales privados. RLS completo en todas las tablas.
- `supabase/migrations/0002_files.sql` — archivos, etiquetas polimórficas,
  bucket privado `files` y políticas de `storage.objects`.
- `supabase/migrations/0003_calls.sql` — historial de sesiones de llamada más
  las funciones transaccionales `join_call` / `leave_call`.
- Andamiaje: Next.js 15, TypeScript estricto, Tailwind 4, `.env.example`.

**Sin verificar** — las migraciones no se han aplicado nunca contra un Postgres
real. Están escritas con cuidado pero no probadas. Aplicarlas a un proyecto
desechable es el primer paso, antes de escribir una línea de interfaz.

**Pendiente**

1. Cliente y servidor de Supabase (`@supabase/ssr`) más middleware de sesión.
2. Autenticación: alta, acceso y cierre de sesión.
3. Estructura de la aplicación: barra lateral de workspaces y canales.
4. Sala de voz (ver decisiones abajo).
5. Biblioteca de archivos: subida, etiquetas, previsualización, búsqueda.

---

## Decisiones ya tomadas

No hace falta volver a abrirlas. Si se cambian, que sea por una razón nueva.

### Voz: malla WebRTC, sin servidor de medios

**No** se usa SFU en esta iteración. Cada participante se conecta directamente
con cada otro, y la señalización va por Supabase Realtime.

Motivo: un SFU (LiveKit, mediasoup) es un servidor más que alojar y pagar, y
para 3 a 6 personas por sala una malla funciona sin él. Encaja además con la
tesis del producto —proveedor de infraestructura, no de alojamiento—. Por
encima de 6 participantes la malla se cae de bruces: ahí se migra a SFU, y esa
migración solo toca el módulo de voz.

Detalles que ya están decididos:

- **Señalización** por Realtime del canal `voice:{channelId}`; Presence lleva el
  estado en vivo (quién está, silenciado, hablando) y broadcast lleva las SDP y
  los candidatos ICE.
- **Identidad de par**: un `peerId` aleatorio por pestaña, no el `userId`. Una
  misma persona puede entrar desde dos sitios y tienen que ser dos pares.
- **Negociación perfecta** (*perfect negotiation*) para resolver colisiones de
  oferta: el cortés es el del `peerId` mayor. Crear el `RTCPeerConnection`
  también al recibir una señal de un par desconocido, no solo al verlo en
  Presence: los dos caminos compiten y el orden no está garantizado.
- **TURN** es opcional en desarrollo y **obligatorio en producción**. Sin él la
  señalización conecta pero no llega el audio en NAT simétrico y en buena parte
  de las redes móviles. Configurado por entorno en `.env.example`.
- El estado en vivo **no se guarda en la base de datos**. Presence se limpia
  solo al cerrar la pestaña; una tabla no. Las tablas de `0003_calls.sql` son
  historial, y `left_at` es mejor-esfuerzo por diseño.

### Cifrado de llamada

Pendiente de decisión y **bloquea la grabación**. El cifrado extremo a extremo
y la grabación en servidor se excluyen mutuamente (§7, S2 del PDF). En una
malla WebRTC el audio ya va cifrado entre pares con DTLS-SRTP y no pasa por
ningún servidor nuestro, así que la iteración actual es de hecho extremo a
extremo — y por eso mismo **no es grabable desde el servidor**. Si se quiere
grabar, hay que elegir salida antes de implementarla, no después.

### Archivos

- Bucket privado `files`, ruta `{organization_id}/{workspace_id}/{uuid}.{ext}`.
- **La primera carpeta de la ruta es la frontera de seguridad**: las políticas
  de `storage.objects` la leen para decidir el acceso. Cambiar la convención de
  ruta sin revisar esas políticas abre una fuga entre organizaciones.
- Acceso por URL firmada con caducidad. Nunca bucket público.
- El cast de la ruta a uuid es tolerante (`public.try_uuid`): un objeto subido
  fuera de la aplicación deniega en vez de reventar la consulta.

### Aislamiento

RLS como mecanismo primario, con funciones de pertenencia `SECURITY DEFINER`.
Esto no es un detalle de estilo: una política sobre `organization_members` que
consulta `organization_members` entra en **recursión infinita**. `SECURITY
DEFINER` salta RLS en la consulta interna y la corta.

Toda tabla nueva con `organization_id` necesita su política y su prueba de
aislamiento. Ver «Estrategia de pruebas» en el PDF (§5).

---

## Puesta en marcha

```bash
npm install
cp .env.example .env.local     # rellenar con los datos del proyecto Supabase
npm run dev
```

Las migraciones se aplican con la CLI de Supabase:

```bash
supabase link --project-ref <ref>
supabase db push
```

**Hace falta un proyecto Supabase propio para DevUP.** Los que hay en la cuenta
(`GestorEventosMarcaBlanca`, `AgenteBarfNewBlood`) son de otros productos y no
se tocan.

Para probar el acceso por correo y contraseña sin configurar SMTP, hay que
desactivar la confirmación por correo en Authentication → Providers → Email.
