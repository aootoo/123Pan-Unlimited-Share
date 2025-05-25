// static/js/importPage.js

document.addEventListener('DOMContentLoaded', function () {
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

    const API_IMPORT_URL = window.APP_CONFIG.apiImportUrl || '/api/import';
    const API_LIST_PUBLIC_SHARES_URL = window.APP_CONFIG.apiListPublicSharesUrl || '/api/list_public_shares';

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
            selectedPublicCodeHashInput.value = ''; // 清空公共资源选择
            shortCodeInput.value = '';
            longBase64DataInput.value = '';
            longRootFolderNameInput.value = '';
            importShareProjectCheckbox.checked = false;
            
            document.querySelectorAll('.public-share-item.active').forEach(activeItem => {
                activeItem.classList.remove('active');
            });
            if (statusMessageEl.textContent.startsWith('已选择公共资源:')) {
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
            if (!longBase64DataInput.value.trim()) {
                updateStatusMessage(statusMessageEl, '错误: 请输入长分享码。', 'danger');
                longBase64DataInput.focus();
                formValid = false;
            }
            if (!longRootFolderNameInput.value.trim()) {
                updateStatusMessage(statusMessageEl, '错误: 请输入根目录名。', 'danger');
                longRootFolderNameInput.focus();
                formValid = false;
            }
            payload.base64Data = longBase64DataInput.value.trim();
            payload.rootFolderName = longRootFolderNameInput.value.trim();
            payload.shareProject = importShareProjectCheckbox.checked;
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
            item.classList.add('public-share-item');
            
            const nameSpan = document.createElement('span');
            nameSpan.classList.add('share-name');
            nameSpan.textContent = share.name;
            item.appendChild(nameSpan);

            const tsSpan = document.createElement('span');
            tsSpan.classList.add('share-timestamp');
            const date = new Date(share.timestamp);
            tsSpan.textContent = `更新时间: ${date.toLocaleString()}`;
            item.appendChild(tsSpan);

            item.dataset.codehash = share.codeHash;
            item.dataset.rootname = share.name; 

            item.addEventListener('click', function() {
                document.querySelectorAll('.public-share-item.active').forEach(activeItem => {
                    activeItem.classList.remove('active');
                });
                this.classList.add('active'); 

                selectedPublicCodeHashInput.value = this.dataset.codehash;
                updateStatusMessage(statusMessageEl, `已选择公共资源: ${this.dataset.rootname}`, 'secondary');
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

    fetchPublicShares(); // 初始加载
});