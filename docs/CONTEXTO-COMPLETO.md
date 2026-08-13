# DevUP — Contexto completo para reconstruir desde cero

Documento autosuficiente. Si lo único que tienes es este archivo, alcanza para
levantar el proyecto entero: visión, alcance, decisiones de arquitectura con su
razón, el esquema de base de datos completo y lo que falta por construir.

Escrito para que lo lea una persona o un agente que arranca en frío.

---

## 0. Cómo usar este documento

1. Lee las secciones 1 a 5 antes de escribir código. Son las decisiones y sus
   motivos; saltárselas lleva a rehacer trabajo.
2. La sección 6 trae el SQL completo, listo para copiar a
   `supabase/migrations/`. **Aplícalo contra un proyecto desechable primero**:
   nunca se ha ejecutado contra un Postgres real.
3. La sección 7 dice qué construir y en qué orden.
4. La sección 9 son las trampas concretas. Vale la pena leerla antes de
   depurar, no después.

Cuando algo de aquí choque con lo que parezca razonable en el momento, gana lo
de aquí salvo que haya una razón nueva. Estas decisiones ya se discutieron.

---

## 1. Qué es DevUP

Un **centro de mando unificado** para la operación comercial y la
infraestructura técnica de un equipo de desarrollo.

El problema que resuelve: hoy sacar adelante un producto pequeño obliga a
repartir el trabajo entre cinco o seis herramientas que no se hablan. El código
en GitHub, el frontend en Vercel, el backend en Render, la base de datos en un
cuarto proveedor, las tareas en un quinto y la conversación en un sexto. Cada
salto rompe el contexto.

Tres promesas, en este orden de construcción:

| Capa | Qué incluye |
|---|---|
| **Espacio de trabajo** | Workspaces, canales, mensajería en tiempo real, llamadas de voz, gestión documental con etiquetas y búsqueda. Donde el equipo vive a diario. |
| **Control de ventas** | Catálogo de servicios etiquetados, clientes, oportunidades, cotizaciones, objetivos. Una venta ganada se convierte en proyecto con tareas y el objetivo avanza solo. |
| **Infraestructura sin alojamiento** | Modelado de esquema, migraciones versionadas, explorador de datos y vista unificada de repos y despliegues — sobre las cuentas del cliente. Encima, agentes (Codex, Claude Code) etiquetados y asignables a tareas. |

### El modelo: BYOI — *Bring Your Own Infrastructure*

La diferencia con Supabase, Render o Vercel es de rol. Ellos venden capacidad
de cómputo y almacenamiento; **DevUP vende coordinación**. No competimos con el
proveedor del cliente, nos montamos encima. El cliente conecta sus cuentas con
credenciales que quedan cifradas en nuestra bóveda; DevUP orquesta, propone,
versiona y audita, pero nunca aloja la base productiva ni ejecuta su servicio.

Consecuencia buena: coste marginal por cliente casi plano, sin guardias de
disponibilidad sobre sistemas ajenos, superficie regulatoria pequeña.

Consecuencia mala: dependemos de las APIs de terceros, y **custodiamos llaves
de sistemas productivos ajenos**. Esa bóveda es el activo más sensible del
producto.

---

## 2. Alcance: qué es y qué no es

**Sí**

- Workspaces, canales y mensajería en tiempo real
- Llamadas de voz con cifrado y (según el modo) grabación
- Almacenamiento, versionado, etiquetado y búsqueda de archivos
- Control de ventas y objetivos con progreso calculado
- Modelado visual de esquema y generación de migraciones
- Explorador de datos sobre la base del cliente, con guardas
- Vista unificada de repositorios, entornos y despliegues
- Orquestación de agentes con aprobación humana
- Identidad propia (DevUP ID), auditoría y control de acceso

**No**

- No alojamos bases de datos ni las operamos
- No ejecutamos el cómputo del cliente
- No revendemos servicios de terceros de pago
- No somos CDN, ni registrador de dominios, ni pasarela de pagos
- No almacenamos copias de los datos productivos del cliente
- No garantizamos disponibilidad de sistemas que no controlamos
- No sustituimos el control de versiones: GitHub sigue siendo la fuente de
  verdad del código

### Regla permanente de producto

> Si una funcionalidad exige que DevUP mantenga un proceso corriendo, un puerto
> abierto o un disco montado **en nombre del cliente**, está fuera de alcance
> por definición y hay que rediseñarla como orquestación sobre la cuenta del
> cliente.

No admite excepciones tácticas. Cada una nos acerca a ser un proveedor de
alojamiento, con todos sus costes y ninguna de sus ventajas.

---

## 3. La iteración actual

**Objetivo: llamadas de voz y un lugar donde alojar imágenes y archivos.**

Corresponde a las semanas 1 a 3 del plan de 12 semanas, recortadas a lo mínimo
que se sostiene en pie. Concretamente:

