---
description: Deploy to Alibaba Cloud ECS server
---

# Deploy to Alibaba Cloud ECS

## Quick Deploy (Auto)
// turbo-all

After pushing to GitHub, the webhook will automatically deploy. Just run:

```bash
git add .
git commit -m "your message"
git push origin main
```

The webhook at `http://123.56.75.68:9000/webhook` will trigger auto-deployment.

## Manual Deploy (if webhook fails)

1. Connect to server via Alibaba Workbench or SSH:
   - IP: 123.56.75.68
   - User: root

2. Run deployment commands:
```bash
cd /var/www/tiktok-ai-mcn
git pull origin main
npm run build
pm2 restart tiktok-ai-mcn
```

3. Verify deployment:
```bash
pm2 list
```

## Check Logs

```bash
pm2 logs tiktok-ai-mcn --lines 50
```

## Restart Webhook (if needed)

```bash
pm2 restart webhook
pm2 logs webhook
```
