document.addEventListener('DOMContentLoaded', function () {
    // 从HTML中获取Admin API的基础URL (通过Flask的url_for生成)
    const adminApiBase = window.APP_CONFIG.adminApiBaseUrl;

    // 配置对象，用于管理每个标签页的状态和数据
    const tabsConfig = {
        approved: {
            body: document.getElementById('approved-table-body'), // 表格体元素
            countSpan: document.getElementById('approved-count'), // 显示数量的span元素
            currentPage: 1,       // 当前加载到的页码
            isLoading: false,     // 是否正在加载数据
            isEnd: false,         // 是否已到达数据末尾
            data: []              // 存储该标签页已加载的所有数据项
        },
        pending: {
            body: document.getElementById('pending-table-body'),
            countSpan: document.getElementById('pending-count'),
            currentPage: 1,
            isLoading: false,
            isEnd: false,
            data: []
        },
        private: {
            body: document.getElementById('private-table-body'),
            countSpan: document.getElementById('private-count'),
            currentPage: 1,
            isLoading: false,
            isEnd: false,
            data: []
        }
    };
    let activeStatus = 'approved'; // 默认激活的标签页状态 (approved, pending, private)

    // 查看完整长分享码模态框相关的元素
    const viewShareCodeModal = new bootstrap.Modal(document.getElementById('viewShareCodeModal'));
    const modalCodeHashSpan = document.getElementById('modalCodeHash');
    const modalShareCodeTextarea = document.getElementById('modalShareCodeContent');
    const copyModalShareCodeBtn = document.getElementById('copyModalShareCode');
    const originalCopyModalBtnHtml = copyModalShareCodeBtn.innerHTML; // 保存复制按钮的原始HTML，用于反馈后恢复

    /**
     * 异步函数，用于向Admin API发送请求。
     * @param {string} endpoint API的端点路径 (例如: '/get_shares')。
     * @param {string} method HTTP请求方法 (默认为 'GET')。
     * @param {object|null} body 请求体数据 (对于POST, PUT等方法)。
     * @returns {Promise<object>} 返回从API获取的JSON数据。
     * @throws {Error} 如果API请求失败或响应不成功，则抛出错误。
     */
    async function fetchAdminApi(endpoint, method = 'GET', body = null) {
        const options = {
            method: method,
            headers: {}, // 初始化headers对象
        };
        // 仅当方法不是GET且有请求体时，才设置Content-Type和body
        if (method !== 'GET' && body) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        }
        
        // 如果是GET请求且有 'body' 作为查询参数对象 (特定场景，通常GET参数在URL中)
        // 当前项目get_shares的page和status是通过url query传递的，所以这里不需要特殊处理GET的body

        try {
            const response = await fetch(`${adminApiBase}${endpoint}`, options);
            if (!response.ok) {
                // 尝试从响应体中解析JSON格式的错误信息
                const errorData = await response.json().catch(() => ({ message: response.statusText }));
                throw new Error(`API请求失败 (${response.status}): ${errorData.message}`);
            }
            return await response.json(); // 解析成功的JSON响应
        } catch (error) {
            console.error(`请求 ${adminApiBase}${endpoint} 失败:`, error);
            // 使用 uiUtils.js 中的 alert (如果已集成) 或标准 alert
            window.alert(`操作失败: ${error.message}`); // window.alert 是标准Js alert
            throw error; // 重新抛出错误，以便调用者可以进一步处理
        }
    }

    /**
     * 为指定的标签页状态加载分享数据。
     * @param {string} status 标签页的状态 ('approved', 'pending', 'private')。
     * @param {number} page 要加载的页码。
     * @param {boolean} append 是否将数据追加到现有列表 (用于滚动加载，默认为 false，即替换)。
     */
    async function loadSharesForTab(status, page, append = false) {
        const tab = tabsConfig[status]; // 获取对应标签页的配置对象
        // 如果正在加载数据，或者是要追加数据但已到达末尾，则直接返回
        if (tab.isLoading || (append && tab.isEnd)) {
            return;
        }
        tab.isLoading = true; // 标记为正在加载

        // 如果是加载第一页且非追加模式，则在表格中显示加载提示，并重置数据和结束标记
        if (page === 1 && !append) {
            tab.body.innerHTML = `<tr><td colspan="6" class="text-center text-muted">正在加载...</td></tr>`;
            tab.data = [];
            tab.isEnd = false;
        } else if (append) {
            // 如果是追加模式，在表格末尾添加 "正在加载更多..." 的指示行
            const loadingRow = tab.body.insertRow(-1);
            loadingRow.classList.add('loading-indicator-row');
            loadingRow.innerHTML = `<td colspan="6" class="text-center text-muted">正在加载更多...</td>`;
        }

        try {
            // API端点包含status和page作为查询参数
            const data = await fetchAdminApi(`/get_shares?status=${status}&page=${page}`, 'GET');

            // 移除可能存在的 "正在加载更多..." 指示行
            const existingLoadingIndicator = tab.body.querySelector('.loading-indicator-row');
            if (existingLoadingIndicator) existingLoadingIndicator.remove();
            
            if (data.success) {
                // 如果是第一页且非追加，成功获取数据后清空 "正在加载..."
                if (page === 1 && !append) tab.body.innerHTML = ''; 

                if (data.shares && data.shares.length > 0) {
                    // 更新数据数组和当前页码
                    tab.data = append ? tab.data.concat(data.shares) : data.shares;
                    populateTable(tab.body, data.shares, append); // 填充表格
                    tab.currentPage = page;
                } else if (page === 1 && !append) {
                    // 如果第一页就没有数据，显示 "暂无记录"
                    tab.body.innerHTML = `<tr><td colspan="6" class="text-center text-muted">暂无记录</td></tr>`;
                }
                tab.isEnd = data.end; // 更新是否到达末尾的标记
                tab.countSpan.textContent = tab.data.length; // 更新总数显示为当前已加载的项数
                
            } else {
                // API返回success:false的情况
                if (page === 1 && !append) tab.body.innerHTML = `<tr><td colspan="6" class="text-center text-danger">加载失败: ${escapeHtml(data.message)}</td></tr>`;
                else if (append) tab.body.insertAdjacentHTML('beforeend', `<tr><td colspan="6" class="text-center text-danger">加载更多失败</td></tr>`);
                tab.isEnd = true; // 发生错误时，标记为结束，防止无限滚动
            }
        } catch (error) {
            // fetchAdminApi内部已处理alert，这里主要处理表格UI
            if (page === 1 && !append) tab.body.innerHTML = `<tr><td colspan="6" class="text-center text-danger">加载时出现错误</td></tr>`;
            else if (append && tab.body.lastChild && tab.body.lastChild.classList.contains('loading-indicator-row')) {
                 // 如果追加时出错，可以移除加载行并提示
                tab.body.lastChild.innerHTML = `<td colspan="6" class="text-center text-danger">加载更多错误</td>`;
            }
            tab.isEnd = true; // 网络或其他错误时，也标记结束
        } finally {
            tab.isLoading = false; // 重置加载状态
        }
    }

    /**
     * 用分享数据填充表格。
     * @param {HTMLTableSectionElement} tbody 表格的tbody元素。
     * @param {Array<object>} sharesPage 当前页的分享数据数组。
     * @param {boolean} append 是否为追加模式。
     */
    function populateTable(tbody, sharesPage, append = false) {
        if (!append) { 
            tbody.innerHTML = ''; // 如果不是追加，则先清空tbody
        }

        // 如果是追加模式但sharesPage为空，则什么都不做
        if (append && sharesPage.length === 0) return;

        // 如果tbody为空（即之前没有数据，也不是追加模式），且当前页数据也为空，那么显示“暂无记录”
        if (tbody.children.length === 0 && sharesPage.length === 0 && !append) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">暂无记录</td></tr>`;
            return;
        }

        sharesPage.forEach(share => {
            const row = tbody.insertRow(); // 在末尾插入新行
            row.dataset.codeHash = share.codeHash; // 将codeHash存储在行数据中，方便操作

            let statusBadge = ''; // 根据visibleFlag生成状态徽章
            if (share.visibleFlag === true) {
                statusBadge = '<span class="badge bg-success status-badge">已审核</span>';
            } else if (share.visibleFlag === null) { // null 代表待审核
                statusBadge = '<span class="badge bg-warning text-dark status-badge">待审核</span>';
            } else if (share.visibleFlag === false) {
                statusBadge = '<span class="badge bg-secondary status-badge">私密</span>';
            }

            // 填充行内容，使用escapeHtml确保安全
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
                    ${generateActionButtons(share.codeHash, share.visibleFlag, share.rootFolderName)}
                </td>
            `;
        });
    }
    
    /**
     * 根据分享的状态和当前名称生成操作按钮的HTML字符串。
     * @param {string} codeHash 分享的短码。
     * @param {boolean|null} visibleFlag 分享的可见性状态。
     * @param {string} currentName 当前的分享名称。
     * @returns {string} 操作按钮的HTML。
     */
    function generateActionButtons(codeHash, visibleFlag, currentName) {
        let buttons = `<button class="btn btn-outline-info btn-sm edit-name-btn" data-currentname="${escapeHtml(currentName)}">编辑名称</button>`;
        if (visibleFlag === null) { // 状态：待审核
            buttons += `<button class="btn btn-success btn-sm update-status-btn" data-newstatus="approved">审核通过</button>`;
            buttons += `<button class="btn btn-secondary btn-sm update-status-btn" data-newstatus="private">转私密</button>`;
        } else if (visibleFlag === true) { // 状态：已审核 (公开)
            buttons += `<button class="btn btn-warning btn-sm update-status-btn" data-newstatus="pending">设为待审</button>`;
            buttons += `<button class="btn btn-secondary btn-sm update-status-btn" data-newstatus="private">转私密</button>`;
        } else if (visibleFlag === false) { // 状态：私密
            buttons += `<button class="btn btn-info btn-sm update-status-btn" data-newstatus="pending">设为待审</button>`;
            // 通常私密状态不能直接通过审核到公开，需要先到待审
        }
        buttons += `<button class="btn btn-danger btn-sm delete-share-btn">删除</button>`;
        return buttons;
    }

    // 使用事件委托处理表格内按钮的点击事件
    document.body.addEventListener('click', async function(event) {
        const target = event.target; // 获取被点击的元素
        
        // 处理 "查看完整长分享码" 的点击
        if (target.classList.contains('view-full-code')) {
            const codeHash = target.dataset.codehash;
            const shareCode = target.dataset.sharecode;
            modalCodeHashSpan.textContent = codeHash; // 更新模态框中的短码显示
            modalShareCodeTextarea.value = shareCode; // 更新模态框中的长码文本域
            viewShareCodeModal.show(); // 显示模态框
            return; 
        }

        const row = target.closest('tr'); // 找到被点击按钮所在的行
        if (!row) return; // 如果点击的不是行内元素，则忽略

        const codeHashFromRow = row.dataset.codeHash; // 从行数据中获取codeHash

        if (target.classList.contains('edit-name-btn')) {
            // 处理 "编辑名称" 按钮点击
            const nameCell = row.querySelector('.root-folder-name-cell');
            const currentName = target.dataset.currentname;
            // 将名称单元格替换为带输入框和确认/取消按钮的表单
            nameCell.innerHTML = `
                <div class="input-group input-group-sm edit-input-group">
                    <input type="text" class="form-control form-control-sm" value="${escapeHtml(currentName)}">
                    <button class="btn btn-success btn-sm save-name-btn">确认</button>
                    <button class="btn btn-secondary btn-sm cancel-edit-btn" data-original="${escapeHtml(currentName)}">取消</button>
                </div>`;
            target.style.display = 'none'; // 隐藏原 "编辑名称" 按钮
        } else if (target.classList.contains('save-name-btn')) {
            // 处理 "确认" (保存名称) 按钮点击
            const inputField = row.querySelector('.root-folder-name-cell input[type="text"]');
            const newName = inputField.value;
            await updateShareName(codeHashFromRow, newName, row); // 调用API更新名称
        } else if (target.classList.contains('cancel-edit-btn')) {
            // 处理 "取消" (编辑名称) 按钮点击
            const nameCell = row.querySelector('.root-folder-name-cell');
            const originalName = target.dataset.original;
            nameCell.textContent = originalName; // 恢复原始名称显示
            const editButton = row.querySelector('.edit-name-btn'); // 找到隐藏的 "编辑名称" 按钮
             // 注意：此时editButton可能不存在，因为 innerHTML 被重写，原来的edit-name-btn在DOM树中可能已被移除。
             // 正确的做法是重新生成或找到新生成的编辑按钮并显示。
             // 简单处理：直接刷新当前tab的数据
             const currentTabConfig = tabsConfig[activeStatus];
             loadSharesForTab(activeStatus, currentTabConfig.currentPage, false); // 重新加载当前页
        } else if (target.classList.contains('update-status-btn')) {
            // 处理 "更新状态" 相关按钮点击
            const newStatus = target.dataset.newstatus;
            await updateShareStatus(codeHashFromRow, newStatus); // 调用API更新状态
        } else if (target.classList.contains('delete-share-btn')) {
            // 处理 "删除" 按钮点击
            await deleteShareConfirmation(codeHashFromRow); // 调用API删除分享
        }
    });
        
    /**
     * 调用API更新分享名称。
     * @param {string} codeHash 要更新的分享短码。
     * @param {string} newName 新的分享名称。
     * @param {HTMLTableRowElement} rowElement 被操作的表格行元素 (用于UI局部更新，当前版本改为刷新Tab)。
     */
    async function updateShareName(codeHash, newName, rowElement) {
        if (!newName.trim()) {
            alert("分享名称不能为空。");
            return;
        }
        // 弹出确认框
        if (!confirm(`确定要将短码 ${escapeHtml(codeHash.substring(0,8))}... 的名称修改为 "${escapeHtml(newName)}" 吗？`)) {
            return;
        }
        try {
            const data = await fetchAdminApi('/update_share_name', 'POST', { codeHash, newName });
            if (data.success) {
                alert(data.message);
                // 刷新当前激活的标签页的第一页数据
                tabsConfig[activeStatus].currentPage = 1;
                tabsConfig[activeStatus].isEnd = false;
                tabsConfig[activeStatus].data = [];
                loadSharesForTab(activeStatus, 1, false);
            } else {
                alert(`修改名称失败: ${data.message}`);
            }
        } catch (error) { /* 错误已在 fetchAdminApi 中通过 alert 处理 */ }
    }

    /**
     * 调用API更新分享状态。
     * @param {string} codeHash 要更新的分享短码。
     * @param {string} newStatus 新的状态字符串 ('approved', 'pending', 'private')。
     */
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
        } catch (error) { /* 错误已在 fetchAdminApi 中通过 alert 处理 */ }
    }

    /**
     * 调用API删除分享记录，并带有确认步骤。
     * @param {string} codeHash 要删除的分享短码。
     */
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
        } catch (error) { /* 错误已在 fetchAdminApi 中通过 alert 处理 */ }
    }

    // "复制到剪贴板" 按钮的事件监听 (模态框内)
    copyModalShareCodeBtn.addEventListener('click', function() {
        copyToClipboard(modalShareCodeTextarea, copyModalShareCodeBtn, '已复制!', originalCopyModalBtnHtml);
    });

    // --- Tab 切换和滚动加载逻辑 ---
    document.querySelectorAll('#adminTabs .nav-link').forEach(tabLink => {
        tabLink.addEventListener('shown.bs.tab', function (event) {
            activeStatus = event.target.id.split('-')[0]; 
            const tabConfig = tabsConfig[activeStatus];
            // 切换标签页时，如果数据为空或未到末尾，则从第一页开始加载
            if (tabConfig.data.length === 0 || !tabConfig.isEnd) {
                tabConfig.currentPage = 1;
                tabConfig.isEnd = false;
                tabConfig.data = [];
                loadSharesForTab(activeStatus, 1, false);
            } else {
                // 如果数据已完全加载，只需要确保显示正确数量
                tabConfig.countSpan.textContent = tabConfig.data.length;
                // (由于Bootstrap的tab切换会显示/隐藏内容，通常不需要手动重渲染表格，除非有特殊需求)
            }
        });
    });

    // 为每个标签页内的 .table-responsive 容器添加滚动事件监听器
    document.querySelectorAll('.tab-pane .table-responsive').forEach(scrollableDiv => {
        scrollableDiv.addEventListener('scroll', function() {
            // 确定当前滚动的是哪个标签页的容器
            const paneId = scrollableDiv.closest('.tab-pane').id;
            const statusOfPane = paneId.split('-')[0]; // e.g., "approved-content" -> "approved"

            // 仅当滚动的是当前激活的标签页时才处理
            if (statusOfPane !== activeStatus) {
                return;
            }

            const tabConfig = tabsConfig[activeStatus];
            // 如果正在加载或已到达末尾，则不执行
            if (tabConfig.isLoading || tabConfig.isEnd) {
                return;
            }

            const { scrollTop, scrollHeight, clientHeight } = scrollableDiv;
            // 当滚动条接近底部 (例如，距离底部小于等于200px) 时，加载下一页
            if (scrollHeight - scrollTop - clientHeight <= 200) { 
                loadSharesForTab(activeStatus, tabConfig.currentPage + 1, true); // true表示追加数据
            }
        });
    });

    // 初始加载默认激活的标签页 (approved) 的第一页数据
    loadSharesForTab(activeStatus, 1, false); 
});