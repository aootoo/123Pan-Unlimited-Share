// static/js/importPage.js

document.addEventListener('DOMContentLoaded', async function () {
    // 客户端侧检查IP是否为中国大陆地区
    await checkRegionAndRedirect(); 

    const importForm = document.getElementById('importForm');
    const resultArea = document.getElementById('resultArea');
    const statusMessageEl = document.getElementById('statusMessage');
    const logOutputEl = document.getElementById('logOutput');
    
    const selectedPublicCodeHashInput = document.getElementById('selectedPublicCodeHash');
    const publicSharesListDiv = document.getElementById('publicSharesListActual');
    const publicShareSearchInput = document.getElementById('publicShareSearch');
    
    const shortCodeInput = document.getElementById('shortCodeInput');
    const longBase64DataInput = document.getElementById('longBase64DataInput');
    const longRootFolderNameInput = document.getElementById('longRootFolderNameInput');
    const importShareProjectCheckbox = document.getElementById('importShareProject');

    const shareFileInput = document.getElementById('shareFileInput');
    const selectShareFileButton = document.getElementById('selectShareFileButton');

    // Content Tree Modal Elements
    const contentTreeModalEl = document.getElementById('contentTreeModal');
    const contentTreeSearchInput = document.getElementById('contentTreeSearchInput');
    const contentTreeDisplayArea = document.getElementById('contentTreeDisplayArea');
    const bsContentTreeModal = new bootstrap.Modal(contentTreeModalEl);

    const API_IMPORT_URL = window.APP_CONFIG.apiImportUrl || '/api/import';
    const API_LIST_PUBLIC_SHARES_URL = window.APP_CONFIG.apiListPublicSharesUrl || '/api/list_public_shares';
    const API_GET_CONTENT_TREE_URL = window.APP_CONFIG.apiGetContentTreeUrl || '/api/get_content_tree'; // 新增

    let allPublicShares = [];
    let currentActiveTabId = 'publicRepoContent'; // 默认活动标签页ID

    // 从 Cookie 加载凭据
    const savedUsername = getCookie('username');
    const savedPassword = getCookie('password');
    if (savedUsername) document.getElementById('username').value = savedUsername;
    if (savedPassword) document.getElementById('password').value = savedPassword;

    document.querySelectorAll('#importTabs button[data-bs-toggle="tab"]').forEach(tabEl => {
        tabEl.addEventListener('shown.bs.tab', function (event) {
            currentActiveTabId = event.target.getAttribute('aria-controls');
            // 清理所有输入，避免Tab切换时数据混淆
            selectedPublicCodeHashInput.value = ''; 
            shortCodeInput.value = '';
            longBase64DataInput.value = '';
            longRootFolderNameInput.value = '';
            importShareProjectCheckbox.checked = false;
            if (shareFileInput) shareFileInput.value = ''; // 清空文件选择器的值
            
            document.querySelectorAll('.public-share-item.active').forEach(activeItem => {
                activeItem.classList.remove('active');
            });
            // 如果状态消息是关于已选择的公共资源，则清除或更新它
            if (statusMessageEl.textContent.startsWith('已选择公共资源:') || statusMessageEl.textContent.startsWith('已成功加载文件:')) {
                updateStatusMessage(statusMessageEl, '请输入必填信息。', 'info');
            }
        });
    });

    importForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        resultArea.style.display = 'block';
        logOutputEl.textContent = ''; 
        updateStatusMessage(statusMessageEl, '准备开始...', 'info');

        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        setCookie('username', username, 30);
        setCookie('password', password, 30);

        let payload = { username: username, password: password };
        let formValid = true;

        if (currentActiveTabId === 'publicRepoContent') {
            if (!selectedPublicCodeHashInput.value) {
                updateStatusMessage(statusMessageEl, '错误: 请先从公共资源库选择一项资源。', 'danger');
                formValid = false;
            }
            payload.codeHash = selectedPublicCodeHashInput.value;
        } else if (currentActiveTabId === 'shortCodeContent') {
            if (!shortCodeInput.value.trim()) {
                updateStatusMessage(statusMessageEl, '错误: 请输入短分享码。', 'danger');
                shortCodeInput.focus();
                formValid = false;
            }
            payload.codeHash = shortCodeInput.value.trim();
        } else if (currentActiveTabId === 'longCodeContent') {
            // 校验由文件选择或手动输入的长分享码和目录名
            if (!longBase64DataInput.value.trim()) {
                updateStatusMessage(statusMessageEl, '错误: 请输入或选择文件以填充长分享码。', 'danger');
                longBase64DataInput.focus();
                formValid = false;
            }
            if (!longRootFolderNameInput.value.trim()) {
                updateStatusMessage(statusMessageEl, '错误: 请输入或选择文件以填充根目录名。', 'danger');
                longRootFolderNameInput.focus();
                formValid = false;
            }
            // 仅当上述校验通过后才继续
            if (formValid) {
                payload.base64Data = longBase64DataInput.value.trim();
                payload.rootFolderName = longRootFolderNameInput.value.trim();
                payload.shareProject = importShareProjectCheckbox.checked;

                // 如果勾选了加入共享计划，根目录名必须再次校验是否有效 (虽然上面已校验非空)
                if (payload.shareProject && !payload.rootFolderName) { // 此处逻辑可能重复，但确保万无一失
                     updateStatusMessage(statusMessageEl, '错误: 加入资源共享计划时，必须填写有效的根目录名。', 'danger');
                     longRootFolderNameInput.focus();
                     formValid = false;
                }
            }
        } else {
             updateStatusMessage(statusMessageEl, '错误: 未知的导入模式。', 'danger');
             formValid = false;
        }

        if (!formValid) return;

        handleApiStreamRequest({
            endpoint: API_IMPORT_URL,
            payload: payload,
            statusElement: statusMessageEl,
            logElement: logOutputEl,
            callbacks: {
                onSuccess: function(data) {
                    // 导入操作在isFinish:true时，jsonData.message是字符串，不是包含分享码的对象
                    // streamApiHandler 已经处理了这种情况并更新了 statusMessageEl
                    // 如果需要，这里可以做额外的事
                },
                onFailure: function(message) { /* Stream handler 会更新 UI */ },
                onRequestError: function(error) { /* Stream handler 会更新 UI */ }
            }
        });
    });

    async function fetchPublicShares() {
        try {
            const response = await fetch(API_LIST_PUBLIC_SHARES_URL);
            if (!response.ok) {
                publicSharesListDiv.innerHTML = '<p class="text-danger text-center">加载公共资源列表失败。</p>';
                return;
            }
            const data = await response.json();
            if (data.success && data.files && data.files.length > 0) {
                allPublicShares = data.files; 
                renderPublicShares(allPublicShares);
            } else if (data.success && (!data.files || data.files.length === 0)) {
                 publicSharesListDiv.innerHTML = '<p class="text-muted text-center">暂无公共资源。</p>';
            } else {
                publicSharesListDiv.innerHTML = `<p class="text-danger text-center">加载公共资源列表失败: ${data.message || '未知错误'}</p>`;
            }
        } catch (error) {
            console.error("获取公共资源时出错:", error);
            publicSharesListDiv.innerHTML = '<p class="text-danger text-center">加载公共资源列表时发生网络错误。</p>';
        }
    }

    function renderPublicShares(shares) {
        publicSharesListDiv.innerHTML = ''; 
        if (shares.length === 0 && publicShareSearchInput.value) {
            publicSharesListDiv.innerHTML = '<p class="text-muted text-center">沒有匹配的公共资源。</p>';
            return;
        } else if (shares.length === 0) {
            publicSharesListDiv.innerHTML = '<p class="text-muted text-center">暂无公共资源。</p>';
            return;
        }

        shares.forEach(share => {
            const item = document.createElement('div');
            item.classList.add('public-share-item', 'd-flex', 'justify-content-between', 'align-items-center');
            
            const textContainer = document.createElement('div');
            textContainer.style.cursor = 'pointer'; // 使文本区域也可点击选择

            const nameSpan = document.createElement('span');
            nameSpan.classList.add('share-name');
            nameSpan.textContent = share.name;
            textContainer.appendChild(nameSpan);

            const tsSpan = document.createElement('span');
            tsSpan.classList.add('share-timestamp');
            const date = new Date(share.timestamp);
            tsSpan.textContent = `更新时间: ${date.toLocaleString()}`;
            textContainer.appendChild(tsSpan);

            item.appendChild(textContainer);

            const viewTreeBtn = document.createElement('button');
            viewTreeBtn.type = 'button';
            viewTreeBtn.classList.add('btn', 'btn-sm', 'btn-outline-secondary', 'view-content-tree-btn');
            viewTreeBtn.innerHTML = '<i class="bi bi-search"></i>';
            viewTreeBtn.dataset.codehash = share.codeHash;
            viewTreeBtn.title = "查看目录结构";
            viewTreeBtn.style.flexShrink = '0'; // 防止按钮在名称过长时被挤压

            item.appendChild(viewTreeBtn);
            
            // 点击文本区域选择资源进行导入
            textContainer.addEventListener('click', function() {
                document.querySelectorAll('.public-share-item.active').forEach(activeItem => {
                    activeItem.classList.remove('active');
                });
                item.classList.add('active'); // 高亮整个item

                selectedPublicCodeHashInput.value = share.codeHash;
                updateStatusMessage(statusMessageEl, `已选择公共资源: ${share.name}`, 'secondary');
                logOutputEl.textContent = ''; 
            });
            publicSharesListDiv.appendChild(item);
        });
    }
    
    publicShareSearchInput.addEventListener('input', function(e) {
        const searchTerm = e.target.value.toLowerCase();
        const filteredShares = allPublicShares.filter(share => 
            share.name.toLowerCase().includes(searchTerm)
        );
        renderPublicShares(filteredShares);
    });

    if (selectShareFileButton && shareFileInput) {
        selectShareFileButton.addEventListener('click', function() {
            shareFileInput.click(); // 触发隐藏的文件输入框的点击事件
        });

        shareFileInput.addEventListener('change', function(event) {
            const file = event.target.files[0];
            if (file) {
                // 再次校验文件类型（虽然HTML的accept属性已做限制）
                if (!file.name.toLowerCase().endsWith('.123share')) {
                    updateStatusMessage(statusMessageEl, '错误: 请选择一个有效的 .123share 文件。', 'danger');
                    shareFileInput.value = ''; // 清空选择，以便用户可以重新选择相同文件
                    return;
                }

                // 提取文件名作为根目录名
                let rootFolderName = file.name;
                if (rootFolderName.toLowerCase().endsWith('.123share')) {
                    // 移除'.123share'后缀 (长度为9)
                    rootFolderName = rootFolderName.substring(0, rootFolderName.length - 9);
                }
                longRootFolderNameInput.value = rootFolderName; // 填充根目录名输入框

                // 使用FileReader读取文件内容
                const reader = new FileReader();
                reader.onload = function(e) {
                    longBase64DataInput.value = e.target.result; // 将文件内容填充到长分享码文本域
                    updateStatusMessage(statusMessageEl, `已成功加载文件: ${file.name}`, 'success');
                    
                    // 检查并尝试自动切换到 "从长分享码/文件导入" 标签页
                    const longCodeTabButton = document.getElementById('long-code-tab');
                    if (longCodeTabButton && currentActiveTabId !== 'longCodeContent') {
                        // 确保Bootstrap Tab实例正确获取和调用show方法
                        const tabInstance = bootstrap.Tab.getInstance(longCodeTabButton);
                        if (tabInstance) {
                            tabInstance.show();
                        } else {
                            new bootstrap.Tab(longCodeTabButton).show();
                        }
                    }
                };
                reader.onerror = function(e) {
                    console.error("读取文件时出错:", e);
                    updateStatusMessage(statusMessageEl, `错误: 读取文件 ${file.name} 失败。请检查文件或浏览器权限。`, 'danger');
                    // 清空可能已部分填充的字段
                    longBase64DataInput.value = ''; 
                    longRootFolderNameInput.value = ''; 
                };
                reader.readAsText(file, 'UTF-8'); // 以UTF-8编码读取文本
                
                // 清空文件选择器的值，以便用户可以再次选择同一个文件并触发 change 事件
                shareFileInput.value = '';
            }
        });
    }
    // --- 文件选择处理结束 ---

    // --- 内容目录树相关逻辑 ---
    async function fetchAndDisplayContentTree(params) {
        const payload = {};
        if (params.codeHash) payload.codeHash = params.codeHash;
        if (params.shareCode) payload.shareCode = params.shareCode;

        if (!payload.codeHash && !payload.shareCode) {
            // 此情况不应发生，因为调用前已校验
            contentTreeDisplayArea.innerHTML = '<p class="text-center text-danger">错误: 缺少必要的参数。</p>';
            bsContentTreeModal.show();
            return;
        }

        try {
            // 在显示模态框之前清空旧内容并设置加载状态
            contentTreeDisplayArea.innerHTML = '<div class="text-center p-3"><div class="spinner-border spinner-border-sm text-primary" role="status"><span class="visually-hidden">加载中...</span></div> <span class="ms-2 text-muted">正在加载目录结构...</span></div>';
            contentTreeSearchInput.value = '';
            bsContentTreeModal.show();

            const response = await fetch(API_GET_CONTENT_TREE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            
            // 确保在填充内容前清除加载提示
            contentTreeDisplayArea.innerHTML = '';

            if (result.isFinish === true) {
                if (Array.isArray(result.message) && result.message.length > 0) {
                    const treeHtml = result.message.map(line => `<div>${escapeHtml(line)}</div>`).join('');
                    contentTreeDisplayArea.innerHTML = treeHtml;
                } else if (Array.isArray(result.message) && result.message.length === 0) {
                    contentTreeDisplayArea.innerHTML = '<p class="text-center text-muted p-3">此分享内容为空。</p>';
                }
                 else {
                    contentTreeDisplayArea.innerHTML = '<p class="text-center text-muted p-3">目录为空或无法解析。</p>';
                }
            } else {
                contentTreeDisplayArea.innerHTML = `<p class="text-center text-danger p-3">错误: ${escapeHtml(result.message)}</p>`;
            }
        } catch (error) {
            console.error('获取目录树失败:', error);
            contentTreeDisplayArea.innerHTML = `<p class="text-center text-danger p-3">请求目录树失败: ${error.message}</p>`;
            if (!bsContentTreeModal._isShown) { // 如果请求失败前模态框未显示，则显示它以展示错误
                bsContentTreeModal.show();
            }
        }
    }

    // 事件委托处理所有 "view-content-tree-btn" 按钮的点击
    document.getElementById('importTabsContent').addEventListener('click', function(event) {
        const target = event.target.closest('.view-content-tree-btn');
        if (!target) return;

        let codeHash = null;
        let shareCode = null;

        // 根据按钮ID或dataset确定是哪个按钮触发，并获取相应的值
        if (target.id === 'viewTreeForShortCodeBtn') {
            codeHash = shortCodeInput.value.trim();
            if (!codeHash) { 
                alert('请输入短分享码。'); 
                statusMessageEl.textContent = '请输入短分享码以查看目录。';
                statusMessageEl.className = 'alert alert-warning';
                return; 
            }
        } else if (target.id === 'viewTreeForLongCodeBtn') {
            shareCode = longBase64DataInput.value.trim();
            if (!shareCode) { 
                alert('请输入长分享码（或从文件加载）。');
                statusMessageEl.textContent = '请输入长分享码以查看目录。';
                statusMessageEl.className = 'alert alert-warning';
                return; 
            }
        } else if (target.dataset.codehash) { // 来自公共资源列表的按钮
            codeHash = target.dataset.codehash;
        } else {
            // 未知按钮来源，理论上不应发生
            console.warn('未知的查看目录按钮被点击:', target);
            return;
        }

        if (codeHash || shareCode) {
            fetchAndDisplayContentTree({ codeHash, shareCode });
        }
    });

    // 目录树模态框内的搜索功能
    contentTreeSearchInput.addEventListener('input', function() {
        const searchTerm = this.value.toLowerCase();
        const lines = contentTreeDisplayArea.querySelectorAll('div'); // 假设每行是一个div
        lines.forEach(lineEl => {
            const text = lineEl.textContent.toLowerCase();
            if (text.includes(searchTerm)) {
                lineEl.style.display = '';
            } else {
                lineEl.style.display = 'none';
            }
        });
    });

    // 当模态框隐藏时，清空搜索框并重置行显示（如果之前有搜索过滤）
    contentTreeModalEl.addEventListener('hidden.bs.modal', function () {
        contentTreeSearchInput.value = '';
        const lines = contentTreeDisplayArea.querySelectorAll('div');
        lines.forEach(lineEl => {
            lineEl.style.display = ''; // 重置所有行的显示
        });
        contentTreeDisplayArea.innerHTML = ''; // 完全清空内容，下次打开时重新加载
    });
    // --- 内容目录树相关逻辑结束 ---

    fetchPublicShares(); // 初始加载公共资源列表
});