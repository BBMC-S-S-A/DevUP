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
# Solo el workspace de la API: la web se construye en su propia imagen.
RUN npm ci --workspace apps/api --include-workspace-root

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY package.json package-lock.json ./
COPY apps/api ./apps/api
RUN npm run build --workspace apps/api

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
