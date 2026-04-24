# @liquor/api runtime image.
# We run under tsx (not a separate compile step) so @liquor/shared keeps its
# source exports from dev mode — one resolution strategy, fewer surprises.

FROM node:20-alpine

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

# Workspace manifests first for caching
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY api/package.json             ./api/
COPY packages/shared/package.json ./packages/shared/

# Install full deps (tsx is a devDep but we need it to run src/index.ts).
# NODE_ENV=production is set via compose at runtime — not here, so pnpm does
# install devDependencies during the build.
RUN pnpm install --frozen-lockfile

# Sources
COPY packages/shared ./packages/shared
COPY api             ./api

# Non-root runtime user
RUN addgroup -S liquor && adduser -S liquor -G liquor && chown -R liquor:liquor /app
USER liquor

EXPOSE 4000
CMD ["pnpm", "--filter", "@liquor/api", "exec", "tsx", "src/index.ts"]
