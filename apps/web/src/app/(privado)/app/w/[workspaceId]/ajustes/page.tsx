// Mismo componente que `/app/o/[orgId]/ajustes`, montado bajo la URL del
// workspace para que abrirlo no cambie de armazón — sigue siendo
// `WorkspaceLayout` el que pinta la barra. `useOrgId`, dentro del componente,
// resuelve la organización desde el `WorkspaceProvider` en vez de la URL.
// Ver el comentario de `NavegacionOrganizacion.tsx`.
export { default } from "@/app/(privado)/app/o/[orgId]/ajustes/page";
