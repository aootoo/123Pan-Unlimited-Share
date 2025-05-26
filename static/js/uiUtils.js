// static/js/uiUtils.js

/**
 * 对HTML特殊字符进行转义。
 * @param {string} unsafe 未转义的字符串。
 * @returns {string} 转义后的字符串。
 */
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') {
        return '';
    }
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

/**
 * 更新状态消息。
 * @param {HTMLElement} element 显示状态消息的HTML元素。
 * @param {string} message 要显示的消息。
 * @param {'info'|'success'|'danger'|'warning'|'secondary'} type 消息类型，用于设置alert样式。
 */
function updateStatusMessage(element, message, type = 'info') {
    if (element) {
        element.textContent = message;
        element.className = `alert alert-${type}`;
        element.style.display = 'block';
    }
}

/**
 * 向日志区域添加消息。
 * @param {HTMLElement} logElement 显示日志的HTML元素 (通常是 <pre>).
 * @param {string} message 要添加的日志消息。
 */
function addLogMessage(logElement, message) {
    if (logElement) {
        logElement.textContent += `${message}\n`;
        logElement.scrollTop = logElement.scrollHeight;
    }
}

/**
 * 重置结果显示区域。
 * @param {object} elements 包含各个UI元素引用的对象。
 * @param {HTMLElement} elements.statusMessageElement 状态消息元素。
 * @param {HTMLElement} elements.logOutputElement 日志输出元素。
 * @param {HTMLElement} [elements.longShareCodeAreaElement] 长分享码区域元素。
 * @param {HTMLElement} [elements.shortShareCodeAreaElement] 短分享码区域元素。
 * @param {HTMLElement} [elements.actionButtonsAreaElement] 操作按钮区域元素。
 */
function resetResultDisplay(elements) {
    if (elements.logOutputElement) elements.logOutputElement.textContent = '';
    if (elements.longShareCodeAreaElement) elements.longShareCodeAreaElement.style.display = 'none';
    if (elements.shortShareCodeAreaElement) elements.shortShareCodeAreaElement.style.display = 'none';
    if (elements.actionButtonsAreaElement) elements.actionButtonsAreaElement.style.display = 'none';
    
    if (elements.statusMessageElement) {
        updateStatusMessage(elements.statusMessageElement, '准备开始...', 'info');
    }
}

/**
 * 将文本复制到剪贴板，并提供用户反馈。
 * @param {HTMLTextAreaElement|HTMLInputElement} textElement 包含要复制文本的元素。
 * @param {HTMLButtonElement} buttonElement 点击的复制按钮元素。
 * @param {string} copiedText 复制成功后按钮上显示的文本 (例如 "已复制!")。
 * @param {string} originalButtonHtml 按钮的原始HTML内容。
 */
