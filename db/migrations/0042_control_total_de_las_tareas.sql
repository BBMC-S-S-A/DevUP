-- =============================================================================
-- DevUP · 0042 · Control total de las tareas: tipo, prioridad, contexto,
--                ramas y evidencia
--
-- DE QUÉ VA ESTO. Una tarjeta de DevUP sabía hasta hoy cinco cosas: cómo se
-- llama, qué dice, de quién es, cuándo vence y en qué columna está. Eso basta
-- para un tablero de recados y se queda corto para lo que dice ser este
-- producto —el gestor del DESARROLLO del proyecto—, porque las preguntas que
-- de verdad se hacen sobre una tarea de desarrollo son otras: qué clase de
-- trabajo es, cuánto corre, de dónde salió, cómo sabremos que está hecha, en
-- qué rama se está tocando y qué prueba que se hizo.
--
-- LAS CINCO COSAS QUE SE AÑADEN, Y POR QUÉ CADA UNA ESTÁ DONDE ESTÁ:
--
--   · `tipo` y `prioridad` son COLUMNAS de la tarea porque son una sola cosa
--     cada una y porque hay que poder ordenar y filtrar por ellas sin un join.
--   · `contexto` y `criterio` son columnas de texto porque son la tarea misma
--     contada con más detalle, no cosas que le cuelgan.
--   · Las RAMAS son una tabla aparte porque son varias: eso es justo lo que se
--     pidió —«por si la persona divide el plan de desarrollo en varios
--     caminos»—, y un campo de texto con comas es una tabla mal hecha.
--   · La EVIDENCIA es una tabla aparte por lo mismo, y además porque cada
--     prueba tiene su autor y su fecha: es un hecho, y los hechos se apilan.
--
-- ─────────────────────────────────────────────────────────────────────────
--
-- EL TIPO ES UN VOCABULARIO CERRADO, Y ES LA DECISIÓN QUE MÁS SE VA A
-- DISCUTIR. Lo cómodo habría sido una tabla de tipos por espacio, como las
-- áreas de la 0039. Y sería un error, por dos motivos:
--
--   1. Ya existe ese eje. Las áreas son «de qué trata y de quién es», y se
--      inventan por tablero a propósito. El tipo es otra cosa: «qué clase de
--      trabajo es esto», y esa clasificación **no depende del proyecto**.
--      Arreglar un fallo es arreglar un fallo en cualquier empresa. Dejar que
--      cada tablero invente sus tipos crearía una segunda taxonomía libre que
--      acabaría compitiendo con las áreas y significando lo mismo.
--   2. Un vocabulario cerrado es lo único que permite comparar entre tableros
--      —«¿cuánto de lo que hicimos este trimestre fue deuda técnica?»—, que es
--      exactamente la pregunta para la que el tipo existe. Ocho valores
--      distintos por tablero convierten esa pregunta en imposible.
--
-- Y por eso son ocho y no veinte: una lista que no cabe en un desplegable sin
-- desplazarse es una lista que la gente rellena al azar.
--
-- EL TIPO ES NULO POR DEFECTO, y no es dejadez. Poner `funcionalidad` de
-- oficio haría que la mitad del tablero dijera «funcionalidad» sin que nadie
-- lo hubiera decidido, y entonces el dato deja de valer para la pregunta de
-- arriba: no se distinguiría lo tipado de lo que nadie miró. «Sin clasificar»
-- es un estado honesto y se ve como lo que es.
--
-- LA PRIORIDAD ES UN NÚMERO Y NO UN ENUM, aunque el tipo de al lado sí lo sea.
-- La diferencia es que la prioridad se ORDENA: «lo más urgente primero» es una
-- cláusula `order by` y con un enum habría que arrastrar un `case` a cada
-- consulta que la use. Cuatro niveles, con `normal` por defecto: con tres no
-- cabe la diferencia entre «esto corre» y «esto es ahora», y a partir de cinco
-- nadie coincide en qué significa el de en medio. Que el valor por defecto sea
-- el de en medio y no el más bajo es deliberado: así marcar algo es decir
-- «esto NO es normal», que es la única información que aporta una prioridad.
--
-- POR QUÉ `contexto` Y `criterio` SON DOS CAMPOS Y NO UNO MÁS DE DESCRIPCIÓN.
-- Porque contestan a preguntas distintas y en momentos distintos. El contexto
-- se lee AL EMPEZAR —de dónde salió esto, qué se intentó antes, con qué no hay
-- que romper—; el criterio se lee AL TERMINAR —cómo sabemos que está hecha—.
-- Metidos los dos en `description` se convierten en un muro que no se lee
-- entero ninguna de las dos veces. Separados, además, el criterio se puede
-- enseñar en el momento de cerrar, que es el único en que sirve.
--
-- LAS RAMAS NO SE VALIDAN CONTRA GITHUB, Y ESO ES A PROPÓSITO. Se guarda el
-- nombre tal cual y, si el espacio tiene repositorios conectados, ADEMÁS a
-- cuál pertenece. Exigir la conexión para poder apuntar una rama dejaría la
-- función inservible para quien trabaja con un GitLab, un Gitea o un repositorio
-- privado sin conectar — que hoy es casi todo el mundo el primer día. Con el
-- repositorio apuntado se puede componer el enlace; sin él, sigue sirviendo
-- para lo primero que hace falta: saber dónde está ese trabajo.
--
-- LA EVIDENCIA NO SUSTITUYE A LOS ADJUNTOS. Los archivos ya tienen su sitio
-- (`attachments`). Esto es para lo que no es un archivo: el PR que la cierra,
-- el commit, el enlace al entorno donde se ve, o la nota de quien la revisó.
-- Un archivo subido es algo que alguien guardó; una evidencia es algo que
-- alguien AFIRMA, con su nombre y su fecha al lado. Por eso se anota también
-- en el registro de actividad.
--
-- LA EVIDENCIA NO SE EDITA. Hay política de borrado —quien se equivoca de
-- enlace tiene que poder quitarlo— pero no de UPDATE: cambiar en silencio lo
-- que alguien afirmó, dejando su nombre debajo, es justo lo que un registro de
-- pruebas no puede permitir. Corregir es borrar y volver a poner, y eso queda
-- en el registro.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Qué clase de trabajo es
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_kind') then
    create type public.task_kind as enum (
      'funcionalidad',   -- algo que antes no se podía hacer
      'arreglo',         -- algo que no funciona como dice
      'mejora',          -- funciona, pero no lo bastante bien
      'deuda',           -- funciona y hay que rehacerlo igualmente
      'investigacion',   -- todavía no se sabe qué hay que hacer
      'documentacion',
      'diseno',
      'infraestructura'  -- despliegue, entornos, tuberías, credenciales
    );
  end if;
