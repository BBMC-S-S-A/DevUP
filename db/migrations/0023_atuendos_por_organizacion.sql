-- =============================================================================
-- DevUP · 0023 · Atuendos por organización
--
-- La misma persona puede querer verse distinta en dos organizaciones: con la
-- suya va como quiere, y en la del cliente prefiere algo más sobrio. Hoy el
-- personaje es uno solo para todo el mundo.
--
-- SE AÑADE UNA TABLA, NO SE CAMBIA LA CLAVE DE `world_avatars`. Lo evidente
-- sería pasar su clave primaria de `user_id` a `(user_id, organization_id)`,
-- y sería un error por dos motivos. El primero es de migración: obligaría a
-- repartir las filas que ya existen entre las organizaciones de cada cual,
-- inventando datos. El segundo es de producto: sin un aspecto por defecto,
-- entrar por primera vez en una organización nueva te deja gris, y tendrías
-- que vestirte otra vez en cada una.
--
-- Así que `world_avatars` sigue siendo QUIÉN ERES y esto es CÓMO VAS AQUÍ. La
-- fila de aquí manda donde existe; donde no, se lleva el de siempre. Es también
-- lo que hace barata la tienda de ropa del día de mañana: un desbloqueo se
-- aplica a un atuendo concreto sin tocar el personaje base.
--
-- LAS MISMAS COLUMNAS Y LOS MISMOS TOPES, a propósito. Guardar el aspecto como
-- un jsonb aquí habría ahorrado catorce líneas y perdido las catorce
-- comprobaciones: un índice de pelo fuera de rango dejaría de ser un error de
-- la base para pasar a ser un hueco en el dibujo que nadie sabe de dónde sale.
-- =============================================================================

create table if not exists public.world_outfits (
  user_id         uuid not null references public.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,

  body        smallint not null default 0 check (body   between 0 and 63),
  hair        smallint not null default 0 check (hair   between 0 and 63),
  top         smallint not null default 0 check (top    between 0 and 63),
  bottom      smallint not null default 0 check (bottom between 0 and 63),
  skin_tone   smallint not null default 0 check (skin_tone   between 0 and 15),
  hair_tone   smallint not null default 0 check (hair_tone   between 0 and 15),
  top_tone    smallint not null default 0 check (top_tone    between 0 and 15),
  bottom_tone smallint not null default 0 check (bottom_tone between 0 and 15),
  hat         smallint not null default 0 check (hat     between 0 and 63),
  glasses     smallint not null default 0 check (glasses between 0 and 63),
  beard       smallint not null default 0 check (beard   between 0 and 63),
  shoes       smallint not null default 0 check (shoes   between 0 and 63),
  hat_tone    smallint not null default 0 check (hat_tone   between 0 and 15),
  shoes_tone  smallint not null default 0 check (shoes_tone between 0 and 15),

  updated_at  timestamptz not null default now(),
  primary key (user_id, organization_id)
);

alter table public.world_outfits enable row level security;

-- Ver el atuendo de alguien es ver cómo va vestido en ESTA organización, así
-- que la condición no es «compartimos alguna organización» —la de
-- `world_avatars`— sino «los dos estamos en esta». Con la condición laxa, quien
-- comparte contigo la organización A vería cómo vas en la B, que es
-- precisamente lo que este atuendo existe para separar.
drop policy if exists world_outfits_select on public.world_outfits;
create policy world_outfits_select on public.world_outfits for select
  using (
    public.is_org_member(organization_id)
    and exists (
      select 1 from public.organization_members m
       where m.organization_id = public.world_outfits.organization_id
         and m.user_id = public.world_outfits.user_id
    )
  );

-- Escribir, solo el tuyo y solo donde perteneces. Lo segundo no es cinturón y
-- tirantes: sin ello, cualquiera podría dejar filas suyas en organizaciones
-- ajenas — invisibles para todos, pero ocupando sitio y con su identificador
-- dentro, que ya es contar algo que no le habían preguntado.
drop policy if exists world_outfits_write on public.world_outfits;
create policy world_outfits_write on public.world_outfits for insert
  with check (user_id = public.current_user_id() and public.is_org_member(organization_id));

drop policy if exists world_outfits_update on public.world_outfits;
create policy world_outfits_update on public.world_outfits for update
  using (user_id = public.current_user_id() and public.is_org_member(organization_id))
  with check (user_id = public.current_user_id() and public.is_org_member(organization_id));

-- Quitar el atuendo es volver al personaje de siempre, y tiene que poder
-- hacerse: si vestirse en una organización fuera irreversible, nadie probaría
-- nada.
drop policy if exists world_outfits_delete on public.world_outfits;
create policy world_outfits_delete on public.world_outfits for delete
  using (user_id = public.current_user_id());

/**
 * Guarda el atuendo de quien llama en una organización.
 *
 * `security invoker` como su hermana de 0011: aquí no hay ninguna consulta que
 * necesite ver más de lo que ve quien pregunta, así que las políticas de arriba
 * se aplican y son toda la seguridad que hace falta. Un `security definer` que
 * no lo necesita es una puerta que alguien acabará empujando.
 */
create or replace function public.upsert_world_outfit(_org uuid, _look jsonb)
returns void
language sql
volatile
security invoker
set search_path = public
as $$
  insert into public.world_outfits (
    user_id, organization_id, body, hair, top, bottom,
    skin_tone, hair_tone, top_tone, bottom_tone,
    hat, glasses, beard, shoes, hat_tone, shoes_tone, updated_at
  )
  values (
    public.current_user_id(),
    _org,
    coalesce((_look->>'body')::smallint, 0),
    coalesce((_look->>'hair')::smallint, 0),
    coalesce((_look->>'top')::smallint, 0),
    coalesce((_look->>'bottom')::smallint, 0),
    coalesce((_look->>'skinTone')::smallint, 0),
    coalesce((_look->>'hairTone')::smallint, 0),
    coalesce((_look->>'topTone')::smallint, 0),
    coalesce((_look->>'bottomTone')::smallint, 0),
    coalesce((_look->>'hat')::smallint, 0),
    coalesce((_look->>'glasses')::smallint, 0),
    coalesce((_look->>'beard')::smallint, 0),
    coalesce((_look->>'shoes')::smallint, 0),
    coalesce((_look->>'hatTone')::smallint, 0),
    coalesce((_look->>'shoesTone')::smallint, 0),
    now()
  )
  on conflict (user_id, organization_id) do update set
    body = excluded.body, hair = excluded.hair,
    top = excluded.top, bottom = excluded.bottom,
    skin_tone = excluded.skin_tone, hair_tone = excluded.hair_tone,
    top_tone = excluded.top_tone, bottom_tone = excluded.bottom_tone,
    hat = excluded.hat, glasses = excluded.glasses,
    beard = excluded.beard, shoes = excluded.shoes,
    hat_tone = excluded.hat_tone, shoes_tone = excluded.shoes_tone,
    updated_at = now();
$$;
