-- =============================================================================
-- DevUP · 0024 · La cola deja de ser de Spotify
--
-- Está cerrado en la propuesta y hasta ahora no estaba implementado: **la cola
-- guarda la canción, no el enlace de un servicio**. Su identificador
-- internacional de grabación —el ISRC—, su título y su artista. Cada persona la
-- reproduce en el suyo.
--
-- POR QUÉ NO SE PUEDE HACER LO OTRO. Sonar sincronizados entre plataformas no
-- es cuestión de esfuerzo: reproducir en el navegador exige una suscripción de
-- pago por oyente en un servicio, un programa de desarrollador de pago en otro,
-- y en un tercero no hay interfaz oficial. No existe forma de que dos personas
-- en servicios distintos estén en el mismo segundo de la misma canción. Se gana
-- una sola lista de verdad; se pierde la escucha simultánea al segundo.
--
-- Y GUARDAR LA CANCIÓN ES LO CORRECTO AUNQUE SOLO HUBIERA UN SERVICIO: el
-- enlace es de una plataforma, la canción es del equipo. Una cola llena de
-- `spotify:track:…` es una cola que muere el día que alguien se cambia, y no
-- porque falte una función sino porque nunca se guardó lo que importaba.
--
-- `track_uri` SE QUEDA, Y PASA A SER OPCIONAL. Deja de ser la identidad de la
-- canción para ser un atajo: si quien escucha usa el mismo servicio desde el
-- que se añadió, se reproduce sin buscar nada. Si usa otro, se resuelve por
-- ISRC. Tirarlo habría hecho que todas las colas que ya existen tuvieran que
-- resolverse una por una la primera vez, a cambio de nada.
-- =============================================================================

-- El ISRC son doce caracteres: dos de país, tres de registrante, dos de año y
-- cinco de designación. Se guarda en mayúsculas y sin guiones, que es la forma
-- canónica — con guiones, el mismo código no se parecería a sí mismo.
alter table public.channel_queue_tracks
  add column if not exists isrc text
    check (isrc is null or isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$');

alter table public.channel_listening_sessions
  add column if not exists isrc text
    check (isrc is null or isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$');

-- Deja de ser obligatorio: una canción añadida por ISRC —desde otro servicio, o
-- pegando un código— es una canción legítima aunque nadie sepa su dirección en
-- Spotify.
alter table public.channel_queue_tracks
  alter column track_uri drop not null;

-- Pero algo hay que tener para saber de qué canción se habla. Sin ISRC ni
-- dirección, la fila es un título suelto que nadie puede reproducir.
alter table public.channel_queue_tracks
  drop constraint if exists channel_queue_tracks_identificable;
alter table public.channel_queue_tracks
  add constraint channel_queue_tracks_identificable
    check (isrc is not null or track_uri is not null);

-- Buscar «¿está ya esta canción en la cola?» pasa a hacerse por ISRC, que es lo
-- que la identifica de verdad. Sin índice es un recorrido por cola y canción.
create index if not exists channel_queue_tracks_isrc_idx
  on public.channel_queue_tracks (channel_id, isrc)
  where isrc is not null;
