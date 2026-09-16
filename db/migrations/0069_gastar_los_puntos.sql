-- ---------------------------------------------------------------------------
-- 0069 · Gastar los puntos: la tienda del DevVerse
-- ---------------------------------------------------------------------------
--
-- GANARLOS YA FUNCIONA DESDE LA 0055 y no había dónde gastarlos. Esto es el
-- otro lado.
--
-- EL GASTO ES UN ASIENTO NEGATIVO EN `puntos`, NO UNA COLUMNA «SALDO». Un saldo
-- guardado aparte se desincroniza el primer día que algo falle a medias, y
-- entonces no hay forma de saber cuál de los dos números es el bueno: ni el
-- saldo ni la suma, porque ya discrepan. Sumar la columna es barato —hay un
-- índice por (organización, persona)— y siempre es verdad.
--
-- POR ESO EL `check` DE `cantidad` SE ABRE, y es el único cambio sobre algo que
-- ya existía: era `> 0` porque hasta hoy todos los asientos sumaban. Abrirlo a
-- `<> 0` no invalida ninguna fila de las que hay —ampliar una restricción nunca
-- lo hace— y sigue impidiendo el asiento de cero, que no es un hecho: es ruido.
--
-- LO QUE NO SE VENDE, Y ESTO ES UNA DECISIÓN, NO UN OLVIDO: nada de lo que hoy
-- es gratis. Las piezas que el editor de avatar ya ofrece —las cuatro gorras,
-- las tres gafas, todo lo demás— siguen siendo gratis para siempre. Cobrar por
-- algo que la gente ya tiene puesto es desandar lo ganado, y eso rompe la
-- confianza en el marcador entero igual que quitarle puntos a alguien. La
-- tienda vende piezas NUEVAS, que nacen ya con precio.
--
-- LOS PRECIOS SON DATOS, no constantes en el código, y esa es la parte que hace
-- que la calibración se pueda corregir: si una semana normal resulta dar la
-- mitad de puntos de lo que se calculó, esto se arregla con un `update` de una
-- fila y no con una migración. El razonamiento de los números de abajo está en
-- docs/decisiones/0005-que-cuesta-que-en-el-devverse.md.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- El motivo nuevo
-- ---------------------------------------------------------------------------
--
-- `add value if not exists` es idempotente, que es lo que pide la disciplina de
-- este repositorio. No hay vuelta atrás para un valor de enum en Postgres, pero
-- tampoco hace falta: un valor que nadie usa no molesta a nadie.
alter type public.motivo_de_punto add value if not exists 'compro';

-- ---------------------------------------------------------------------------
-- El asiento negativo
-- ---------------------------------------------------------------------------
alter table public.puntos drop constraint if exists puntos_cantidad_check;
do $$ begin
  alter table public.puntos add constraint puntos_cantidad_check check (cantidad <> 0);
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- El catálogo
-- ---------------------------------------------------------------------------
--
-- ES GLOBAL Y NO POR ORGANIZACIÓN: lo que se vende es contenido del producto,
-- igual para todo el mundo, no algo que cada equipo configure. De ahí que la
-- política de lectura no mire pertenencia — enseñar el catálogo a quien tiene
-- sesión no cuenta nada de nadie.
--
-- `clave` Y NO SOLO EL ID: lo que se compra es una pieza concreta del dibujo
-- («hat:4»), y el código del avatar la nombra así. Un uuid obligaría a una
-- traducción más en cada sitio que pinta un muñeco.
do $$ begin
  create type public.tipo_de_articulo as enum ('ropa', 'edificio');
exception when duplicate_object then null;
end $$;

create table if not exists public.tienda_articulos (
  id          uuid primary key default gen_random_uuid(),
  clave       text not null unique check (clave ~ '^[a-z]+:[0-9]+$'),
  nombre      text not null check (length(btrim(nombre)) between 1 and 60),
  descripcion text not null default '' check (length(descripcion) <= 200),
  tipo        public.tipo_de_articulo not null default 'ropa',
  -- El precio en puntos. Se cambia con un `update` cuando la calibración lo
  -- pida; por eso es una fila y no una constante.
  precio      integer not null check (precio > 0),
  -- Apagar un artículo en vez de borrarlo: quien ya lo compró tiene que poder
  -- seguir llevándolo puesto, y una fila borrada deja su compra sin nombre.
  activo      boolean not null default true,
  orden       integer not null default 0,
  creado_en   timestamptz not null default now()
);

alter table public.tienda_articulos enable row level security;

drop policy if exists tienda_articulos_select on public.tienda_articulos;
create policy tienda_articulos_select on public.tienda_articulos for select
  using (public.current_user_id() is not null);

-- Sin políticas de escritura, a propósito: el catálogo lo pone una migración.
-- Un artículo que se pueda crear desde la aplicación es un precio que se puede
-- poner quien va a pagarlo.

-- ---------------------------------------------------------------------------
-- Lo comprado
-- ---------------------------------------------------------------------------
--
-- EL ÚNICO (persona, artículo) ES LA MITAD DE «NO SE COMPRA DOS VECES», y la
-- mitad que aguanta aunque dos pestañas pulsen a la vez: la otra mitad —que no
-- se pueda quedar en negativo— la pone la función de abajo, porque eso no lo
-- puede decir un índice.
--
-- `precio_pagado` COPIADO Y NO LEÍDO DEL CATÁLOGO: si mañana sube el precio, lo
-- que esta persona pagó sigue siendo lo que pagó. Es el mismo criterio que el
-- título de la tarea copiado en `puntos` (0055).
create table if not exists public.compras (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  articulo_id   uuid not null references public.tienda_articulos(id) on delete restrict,
  precio_pagado integer not null check (precio_pagado > 0),
  at            timestamptz not null default now(),
  unique (user_id, articulo_id)
);

