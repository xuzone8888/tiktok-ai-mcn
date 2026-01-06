// Tok Factory 助手 - 后台脚本
// 实现多线程下载加速

// 下载队列
let downloadQueue = [];

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'download') {
    handleDownload(message.url, message.filename, sender.tab?.id)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // 异步响应
  }

  if (message.action === 'batchDownload') {
    handleBatchDownload(message.urls, sender.tab?.id)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// 单文件多线程下载
async function handleDownload(url, filename, tabId) {
  console.log('[Background] Starting download:', filename);

  // 获取线程设置
  const { threads = 4 } = await chrome.storage.local.get(['threads']);
  
  try {
    // 1. 获取文件大小
    const headResponse = await fetch(url, { method: 'HEAD' });
    const contentLength = parseInt(headResponse.headers.get('content-length') || '0');
    
    if (contentLength === 0) {
      // 无法获取文件大小，使用普通下载
      console.log('[Background] Cannot get file size, using normal download');
      await normalDownload(url, filename);
      return;
    }

    console.log('[Background] File size:', (contentLength / 1024 / 1024).toFixed(2), 'MB');
    console.log('[Background] Using', threads, 'threads');

    // 更新队列
    updateQueue(filename, 0);

    // 2. 分片下载
    const chunkSize = Math.ceil(contentLength / threads);
    const chunks = [];

    for (let i = 0; i < threads; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize - 1, contentLength - 1);
      chunks.push({ start, end, index: i });
    }

    // 3. 并行下载所有分片
    let downloadedBytes = 0;
    const chunkData = new Array(threads);

    const downloadPromises = chunks.map(async (chunk, i) => {
      const response = await fetch(url, {
        headers: {
          'Range': `bytes=${chunk.start}-${chunk.end}`
        }
      });

      const reader = response.body.getReader();
      const chunkParts = [];
      let chunkDownloaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        chunkParts.push(value);
        chunkDownloaded += value.length;
        downloadedBytes += value.length;

        // 更新进度
        const progress = Math.round((downloadedBytes / contentLength) * 100);
        updateQueue(filename, progress);
        
        // 通知页面
        if (tabId) {
          chrome.tabs.sendMessage(tabId, {
            type: 'DOWNLOAD_PROGRESS',
            filename,
            progress
          }).catch(() => {});
        }
      }

      // 合并分片数据
      const totalLength = chunkParts.reduce((acc, arr) => acc + arr.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const part of chunkParts) {
        result.set(part, offset);
        offset += part.length;
      }
      
      chunkData[i] = result;
      return result;
    });

    await Promise.all(downloadPromises);

    // 4. 合并所有分片
    const totalLength = chunkData.reduce((acc, arr) => acc + arr.length, 0);
    const mergedData = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunkData) {
      mergedData.set(chunk, offset);
      offset += chunk.length;
    }

    // 5. 创建 Blob 并下载
    const blob = new Blob([mergedData], { type: 'video/mp4' });
    const blobUrl = URL.createObjectURL(blob);

    await chrome.downloads.download({
      url: blobUrl,
      filename: filename,
      saveAs: false
    });

    // 清理
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);

    // 完成
    updateQueue(filename, 100, true);
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: 'DOWNLOAD_COMPLETE',
        filename
      }).catch(() => {});
    }

    console.log('[Background] Download complete:', filename);
  } catch (error) {
    console.error('[Background] Download error:', error);
    // 回退到普通下载
    await normalDownload(url, filename);
  }
}

// 普通下载（不支持 Range 时的回退方案）
async function normalDownload(url, filename) {
  await chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: false
  });
}

// 批量下载
async function handleBatchDownload(urls, tabId) {
  console.log('[Background] Batch download:', urls.length, 'files');
  
  // 依次下载，避免同时太多连接
  for (const item of urls) {
    try {
      await handleDownload(item.url, item.filename, tabId);
      // 间隔 500ms
      await new Promise(r => setTimeout(r, 500));
    } catch (error) {
      console.error('[Background] Batch item error:', error);
    }
  }
}

// 更新下载队列
function updateQueue(filename, progress, remove = false) {
  if (remove) {
    downloadQueue = downloadQueue.filter(item => item.filename !== filename);
  } else {
    const existing = downloadQueue.find(item => item.filename === filename);
    if (existing) {
      existing.progress = progress;
    } else {
      downloadQueue.push({ filename, progress });
    }
  }
  
  // 只保留最近10个
  if (downloadQueue.length > 10) {
    downloadQueue = downloadQueue.slice(-10);
  }

  chrome.storage.local.set({ downloadQueue });
}

// 初始化
console.log('[Tok Factory Extension] Background script loaded');
