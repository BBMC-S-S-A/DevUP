-- =============================================================================
-- DevUP · 0022 · Presencia y rol en el perfil
--
-- La cartelera que va sobre cada personaje en DevVerse: nombre, rol y estado.
-- El nombre ya estaba; esto añade los otros dos.
--
-- EL TERCER ESTADO ES EL MOTIVO DE TODO ESTO. Las herramientas de trabajo
-- ofrecen «disponible» y «no molestar», y la verdad la mayor parte del tiempo
-- no es ninguna de las dos: es **ocupado, pero abierto a llamadas** — estoy
-- concentrado, no me escribas por cualquier cosa, y si de verdad hace falta
-- hablar, llámame. Sin ese estado la gente se pone «no molestar» para que la
-- dejen en paz y de paso se aísla de lo que sí importaba, o se deja
-- «disponible» y acepta que la interrumpan por todo.
--
-- VA EN `profiles` Y NO EN `users`. `users` guarda credenciales y lo lee muy
-- poca gente; `profiles` es la cara pública y ya tiene la política que hace
-- falta: lo ve quien comparte alguna organización contigo, y lo cambia solo su
-- dueño. Presencia y rol son exactamente eso.
--
-- ES UNA ELECCIÓN, NO UNA DEDUCCIÓN. No se calcula del teclado ni de si hay una
-- pestaña abierta. Un estado que el sistema adivina acaba mintiendo —dice
-- «disponible» de alguien que salió a comer y dejó el portátil abierto— y
-- enseña a no fiarse de él, que es peor que no tenerlo.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'presence_state') then
    create type public.presence_state as enum (
      'available',
      -- «Ocupado, pero abierto a llamadas». El nombre largo va en la interfaz;
      -- aquí basta con que se distinga de los otros dos.
      'busy_open',
      'do_not_disturb'
    );
  end if;
end$$;

alter table public.profiles
  add column if not exists presence public.presence_state not null default 'available';

-- El rol es texto libre y no un catálogo: «backend», «diseño», «la persona que
-- sabe de facturas». Un desplegable cerrado obliga a alguien a elegir la
-- casilla que menos le miente, y lo que se quiere saber al cruzarse con
-- alguien en la oficina es a qué se dedica, no en qué casilla cabe.
alter table public.profiles
  add column if not exists title text check (title is null or length(btrim(title)) <= 40);