-- El único ya cubre las consultas por persona (es su prefijo). Este es para el
-- otro lado: Postgres no indexa las claves ajenas solo, y sin esto borrar un
-- artículo escanearía la tabla entera.
create index if not exists compras_por_articulo_idx on public.compras (articulo_id);

alter table public.compras enable row level security;

-- CADA QUIEN VE LAS SUYAS, y aquí no se abre a la organización como en
-- `puntos`. Aquello se abrió a propósito —un total que nadie puede contrastar
-- vuelve a ser un número que hay que creerse— pero esto es lo que alguien se ha
-- comprado, y no se contrasta con nada: se ve puesto en su muñeco.
drop policy if exists compras_select on public.compras;
create policy compras_select on public.compras for select
  using (user_id = public.current_user_id());

-- Sin insert, update ni delete: se entra por la función. Una compra que se
-- pueda escribir a mano es un artículo gratis.

-- ---------------------------------------------------------------------------
-- Comprar
-- ---------------------------------------------------------------------------
--
-- LAS TRES COSAS QUE TIENE QUE GARANTIZAR, y ninguna sobra:
--
--   1. Que exista y esté a la venta.
--   2. Que no lo tengas ya. Lo dice el único, y se traduce a una frase en vez
--      de dejar salir una violación de restricción.
--   3. QUE NO TE DEJE EN NEGATIVO, que es la que no puede poner ningún índice.
--      Se comprueba sumando los asientos, que es la única cuenta que siempre es
--      verdad.
--
-- EL CERROJO POR PERSONA ES LO QUE HACE QUE 3 SEA CIERTA DE VERDAD. Sin él, dos
-- compras a la vez leen el mismo saldo, las dos lo ven suficiente y las dos
-- pasan: el saldo acaba en negativo sin que ninguna fila esté mal. Es un
-- cerrojo de transacción, así que se suelta solo al terminar —no hay forma de
-- olvidarse de soltarlo— y solo se pisan entre sí las compras de la MISMA
-- persona.
create or replace function public.comprar_articulo(_clave text)
returns public.compras
language plpgsql
security definer
set search_path = public
as $$
declare
  _yo        uuid := public.current_user_id();
  _articulo  public.tienda_articulos;
  _saldo     integer;
  _compra    public.compras;
begin
  if _yo is null then
    raise exception 'hace falta sesión para comprar';
  end if;

  perform pg_advisory_xact_lock(hashtext('comprar:' || _yo::text));

  select * into _articulo from public.tienda_articulos
   where clave = _clave and activo;
  if not found then
    raise exception 'ese artículo no existe o ya no está a la venta';
  end if;

  if exists (select 1 from public.compras where user_id = _yo and articulo_id = _articulo.id) then
    raise exception 'ya tienes eso';
  end if;

  select coalesce(sum(cantidad), 0) into _saldo from public.puntos where user_id = _yo;
  if _saldo < _articulo.precio then
    raise exception 'te faltan % puntos', _articulo.precio - _saldo;
  end if;

  insert into public.compras (user_id, articulo_id, precio_pagado)
  values (_yo, _articulo.id, _articulo.precio)
  returning * into _compra;

  -- El asiento del gasto. `organization_id` y `workspace_id` son obligatorios
  -- en `puntos` desde la 0055 —los asientos nacieron atados a una tarea— así
  -- que se toma uno cualquiera de los de esta persona: el gasto es suyo, no de
  -- un espacio, y elegir el primero es más honesto que inventar un espacio
  -- «tienda» que no existe en ninguna otra parte.
  insert into public.puntos
    (organization_id, workspace_id, user_id, task_id, task_label, motivo, cantidad, a_solas)
  select p.organization_id, p.workspace_id, _yo, null, _articulo.nombre, 'compro', -_articulo.precio, true
    from public.puntos p
   where p.user_id = _yo
   order by p.at desc
   limit 1;

  return _compra;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lo que hay a la venta hoy
-- ---------------------------------------------------------------------------
--
-- PRECIOS PROPUESTOS, NO ACORDADOS. Salen de lo que ya se gana: 10 por cerrar
-- una tarea y 5 más por dejar prueba, o sea 40-60 en una semana de cuatro
-- tareas bien cerradas. Con eso:
--
--   · 60 puntos  → la primera semana. Algo que se note enseguida o nadie
--                  vuelve a mirar el marcador.
--   · 180 puntos → un mes largo.
--   · 500 puntos → un trimestre. Es la pieza que se enseña.
--
-- Todas son piezas NUEVAS del vestuario: ninguna estaba antes en el editor.
-- Si los números no cuadran con la realidad de un mes, se corrigen con un
-- `update` de esta tabla.
insert into public.tienda_articulos (clave, nombre, descripcion, tipo, precio, orden) values
  ('hat:4',     'Bandana',          'La cinta de quien lleva un rato dándole.',  'ropa', 60,  1),
  ('glasses:3', 'Visor',            'Una sola pieza, con su brillo.',            'ropa', 60,  2),
  ('hat:5',     'Sombrero de ala',  'Sombra propia en una oficina sin sol.',     'ropa', 180, 3),
  ('hat:6',     'Corona',           'Un trimestre entero cerrando cosas.',       'ropa', 500, 4)
on conflict (clave) do nothing;