end $$;

alter table public.tasks
  add column if not exists tipo public.task_kind;

-- ---------------------------------------------------------------------------
-- 2. Cuánto corre
--
-- 0 baja · 1 normal · 2 alta · 3 urgente. Ver la cabecera: número y no enum
-- porque se ordena, y `normal` por defecto porque marcar algo tiene que
-- significar «esto no es normal».
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists prioridad smallint not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tasks_prioridad_valida'
  ) then
    alter table public.tasks
      add constraint tasks_prioridad_valida check (prioridad between 0 and 3);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Más contexto: de dónde sale, y cuándo está hecha
--
-- Con tope de longitud, que `description` no tiene. No es por el espacio: es
-- que un campo sin límite acaba con un documento entero pegado dentro, y
-- entonces deja de leerse — que es lo contrario de para lo que está. Cuatro
-- mil caracteres son unas dos páginas; lo que no quepa ahí es un documento y
-- su sitio es un enlace en la evidencia.
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists contexto text not null default '';
alter table public.tasks
  add column if not exists criterio text not null default '';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_contexto_cabe') then
    alter table public.tasks
      add constraint tasks_contexto_cabe check (length(contexto) <= 4000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_criterio_cabe') then
    alter table public.tasks
      add constraint tasks_criterio_cabe check (length(criterio) <= 4000);
  end if;
end $$;

-- Para «lo más urgente primero» dentro de una columna sin ordenar la tabla
-- entera. `prioridad desc` porque 3 es lo que más corre.
create index if not exists tasks_prioridad_idx
  on public.tasks (column_id, prioridad desc, position);

-- ---------------------------------------------------------------------------
-- 4. Las ramas donde se está tocando
--
-- Varias por tarea a propósito: un plan de desarrollo partido en dos caminos
-- —el de la API y el de la interfaz, o una prueba de concepto en paralelo— son
-- dos ramas de la misma tarea, y obligar a partir la tarea en dos para poder
-- apuntarlas sería inventarse trabajo administrativo para dar de comer al
-- modelo de datos.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'branch_state') then
    create type public.branch_state as enum ('abierta', 'fusionada', 'descartada');
  end if;
end $$;

