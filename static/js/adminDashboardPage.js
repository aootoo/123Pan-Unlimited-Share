document.addEventListener('DOMContentLoaded', function () {
    const adminApiBase = window.APP_CONFIG.adminApiBaseUrl;
    const API_GET_CONTENT_TREE_URL = window.APP_CONFIG.apiGetContentTreeUrl;

    const tabsConfig = {
        approved: {
            body: document.getElementById('approved-table-body'),
            currentPage: 1, isLoading: false, isEnd: false, data: []
        },
        pending: {
            body: document.getElementById('pending-table-body'),
            currentPage: 1, isLoading: false, isEnd: false, data: []
        },
        private: {
            body: document.getElementById('private-table-body'),
            currentPage: 1, isLoading: false, isEnd: false, data: []
        }
    };
    let activeStatus = 'approved'; 

    // 长分享码模态框
    const viewShareCodeModal = new bootstrap.Modal(document.getElementById('viewShareCodeModal'));
    const modalCodeHashDisplaySpan = document.getElementById('modalCodeHashDisplay'); // 已修改ID
    const modalShareCodeTextarea = document.getElementById('modalShareCodeContent');
    const copyModalShareCodeBtn = document.getElementById('copyModalShareCode');
    const originalCopyModalBtnHtml = copyModalShareCodeBtn.innerHTML;

    // 目录树模态框元素 (移植自 importPage.js)
    const contentTreeModalEl = document.getElementById('contentTreeModal'); // HTML中已提供此模态框结构
    const contentTreeSearchInput = document.getElementById('contentTreeSearchInputAdmin'); // HTML中ID已修改
    const contentTreeDisplayArea = document.getElementById('contentTreeDisplayAreaAdmin'); // HTML中ID已修改
    const bsContentTreeModal = contentTreeModalEl ? new bootstrap.Modal(contentTreeModalEl) : null;

    async function fetchAdminApi(endpoint, method = 'GET', body = null) {
        const options = {
            method: method,
            headers: {},
        };
        if (method !== 'GET' && body) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        }
        try {
            const response = await fetch(`${adminApiBase}${endpoint}`, options);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: response.statusText }));
                throw new Error(`API请求失败 (${response.status}): ${errorData.message}`);
            }
            return await response.json(); 
        } catch (error) {
            console.error(`请求 ${adminApiBase}${endpoint} 失败:`, error);
            window.alert(`操作失败: ${error.message}`); 
            throw error; 
        }
    }

    async function loadSharesForTab(status, page, append = false) {
        const tab = tabsConfig[status]; 
        if (tab.isLoading || (append && tab.isEnd)) {
            return;
        }
        tab.isLoading = true; 

        if (page === 1 && !append) {
            tab.body.innerHTML = `<tr><td colspan="6" class="text-center text-muted">正在加载...</td></tr>`;
            tab.data = [];
            tab.isEnd = false;
        } else if (append) {
            const loadingRow = tab.body.insertRow(-1);
            loadingRow.classList.add('loading-indicator-row');
            loadingRow.innerHTML = `<td colspan="6" class="text-center text-muted">正在加载更多...</td>`;
        }

        try {
            const data = await fetchAdminApi(`/get_shares?status=${status}&page=${page}`, 'GET');
            const existingLoadingIndicator = tab.body.querySelector('.loading-indicator-row');
            if (existingLoadingIndicator) existingLoadingIndicator.remove();
            
            if (data.success) {
                if (page === 1 && !append) tab.body.innerHTML = ''; 
                if (data.shares && data.shares.length > 0) {
                    tab.data = append ? tab.data.concat(data.shares) : data.shares;
                    populateTable(tab.body, data.shares, append); 
                    tab.currentPage = page;
                } else if (page === 1 && !append) {
                    tab.body.innerHTML = `<tr><td colspan="6" class="text-center text-muted">暂无记录</td></tr>`;
                }
                tab.isEnd = data.end; 
                // 数量显示已从UI移除，故不再更新 tab.countSpan
            } else {
                if (page === 1 && !append) tab.body.innerHTML = `<tr><td colspan="6" class="text-center text-danger">加载失败: ${escapeHtml(data.message)}</td></tr>`;
                else if (append) tab.body.insertAdjacentHTML('beforeend', `<tr><td colspan="6" class="text-center text-danger">加载更多失败</td></tr>`);
                tab.isEnd = true; 
            }
        } catch (error) {
            if (page === 1 && !append) tab.body.innerHTML = `<tr><td colspan="6" class="text-center text-danger">加载时出现错误</td></tr>`;
            else if (append && tab.body.lastChild && tab.body.lastChild.classList.contains('loading-indicator-row')) {
                tab.body.lastChild.innerHTML = `<td colspan="6" class="text-center text-danger">加载更多错误</td>`;
            }
            tab.isEnd = true; 
        } finally {
            tab.isLoading = false; 
        }
    }

    function populateTable(tbody, sharesPage, append = false) {
        if (!append) { 
            tbody.innerHTML = ''; 
        }
        if (append && sharesPage.length === 0) return;
        if (tbody.children.length === 0 && sharesPage.length === 0 && !append) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">暂无记录</td></tr>`;
            return;
        }

        sharesPage.forEach(share => {
            const row = tbody.insertRow(); 
            row.dataset.codeHash = share.codeHash; 

            let statusBadge = ''; 
            if (share.visibleFlag === true) {
                statusBadge = '<span class="badge bg-success status-badge">已审核</span>';
            } else if (share.visibleFlag === null) { 
                statusBadge = '<span class="badge bg-warning text-dark status-badge">待审核</span>';
            } else if (share.visibleFlag === false) {
                statusBadge = '<span class="badge bg-secondary status-badge">私密</span>';
            }

            row.innerHTML = `
                <td class="codehash-cell">${escapeHtml(share.codeHash)}</td>
                <td class="root-folder-name-cell">${escapeHtml(share.rootFolderName)}</td>
                <td class="share-code-cell">
                    <span class="view-full-code" 
                          data-codehash="${escapeHtml(share.codeHash)}" 
                          data-sharecode="${escapeHtml(share.shareCode)}">
                        ${escapeHtml(share.shareCode.substring(0,10))}... (点击查看)
                    </span>
                </td>
                <td>${new Date(share.timeStamp).toLocaleString('zh-CN')}</td>
                <td>${statusBadge}</td>
                <td class="action-buttons">
                    ${generateActionButtons(share.codeHash, share.visibleFlag, share.rootFolderName, share.shareCode)}
                </td>
            `;
        });
    }
    
    function generateActionButtons(codeHash, visibleFlag, currentName, shareCode) {
        let buttons = `<button class="btn btn-outline-info btn-sm edit-name-btn" data-currentname="${escapeHtml(currentName)}">编辑名称</button>`;
        if (visibleFlag === null) { 
            buttons += `<button class="btn btn-success btn-sm update-status-btn" data-newstatus="approved">审核通过</button>`;
            buttons += `<button class="btn btn-secondary btn-sm update-status-btn" data-newstatus="private">转私密</button>`;
        } else if (visibleFlag === true) { 
            buttons += `<button class="btn btn-warning btn-sm update-status-btn" data-newstatus="pending">设为待审</button>`;
            buttons += `<button class="btn btn-secondary btn-sm update-status-btn" data-newstatus="private">转私密</button>`;
        } else if (visibleFlag === false) { 
            buttons += `<button class="btn btn-info btn-sm update-status-btn" data-newstatus="pending">设为待审</button>`;
        }
        // 新增查看目录按钮
        buttons += `<button class="btn btn-outline-secondary btn-sm view-share-content-tree-btn" data-codehash="${escapeHtml(codeHash)}" data-sharecode="${escapeHtml(shareCode)}" title="查看目录结构"><i class="bi bi-folder2-open"></i></button>`;
        buttons += `<button class="btn btn-danger btn-sm delete-share-btn" title="删除"><i class="bi bi-trash"></i></button>`;
        return buttons;
    }

    document.body.addEventListener('click', async function(event) {
        const target = event.target.closest('button, span.view-full-code'); // 确保能捕获按钮和可点击的span
        if (!target) return;
        
        if (target.classList.contains('view-full-code')) {
            const codeHash = target.dataset.codehash;
            const shareCode = target.dataset.sharecode;
            modalCodeHashDisplaySpan.textContent = codeHash; 
            modalShareCodeTextarea.value = shareCode; 
            viewShareCodeModal.show(); 
            return; 
        }

        const row = target.closest('tr'); 
        if (!row) return; 

        const codeHashFromRow = row.dataset.codeHash; 

        if (target.classList.contains('edit-name-btn')) {
            const nameCell = row.querySelector('.root-folder-name-cell');
            const currentName = target.dataset.currentname;
            nameCell.innerHTML = `
                <div class="input-group input-group-sm edit-input-group">
                    <input type="text" class="form-control form-control-sm" value="${escapeHtml(currentName)}">
                    <button class="btn btn-success btn-sm save-name-btn">确认</button>
                    <button class="btn btn-secondary btn-sm cancel-edit-btn" data-original="${escapeHtml(currentName)}">取消</button>
                </div>`;
            
            // 隐藏所有其他操作按钮，只显示保存和取消
            row.querySelectorAll('.action-buttons .btn').forEach(btn => {
                if (!btn.classList.contains('save-name-btn') && !btn.classList.contains('cancel-edit-btn')) {
                    btn.style.display = 'none';
                }
            });
            target.style.display = 'none';

        } else if (target.classList.contains('save-name-btn')) {
            const inputField = row.querySelector('.root-folder-name-cell input[type="text"]');
            const newName = inputField.value;
            await updateShareName(codeHashFromRow, newName, row); 
        } else if (target.classList.contains('cancel-edit-btn')) {
            const currentTabConfig = tabsConfig[activeStatus];
            loadSharesForTab(activeStatus, currentTabConfig.currentPage, false); 
        } else if (target.classList.contains('update-status-btn')) {
            const newStatus = target.dataset.newstatus;
            await updateShareStatus(codeHashFromRow, newStatus); 
        } else if (target.classList.contains('delete-share-btn')) {
            await deleteShareConfirmation(codeHashFromRow); 
        } else if (target.classList.contains('view-share-content-tree-btn')) { // 处理查看目录按钮
            const codeHash = target.dataset.codehash;
            const shareCode = target.dataset.sharecode; // 从按钮的data属性获取长码
            if (bsContentTreeModal) { // 确保模态框实例存在
                fetchAndDisplayContentTree({ codeHash, shareCode }); // 传递短码和长码
            } else {
                console.error("目录树模态框未初始化！");
            }
        }
    });
        
    async function updateShareName(codeHash, newName, rowElement) {
        if (!newName.trim()) {
            alert("分享名称不能为空。");
            return;
        }
        if (!confirm(`确定要将短码 ${escapeHtml(codeHash.substring(0,8))}... 的名称修改为 "${escapeHtml(newName)}" 吗？`)) {
            return;
        }
        try {
            const data = await fetchAdminApi('/update_share_name', 'POST', { codeHash, newName });
            if (data.success) {
                alert(data.message);
                tabsConfig[activeStatus].currentPage = 1;
                tabsConfig[activeStatus].isEnd = false;
                tabsConfig[activeStatus].data = [];
                loadSharesForTab(activeStatus, 1, false);
            } else {
                alert(`修改名称失败: ${data.message}`);
            }
        } catch (error) { /* 错误已处理 */ }
    }

    async function updateShareStatus(codeHash, newStatus) {
        const statusTextMap = { approved: "审核通过", pending: "设为待审核", private: "转为私密" };
        if (!confirm(`确定要将短码 ${escapeHtml(codeHash.substring(0,8))}... 的状态改为 "${statusTextMap[newStatus]}" 吗？`)) {
            return;
        }
        try {
            const data = await fetchAdminApi('/update_share_status', 'POST', { codeHash, newStatus });
            if (data.success) {
                alert(data.message);
                tabsConfig[activeStatus].currentPage = 1;
                tabsConfig[activeStatus].isEnd = false;
                tabsConfig[activeStatus].data = [];
                loadSharesForTab(activeStatus, 1, false); 
            } else {
                alert(`更新状态失败: ${data.message}`);
            }
        } catch (error) { /* 错误已处理 */ }
    }

    async function deleteShareConfirmation(codeHash) {
        if (!confirm(`确定要永久删除短码为 ${escapeHtml(codeHash.substring(0,8))}... 的分享记录吗？此操作不可恢复！`)) {
            return;
        }
        try {
            const data = await fetchAdminApi('/delete_share', 'POST', { codeHash });
            if (data.success) {
                alert(data.message);
                tabsConfig[activeStatus].currentPage = 1;
                tabsConfig[activeStatus].isEnd = false;
                tabsConfig[activeStatus].data = [];
                loadSharesForTab(activeStatus, 1, false);
            } else {
                alert(`删除失败: ${data.message}`);
            }
        } catch (error) { /* 错误已处理 */ }
    }

    copyModalShareCodeBtn.addEventListener('click', function() {
        copyToClipboard(modalShareCodeTextarea, copyModalShareCodeBtn, '已复制!', originalCopyModalBtnHtml);
    });

    document.querySelectorAll('#adminTabs .nav-link').forEach(tabLink => {
        tabLink.addEventListener('shown.bs.tab', function (event) {
            activeStatus = event.target.id.split('-')[0]; 
            const tabConfig = tabsConfig[activeStatus];
            if (tabConfig.data.length === 0 || !tabConfig.isEnd) {
                tabConfig.currentPage = 1;
                tabConfig.isEnd = false;
                tabConfig.data = [];
                loadSharesForTab(activeStatus, 1, false);
            }
            // 数量显示已移除
        });
    });

    document.querySelectorAll('.tab-pane .table-responsive').forEach(scrollableDiv => {
        scrollableDiv.addEventListener('scroll', function() {
            const paneId = scrollableDiv.closest('.tab-pane').id;
            const statusOfPane = paneId.split('-')[0]; 
            if (statusOfPane !== activeStatus) {
                return;
            }
            const tabConfig = tabsConfig[activeStatus];
            if (tabConfig.isLoading || tabConfig.isEnd) {
                return;
            }
            const { scrollTop, scrollHeight, clientHeight } = scrollableDiv;
            if (scrollHeight - scrollTop - clientHeight <= 200) { 
                loadSharesForTab(activeStatus, tabConfig.currentPage + 1, true); 
            }
        });
    });

    // --- 内容目录树相关逻辑 (移植自 importPage.js 并适配) ---
    async function fetchAndDisplayContentTree(params) {
        const payload = {};
        // 管理员后台调用时，优先使用 shareCode (长码) 来获取目录树，因为短码可能未公开或数据库可能不是最新。
        // 但如果API仅支持通过 codeHash + 数据库查询 或直接传入 shareCode，则需要确保传入正确的参数。
        // 当前 get_content_tree API 接受 codeHash 或 shareCode。
        // 从表格按钮传递过来的 params 会包含 codeHash 和 shareCode
        if (params.shareCode) { // 优先使用长码（如果API支持直接处理）
             payload.shareCode = params.shareCode;
        } else if (params.codeHash) {
            payload.codeHash = params.codeHash;
        }

        if (!payload.codeHash && !payload.shareCode) {
            contentTreeDisplayArea.innerHTML = '<p class="text-center text-danger">错误: 查看目录树缺少必要的分享码信息。</p>';
            if (bsContentTreeModal) bsContentTreeModal.show();
            return;
        }

        contentTreeDisplayArea.innerHTML = '<div class="text-center p-3"><div class="spinner-border spinner-border-sm text-primary" role="status"><span class="visually-hidden">加载中...</span></div> <span class="ms-2 text-muted">正在加载目录结构...</span></div>';
        contentTreeSearchInput.value = ''; 
        if (bsContentTreeModal) bsContentTreeModal.show(); 

        try {
            // 使用全局的 API_GET_CONTENT_TREE_URL
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
            if (bsContentTreeModal && !bsContentTreeModal._isShown) bsContentTreeModal.show();
        }
    }

    if (contentTreeSearchInput) {
        contentTreeSearchInput.addEventListener('input', function() {
            const searchTerm = this.value.toLowerCase();
            const lines = contentTreeDisplayArea.querySelectorAll('div'); 
            lines.forEach(lineEl => {
                const text = lineEl.textContent.toLowerCase();
                lineEl.style.display = text.includes(searchTerm) ? '' : 'none';
            });
        });
    }

    if (contentTreeModalEl) {
        contentTreeModalEl.addEventListener('hidden.bs.modal', function () {
            contentTreeSearchInput.value = ''; 
            const lines = contentTreeDisplayArea.querySelectorAll('div');
            lines.forEach(lineEl => {
                lineEl.style.display = ''; 
            });
            contentTreeDisplayArea.innerHTML = ''; 
        });
    }
    // --- 内容目录树相关逻辑结束 ---

    loadSharesForTab(activeStatus, 1, false); 
});