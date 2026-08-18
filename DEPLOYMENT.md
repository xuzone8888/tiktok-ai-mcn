# Production deployment

The production site runs on Aliyun at `https://www.toryxai.com`.

## Release flow

1. Develop on a feature branch or isolated worktree.
2. Run type checking, tests, lint review, and a production build.
3. Open a pull request into the protected `main` branch.
4. Merge only after the release scope and database migrations are reviewed.
5. The GitHub webhook on the Aliyun server fetches `main`, installs dependencies, builds Next.js, and restarts the PM2 application.

## Production components

- Nginx terminates HTTPS and proxies the Next.js application.
- PM2 runs `tiktok-ai-mcn`, the GitHub deployment webhook, and supporting services.
- Root cron runs the image worker and publish scheduler with non-overlapping locks.
- Supabase hosts the production database and Edge Functions.

## Required verification

- Local, GitHub, and Aliyun `main` resolve to the same commit.
- The server worktree is clean and tracks `origin/main`.
- The production build completes and PM2 reports the application online.
- The public homepage returns HTTP 200.
- Protected routes redirect unauthenticated users to login.
- Database migrations and public webhook handshakes are verified separately.

Do not copy a development `.env.local` over production. Back up the production file, update only reviewed keys, and keep permissions restricted.
