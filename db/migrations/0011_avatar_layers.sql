-- =============================================================================
-- DevUP · 0011 · Más capas de avatar
--
-- Ver docs/plan-mundo-y-plataforma.md §5.2.
--
-- Con complexión, pelo y dos colores de ropa, dieciocho personas en una
-- oficina empiezan a repetirse. Gafas, barba, gorro y calzado multiplican las
-- combinaciones por bastante más de lo que cuestan: son cuatro rectángulos de
-- dibujo y cuatro columnas.
--
-- La función pasa a recibir un jsonb en vez de una lista de argumentos. Con
-- ocho campos la lista ya era incómoda; con catorce, un argumento traspuesto
-- vestiría a alguien con el pelo del color de los zapatos y nada fallaría. Con
-- un objeto, cada campo va por su nombre y añadir la capa quince no vuelve a
-- cambiar la firma — que es justo lo que ha pasado hoy.
-- =============================================================================

alter table public.world_avatars
  add column if not exists hat     smallint not null default 0 check (hat     between 0 and 63),
  add column if not exists glasses smallint not null default 0 check (glasses between 0 and 63),
  add column if not exists beard   smallint not null default 0 check (beard   between 0 and 63),
  add column if not exists shoes   smallint not null default 0 check (shoes   between 0 and 63),
  add column if not exists hat_tone   smallint not null default 0 check (hat_tone   between 0 and 15),
  add column if not exists shoes_tone smallint not null default 0 check (shoes_tone between 0 and 15);

-- La firma vieja se retira: dejarla como sobrecarga significaría que una
-- llamada antigua guarda el avatar a medias y borra en silencio las capas
-- nuevas, sin error y sin rastro.
drop function if exists public.upsert_world_avatar(
  smallint, smallint, smallint, smallint, smallint, smallint, smallint, smallint
);

create or replace function public.upsert_world_avatar(_look jsonb)
returns void
language sql
volatile
security invoker
set search_path = public
as $$
  insert into public.world_avatars (
    user_id, body, hair, top, bottom,
    skin_tone, hair_tone, top_tone, bottom_tone,
    hat, glasses, beard, shoes, hat_tone, shoes_tone, updated_at
  )
  values (
    public.current_user_id(),
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
  on conflict (user_id) do update set
    body = excluded.body, hair = excluded.hair,
    top = excluded.top, bottom = excluded.bottom,
    skin_tone = excluded.skin_tone, hair_tone = excluded.hair_tone,
    top_tone = excluded.top_tone, bottom_tone = excluded.bottom_tone,
    hat = excluded.hat, glasses = excluded.glasses,
    beard = excluded.beard, shoes = excluded.shoes,
    hat_tone = excluded.hat_tone, shoes_tone = excluded.shoes_tone,
    updated_at = now();
$$;
