# StarGaze 跨境发布 worker —— 仅用于美国出口节点处理 YouTube/Facebook/Instagram 发布。
# 非 standalone（next.config 无 output:'standalone'）：运行期需 node_modules + .next + server.js。
#
# 机密绝不进 build context（见 .dockerignore；本仓库 public，镜像层可被 docker history 读出），
# 只经运行期 env_file 注入。唯有非机密的 NEXT_PUBLIC_*（anon key/URL 设计上公开）在 build 期 ARG 桥接：
# src/lib/supabase.ts:7 在模块作用域 createClient(URL, ANON)，空值会让 next build 直接失败。

FROM node:20-bookworm-slim
WORKDIR /app

# 1) 依赖：在 NODE_ENV 设为 production 之前 npm ci，确保 devDeps（typescript/tailwind/postcss）装入供 next build。
COPY package.json package-lock.json ./
RUN npm ci

# 2) 源码 + 构建
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NODE_ENV=production
RUN npm run build

# 3) 运行期：server.js 绑 0.0.0.0:$PORT；NODE_ENV=production 走生产分支（server.js:15）。
ENV PORT=3100
EXPOSE 3100
CMD ["node", "server.js"]
