// Tok Factory 助手 - 内容脚本
// 注入到 Tok Factory 页面，监听下载请求

(function() {
  // 向页面注入标识，表示扩展已安装
  window.postMessage({ type: 'TOK_FACTORY_EXTENSION_READY', version: '2.0' }, '*');

  // 监听来自页面的消息
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;

    // 下载请求
    if (event.data.type === 'TOK_FACTORY_DOWNLOAD') {
      const { url, filename } = event.data;
      console.log('[Tok Factory Extension] Download request:', filename);

      try {
        // 发送到 background script 处理
        chrome.runtime.sendMessage({
          action: 'download',
          url,
          filename
        }, (response) => {
          if (response && response.success) {
            window.postMessage({
              type: 'TOK_FACTORY_DOWNLOAD_STARTED',
              filename
            }, '*');
          } else {
            window.postMessage({
              type: 'TOK_FACTORY_DOWNLOAD_ERROR',
              filename,
              error: response?.error || '下载失败'
            }, '*');
          }
        });
      } catch (error) {
        console.error('[Tok Factory Extension] Error:', error);
        window.postMessage({
          type: 'TOK_FACTORY_DOWNLOAD_ERROR',
          filename,
          error: error.message
        }, '*');
      }
    }

    // 批量下载请求
    if (event.data.type === 'TOK_FACTORY_BATCH_DOWNLOAD') {
      const { urls } = event.data; // [{url, filename}, ...]
      console.log('[Tok Factory Extension] Batch download request:', urls.length, 'files');

      chrome.runtime.sendMessage({
        action: 'batchDownload',
        urls
      }, (response) => {
        window.postMessage({
          type: 'TOK_FACTORY_BATCH_DOWNLOAD_STARTED',
          count: urls.length
        }, '*');
      });
    }

    // 检查扩展状态
    if (event.data.type === 'TOK_FACTORY_CHECK_EXTENSION') {
      window.postMessage({
        type: 'TOK_FACTORY_EXTENSION_STATUS',
        installed: true,
        version: '2.0'
      }, '*');
    }
  });

  // 监听来自 background 的下载进度
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'DOWNLOAD_PROGRESS') {
      window.postMessage({
        type: 'TOK_FACTORY_DOWNLOAD_PROGRESS',
        filename: message.filename,
        progress: message.progress
      }, '*');
    }
    if (message.type === 'DOWNLOAD_COMPLETE') {
      window.postMessage({
        type: 'TOK_FACTORY_DOWNLOAD_COMPLETE',
        filename: message.filename
      }, '*');
    }
  });

  console.log('[Tok Factory Extension] Content script loaded');
})();
