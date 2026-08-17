-- =============================================================================
-- DevUP · 0018 · A la bóveda le faltaba poder actualizarse
--
-- 0015 le puso a `connection_secrets` políticas de select, insert y delete — y
-- se olvidó la de update. Con RLS activo y ninguna política para un comando,
-- Postgres no lanza ningún error: simplemente afecta a cero filas.
--
-- LO QUE ROMPÍA, Y POR QUÉ NO SE VEÍA. Un token de Spotify caduca en una hora,
-- así que `getValidUserToken` lo refresca y guarda el nuevo. Ese UPDATE se
-- estaba denegando en silencio. Consecuencias, en orden de gravedad creciente:
--
--   1. Cada petición que necesitaba el token volvía a pedirle uno nuevo a
--      Spotify, porque la caducidad guardada seguía siendo la vieja. Funcionaba,
--      pero gastando una llamada de más en cada una.
--   2. Spotify puede devolver un `refresh_token` nuevo al refrescar. Si lo
--      hacía, se perdía — y con él la única forma de volver a entrar sin
--      reautorizar. La conexión se moría sola y sin rastro.
--
-- Es el mismo patrón que §9 de CONTEXTO-COMPLETO.md llama el fallo más
-- peligroso de esta arquitectura: la política que no está no da error, solo
-- devuelve o escribe de menos.
-- =============================================================================

drop policy if exists connection_secrets_update on public.connection_secrets;
create policy connection_secrets_update on public.connection_secrets for update
  using (
    exists (
      select 1 from public.connections c
       where c.id = connection_secrets.connection_id
         and (
           (c.organization_id is not null and public.is_org_admin(c.organization_id))
           or (c.user_id is not null and c.user_id = public.current_user_id())
         )
    )
  )
  with check (
    exists (
      select 1 from public.connections c
       where c.id = connection_secrets.connection_id
         and (
           (c.organization_id is not null and public.is_org_admin(c.organization_id))
           or (c.user_id is not null and c.user_id = public.current_user_id())
         )
    )
  );