1. Autenticación y multi-tenencia (organizaciones, miembros, roles)
2. Workspaces y canales
3. Sala de voz funcional entre varios participantes
4. Biblioteca de archivos con etiquetas, previsualización y búsqueda

Lo que **no** entra todavía: mensajería de texto, grabación de llamadas,
control de ventas, conectores, agentes, identidad propia.

---

## 4. Pila tecnológica

| Pieza | Elección | Por qué |
|---|---|---|
| Frontend | Next.js 15 (App Router), TypeScript estricto, Tailwind 4 | Estándar, sin sorpresas |
| Datos, auth, almacenamiento, tiempo real | Supabase (Postgres 17) | Resuelve cuatro problemas con una dependencia mientras el equipo sea pequeño |
| Voz | WebRTC en malla, sin servidor de medios | Ver §5.2 |
| Iconos | `lucide-react` | — |

`package.json` de referencia:

```json
{
  "name": "devup",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@supabase/ssr": "^0.7.0",
    "@supabase/supabase-js": "^2.58.0",
    "lucide-react": "^0.544.0",
    "next": "^15.5.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.0",
    "@types/node": "^22.15.0",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "tailwindcss": "^4.1.0",
    "typescript": "^5.8.0"
  }
}
```

Tailwind 4 no necesita `tailwind.config`. Basta `postcss.config.mjs` con
`{ plugins: { "@tailwindcss/postcss": {} } }` y `@import "tailwindcss";` en
`globals.css`.

Variables de entorno (`.env.example`):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://TU-PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# STUN basta cuando ambos extremos pueden abrir un camino directo. En redes
# corporativas, con NAT simétrico o detrás de algunos móviles, hace falta TURN:
# sin él la llamada conecta la señalización pero no llega el audio.
NEXT_PUBLIC_STUN_URLS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302
NEXT_PUBLIC_TURN_URL=
NEXT_PUBLIC_TURN_USERNAME=
NEXT_PUBLIC_TURN_CREDENTIAL=
```

---

## 5. Decisiones de arquitectura

### 5.1 Multi-tenencia con RLS

El aislamiento entre organizaciones vive **en la base de datos**, no en la
aplicación. Motivo: con multi-tenencia, un solo `WHERE organization_id = ?`
olvidado filtra datos entre clientes. Poniendo el aislamiento en Postgres, un
error de la aplicación devuelve cero filas en vez de las filas de otro.

El coste es disciplina: **cada tabla nueva necesita su política y su prueba de
aislamiento**.

**El detalle que hay que entender sí o sí:** las funciones de pertenencia son
`SECURITY DEFINER` a propósito. Sin eso, una política sobre
`organization_members` que consulta `organization_members` entra en **recursión
infinita** y Postgres aborta la consulta. `SECURITY DEFINER` salta RLS en la
consulta interna y corta el ciclo. Si alguien las "limpia" quitando ese
modificador, la aplicación deja de arrancar de una forma difícil de
diagnosticar.

### 5.2 Voz: malla WebRTC, sin servidor de medios

**No se usa SFU** (LiveKit, mediasoup) en esta iteración. Cada participante se
conecta directamente con cada otro y la señalización va por Supabase Realtime.

Razones:

- Un SFU es un servidor más que alojar, operar y pagar.
- Para 3 a 6 personas por sala, una malla funciona sin él.
- Encaja con la tesis del producto: proveedor de infraestructura, no de
  alojamiento.

**Límite honesto:** por encima de ~6 participantes la malla se cae de bruces —
cada cliente sube su audio N−1 veces. Ahí se migra a SFU, y esa migración solo
toca el módulo de voz si se mantiene aislado.

Decisiones concretas:

- **Señalización** por el canal Realtime `voice:{channelId}`. Presence lleva el
  estado en vivo (quién está, silenciado, hablando); broadcast lleva las SDP y
  los candidatos ICE.
- **Identidad de par:** un `peerId` aleatorio por pestaña, **no** el `userId`.
  Una misma persona puede entrar desde dos sitios y tienen que ser dos pares
  distintos.
- **Negociación perfecta** (*perfect negotiation*) para resolver colisiones de
  oferta. El «cortés» es el del `peerId` mayor.
- **Crear el `RTCPeerConnection` también al recibir una señal** de un par
  desconocido, no solo al verlo aparecer en Presence. Los dos caminos compiten
  y el orden no está garantizado.
- **TURN es opcional en desarrollo y obligatorio en producción.** Sin él la
  señalización conecta pero no llega el audio en NAT simétrico y en buena parte
  de las redes móviles. Es el fallo número uno de este tipo de sistema.
- **El estado en vivo no se guarda en la base de datos.** Presence se limpia
  solo al cerrar la pestaña; una tabla no. Las tablas de `0003_calls.sql` son
  historial, y `left_at` es mejor-esfuerzo por diseño.

Esbozo del hook, que es donde está toda la dificultad:

```ts
// src/lib/voice/useVoiceRoom.ts

