// Tok Factory 商品提取器 - 后台脚本

// 点击扩展图标时执行
chrome.action.onClicked.addListener(async (tab) => {
  try {
    // 在当前页面注入并执行提取脚本
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractProductData
    });

    if (results && results[0] && results[0].result) {
      const data = results[0].result;
      // 打开 Tok Factory 并传递数据
      const url = 'http://123.56.75.68:3000/link-video?data=' + encodeURIComponent(JSON.stringify(data));
      chrome.tabs.create({ url: url });
    }
  } catch (error) {
    console.error('提取失败:', error);
    // 显示错误提示
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => alert('提取失败，请确保在商品页面使用')
    });
  }
});

// 提取商品数据的函数（会注入到页面执行）
function extractProductData() {
  const data = {
    title: document.title || '',
    price: '',
    imgs: []
  };

  // 提取价格
  const priceMatch = document.body.innerText.match(/[¥￥$]\s*([\d,.]+)/);
  if (priceMatch) {
    data.price = priceMatch[1];
  }

  // 提取图片
  document.querySelectorAll('img[src*="http"]').forEach(img => {
    if (img.width > 150 && img.height > 150 && data.imgs.length < 5) {
      data.imgs.push(img.src);
    }
  });
  
  // 去重
  data.imgs = [...new Set(data.imgs)];

  return data;
}