create table if not exists public.task_branches (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references public.tasks(id) on delete cascade,
  nombre         text not null check (length(btrim(nombre)) between 1 and 255),

  -- Opcional a propósito: ver la cabecera. Con él se puede componer el enlace;
  -- sin él, la rama sigue sirviendo para saber dónde está el trabajo.
  github_repo_id uuid references public.github_repos(id) on delete set null,

  -- `descartada` existe y no es lo mismo que borrar la fila: un camino que se
  -- probó y se abandonó es información —la siguiente persona que lo piense ya
  -- sabe que se intentó— y borrarlo la tira.
  estado         public.branch_state not null default 'abierta',

  created_by     uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default now(),

  -- La misma rama del mismo repositorio no se apunta dos veces. `nulls not
  -- distinct` porque «sin repositorio» tiene que contar como un valor y no
  -- como «distinto siempre de sí mismo», o la rama sin repo se podría repetir
  -- sin límite.
  unique nulls not distinct (task_id, github_repo_id, nombre)
);

create index if not exists task_branches_task_idx on public.task_branches (task_id);

-- ---------------------------------------------------------------------------
-- 5. La evidencia: qué prueba que esto se hizo
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'evidence_kind') then
    create type public.evidence_kind as enum (
      'pr',       -- la petición de fusión que la cierra
      'commit',
      'enlace',   -- el entorno donde se ve, el panel, el documento
      'nota'      -- lo que comprobó una persona y no deja rastro en ningún sitio
    );
  end if;
end $$;

create table if not exists public.task_evidence (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  tipo       public.evidence_kind not null,

  -- Nula solo para las notas: una nota ES el texto. Lo demás apunta a algo, y
  -- una evidencia que dice «hay un PR» sin decir cuál no prueba nada.
  url        text check (url is null or length(btrim(url)) between 1 and 2000),
  titulo     text not null default '' check (length(titulo) <= 200),
  nota       text not null default '' check (length(nota) <= 2000),

  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint evidencia_con_algo_dentro check (
    (tipo = 'nota' and length(btrim(nota)) > 0)
    or (tipo <> 'nota' and url is not null)
  )
);

create index if not exists task_evidence_task_idx on public.task_evidence (task_id, created_at);

-- ---------------------------------------------------------------------------
-- Aislamiento
--
-- Las dos tablas cuelgan de una tarea y no llevan `workspace_id` propio: se
-- apoyan en la política de `tasks`, igual que `task_tags` desde la 0004. El
-- `exists` corre con los privilegios de quien pregunta, así que si la tarea no
-- es visible, la subconsulta no devuelve nada y la fila tampoco existe.
--
-- Repetir `workspace_id` aquí habría dado un índice mejor y una forma nueva de
-- que las dos copias se contradigan: una fila cuyo `workspace_id` dijera una
-- cosa y cuya tarea dijera otra sería visible para quien no debe, y nada
-- fallaría.
-- ---------------------------------------------------------------------------
alter table public.task_branches enable row level security;
alter table public.task_evidence enable row level security;

drop policy if exists task_branches_select on public.task_branches;
create policy task_branches_select on public.task_branches for select
  using (exists (select 1 from public.tasks t where t.id = task_id));

drop policy if exists task_branches_insert on public.task_branches;
create policy task_branches_insert on public.task_branches for insert
  with check (exists (select 1 from public.tasks t where t.id = task_id));

drop policy if exists task_branches_update on public.task_branches;
create policy task_branches_update on public.task_branches for update
  using (exists (select 1 from public.tasks t where t.id = task_id))
  with check (exists (select 1 from public.tasks t where t.id = task_id));

drop policy if exists task_branches_delete on public.task_branches;
create policy task_branches_delete on public.task_branches for delete
  using (exists (select 1 from public.tasks t where t.id = task_id));

drop policy if exists task_evidence_select on public.task_evidence;
create policy task_evidence_select on public.task_evidence for select
  using (exists (select 1 from public.tasks t where t.id = task_id));

drop policy if exists task_evidence_insert on public.task_evidence;
create policy task_evidence_insert on public.task_evidence for insert
  with check (
    exists (select 1 from public.tasks t where t.id = task_id)
    -- Una evidencia se firma con el nombre de quien la pone. Dejar escribir
    -- `created_by` ajeno permitiría atribuirle a otro una comprobación que no
    -- hizo, que es la única forma que tiene esta tabla de mentir.
    and (created_by is null or created_by = public.current_user_id())
  );

-- SIN POLÍTICA DE UPDATE, Y NO ES UN OLVIDO. Ver la cabecera: cambiar en
-- silencio lo que alguien afirmó, dejando su nombre debajo, es justo lo que un
-- registro de pruebas no puede permitir. Sin política, Postgres deniega.
drop policy if exists task_evidence_update on public.task_evidence;

drop policy if exists task_evidence_delete on public.task_evidence;
create policy task_evidence_delete on public.task_evidence for delete
  using (exists (select 1 from public.tasks t where t.id = task_id));
