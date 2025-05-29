document.addEventListener('DOMContentLoaded', async function () {
    // 客户端侧检查IP是否为中国大陆地区, 如果是则重定向
    await checkRegionAndRedirect(); 

    // 获取表单和结果显示区域的DOM元素
    const importForm = document.getElementById('importForm');
    const resultArea = document.getElementById('resultArea');
    const statusMessageEl = document.getElementById('statusMessage');
    const logOutputEl = document.getElementById('logOutput');
    
    // 公共资源库相关的DOM元素
    const selectedPublicCodeHashInput = document.getElementById('selectedPublicCodeHash'); // 隐藏input，用于存储选中的公共资源hash
    const publicSharesListDiv = document.getElementById('publicSharesListActual');      // 显示公共资源列表的容器
    const publicShareSearchInput = document.getElementById('publicShareSearch');        // 公共资源搜索框
    const publicSharesListContainer = document.getElementById('publicSharesListContainer'); // 公共资源列表的滚动容器

    // 短分享码、长分享码、文件导入相关的DOM元素
    const shortCodeInput = document.getElementById('shortCodeInput');
    const longBase64DataInput = document.getElementById('longBase64DataInput');
    const longRootFolderNameInput = document.getElementById('longRootFolderNameInput');
    const importShareProjectCheckbox = document.getElementById('importShareProject'); // 是否加入共享计划的复选框

    const shareFileInput = document.getElementById('shareFileInput'); // 隐藏的文件选择input
    const selectShareFileButton = document.getElementById('selectShareFileButton'); // “选择.123share文件”按钮

    // 内容目录树模态框相关的DOM元素
    const contentTreeModalEl = document.getElementById('contentTreeModal');
    const contentTreeSearchInput = document.getElementById('contentTreeSearchInput'); // 目录树内的搜索框
    const contentTreeDisplayArea = document.getElementById('contentTreeDisplayArea'); // 显示目录树内容的区域
    const bsContentTreeModal = new bootstrap.Modal(contentTreeModalEl); // Bootstrap模态框实例

    // API端点URL (从HTML内联脚本或全局配置中获取，提供默认值)
    const API_IMPORT_URL = window.APP_CONFIG.apiImportUrl || '/api/import';
    const API_LIST_PUBLIC_SHARES_URL = window.APP_CONFIG.apiListPublicSharesUrl || '/api/list_public_shares';
    const API_GET_CONTENT_TREE_URL = window.APP_CONFIG.apiGetContentTreeUrl || '/api/get_content_tree';
    const API_SEARCH_DATABASE_URL = window.APP_CONFIG.apiSearchDatabaseUrl || '/api/search_database'; // 新增搜索API

    // 分页和加载状态变量
    let allPublicSharesData = []; // 用于存储当前显示的列表数据（公共列表或搜索结果）

    let currentPublicListPage = 1;       // 公共资源列表的当前页码
    let isLoadingPublicList = false;     // 公共资源列表是否正在加载
    let isEndOfPublicList = false;       // 公共资源列表是否已到末尾

    let currentSearchPage = 1;           // 搜索结果的当前页码
    let isLoadingSearchResults = false;  // 搜索结果是否正在加载
    let isEndOfSearchResults = false;    // 搜索结果是否已到末尾
    let currentSearchTerm = '';          // 当前的搜索关键词

    let currentActiveTabId = 'publicRepoContent'; // 默认活动的导入模式标签页ID

    // 从Cookie加载用户凭据 (如果存在)
    const savedUsername = getCookie('username');
    const savedPassword = getCookie('password');
    if (savedUsername) document.getElementById('username').value = savedUsername;
    if (savedPassword) document.getElementById('password').value = savedPassword;

    // 监听导入模式标签页的切换事件
    document.querySelectorAll('#importTabs button[data-bs-toggle="tab"]').forEach(tabEl => {
        tabEl.addEventListener('shown.bs.tab', function (event) {
            currentActiveTabId = event.target.getAttribute('aria-controls'); // 更新当前激活的标签页ID
            // 清理所有输入字段，避免在不同导入模式间混淆数据
            selectedPublicCodeHashInput.value = ''; 
            shortCodeInput.value = '';
            longBase64DataInput.value = '';
            longRootFolderNameInput.value = '';
            importShareProjectCheckbox.checked = false;
            if (shareFileInput) shareFileInput.value = ''; // 清空文件选择器的值
            
            // 移除公共资源列表中的选中高亮状态
            document.querySelectorAll('.public-share-item.active').forEach(activeItem => {
                activeItem.classList.remove('active');
            });
            // 如果顶部的状态消息是关于已选择的公共资源或文件加载，则清除它
            if (statusMessageEl.textContent.startsWith('已选择公共资源:') || statusMessageEl.textContent.startsWith('已成功加载文件:')) {
                updateStatusMessage(statusMessageEl, '请输入必填信息。', 'info');
            }
        });
    });

    // 导入表单的提交事件监听
    importForm.addEventListener('submit', async function (event) {
        event.preventDefault(); // 阻止表单默认提交行为
        resultArea.style.display = 'block'; // 显示结果区域
        logOutputEl.textContent = '';       // 清空之前的日志
        updateStatusMessage(statusMessageEl, '准备开始...', 'info'); // 设置初始状态消息

        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        // 将用户凭据保存到Cookie，有效期30天
        setCookie('username', username, 30);
        setCookie('password', password, 30);

        let payload = { username: username, password: password }; // 构建API请求的负载对象
        let formValid = true; // 表单校验标志

        // 根据当前激活的导入模式，准备payload并进行校验
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
            if (formValid) { // 只有当基本校验通过时才继续
                payload.base64Data = longBase64DataInput.value.trim();
                payload.rootFolderName = longRootFolderNameInput.value.trim();
                payload.shareProject = importShareProjectCheckbox.checked;

                // 如果勾选了加入共享计划，根目录名必须再次校验 (虽然上面已校验非空)
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

        if (!formValid) return; // 如果表单校验失败，则不继续

        // 调用通用的流式API请求处理函数
        handleApiStreamRequest({
            endpoint: API_IMPORT_URL,
            payload: payload,
            statusElement: statusMessageEl,
            logElement: logOutputEl,
            callbacks: { // 定义成功、失败等情况的回调
                onSuccess: function(data) {
                    // 导入操作在 isFinish:true 时，jsonData.message 是字符串，不是包含分享码的对象
                    // streamApiHandler 已经处理了这种情况并更新了 statusMessageEl
                },
                onFailure: function(message) { /* streamApiHandler 会更新UI */ },
                onRequestError: function(error) { /* streamApiHandler 会更新UI */ }
            }
        });
    });

    /**
     * 加载公共资源列表或搜索结果的某一页。
     * @param {number} page 要加载的页码。
     * @param {string} searchTerm 搜索关键词。如果为空字符串，则加载公共资源列表。
     */
    async function loadSharesPage(page, searchTerm = '') {
        const isSearchMode = searchTerm !== ''; // 判断是否为搜索模式
        let isLoadingFlag, isEndFlag, currentPageToUpdate, sharesArrayToUpdate, listDiv, apiUrl, fetchOptions;

        // 根据模式设置相应的状态变量和API参数
        if (isSearchMode) {
            if (isLoadingSearchResults && page > 1) return; // 如果正在加载（非第一页），则不重复加载
            isLoadingSearchResults = true;
            isLoadingFlag = isLoadingSearchResults;
            isEndFlag = isEndOfSearchResults;
            sharesArrayToUpdate = allPublicSharesData; // 搜索结果和公共列表共用一个数据数组，但通过模式区分
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
            apiUrl = `${API_LIST_PUBLIC_SHARES_URL}?page=${page}`; // GET请求，页码在URL中
            fetchOptions = { method: 'GET' };
        }

        // UI提示：如果是第一页，显示 "正在加载..."，否则在列表末尾追加 "正在加载更多..."
        if (page === 1) {
            listDiv.innerHTML = '<p class="text-muted text-center">正在加载...</p>';
            allPublicSharesData = []; // 重置数据数组
            if (isSearchMode) isEndOfSearchResults = false; else isEndOfPublicList = false; // 重置结束标记
        } else {
            const loadingIndicator = listDiv.querySelector('.loading-indicator');
            if (!loadingIndicator) { // 避免重复添加加载指示器
                 listDiv.insertAdjacentHTML('beforeend', '<p class="text-muted text-center loading-indicator">正在加载更多...</p>');
            }
        }

        try {
            const response = await fetch(apiUrl, fetchOptions);
            const existingLoadingIndicator = listDiv.querySelector('.loading-indicator'); // 获取加载指示器DOM元素
            if (existingLoadingIndicator) existingLoadingIndicator.remove(); // 移除加载指示器

            if (!response.ok) {
                if(page === 1) listDiv.innerHTML = `<p class="text-danger text-center">加载失败 (HTTP ${response.status})。</p>`;
                else listDiv.insertAdjacentHTML('beforeend', `<p class="text-danger text-center">加载更多失败。</p>`);
                if (isSearchMode) isEndOfSearchResults = true; else isEndOfPublicList = true;
                return;
            }
            const data = await response.json();

            if (data.success) {
                if (page === 1) listDiv.innerHTML = ''; // 成功获取第一页数据后，清空 "正在加载..."
                
                if (data.files && data.files.length > 0) {
                    allPublicSharesData = (page === 1) ? data.files : allPublicSharesData.concat(data.files);
                    renderPublicSharesList(data.files, true); // true表示追加模式
                    if (isSearchMode) currentPageSearch = page; else currentPublicListPage = page;
                } else if (page === 1) { // 第一页就没有数据
                    listDiv.innerHTML = `<p class="text-muted text-center">${isSearchMode ? '没有匹配的搜索结果。' : '暂无公共资源。'}</p>`;
                }
                // 更新是否到达末尾的标记
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
            // 重置加载状态标志
            if (isSearchMode) isLoadingSearchResults = false; else isLoadingPublicList = false;
        }
    }

    /**
     * 将获取到的分享数据渲染到公共资源列表中。
     * @param {Array<object>} sharesToRender 要渲染的分享数据数组。
     * @param {boolean} append 是否将数据追加到现有列表 (默认为 false，即替换)。
     */
    function renderPublicSharesList(sharesToRender, append = false) {
        if (!append) {
            publicSharesListDiv.innerHTML = ''; // 如果不是追加模式，则先清空列表
        }

        // 如果是追加模式但传入的待渲染数组为空，则什么也不做
        if (append && sharesToRender.length === 0) return;

        // 如果列表为空（即之前没有数据，也不是追加模式），且当前待渲染数据也为空，则显示提示信息
        if (publicSharesListDiv.children.length === 0 && sharesToRender.length === 0 && !append) {
            publicSharesListDiv.innerHTML = `<p class="text-muted text-center">${currentSearchTerm ? '没有匹配的搜索结果。' : '暂无公共资源。'}</p>`;
            return;
        }
        
        sharesToRender.forEach(share => {
            // 创建列表项的DOM结构
            const item = document.createElement('div');
            item.classList.add('public-share-item', 'd-flex', 'justify-content-between', 'align-items-center');
            
            const textContainer = document.createElement('div'); // 用于包裹名称和时间戳，使其可点击
            textContainer.style.cursor = 'pointer'; 
            textContainer.style.flexGrow = '1'; 
            textContainer.style.overflow = 'hidden'; 
            textContainer.style.marginRight = '8px'; 
            textContainer.style.minWidth = '0'; // 允许flex item收缩以适配内容截断或换行

            const nameSpan = document.createElement('span'); // 分享名称
            nameSpan.classList.add('share-name');
            nameSpan.textContent = share.name;
            textContainer.appendChild(nameSpan);

            const tsSpan = document.createElement('span'); // 时间戳
            tsSpan.classList.add('share-timestamp');
            const date = new Date(share.timestamp);
            tsSpan.textContent = `更新时间: ${date.toLocaleString('zh-CN')}`; // 本地化时间显示
            textContainer.appendChild(tsSpan);

            item.appendChild(textContainer); // 将文本容器加入列表项

            const viewTreeBtn = document.createElement('button'); // "查看目录树"按钮
            viewTreeBtn.type = 'button';
            viewTreeBtn.classList.add('btn', 'btn-sm', 'btn-outline-secondary', 'view-content-tree-btn');
            viewTreeBtn.innerHTML = '<i class="bi bi-search"></i>'; // 搜索图标
            viewTreeBtn.dataset.codehash = share.codeHash; // 存储短码到按钮data属性
            viewTreeBtn.title = "查看目录结构";
            viewTreeBtn.style.flexShrink = '0'; // 防止按钮在名称过长时被挤压

            item.appendChild(viewTreeBtn); // 将按钮加入列表项
            
            // 给文本容器添加点击事件，用于选中该分享资源
            textContainer.addEventListener('click', function() {
                // 移除其他所有项的选中状态
                document.querySelectorAll('.public-share-item.active').forEach(activeItem => {
                    activeItem.classList.remove('active');
                });
                item.classList.add('active'); // 给当前项添加选中状态

                selectedPublicCodeHashInput.value = share.codeHash; // 将选中的短码存入隐藏input
                updateStatusMessage(statusMessageEl, `已选择公共资源: ${escapeHtml(share.name)}`, 'secondary');
                logOutputEl.textContent = ''; // 清空操作日志
            });
            publicSharesListDiv.appendChild(item); // 将构建好的列表项加入到总列表中
        });
    }
    
    // 公共资源搜索框的输入事件监听
    publicShareSearchInput.addEventListener('input', function(e) {
        currentSearchTerm = e.target.value.trim().toLowerCase(); // 获取并处理搜索词
        currentSearchPage = 1;           // 重置搜索结果的页码
        isEndOfSearchResults = false;    // 重置搜索结果的结束标记
        allPublicSharesData = [];        // 清空当前数据数组
        publicSharesListDiv.innerHTML = ''; // 立即清空显示的列表

        if (currentSearchTerm) {
            loadSharesPage(1, currentSearchTerm); // 如果有搜索词，则按搜索模式加载第一页
        } else {
            // 如果搜索词为空，则重新加载公共资源列表的第一页
            currentPublicListPage = 1;
            isEndOfPublicList = false;
            loadSharesPage(1);
        }
    });

    // "选择.123share文件"按钮的点击事件处理
    if (selectShareFileButton && shareFileInput) {
        selectShareFileButton.addEventListener('click', function() {
            shareFileInput.click(); // 触发隐藏的文件输入框的点击事件
        });

        // 文件输入框的change事件处理 (当用户选择了文件后触发)
        shareFileInput.addEventListener('change', function(event) {
            const file = event.target.files[0]; // 获取选择的第一个文件
            if (file) {
                // 再次校验文件类型 (虽然HTML的accept属性已做限制)
                if (!file.name.toLowerCase().endsWith('.123share')) {
                    updateStatusMessage(statusMessageEl, '错误: 请选择一个有效的 .123share 文件。', 'danger');
                    shareFileInput.value = ''; // 清空选择，以便用户可以重新选择相同文件
                    return;
                }

                // 提取文件名作为根目录名 (去掉.123share后缀)
                let rootFolderName = file.name;
                if (rootFolderName.toLowerCase().endsWith('.123share')) {
                    rootFolderName = rootFolderName.substring(0, rootFolderName.length - 9);
                }
                longRootFolderNameInput.value = rootFolderName; // 填充根目录名输入框

                const reader = new FileReader(); // 使用FileReader读取文件内容
                reader.onload = function(e) {
                    // 文件成功读取后
                    longBase64DataInput.value = e.target.result; // 将文件内容填充到长分享码文本域
                    updateStatusMessage(statusMessageEl, `已成功加载文件: ${escapeHtml(file.name)}`, 'success');
                    
                    // 检查并尝试自动切换到 "从长分享码/文件导入" 标签页
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
                reader.readAsText(file, 'UTF-8'); // 以UTF-8编码读取文本
                shareFileInput.value = ''; // 清空文件选择器的值，以便用户可以再次选择同一个文件并触发change事件
            }
        });
    }

    // --- 内容目录树相关逻辑 ---
    /**
     * 异步获取并显示指定分享码的目录树结构。
     * @param {object} params 参数对象，包含codeHash或shareCode。
     * @param {string} [params.codeHash] 短分享码。
     * @param {string} [params.shareCode] 长分享码 (Base64)。
     */
    async function fetchAndDisplayContentTree(params) {
        const payload = {};
        if (params.codeHash) payload.codeHash = params.codeHash;
        if (params.shareCode) payload.shareCode = params.shareCode; // API会处理base64解码

        if (!payload.codeHash && !payload.shareCode) {
            contentTreeDisplayArea.innerHTML = '<p class="text-center text-danger">错误: 查看目录树缺少必要的参数。</p>';
            bsContentTreeModal.show();
            return;
        }

        // 显示模态框前清空旧内容并设置加载状态
        contentTreeDisplayArea.innerHTML = '<div class="text-center p-3"><div class="spinner-border spinner-border-sm text-primary" role="status"><span class="visually-hidden">加载中...</span></div> <span class="ms-2 text-muted">正在加载目录结构...</span></div>';
        contentTreeSearchInput.value = ''; // 清空目录树内的搜索框
        bsContentTreeModal.show(); // 显示模态框

        try {
            const response = await fetch(API_GET_CONTENT_TREE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            contentTreeDisplayArea.innerHTML = ''; // 清除加载提示

            if (result.isFinish === true) {
                if (Array.isArray(result.message) && result.message.length > 0) {
                    // 将目录树的每一行包装在div中并显示
                    const treeHtml = result.message.map(line => `<div>${escapeHtml(line)}</div>`).join('');
                    contentTreeDisplayArea.innerHTML = treeHtml;
                } else if (Array.isArray(result.message) && result.message.length === 0) {
                    contentTreeDisplayArea.innerHTML = '<p class="text-center text-muted p-3">此分享内容为空。</p>';
                } else { // result.message 不是预期的数组格式
                    contentTreeDisplayArea.innerHTML = '<p class="text-center text-muted p-3">目录为空或无法解析。</p>';
                }
            } else { // API返回 isFinish: false
                contentTreeDisplayArea.innerHTML = `<p class="text-center text-danger p-3">错误: ${escapeHtml(result.message)}</p>`;
            }
        } catch (error) {
            console.error('获取目录树失败:', error);
            contentTreeDisplayArea.innerHTML = `<p class="text-center text-danger p-3">请求目录树失败: ${escapeHtml(error.message)}</p>`;
            // 如果请求失败前模态框未显示，则显示它以展示错误
            if (!bsContentTreeModal._isShown) bsContentTreeModal.show();
        }
    }

    // 使用事件委托处理所有 "view-content-tree-btn" 按钮的点击
    document.getElementById('importTabsContent').addEventListener('click', function(event) {
        const target = event.target.closest('.view-content-tree-btn'); // 确保点到按钮本身或其内部图标
        if (!target) return; // 如果没点到目标按钮，则忽略

        let codeHash = null;
        let shareCode = null;

        // 根据按钮ID或data属性确定是从哪个输入获取分享码
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
        } else if (target.dataset.codehash) { // 来自公共资源列表项的按钮
            codeHash = target.dataset.codehash;
        } else {
            console.warn('未知的查看目录按钮被点击:', target);
            return;
        }

        if (codeHash || shareCode) {
            fetchAndDisplayContentTree({ codeHash, shareCode });
        }
    });

    // 目录树模态框内的文件名搜索功能
    contentTreeSearchInput.addEventListener('input', function() {
        const searchTerm = this.value.toLowerCase();
        const lines = contentTreeDisplayArea.querySelectorAll('div'); // 假设目录树每行是一个div
        lines.forEach(lineEl => {
            const text = lineEl.textContent.toLowerCase();
            // 如果行文本包含搜索词，则显示该行，否则隐藏
            lineEl.style.display = text.includes(searchTerm) ? '' : 'none';
        });
    });

    // 当目录树模态框隐藏时，清空搜索框并重置行显示
    contentTreeModalEl.addEventListener('hidden.bs.modal', function () {
        contentTreeSearchInput.value = ''; // 清空搜索框
        const lines = contentTreeDisplayArea.querySelectorAll('div');
        lines.forEach(lineEl => {
            lineEl.style.display = ''; // 重置所有行的显示状态
        });
        contentTreeDisplayArea.innerHTML = ''; // 完全清空内容，下次打开时会重新加载
    });
    // --- 内容目录树相关逻辑结束 ---

    // 公共资源列表容器的滚动事件监听，用于无限滚动加载
    if (publicSharesListContainer) {
        publicSharesListContainer.addEventListener('scroll', function() {
            const { scrollTop, scrollHeight, clientHeight } = publicSharesListContainer;
            const threshold = 50; // 距离底部50px时触发加载更多

            // 判断是否滚动到接近底部
            if (scrollTop + clientHeight >= scrollHeight - threshold) {
                if (currentSearchTerm) { // 如果当前是搜索模式
                    if (!isLoadingSearchResults && !isEndOfSearchResults) {
                        loadSharesPage(currentSearchPage + 1, currentSearchTerm);
                    }
                } else { // 如果当前是浏览公共列表模式
                    if (!isLoadingPublicList && !isEndOfPublicList) {
                        loadSharesPage(currentPublicListPage + 1);
                    }
                }
            }
        });
    }

    // 初始加载: 加载公共资源列表的第一页
    loadSharesPage(1); 
});