const peerId = useMemo(() => crypto.randomUUID(), []);
const pcs = useRef(new Map<string, RTCPeerConnection>());
const makingOffer = useRef(new Map<string, boolean>());
const ignoreOffer = useRef(new Map<string, boolean>());

// Soy el «cortés» si mi peerId es mayor. Determinista y simétrico:
// los dos extremos calculan lo mismo sin ponerse de acuerdo.
const isPolite = (remote: string) => peerId > remote;

function getOrCreatePeer(remote: string): RTCPeerConnection {
  const existing = pcs.current.get(remote);
  if (existing) return existing;

  const pc = new RTCPeerConnection({ iceServers });
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  pc.onicecandidate = (e) => {
    if (e.candidate) send(remote, { candidate: e.candidate });
  };
  pc.ontrack = (e) => setRemoteStream(remote, e.streams[0]);

  pc.onnegotiationneeded = async () => {
    try {
      makingOffer.current.set(remote, true);
      await pc.setLocalDescription();          // sin argumento: crea la oferta
      send(remote, { description: pc.localDescription });
    } finally {
      makingOffer.current.set(remote, false);
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') pc.restartIce();
  };

  pcs.current.set(remote, pc);
  return pc;
}

// Al recibir una descripción
const pc = getOrCreatePeer(from);
const collision =
  description.type === 'offer' &&
  (makingOffer.current.get(from) || pc.signalingState !== 'stable');

ignoreOffer.current.set(from, !isPolite(from) && collision);
if (ignoreOffer.current.get(from)) return;

await pc.setRemoteDescription(description);
if (description.type === 'offer') {
  await pc.setLocalDescription();              // sin argumento: crea la respuesta
  send(from, { description: pc.localDescription });
}

// Al recibir un candidato
try {
  await pc.addIceCandidate(candidate);
} catch (err) {
  if (!ignoreOffer.current.get(from)) throw err;
}
```

Resto de piezas:

- **Indicador de quién habla:** `AudioContext` + `AnalyserNode` sobre cada
  pista, RMS en un bucle de `requestAnimationFrame`, umbral con histéresis para
  que no parpadee.
- **Silenciar:** `track.enabled = false` y actualizar el estado en Presence. No
  cierres la pista: reabrirla pide permiso otra vez en algunos navegadores.
- **Cambiar de micrófono:** `getUserMedia({ audio: { deviceId } })` y luego
  `sender.replaceTrack(newTrack)` en cada conexión. **No hace falta
  renegociar.**
- **Limpieza al salir:** parar las pistas, cerrar todas las conexiones,
  `untrack()`, `supabase.removeChannel(room)` y llamar a `leave_call`. Olvidar
  esto deja el micrófono encendido y pares fantasma en la sala.

### 5.3 Archivos y almacenamiento

- Bucket **privado** `files`, ruta `{organization_id}/{workspace_id}/{uuid}.{ext}`.
- **La primera carpeta de la ruta es la frontera de seguridad**: las políticas
  de `storage.objects` la leen para decidir el acceso. Cambiar la convención de
  ruta sin revisar esas políticas abre una fuga entre organizaciones.
- Acceso siempre por **URL firmada con caducidad**. Nunca bucket público.
- El cast de la ruta a uuid es tolerante (`public.try_uuid`): un objeto subido
  fuera de la aplicación deniega en vez de reventar la consulta entera.
- **Orden de la subida:** primero el objeto al bucket, después la fila en
  `files`. Si la fila falla, hay que **borrar el objeto huérfano**; si no, el
  almacenamiento se llena de basura que nadie referencia y por la que se paga.

### 5.4 Cifrado frente a grabación

**El cifrado extremo a extremo y la grabación en servidor se excluyen
mutuamente.** Si el audio va cifrado de punta a punta, el servidor solo ve
paquetes opacos y no puede grabar; si puede grabar es porque tiene la clave, y
entonces no es extremo a extremo por mucho que se le llame así.

En una malla WebRTC el audio va cifrado entre pares con DTLS-SRTP y **no pasa
por ningún servidor nuestro**. Es decir: la iteración actual es de hecho
extremo a extremo, y por eso mismo **no es grabable desde el servidor**.

Las tres salidas, cuando toque grabar:

1. **Grabar en el cliente** — un participante designado graba localmente y sube
   el archivo re-cifrado. Preserva el cifrado, pero depende de su conexión y de
   que no cierre la pestaña.
2. **Sala sin cifrado extremo a extremo** — cifrado en tránsito y en reposo,
   con el servidor capaz de grabar. Es lo que hacen Zoom y Meet por defecto, y
   es defendible mientras se diga.
3. **Participante grabador con clave** — se entrega la clave de sala a un
   grabador del lado servidor. Conserva la arquitectura, rompe la promesa
   estricta.

**Recomendación: modo declarado por sala**, elegido al crearla y visible para
todos antes de entrar — «Sala privada: cifrada extremo a extremo, no grabable»
frente a «Sala grabable: cifrada en tránsito y en reposo». Prometer ambas cosas
a la vez es una promesa de seguridad falsa, y en este terreno una promesa falsa
cuesta más que una funcionalidad ausente.

Hay que elegir **antes** de implementar la grabación, no después.

---

## 6. Esquema de base de datos

Tres archivos en `supabase/migrations/`. Se aplican en orden.

> **Nunca se han ejecutado contra un Postgres real.** Están escritos con
> cuidado, pero el primer paso de quien retome es aplicarlos a un proyecto
> desechable y corregir lo que salte.

### `supabase/migrations/0001_core.sql` — Identidad, organizaciones, workspaces y canales

```sql
-- =============================================================================
-- DevUP · 0001 · Núcleo: identidad, organizaciones, workspaces y canales
--
-- El aislamiento entre organizaciones vive en la base de datos (RLS), no en la
-- aplicación: un WHERE olvidado devuelve cero filas en vez de filas ajenas.
--
-- Las funciones de pertenencia son SECURITY DEFINER a propósito. Sin eso, una
-- política sobre organization_members que consulta organization_members entra
-- en recursión infinita. SECURITY DEFINER salta RLS en la consulta interna.
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Perfiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url   text,
  created_at   timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      split_part(coalesce(new.email, 'usuario'), '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Organizaciones
-- ---------------------------------------------------------------------------
create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 80),
  slug       text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create type public.org_role as enum ('owner', 'admin', 'member');

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            public.org_role not null default 'member',
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index if not exists organization_members_user_idx
  on public.organization_members (user_id);

-- Quien crea la organización entra como propietario en la misma transacción.
-- SECURITY DEFINER porque en ese instante todavía no es miembro de nada y la
-- política de inserción de organization_members lo rechazaría.
create or replace function public.handle_new_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.organization_members (organization_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_organization_created on public.organizations;
create trigger on_organization_created
  after insert on public.organizations
  for each row execute function public.handle_new_organization();

-- ---------------------------------------------------------------------------
-- Workspaces y canales
-- ---------------------------------------------------------------------------
create table if not exists public.workspaces (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 80),
  created_by      uuid not null references auth.users(id) on delete restrict,
  created_at      timestamptz not null default now()
);

create index if not exists workspaces_org_idx on public.workspaces (organization_id);

create type public.channel_kind as enum ('text', 'voice');

create table if not exists public.channels (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 80),
  kind         public.channel_kind not null default 'text',
  is_private   boolean not null default false,
  created_by   uuid not null references auth.users(id) on delete restrict,
  created_at   timestamptz not null default now()
);

