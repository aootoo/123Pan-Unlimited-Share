document.addEventListener('DOMContentLoaded', async function () {
    // 客户端侧检查IP是否为中国大陆地区, 如果是则重定向
    await checkRegionAndRedirect(); 

    // 获取表单和结果显示区域的DOM元素
    const importForm = document.getElementById('importForm');
    const resultArea = document.getElementById('resultArea');
    const statusMessageEl = document.getElementById('statusMessage');
    const logOutputEl = document.getElementById('logOutput');
    
    // 公共资源库相关的DOM元素
    const selectedPublicCodeHashInput = document.getElementById('selectedPublicCodeHash'); 
    const publicSharesListDiv = document.getElementById('publicSharesListActual');      
    const publicShareSearchInput = document.getElementById('publicShareSearch');        
    const publicSharesListContainer = document.getElementById('publicSharesListContainer'); 

    // 短分享码、长分享码、文件导入相关的DOM元素
    const shortCodeInput = document.getElementById('shortCodeInput');
    const longBase64DataInput = document.getElementById('longBase64DataInput');
    const longRootFolderNameInput = document.getElementById('longRootFolderNameInput');
    const importShareProjectCheckbox = document.getElementById('importShareProject'); 

    const shareFileInput = document.getElementById('shareFileInput'); 
    const selectShareFileButton = document.getElementById('selectShareFileButton'); 

    // 内容目录树模态框相关的DOM元素
    const contentTreeModalEl = document.getElementById('contentTreeModal');
    const contentTreeSearchInput = document.getElementById('contentTreeSearchInput'); 
    const contentTreeDisplayArea = document.getElementById('contentTreeDisplayArea'); 
    const bsContentTreeModal = new bootstrap.Modal(contentTreeModalEl); 

    const startImportBtn = document.getElementById('startImportBtn'); // 获取开始导入按钮

    // API端点URL 
    const API_IMPORT_URL = window.APP_CONFIG.apiImportUrl || '/api/import';
    const API_LIST_PUBLIC_SHARES_URL = window.APP_CONFIG.apiListPublicSharesUrl || '/api/list_public_shares';
    const API_GET_CONTENT_TREE_URL = window.APP_CONFIG.apiGetContentTreeUrl || '/api/get_content_tree';
    const API_SEARCH_DATABASE_URL = window.APP_CONFIG.apiSearchDatabaseUrl || '/api/search_database'; 

    // 分页和加载状态变量
    let allPublicSharesData = []; 

    let currentPublicListPage = 1;       
    let isLoadingPublicList = false;     
    let isEndOfPublicList = false;       

    let currentSearchPage = 1;           
    let isLoadingSearchResults = false;  
    let isEndOfSearchResults = false;    
    let currentSearchTerm = '';          

    let currentActiveTabId = 'publicRepoContent'; 
    const originalStartImportBtnHtml = startImportBtn.innerHTML; 

    // 从Cookie加载用户凭据 
    const savedUsername = getCookie('username');
    const savedPassword = getCookie('password');
    if (savedUsername) document.getElementById('username').value = savedUsername;
    if (savedPassword) document.getElementById('password').value = savedPassword;

    // 监听导入模式标签页的切换事件
    document.querySelectorAll('#importTabs button[data-bs-toggle="tab"]').forEach(tabEl => {
        tabEl.addEventListener('shown.bs.tab', function (event) {
            currentActiveTabId = event.target.getAttribute('aria-controls'); 
            selectedPublicCodeHashInput.value = ''; 
            shortCodeInput.value = '';
            longBase64DataInput.value = '';
            longRootFolderNameInput.value = '';
            importShareProjectCheckbox.checked = false;
            if (shareFileInput) shareFileInput.value = ''; 
            
            document.querySelectorAll('.public-share-item.active').forEach(activeItem => {
                activeItem.classList.remove('active');
            });
            if (statusMessageEl.textContent.startsWith('已选择公共资源:') || statusMessageEl.textContent.startsWith('已成功加载文件:')) {
                updateStatusMessage(statusMessageEl, '请输入必填信息。', 'info');
            }
        });
    });

    // 导入表单的提交事件监听
    importForm.addEventListener('submit', async function (event) {
        event.preventDefault(); 
        resultArea.style.display = 'block'; 
        logOutputEl.textContent = '';       
        updateStatusMessage(statusMessageEl, '准备开始...', 'info'); 

        // 更新开始导入按钮状态：立即禁用并改变文字/图标
        startImportBtn.disabled = true;
        startImportBtn.innerHTML = '<i class="bi bi-hourglass-split"></i>处理中...';

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
                updateStatusMessage(statusMessageEl, '错误: 请输入或选择文件以填充长分享码。', 'danger');
                longBase64DataInput.focus();
                formValid = false;
            }
            if (!longRootFolderNameInput.value.trim()) {
                updateStatusMessage(statusMessageEl, '错误: 请输入或选择文件以填充根目录名。', 'danger');
                longRootFolderNameInput.focus();
                formValid = false;
            }
            if (formValid) { 
                payload.base64Data = longBase64DataInput.value.trim();
                payload.rootFolderName = longRootFolderNameInput.value.trim();
                payload.shareProject = importShareProjectCheckbox.checked;

                if (payload.shareProject && !payload.rootFolderName) {
                     updateStatusMessage(statusMessageEl, '错误: 加入资源共享计划时，必须填写有效的根目录名。', 'danger');
                     longRootFolderNameInput.focus();
                     formValid = false;
                }
            }
        } else {
             updateStatusMessage(statusMessageEl, '错误: 未知的导入模式。', 'danger');
             formValid = false;
        }

        if (!formValid) {
            // 恢复按钮状态因为校验失败提前返回
            startImportBtn.innerHTML = originalStartImportBtnHtml; 
            startImportBtn.disabled = false;
            return; 
        }

        handleApiStreamRequest({
            endpoint: API_IMPORT_URL,
            payload: payload,
            statusElement: statusMessageEl,
            logElement: logOutputEl,
            callbacks: { 
                onSuccess: function(data) {
                    // onSuccess 已由 streamApiHandler 处理 statusMessageEl
                },
                onFailure: function(message) { 
                    // onFailure 已由 streamApiHandler 处理 statusMessageEl
                },
                onRequestError: function(error) { 
                    // onRequestError 已由 streamApiHandler 处理 statusMessageEl
                },
                onStreamEnd: function() {
                    startImportBtn.innerHTML = originalStartImportBtnHtml;
                    startImportBtn.disabled = false;
                }
            }
        });
    });

    async function loadSharesPage(page, searchTerm = '') {
        const isSearchMode = searchTerm !== ''; 
        let isLoadingFlag, isEndFlag, currentPageToUpdate, sharesArrayToUpdate, listDiv, apiUrl, fetchOptions;

        if (isSearchMode) {
            if (isLoadingSearchResults && page > 1) return; 
            isLoadingSearchResults = true;
            isLoadingFlag = isLoadingSearchResults;
            isEndFlag = isEndOfSearchResults;
            sharesArrayToUpdate = allPublicSharesData; 
            listDiv = publicSharesListDiv;
            apiUrl = API_SEARCH_DATABASE_URL;
            fetchOptions = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rootFolderName: searchTerm, page: page })
            };
        } else {
            if (isLoadingPublicList && page > 1) return;
            isLoadingPublicList = true;
            isLoadingFlag = isLoadingPublicList;
            isEndFlag = isEndOfPublicList;
            sharesArrayToUpdate = allPublicSharesData;
            listDiv = publicSharesListDiv;
            apiUrl = `${API_LIST_PUBLIC_SHARES_URL}?page=${page}`; 
            fetchOptions = { method: 'GET' };
        }

        if (page === 1) {
            listDiv.innerHTML = '<p class="text-muted text-center">正在加载...</p>';
            allPublicSharesData = []; 
            if (isSearchMode) isEndOfSearchResults = false; else isEndOfPublicList = false; 
        } else {
            const loadingIndicator = listDiv.querySelector('.loading-indicator');
            if (!loadingIndicator) { 
                 listDiv.insertAdjacentHTML('beforeend', '<p class="text-muted text-center loading-indicator">正在加载更多...</p>');
            }
        }

        try {
            const response = await fetch(apiUrl, fetchOptions);
            const existingLoadingIndicator = listDiv.querySelector('.loading-indicator'); 
            if (existingLoadingIndicator) existingLoadingIndicator.remove(); 

            if (!response.ok) {
                if(page === 1) listDiv.innerHTML = `<p class="text-danger text-center">加载失败 (HTTP ${response.status})。</p>`;
                else listDiv.insertAdjacentHTML('beforeend', `<p class="text-danger text-center">加载更多失败。</p>`);
                if (isSearchMode) isEndOfSearchResults = true; else isEndOfPublicList = true;
                return;
            }
            const data = await response.json();

            if (data.success) {
                if (page === 1) listDiv.innerHTML = ''; 
                
                if (data.files && data.files.length > 0) {
                    allPublicSharesData = (page === 1) ? data.files : allPublicSharesData.concat(data.files);
                    renderPublicSharesList(data.files, true); 
                    if (isSearchMode) currentPageSearch = page; else currentPublicListPage = page;
                } else if (page === 1) { 
                    listDiv.innerHTML = `<p class="text-muted text-center">${isSearchMode ? '没有匹配的搜索结果。' : '暂无公共资源。'}</p>`;
                }
                if (isSearchMode) { isEndOfSearchResults = data.end; currentPageToUpdate = currentSearchPage = page; }
                else { isEndOfPublicList = data.end; currentPageToUpdate = currentPublicListPage = page; }
            } else {
                if(page === 1) listDiv.innerHTML = `<p class="text-danger text-center">加载失败: ${escapeHtml(data.message || '未知错误')}</p>`;
                else listDiv.insertAdjacentHTML('beforeend', `<p class="text-danger text-center">加载更多失败。</p>`);
                if (isSearchMode) isEndOfSearchResults = true; else isEndOfPublicList = true;
            }
        } catch (error) {
            console.error(`获取${isSearchMode ? '搜索结果' : '公共资源'}时出错 (页 ${page}):`, error);
            if(page === 1) listDiv.innerHTML = `<p class="text-danger text-center">加载时发生网络错误。</p>`;
            else listDiv.insertAdjacentHTML('beforeend', `<p class="text-danger text-center">加载更多时发生网络错误。</p>`);
            if (isSearchMode) isEndOfSearchResults = true; else isEndOfPublicList = true;
        } finally {
            if (isSearchMode) isLoadingSearchResults = false; else isLoadingPublicList = false;
        }
    }

    function renderPublicSharesList(sharesToRender, append = false) {
        if (!append) {
            publicSharesListDiv.innerHTML = ''; 
        }

        if (append && sharesToRender.length === 0) return;

        if (publicSharesListDiv.children.length === 0 && sharesToRender.length === 0 && !append) {
            publicSharesListDiv.innerHTML = `<p class="text-muted text-center">${currentSearchTerm ? '没有匹配的搜索结果。' : '暂无公共资源。'}</p>`;
            return;
        }
        
        sharesToRender.forEach(share => {
            const item = document.createElement('div');
            item.classList.add('public-share-item', 'd-flex', 'justify-content-between', 'align-items-center');
            
            const textContainer = document.createElement('div'); 
            textContainer.style.cursor = 'pointer'; 
            textContainer.style.flexGrow = '1'; 
            textContainer.style.overflow = 'hidden'; 
            textContainer.style.marginRight = '8px'; 
            textContainer.style.minWidth = '0'; 

            const nameSpan = document.createElement('span'); 
            nameSpan.classList.add('share-name');
            nameSpan.textContent = share.name;
            textContainer.appendChild(nameSpan);

            const tsSpan = document.createElement('span'); 
            tsSpan.classList.add('share-timestamp');
            const date = new Date(share.timestamp);
            tsSpan.textContent = `更新时间: ${date.toLocaleString('zh-CN')}`; 
            textContainer.appendChild(tsSpan);

            item.appendChild(textContainer); 

            const viewTreeBtn = document.createElement('button'); 
            viewTreeBtn.type = 'button';
            viewTreeBtn.classList.add('btn', 'btn-sm', 'btn-outline-secondary', 'view-content-tree-btn');
            viewTreeBtn.innerHTML = '<i class="bi bi-search"></i>'; 
            viewTreeBtn.dataset.codehash = share.codeHash; 
            viewTreeBtn.title = "查看目录结构";
            viewTreeBtn.style.flexShrink = '0'; 

            item.appendChild(viewTreeBtn); 
            
            textContainer.addEventListener('click', function() {
                document.querySelectorAll('.public-share-item.active').forEach(activeItem => {
                    activeItem.classList.remove('active');
                });
                item.classList.add('active'); 

                selectedPublicCodeHashInput.value = share.codeHash; 
                updateStatusMessage(statusMessageEl, `已选择公共资源: ${escapeHtml(share.name)}`, 'secondary');
                logOutputEl.textContent = ''; 
            });
            publicSharesListDiv.appendChild(item); 
        });
    }
    
    publicShareSearchInput.addEventListener('input', function(e) {
        currentSearchTerm = e.target.value.trim().toLowerCase(); 
        currentSearchPage = 1;           
        isEndOfSearchResults = false;    
        allPublicSharesData = [];        
        publicSharesListDiv.innerHTML = ''; 

        if (currentSearchTerm) {
            loadSharesPage(1, currentSearchTerm); 
        } else {
            currentPublicListPage = 1;
            isEndOfPublicList = false;
            loadSharesPage(1);
        }
    });

    if (selectShareFileButton && shareFileInput) {
        selectShareFileButton.addEventListener('click', function() {
            shareFileInput.click(); 
        });

        shareFileInput.addEventListener('change', function(event) {
            const file = event.target.files[0]; 
            if (file) {
                if (!file.name.toLowerCase().endsWith('.123share')) {
                    updateStatusMessage(statusMessageEl, '错误: 请选择一个有效的 .123share 文件。', 'danger');
                    shareFileInput.value = ''; 
                    return;
                }

                let rootFolderName = file.name;
                if (rootFolderName.toLowerCase().endsWith('.123share')) {
                    rootFolderName = rootFolderName.substring(0, rootFolderName.length - 9);
                }
                longRootFolderNameInput.value = rootFolderName; 

                const reader = new FileReader(); 
                reader.onload = function(e) {
                    longBase64DataInput.value = e.target.result; 
                    updateStatusMessage(statusMessageEl, `已成功加载文件: ${escapeHtml(file.name)}`, 'success');
                    
                    const longCodeTabButton = document.getElementById('long-code-tab');
                    if (longCodeTabButton && currentActiveTabId !== 'longCodeContent') {
                        const tabInstance = bootstrap.Tab.getInstance(longCodeTabButton) || new bootstrap.Tab(longCodeTabButton);
                        tabInstance.show();
                    }
                };
                reader.onerror = function(e) {
                    console.error("读取文件时出错:", e);
                    updateStatusMessage(statusMessageEl, `错误: 读取文件 ${escapeHtml(file.name)} 失败。请检查文件或浏览器权限。`, 'danger');
                    longBase64DataInput.value = ''; 
                    longRootFolderNameInput.value = ''; 
                };
                reader.readAsText(file, 'UTF-8'); 
                shareFileInput.value = ''; 
            }
        });
    }
    
    async function fetchAndDisplayContentTree(params) {
        const payload = {};
        if (params.codeHash) payload.codeHash = params.codeHash;
        if (params.shareCode) payload.shareCode = params.shareCode; 

        if (!payload.codeHash && !payload.shareCode) {
            contentTreeDisplayArea.innerHTML = '<p class="text-center text-danger">错误: 查看目录树缺少必要的参数。</p>';
            bsContentTreeModal.show();
            return;
        }

        contentTreeDisplayArea.innerHTML = '<div class="text-center p-3"><div class="spinner-border spinner-border-sm text-primary" role="status"><span class="visually-hidden">加载中...</span></div> <span class="ms-2 text-muted">正在加载目录结构...</span></div>';
        contentTreeSearchInput.value = ''; 
        bsContentTreeModal.show(); 

        try {
            const response = await fetch(API_GET_CONTENT_TREE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            contentTreeDisplayArea.innerHTML = ''; 

            if (result.isFinish === true) {
                if (Array.isArray(result.message) && result.message.length > 0) {
                    const treeHtml = result.message.map(line => `<div>${escapeHtml(line)}</div>`).join('');
                    contentTreeDisplayArea.innerHTML = treeHtml;
                } else if (Array.isArray(result.message) && result.message.length === 0) {
                    contentTreeDisplayArea.innerHTML = '<p class="text-center text-muted p-3">此分享内容为空。</p>';
                } else { 
                    contentTreeDisplayArea.innerHTML = '<p class="text-center text-muted p-3">目录为空或无法解析。</p>';
                }
            } else { 
                contentTreeDisplayArea.innerHTML = `<p class="text-center text-danger p-3">错误: ${escapeHtml(result.message)}</p>`;
            }
        } catch (error) {
            console.error('获取目录树失败:', error);
            contentTreeDisplayArea.innerHTML = `<p class="text-center text-danger p-3">请求目录树失败: ${escapeHtml(error.message)}</p>`;
            if (!bsContentTreeModal._isShown) bsContentTreeModal.show();
        }
    }

    document.getElementById('importTabsContent').addEventListener('click', function(event) {
        const target = event.target.closest('.view-content-tree-btn'); 
        if (!target) return; 

        let codeHash = null;
        let shareCode = null;

        if (target.id === 'viewTreeForShortCodeBtn') {
            codeHash = shortCodeInput.value.trim();
            if (!codeHash) { 
                alert('请输入短分享码。'); 
                updateStatusMessage(statusMessageEl, '请输入短分享码以查看目录结构。', 'warning');
                return; 
            }
        } else if (target.id === 'viewTreeForLongCodeBtn') {
            shareCode = longBase64DataInput.value.trim();
            if (!shareCode) { 
                alert('请输入长分享码（或从文件加载）。');
                updateStatusMessage(statusMessageEl, '请输入长分享码以查看目录结构。', 'warning');
                return; 
            }
        } else if (target.dataset.codehash) { 
            codeHash = target.dataset.codehash;
        } else {
            console.warn('未知的查看目录按钮被点击:', target);
            return;
        }

        if (codeHash || shareCode) {
            fetchAndDisplayContentTree({ codeHash, shareCode });
        }
    });

    contentTreeSearchInput.addEventListener('input', function() {
        const searchTerm = this.value.toLowerCase();
        const lines = contentTreeDisplayArea.querySelectorAll('div'); 
        lines.forEach(lineEl => {
            const text = lineEl.textContent.toLowerCase();
            lineEl.style.display = text.includes(searchTerm) ? '' : 'none';
        });
    });

    contentTreeModalEl.addEventListener('hidden.bs.modal', function () {
        contentTreeSearchInput.value = ''; 
        const lines = contentTreeDisplayArea.querySelectorAll('div');
        lines.forEach(lineEl => {
            lineEl.style.display = ''; 
        });
        contentTreeDisplayArea.innerHTML = ''; 
    });

    if (publicSharesListContainer) {
        publicSharesListContainer.addEventListener('scroll', function() {
            const { scrollTop, scrollHeight, clientHeight } = publicSharesListContainer;
            const threshold = 50; 

            if (scrollTop + clientHeight >= scrollHeight - threshold) {
                if (currentSearchTerm) { 
                    if (!isLoadingSearchResults && !isEndOfSearchResults) {
                        loadSharesPage(currentSearchPage + 1, currentSearchTerm);
                    }
                } else { 
                    if (!isLoadingPublicList && !isEndOfPublicList) {
                        loadSharesPage(currentPublicListPage + 1);
                    }
                }
            }
        });
    }

    loadSharesPage(1); 
});