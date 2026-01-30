# toryxai.com Nginx 配置参考

## HTTP 重定向到 HTTPS
```nginx
server {
    listen 80;
    listen [::]:80;
    server_name toryxai.com www.toryxai.com;
    return 301 https://$host$request_uri;
}
```

## HTTPS 配置
```nginx
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name toryxai.com www.toryxai.com;

    # SSL 证书（Certbot 自动配置）
    ssl_certificate /etc/letsencrypt/live/toryxai.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/toryxai.com/privkey.pem;
    
    # SSL 配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # 代理到 Next.js 应用
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }

    # 静态文件缓存
    location /_next/static {
        proxy_pass http://localhost:3000;
        proxy_cache_valid 200 60m;
        add_header Cache-Control "public, immutable";
    }
}
```

## 使用方法

1. 将此配置保存到 `/etc/nginx/sites-available/toryxai.com`
2. 创建符号链接: `sudo ln -s /etc/nginx/sites-available/toryxai.com /etc/nginx/sites-enabled/`
3. 测试配置: `sudo nginx -t`
4. 重载 Nginx: `sudo systemctl reload nginx`

## 使用 Certbot 申请证书

```bash
sudo certbot --nginx -d toryxai.com -d www.toryxai.com
```