create index if not exists channels_workspace_idx on public.channels (workspace_id);

create table if not exists public.channel_members (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Funciones de pertenencia (SECURITY DEFINER: saltan RLS, evitan recursión)
-- ---------------------------------------------------------------------------
create or replace function public.is_org_member(_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = _org and m.user_id = auth.uid()
  );
$$;

create or replace function public.org_role_of(_org uuid)
returns public.org_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role from public.organization_members m
  where m.organization_id = _org and m.user_id = auth.uid();
$$;

create or replace function public.is_org_admin(_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.org_role_of(_org) in ('owner', 'admin');
$$;

create or replace function public.org_of_workspace(_workspace uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select w.organization_id from public.workspaces w where w.id = _workspace;
$$;

create or replace function public.can_access_workspace(_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_org_member(public.org_of_workspace(_workspace));
$$;

-- Un canal es accesible si eres miembro de la organización y, cuando el canal
-- es privado, además estás en su lista de miembros.
create or replace function public.can_access_channel(_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.channels c
    join public.workspaces w on w.id = c.workspace_id
    join public.organization_members m
      on m.organization_id = w.organization_id and m.user_id = auth.uid()
    where c.id = _channel
      and (
        not c.is_private
        or exists (
          select 1 from public.channel_members cm
          where cm.channel_id = c.id and cm.user_id = auth.uid()
        )
      )
  );
$$;

create or replace function public.org_of_channel(_channel uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select w.organization_id
  from public.channels c
  join public.workspaces w on w.id = c.workspace_id
  where c.id = _channel;
$$;

-- ---------------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.organizations        enable row level security;
alter table public.organization_members enable row level security;
alter table public.workspaces           enable row level security;
alter table public.channels             enable row level security;
alter table public.channel_members      enable row level security;

-- Perfiles: se ve el propio y el de quien comparte alguna organización.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.organization_members mine
      join public.organization_members theirs
        on theirs.organization_id = mine.organization_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- Organizaciones
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations for select
  using (public.is_org_member(id));

drop policy if exists organizations_insert on public.organizations;
create policy organizations_insert on public.organizations for insert
  with check (created_by = auth.uid());

drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations for update
  using (public.is_org_admin(id)) with check (public.is_org_admin(id));

drop policy if exists organizations_delete on public.organizations;
create policy organizations_delete on public.organizations for delete
  using (public.org_role_of(id) = 'owner');

-- Miembros
drop policy if exists organization_members_select on public.organization_members;
create policy organization_members_select on public.organization_members for select
  using (public.is_org_member(organization_id));

drop policy if exists organization_members_write on public.organization_members;
create policy organization_members_write on public.organization_members for insert
  with check (public.is_org_admin(organization_id));

drop policy if exists organization_members_update on public.organization_members;
create policy organization_members_update on public.organization_members for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- Salir por cuenta propia, o expulsión por un administrador.
drop policy if exists organization_members_delete on public.organization_members;
create policy organization_members_delete on public.organization_members for delete
  using (user_id = auth.uid() or public.is_org_admin(organization_id));

-- Workspaces
drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces for select
  using (public.is_org_member(organization_id));

drop policy if exists workspaces_insert on public.workspaces;
create policy workspaces_insert on public.workspaces for insert
  with check (public.is_org_member(organization_id) and created_by = auth.uid());

drop policy if exists workspaces_update on public.workspaces;
create policy workspaces_update on public.workspaces for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

drop policy if exists workspaces_delete on public.workspaces;
create policy workspaces_delete on public.workspaces for delete
  using (public.is_org_admin(organization_id));

-- Canales
drop policy if exists channels_select on public.channels;
create policy channels_select on public.channels for select
  using (public.can_access_channel(id));

drop policy if exists channels_insert on public.channels;
create policy channels_insert on public.channels for insert
  with check (public.can_access_workspace(workspace_id) and created_by = auth.uid());

drop policy if exists channels_update on public.channels;
create policy channels_update on public.channels for update
  using (public.is_org_admin(public.org_of_workspace(workspace_id)))
  with check (public.is_org_admin(public.org_of_workspace(workspace_id)));

drop policy if exists channels_delete on public.channels;
create policy channels_delete on public.channels for delete
  using (public.is_org_admin(public.org_of_workspace(workspace_id)));

-- Miembros de canal privado
drop policy if exists channel_members_select on public.channel_members;
create policy channel_members_select on public.channel_members for select
  using (public.can_access_channel(channel_id));

drop policy if exists channel_members_write on public.channel_members;
create policy channel_members_write on public.channel_members for insert
  with check (public.is_org_admin(public.org_of_channel(channel_id)));

drop policy if exists channel_members_delete on public.channel_members;
create policy channel_members_delete on public.channel_members for delete
  using (user_id = auth.uid() or public.is_org_admin(public.org_of_channel(channel_id)));
```

### `supabase/migrations/0002_files.sql` — Archivos, etiquetas y almacenamiento

```sql
-- =============================================================================
-- DevUP · 0002 · Archivos, etiquetas y almacenamiento
--
-- Los objetos viven en el bucket privado `files` con la ruta
--   {organization_id}/{workspace_id}/{uuid}.{ext}
-- La primera carpeta ES la frontera de seguridad: las políticas de
-- storage.objects la leen para decidir el acceso, así que la convención de
-- ruta no es cosmética y no se puede cambiar sin revisar estas políticas.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Etiquetas (polimórficas por diseño: hoy archivos, mañana servicios y tareas)
-- ---------------------------------------------------------------------------
create table if not exists public.tags (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 40),
  color           text not null default 'slate'
                  check (color in ('slate','blue','green','amber','red','violet','pink','teal')),
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

-- ---------------------------------------------------------------------------
-- Archivos
-- ---------------------------------------------------------------------------
create table if not exists public.files (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  channel_id      uuid references public.channels(id) on delete set null,
  storage_path    text not null unique,
  name            text not null check (length(btrim(name)) between 1 and 255),
  description     text not null default '',
  mime_type       text not null default 'application/octet-stream',
  size_bytes      bigint not null default 0 check (size_bytes >= 0),
  uploaded_by     uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists files_workspace_idx on public.files (workspace_id, created_at desc);
create index if not exists files_channel_idx   on public.files (channel_id, created_at desc);
create index if not exists files_org_idx       on public.files (organization_id, created_at desc);

-- Búsqueda por nombre y descripción. `simple` en vez de `spanish` a propósito:
-- los nombres de archivo son en su mayoría identificadores, no prosa, y el
-- lematizador español destroza cosas como "informe-Q3-final".
create index if not exists files_search_idx on public.files
  using gin (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(description, '')));

create table if not exists public.file_tags (
  file_id uuid not null references public.files(id) on delete cascade,
  tag_id  uuid not null references public.tags(id) on delete cascade,
  primary key (file_id, tag_id)
);

create index if not exists file_tags_tag_idx on public.file_tags (tag_id);

-- ---------------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------------
alter table public.tags      enable row level security;
alter table public.files     enable row level security;
alter table public.file_tags enable row level security;

drop policy if exists tags_select on public.tags;
create policy tags_select on public.tags for select
  using (public.is_org_member(organization_id));

drop policy if exists tags_insert on public.tags;
create policy tags_insert on public.tags for insert
  with check (public.is_org_member(organization_id));

drop policy if exists tags_update on public.tags;
create policy tags_update on public.tags for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists tags_delete on public.tags;
create policy tags_delete on public.tags for delete
  using (public.is_org_admin(organization_id));

drop policy if exists files_select on public.files;
create policy files_select on public.files for select
  using (
    public.is_org_member(organization_id)
    and (channel_id is null or public.can_access_channel(channel_id))
  );

drop policy if exists files_insert on public.files;
create policy files_insert on public.files for insert
  with check (
    public.can_access_workspace(workspace_id)
    and organization_id = public.org_of_workspace(workspace_id)
    and (channel_id is null or public.can_access_channel(channel_id))
    and uploaded_by = auth.uid()
  );

-- Renombrar y reetiquetar lo puede hacer cualquier miembro; el borrado no.
drop policy if exists files_update on public.files;
create policy files_update on public.files for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists files_delete on public.files;
create policy files_delete on public.files for delete
  using (uploaded_by = auth.uid() or public.is_org_admin(organization_id));

drop policy if exists file_tags_select on public.file_tags;
create policy file_tags_select on public.file_tags for select
  using (exists (select 1 from public.files f where f.id = file_id));

drop policy if exists file_tags_insert on public.file_tags;
create policy file_tags_insert on public.file_tags for insert
  with check (exists (select 1 from public.files f where f.id = file_id));

drop policy if exists file_tags_delete on public.file_tags;
create policy file_tags_delete on public.file_tags for delete
  using (exists (select 1 from public.files f where f.id = file_id));

-- ---------------------------------------------------------------------------
-- Bucket y políticas de almacenamiento
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 104857600)  -- 100 MB
on conflict (id) do update set public = false, file_size_limit = 104857600;

-- La ruta puede no ser un uuid si alguien sube fuera de la aplicación, así que
-- el cast tiene que ser tolerante: un texto no-uuid devuelve null y la política
-- deniega en vez de reventar la consulta entera.
create or replace function public.try_uuid(_text text)
returns uuid
language plpgsql
immutable
as $$
begin
  return _text::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.storage_org_of(_object_name text)
returns uuid
language sql
immutable
as $$
  select public.try_uuid((storage.foldername(_object_name))[1]);
$$;

drop policy if exists "devup files select" on storage.objects;
create policy "devup files select" on storage.objects for select
  using (
    bucket_id = 'files'
    and public.is_org_member(public.storage_org_of(name))
  );

drop policy if exists "devup files insert" on storage.objects;
create policy "devup files insert" on storage.objects for insert
  with check (
    bucket_id = 'files'
    and public.is_org_member(public.storage_org_of(name))
    and owner = auth.uid()
  );

drop policy if exists "devup files update" on storage.objects;
create policy "devup files update" on storage.objects for update
  using (
    bucket_id = 'files'
    and public.is_org_member(public.storage_org_of(name))
  );

drop policy if exists "devup files delete" on storage.objects;
create policy "devup files delete" on storage.objects for delete
  using (
    bucket_id = 'files'
    and (
      owner = auth.uid()
      or public.is_org_admin(public.storage_org_of(name))
    )
  );
```

### `supabase/migrations/0003_calls.sql` — Sesiones de llamada

```sql
-- =============================================================================
-- DevUP · 0003 · Sesiones de llamada
--
-- El estado en vivo de una llamada (quién está dentro, quién habla, quién está
-- silenciado) NO vive aquí: vive en Realtime Presence, que se limpia solo
-- cuando alguien cierra la pestaña o pierde la conexión. Estas tablas son el
-- historial: para qué se usó el canal y quién estuvo.
--
-- Por eso `left_at` es mejor-esfuerzo. Una desconexión brusca lo deja en null,
-- y la vista de duración trata ese caso explícitamente en vez de fingir datos.
-- =============================================================================

create table if not exists public.call_sessions (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  started_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at   timestamptz
);

create index if not exists call_sessions_channel_idx
  on public.call_sessions (channel_id, started_at desc);

-- Una sola sesión abierta por canal: es lo que permite que el segundo en
-- entrar se enganche a la sesión del primero en vez de abrir una paralela.
create unique index if not exists call_sessions_one_open_per_channel
  on public.call_sessions (channel_id) where ended_at is null;

create table if not exists public.call_participants (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.call_sessions(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  peer_id    text not null,
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  unique (session_id, peer_id)
);

create index if not exists call_participants_session_idx
  on public.call_participants (session_id);

alter table public.call_sessions     enable row level security;
alter table public.call_participants enable row level security;

drop policy if exists call_sessions_select on public.call_sessions;
create policy call_sessions_select on public.call_sessions for select
  using (public.can_access_channel(channel_id));

drop policy if exists call_sessions_insert on public.call_sessions;
create policy call_sessions_insert on public.call_sessions for insert
  with check (public.can_access_channel(channel_id));

drop policy if exists call_sessions_update on public.call_sessions;
create policy call_sessions_update on public.call_sessions for update
  using (public.can_access_channel(channel_id))
  with check (public.can_access_channel(channel_id));

create or replace function public.channel_of_session(_session uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.channel_id from public.call_sessions s where s.id = _session;
$$;

drop policy if exists call_participants_select on public.call_participants;
create policy call_participants_select on public.call_participants for select
  using (public.can_access_channel(public.channel_of_session(session_id)));

drop policy if exists call_participants_insert on public.call_participants;
create policy call_participants_insert on public.call_participants for insert
  with check (
    user_id = auth.uid()
    and public.can_access_channel(public.channel_of_session(session_id))
  );

drop policy if exists call_participants_update on public.call_participants;
create policy call_participants_update on public.call_participants for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Entrar a la llamada del canal: reutiliza la sesión abierta o abre una.
-- Va en una función para que las dos operaciones ocurran en una transacción;
-- hacerlo desde el cliente en dos pasos abre una ventana en la que dos
-- personas que entran a la vez crean dos sesiones y no se oyen.
-- ---------------------------------------------------------------------------
create or replace function public.join_call(_channel uuid, _peer_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _session uuid;
begin
  if not public.can_access_channel(_channel) then
    raise exception 'sin acceso al canal';
  end if;

  insert into public.call_sessions (channel_id, started_by)
  values (_channel, auth.uid())
  on conflict do nothing
  returning id into _session;

  if _session is null then
    select id into _session
    from public.call_sessions
    where channel_id = _channel and ended_at is null;
  end if;

  insert into public.call_participants (session_id, user_id, peer_id)
  values (_session, auth.uid(), _peer_id)
  on conflict (session_id, peer_id) do update set left_at = null;

  return _session;
end;
$$;

-- Salir. Cuando se va el último, la sesión se cierra y deja de ser la abierta.
create or replace function public.leave_call(_session uuid, _peer_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.call_participants
  set left_at = now()
  where session_id = _session and peer_id = _peer_id and user_id = auth.uid();

  update public.call_sessions s
  set ended_at = now()
  where s.id = _session
    and s.ended_at is null
    and not exists (
      select 1 from public.call_participants p
      where p.session_id = s.id and p.left_at is null
    );
end;
$$;

revoke all on function public.join_call(uuid, text) from public;
revoke all on function public.leave_call(uuid, text) from public;
grant execute on function public.join_call(uuid, text) to authenticated;
grant execute on function public.leave_call(uuid, text) to authenticated;

-- Realtime para la biblioteca de archivos: subir en una pestaña aparece en la otra.
do $$
begin
  alter publication supabase_realtime add table public.files;
exception when duplicate_object then null;
end $$;
```

---

## 7. Qué construir, y en qué orden

```
src/
  app/
    layout.tsx
    globals.css
    page.tsx                        -> redirige a /login o /app
    login/page.tsx                  -> alta y acceso
    auth/callback/route.ts          -> intercambio de código OAuth
    (app)/
      layout.tsx                    -> shell con barra lateral
      app/page.tsx                  -> elegir o crear organización
      w/[workspaceId]/
        layout.tsx                  -> lista de canales
        c/[channelId]/page.tsx      -> canal: voz + archivos
  components/
    voice/VoiceRoom.tsx             -> interfaz de la sala
    voice/ParticipantTile.tsx
    files/FileLibrary.tsx           -> rejilla, filtros, búsqueda
    files/UploadZone.tsx            -> arrastrar y soltar
    files/FilePreview.tsx           -> imagen, PDF, audio, vídeo
    files/TagPicker.tsx
  lib/
    supabase/client.ts              -> createBrowserClient
    supabase/server.ts              -> createServerClient (cookies)
    supabase/middleware.ts          -> refresco de sesión
    voice/useVoiceRoom.ts           -> el núcleo (ver §5.2)
    voice/useSpeaking.ts            -> detección de voz por RMS
    files/upload.ts                 -> subida + fila + limpieza de huérfanos
  middleware.ts
```

Orden recomendado, cada paso verificable antes del siguiente:

1. **Aplicar las migraciones** a un proyecto desechable. Comprobar a mano que
   un usuario de la organización A no ve nada de la B.
2. **Cliente y servidor de Supabase** más middleware de sesión.
3. **Autenticación**: alta, acceso, cierre de sesión.
4. **Crear organización y workspace**, con la barra lateral.
5. **Archivos** antes que la voz: es más simple y valida que RLS y el bucket
   están bien.
6. **Voz**, que es lo más difícil. Probar con dos pestañas y luego con dos
   máquinas en redes distintas — es ahí donde aparece la necesidad de TURN.

---

## 8. Puesta en marcha

```bash
npm install
cp .env.example .env.local     # rellenar con los datos del proyecto Supabase
npm run dev
```

Migraciones con la CLI de Supabase:

```bash
supabase link --project-ref <ref>
supabase db push
```

**Hace falta un proyecto Supabase propio para DevUP.** Si en la cuenta hay
proyectos de otros productos (por ejemplo un gestor de eventos), no se tocan.

Para probar el acceso por correo y contraseña sin configurar SMTP, desactiva la
confirmación por correo en Authentication → Providers → Email.

---

## 9. Trampas conocidas

| Síntoma | Causa | Salida |
|---|---|---|
| `infinite recursion detected in policy` | Una política sobre `organization_members` consulta `organization_members` | Las funciones de pertenencia tienen que ser `SECURITY DEFINER` |
| La llamada conecta pero no se oye nada | Sin TURN, y los extremos no logran camino directo | Configurar TURN. Es lo primero que hay que descartar |
| Los dos extremos se quedan en `have-local-offer` | Colisión de ofertas sin negociación perfecta | Implementar el patrón cortés/descortés de §5.2 |
| Al recibir una SDP «no existe el par» | La señal llegó antes que el evento de Presence | Crear el `RTCPeerConnection` también al recibir señal |
| Dos personas entran a la vez y no se oyen | Dos sesiones de llamada paralelas | Usar `join_call`, que es transaccional, no dos consultas desde el cliente |
| Se acumulan objetos que nadie referencia | La fila de `files` falló tras subir el objeto | Borrar el objeto si falla la inserción |
| Al subir da 403 | La ruta no empieza por el `organization_id` | Respetar `{org}/{workspace}/{uuid}.{ext}` |
| La misma persona en dos pestañas se pisa | Se usó `userId` como identidad de par | Un `peerId` aleatorio por pestaña |
| El micrófono queda encendido tras colgar | Faltó parar las pistas al desmontar | Limpieza completa: pistas, conexiones, canal Realtime, `leave_call` |

---

## 10. Hoja de ruta de 12 semanas

Resumen. El detalle —94 tareas con criterio de aceptación y estimación— está en
`docs/DevUP-Plan-de-Desarrollo.pdf`, cuyo fuente es `docs/plan-desarrollo.html`
y se regenera con WeasyPrint.

| Semana | Foco | Entregable |
|---|---|---|
| S1 | Cimientos, identidad y canales | Dos usuarios chatean en un canal privado de su organización |
| S2 | Voz: llamada, cifrado y grabación | Llamada cifrada y archivada con consentimiento registrado |
| S3 | Archivos, taxonomía y búsqueda | Archivo subido, cifrado, etiquetado y encontrado por búsqueda |
| S4 | Servicios, clientes y pipeline | Cotización con servicios etiquetados avanzando por el embudo |
| S5 | Objetivos, entrega y seguimiento | Objetivo trimestral que avanza solo al cerrarse una venta |
| S6 | Notificaciones y búsqueda global | El equipo migra su operación diaria a DevUP |
| S7 | Bóveda y conectores externos | Repo, despliegues y base de datos de un proyecto real, en una pantalla |
| S8 | Base de datos como código | Tabla modelada en la interfaz y datos explorados con guardas |
| S9 | Migraciones y sincronía con el repo | Cambio de esquema → migración → PR en GitHub → aplicado con plan previo |
| S10 | Orquestación de agentes | Tarea asignada a un agente, ejecutada, aprobada y fusionada |
| S11 | DevUP ID e identidad propia | Inicio de sesión con identidad propia, MFA y auditoría |
| S12 | Métricas, endurecimiento y beta | Beta cerrada con equipos externos |

Supuesto de capacidad: 2 personas full-stack, 1 punto ≈ 3 horas efectivas,
22 puntos por semana. El plan suma 257 puntos sobre 264 de capacidad — 97 % de
ocupación, sin apenas colchón.

**El hito que decide todo es el final de la semana 6.** Si el propio equipo no
quiere abandonar sus herramientas actuales para usar DevUP, ningún cliente lo
hará tampoco. Ese es el momento de parar y arreglar la base, antes de gastar
seis semanas más construyendo la capa de infraestructura encima.

### Decisiones aún abiertas

- Modo de cifrado de las llamadas (§5.4) — bloquea la grabación
- SFU autoalojado o gestionado, cuando la malla se quede corta
- Aislamiento por RLS o por esquema por organización — cambiarlo después de la
  semana 3 es carísimo
- Modelo de precios: por asiento, por conexión o por consumo de agentes
- Residencia de datos: dónde viven grabaciones y archivos
