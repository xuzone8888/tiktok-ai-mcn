// Tok Factory 助手 - 弹出界面脚本

document.addEventListener('DOMContentLoaded', () => {
  // 加载保存的线程设置
  chrome.storage.local.get(['threads'], (result) => {
    const threads = result.threads || 4;
    document.querySelectorAll('.thread-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.threads) === threads);
    });
  });

  // 线程选择
  document.querySelectorAll('.thread-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const threads = parseInt(btn.dataset.threads);
      chrome.storage.local.set({ threads });
      document.querySelectorAll('.thread-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // 打开 Tok Factory
  document.getElementById('openTokFactory').addEventListener('click', () => {
    chrome.tabs.create({ url: 'http://123.56.75.68:3000/pro-studio/video-batch' });
  });

  // 监听下载队列更新
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.downloadQueue) {
      updateQueueDisplay(changes.downloadQueue.newValue || []);
    }
  });

  // 初始加载队列
  chrome.storage.local.get(['downloadQueue'], (result) => {
    updateQueueDisplay(result.downloadQueue || []);
  });
});

function updateQueueDisplay(queue) {
  const container = document.getElementById('downloadQueue');
  
  if (queue.length === 0) {
    container.innerHTML = `
      <div style="font-size: 12px; color: rgba(255,255,255,0.5); text-align: center; padding: 16px;">
        暂无下载任务<br>
        <span style="font-size: 11px;">在视频批量页面点击"插件下载"开始</span>
      </div>
    `;
    return;
  }

  container.innerHTML = queue.map(item => `
    <div class="queue-item">
      <span style="flex-shrink: 0; width: 60px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${item.filename || '视频'}
      </span>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${item.progress || 0}%"></div>
      </div>
      <span style="flex-shrink: 0; width: 40px; text-align: right;">
        ${item.progress || 0}%
      </span>
    </div>
  `).join('');
}
