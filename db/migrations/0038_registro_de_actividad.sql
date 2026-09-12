-- =============================================================================
-- DevUP · 0038 · El registro de actividad
--
-- LA PREGUNTA QUE HOY NO SE PUEDE CONTESTAR. `auditoria.ts` lo dice en su
-- propia cabecera y se disculpa por ello: se puede saber «Ana tiene cuatro
-- tareas en Hecho», pero no «Ana cerró cuatro esta semana». Y esa es la
-- pregunta de verdad. Una tarea guarda su estado ACTUAL y nada más: no hay
-- rastro de que se movió, ni de cuándo, ni de quién la movió. `updated_at` es
-- lo más cercano y es una aproximación —dice cuándo se tocó por última vez, no
-- cuándo se terminó—, así que para una tarea que se cerró y luego se editó,
-- miente.
--
-- TRES COSAS PEDIDAS POR SEPARADO SALEN DE ESTA TABLA. La auditoría del
-- tablero, la tarjeta de una persona («qué lleva ahora mismo») y el «¿qué me he
-- perdido?» del MCP son la misma consulta con tres filtros distintos. Por eso
-- esto va primero y no en paralelo: construir las tres sobre `updated_at` sería
-- construir tres aproximaciones y luego tirarlas.
--
-- SOLO SE AÑADE. No hay política de UPDATE ni de DELETE, y eso no es un olvido:
-- sin política, Postgres deniega. Un registro que se puede editar deja de ser
-- un registro y pasa a ser una opinión sobre el pasado. Es la misma forma que
-- ya se decidió para el libro de monedas en `avatares-y-economia.md` §8.
--
-- POR QUÉ SE GUARDA UN RESUMEN Y NO SOLO LOS DATOS. `datos` lleva el detalle
-- en JSON y `resumen` una línea legible, y parece duplicado hasta que se mira
-- el caso concreto: **el resumen conserva el título que la tarea tenía en ese
-- momento**. Si alguien renombra la tarjeta mañana, la historia no debe
-- reescribirse sola — «movió "Arreglar el 415"» siguió siendo verdad aunque hoy
-- la tarjeta se llame otra cosa. Reconstruir el resumen al leer obligaría
-- además a mantener para siempre un traductor de todos los verbos que alguna
-- vez existieron.
--
-- EL ORIGEN NO ES DECORACIÓN. `persona`, `regla` o `agente`. La propuesta ya
-- decidió que «hecho» dicho por un agente va marcado como tal, y sin esta
-- columna el panel de participación sumaría a una persona y a su agente en la
-- misma cifra — que es exactamente el número que no queremos publicar.
--
-- DOBLE LLAVE DE AISLAMIENTO, Y HACE FALTA. La política de lectura exige
-- pertenecer a la organización **y** poder acceder al espacio. Con solo lo
-- primero, la actividad de un espacio personal —«Cuaderno de Ana»— se leería
-- desde toda la organización, que es justo lo que el producto promete que no
-- pasa. El caso está en `isolation.test.ts`.
--
-- QUÉ PASA AL BORRAR UN ESPACIO, Y POR QUÉ SE ELIGIÓ ASÍ. Las filas caen con
-- él (`on delete cascade`). Conservarlas con `workspace_id` a nulo habría
-- guardado mejor la participación histórica, pero tiene un efecto que no se ve
-- hasta que ocurre: `can_access_workspace(null)` no restringe, así que la
-- historia de un espacio PRIVADO se volvería visible para toda la organización
-- en el instante en que alguien lo borra. Entre perder historia y filtrarla, se
-- pierde. Si algún día hace falta conservarla, la forma es congelar un resumen
-- agregado al borrar — no dejar las filas sueltas.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'activity_origin') then
    create type public.activity_origin as enum ('persona', 'regla', 'agente');
  end if;
end $$;

create table if not exists public.activity (
  id              uuid primary key default gen_random_uuid(),

  -- Denormalizada a propósito: casi toda lectura es «qué ha pasado en esta
  -- organización», y sacarla del espacio en cada consulta obligaría a un join
  -- con `workspaces` solo para poder aplicar la política.
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- Nulo cuando el hecho es de la organización y no de un espacio concreto
  -- —invitar a alguien, conectar un repositorio—.
  workspace_id    uuid references public.workspaces(id) on delete cascade,

  actor_id        uuid references public.users(id) on delete set null,
  origen          public.activity_origin not null default 'persona',

  -- Vocabulario con espacio de nombres: `tarea.movida`, `tarea.cerrada`. No es
  -- un enum porque la lista va a crecer con cada cosa que el producto aprenda a
  -- anotar, y una migración por verbo nuevo es un impuesto que acaba en que
  -- nadie anota. La comprobación de forma sí, que es lo que caza las erratas.
  verbo           text not null check (verbo ~ '^[a-z]+\.[a-z_]+$'),

  objeto_tipo     text not null check (length(btrim(objeto_tipo)) between 1 and 40),
  objeto_id       uuid,

  resumen         text not null default '' check (length(resumen) <= 300),
  datos           jsonb not null default '{}'::jsonb,

  ocurrido_en     timestamptz not null default now()
);

-- La lectura de siempre: lo último de una organización, o de un espacio.
create index if not exists activity_org_idx
  on public.activity (organization_id, ocurrido_en desc);

create index if not exists activity_workspace_idx
  on public.activity (workspace_id, ocurrido_en desc)
  where workspace_id is not null;

-- «Qué ha hecho esta persona»: la consulta de la auditoría y la de su tarjeta.
create index if not exists activity_actor_idx
  on public.activity (actor_id, ocurrido_en desc)
  where actor_id is not null;

-- «Qué le ha pasado a esta tarea»: la historia de una tarjeta al abrirla.
create index if not exists activity_objeto_idx
  on public.activity (objeto_tipo, objeto_id, ocurrido_en desc)
  where objeto_id is not null;

alter table public.activity enable row level security;

drop policy if exists activity_select on public.activity;
create policy activity_select on public.activity for select
  using (
    public.is_org_member(organization_id)
    and (workspace_id is null or public.can_access_workspace(workspace_id))
  );

-- Escribir en nombre de otro es escribir participación falsa, así que la
-- política lo impide aunque la API se equivoque: el actor es quien escribe, o
-- nadie. Las filas de origen `regla` o `agente` corren igualmente con la sesión
-- de la persona que las disparó, así que tienen su actor y siguen cumpliendo.
drop policy if exists activity_insert on public.activity;
create policy activity_insert on public.activity for insert
  with check (
    public.is_org_member(organization_id)
    and (workspace_id is null or public.can_access_workspace(workspace_id))
    and (actor_id is null or actor_id = public.current_user_id())
  );

-- Sin política de UPDATE ni de DELETE. Ver la cabecera: es lo que convierte
-- esta tabla en un registro y no en un borrador.
