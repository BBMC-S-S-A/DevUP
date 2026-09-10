# Imagen de la API.
#
# Multietapa por dos motivos: la imagen final no lleva TypeScript ni las
# dependencias de desarrollo, y `npm ci` se cachea aparte del código, así que
# cambiar una línea de una ruta no reinstala node_modules.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# `apps/mcp` entra porque la API depende de él: sirve las mismas herramientas
# por HTTP que el paquete sirve por stdio (ver apps/api/src/routes/mcp.ts). Sin
# su package.json, npm no puede enlazar el workspace y el `import` de
# `@devup/mcp/registro.js` no resuelve.
COPY apps/mcp/package.json apps/mcp/
# La web no: se construye en su propia imagen.
RUN npm ci --workspace apps/api --workspace apps/mcp --include-workspace-root

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY package.json package-lock.json ./
COPY apps/api ./apps/api
COPY apps/mcp ./apps/mcp
# `apps/mcp` primero: el typecheck de la API lee su fuente, pero en ejecución
# se importa su `dist`, así que si no se construye aquí el proceso arranca y
# muere en la primera petición al MCP.
RUN npm run build --workspace apps/mcp && npm run build --workspace apps/api

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Sin esto el proceso corre como root dentro del contenedor, y un fallo de
# ejecución remota pasa de «acceso a la aplicación» a «acceso a la máquina».
RUN addgroup -S devup && adduser -S devup -G devup

COPY --from=deps  --chown=devup:devup /app/node_modules ./node_modules
COPY --from=deps  --chown=devup:devup /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=devup:devup /app/apps/api/dist ./apps/api/dist
COPY --chown=devup:devup apps/api/package.json ./apps/api/
COPY --chown=devup:devup package.json ./

# `apps/mcp` compilado, y su package.json con él: el enlace de
# node_modules/@devup/mcp apunta a esta carpeta, y es su mapa de `exports` el
# que traduce `@devup/mcp/registro.js` a `dist/registro.js`. Sin el
# package.json, el enlace existe y la importación falla igual.
COPY --from=build --chown=devup:devup /app/apps/mcp/dist ./apps/mcp/dist
COPY --chown=devup:devup apps/mcp/package.json ./apps/mcp/

# Las migraciones viajan con la imagen: desplegar y migrar tienen que poder
# hacerse con el mismo artefacto, o acaban desincronizados.
COPY --chown=devup:devup db ./db

USER devup
EXPOSE 4000

# Node como PID 1 recibe las señales directamente; sin `--init` un SIGTERM del
# orquestador no llegaría al proceso y el cierre ordenado no ocurriría.
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/server.js"]
