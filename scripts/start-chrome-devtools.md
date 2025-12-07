# 启动 Chrome DevTools 以进行浏览器检查

要使用浏览器工具检查Vercel部署，需要先启动Chrome并启用远程调试。

## macOS 启动方法

在终端运行以下命令：

```bash
# 关闭所有Chrome实例
killall "Google Chrome" 2>/dev/null || true

# 启动Chrome并启用远程调试（端口9222）
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-debug \
  --no-first-run \
  --no-default-browser-check \
  > /dev/null 2>&1 &
```

或者使用Chrome Canary（如果已安装）：

```bash
/Applications/Google\ Chrome\ Canary.app/Contents/MacOS/Google\ Chrome\ Canary \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-debug-canary \
  --no-first-run \
  --no-default-browser-check \
  > /dev/null 2>&1 &
```

## 验证是否启动成功

运行以下命令检查：

```bash
curl http://127.0.0.1:9222/json/version
```

如果返回JSON数据，说明启动成功。

## 然后

启动Chrome后，告诉我，我就可以：
1. 打开Vercel网站
2. 您帮助登录
3. 检查部署状态和项目配置
4. 比较本地文件与服务器版本







