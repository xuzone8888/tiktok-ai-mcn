# syntax=docker/dockerfile:1
# StarGaze 跨境发布 worker —— 仅用于美国出口节点处理 YouTube/Facebook/Instagram 发布。
# 非 standalone（next.config 无 output:'standalone'）：运行期需 node_modules + .next + server.js。
#
# 机密绝不进 build context / 镜像层（本仓库 public，docker history 可读）：
#  - .dockerignore 已排除 .env* / *.env；
#  - 构建期所需真实 env（collect-page-data 会评估多个 admin/sms 路由的模块作用域
#    createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!)）经 BuildKit secret 挂成
#    .env.production.local，Next 构建自动加载；secret mount 不写入任何镜像层，
#    server 端非 NEXT_PUBLIC 的 env 也不会被 inline 进 .next。
#  - 运行期真实机密只经 compose env_file 注入。

# Official multi-platform manifest digest resolved from Docker Hub on
# 2026-07-29; the digest is immutable while the readable tag documents intent.
FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
WORKDIR /app

# The release contract is exact: Node 24.18.0 LTS and npm 12.0.1.
RUN test "$(node -p 'process.versions.node')" = "24.18.0" \
    && npm install --global --no-audit --no-fund npm@12.0.1 \
    && test "$(npm --version)" = "12.0.1"

# 1) 依赖：在 NODE_ENV 设 production 前 npm ci，确保 devDeps（typescript/tailwind/postcss）装入供 next build。
COPY package.json package-lock.json .npmrc ./
RUN npm ci --include=dev --ignore-scripts \
    --allow-remote=root --allow-git=none --allow-file=none --allow-directory=none

# 2) 源码 + 构建。真实 env 经 secret 挂载为 .env.production.local（含 NEXT_PUBLIC_*，由 Next inline 进客户端包；
#    含 SUPABASE_SERVICE_ROLE_KEY，供模块作用域 createClient 构造）。文件仅在本 RUN 期存在，不入镜像层。
COPY . .
RUN --mount=type=secret,id=workerenv,target=/app/.env.production.local \
    NODE_ENV=production npm run build

# 3) 运行期：server.js 绑 0.0.0.0:$PORT；NODE_ENV=production 走生产分支（server.js:15）。
ENV NODE_ENV=production PORT=3100
EXPOSE 3100
CMD ["node", "server.js"]
