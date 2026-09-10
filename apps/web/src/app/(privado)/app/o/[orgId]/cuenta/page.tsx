// Mismo componente que `/app/w/[workspaceId]/cuenta`, para poder llegar a «Mi
// cuenta» también desde el armazón de organización. Aquí la fuente vive en la
// ruta del workspace y no al contrario, al revés que en Ventas o GitHub: esta
// pantalla no es de la organización —no lee `orgId` para nada—, así que su
// sitio natural es la barra del espacio de trabajo, donde se está.
export { default } from "@/app/(privado)/app/w/[workspaceId]/cuenta/page";
