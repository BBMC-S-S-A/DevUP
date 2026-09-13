// Mismo componente que `/app/w/[workspaceId]/cuenta`, para poder llegar a «Mi
// cuenta» también desde el armazón de organización. La fuente vive en la ruta
// del workspace y no al contrario, al revés que en Ventas o GitHub: casi todo
// lo de esta pantalla es de la persona y no de la organización, así que su
// sitio natural es la barra del espacio de trabajo, donde se está.
//
// SÍ LEE `orgId`, desde la tarjeta «En esta organización»: el oficio y el rol
// cambian de una a otra (0048 y 0052). `useOrgId` lo resuelve por las dos vías
// —el parámetro de la URL aquí, el `WorkspaceProvider` allí— así que las dos
// direcciones funcionan sin que la pantalla sepa por cuál la abrieron.
export { default } from "@/app/(privado)/app/w/[workspaceId]/cuenta/page";