async function copyToClipboard(textElement, buttonElement, copiedText, originalButtonHtml) {
    if (!textElement || !textElement.value) {
        alert('没有可复制的内容。');
        return;
    }
    try {
        await navigator.clipboard.writeText(textElement.value);
        if (buttonElement) {
            const tempOriginalHtml = buttonElement.innerHTML; // 保存实际的原始HTML
            buttonElement.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-check-lg me-1" viewBox="0 0 16 16"><path d="M12.736 3.97a.733.733 0 0 1 1.047 0c.286.289.29.756.01 1.05L7.88 12.01a.733.733 0 0 1-1.065.02L3.217 8.384a.757.757 0 0 1 0-1.06.733.733 0 0 1 1.047 0l3.052 3.093 5.4-6.425a.247.247 0 0 1 .02-.022z"/></svg>
                ${copiedText}`;
            setTimeout(() => {
                buttonElement.innerHTML = originalButtonHtml || tempOriginalHtml; // 优先使用传入的originalButtonHtml
            }, 2000);
        }
    } catch (err) {
        alert('复制失败，请尝试手动复制。');
        console.error('复制到剪贴板失败:', err);
    }
}

/**
 * 下载文件。
 * @param {string} content 文件内容。
 * @param {string} filename 下载时的文件名。
 * @param {string} [mimeType='application/octet-stream'] 文件的MIME类型。
 */
function downloadFile(content, filename, mimeType = 'application/octet-stream') {
    if (!content) {
        alert('没有可下载的数据。');
        return;
    }
    try {
        const blob = new Blob([content], { type: mimeType });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    } catch (e) {
        console.error("创建下载时出错:", e);
        alert("创建下载文件失败: " + e.message);
    }
}

/**
 * 显示操作按钮和相关的分享码区域。
 * @param {object} data API成功响应中解析出的数据。
 * @param {object} elements 包含UI元素引用的对象。
 * @param {HTMLElement} elements.actionButtonsAreaElement 操作按钮区域。
 * @param {HTMLElement} [elements.longShareCodeAreaElement] 长分享码区域。
 * @param {HTMLTextAreaElement} [elements.shareCodeOutputElement] 长分享码输出框。
 * @param {HTMLElement} [elements.copyShareCodeBtnElement] 复制长分享码按钮。
 * @param {HTMLElement} [elements.downloadShareCodeBtnElement] 下载分享码按钮。
 * @param {HTMLElement} [elements.shortShareCodeAreaElement] 短分享码区域。
 * @param {HTMLTextAreaElement} [elements.shortShareCodeOutputElement] 短分享码输出框。
 * @param {HTMLElement} [elements.copyShortShareCodeBtnElement] 复制短分享码按钮。
 * @returns {string|null} 返回长分享码数据，如果没有则为null。
 */
function displayShareCodesAndActions(data, elements) {
    let longShareData = null;
    elements.actionButtonsAreaElement.style.display = 'block';

    if (data.longShareCode) {
        longShareData = data.longShareCode;
        if (elements.shareCodeOutputElement) elements.shareCodeOutputElement.value = longShareData;
        if (elements.longShareCodeAreaElement) elements.longShareCodeAreaElement.style.display = 'block';
        if (elements.copyShareCodeBtnElement) elements.copyShareCodeBtnElement.style.display = 'block';
        if (elements.downloadShareCodeBtnElement) elements.downloadShareCodeBtnElement.style.display = 'block';
    } else {
        if (elements.longShareCodeAreaElement) elements.longShareCodeAreaElement.style.display = 'none';
        if (elements.copyShareCodeBtnElement) elements.copyShareCodeBtnElement.style.display = 'none';
        if (elements.downloadShareCodeBtnElement) elements.downloadShareCodeBtnElement.style.display = 'none';
    }

    if (data.shortShareCode) {
        if (elements.shortShareCodeOutputElement) elements.shortShareCodeOutputElement.value = data.shortShareCode;
        if (elements.shortShareCodeAreaElement) elements.shortShareCodeAreaElement.style.display = 'block';
        if (elements.copyShortShareCodeBtnElement) elements.copyShortShareCodeBtnElement.style.display = 'block';
    } else {
         if (elements.shortShareCodeAreaElement) elements.shortShareCodeAreaElement.style.display = 'none';
        if (elements.copyShortShareCodeBtnElement) elements.copyShortShareCodeBtnElement.style.display = 'none';
    }
    return longShareData;
}

// --- IP区域检查功能 ---

/**
 * 客户端侧检查IP是否为中国大陆地区
 * @returns {Promise<boolean>} True: 支持 (境外IP或港澳台或API请求失败), False: 不支持 (中国大陆IP)。
 */
async function isAvailableRegionJS() {
    const checkIpUrl = "https://ipv4.ping0.cc/geo";
    try {
        const response = await fetch(checkIpUrl, { cache: "no-store" }); // cache: "no-store" 确保获取最新信息
        if (!response.ok) {
            console.warn("IP地理位置检查API请求失败:", response.status, "将默认允许访问。");
            return true; // API请求失败时，默认为true以允许访问
        }
        const responseText = await response.text();
        
        // 检查是否包含"中国"并且不包含"香港", "澳门", "台湾"
        if (responseText.includes("中国") && 
            !["香港", "澳门", "台湾"].some(keyword => responseText.includes(keyword))) {
            // console.log(`当前IP地址检测为中国大陆，根据策略将限制访问。API响应: \n${responseText}`);
            return false; // 中国大陆IP
        } else {
            // console.log(`当前IP地址检测为非中国大陆或港澳台，允许访问。API响应: \n${responseText}`);
            return true; // 非中国大陆IP或港澳台
        }
    } catch (error) {
        console.error("检查IP地理位置时发生网络错误:", error, "将默认允许访问。");
        return true; // 发生网络等错误时，默认为true
    }
}

/**
 * 检查用户区域并根据结果重定向。
 * 如果区域不受支持，则重定向到 /banip 页面。
 */
async function checkRegionAndRedirect() {
    // 仅当当前页面不是 /banip 时才执行检查和重定向，防止无限循环
    if (window.location.pathname === '/banip') {
        return;
    }

    // 在执行检查前，可以先给用户一个提示，例如显示一个加载遮罩
    // document.body.classList.add('checking-region'); // 假设有一个CSS类来显示加载状态

    const isAllowed = await isAvailableRegionJS();

    // document.body.classList.remove('checking-region'); // 移除加载状态

    if (!isAllowed) {
        window.location.href = '/banip'; // 服务器端应配置 /banip 路由
    }
}
// --- IP区域检查功能结束 ---