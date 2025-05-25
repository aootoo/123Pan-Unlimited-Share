// static/js/adminDashboardPage.js

// escapeHtml 函数现在从 uiUtils.js 引入（如果已在HTML中先加载 uiUtils.js）
// 如果没有，则需要在此处定义或确保 uiUtils.js 先于此脚本加载。
// 为简单起见，假设 uiUtils.js 中的 escapeHtml 已可用或稍后在HTML中正确排序。
// const escapeHtml = window.escapeHtml; // 假设它被挂载到window或通过模块导入

document.addEventListener('DOMContentLoaded', function () {
    const adminApiBase = window.APP_CONFIG.adminApiBaseUrl; // 从HTML中获取

    const approvedTableBody = document.getElementById('approved-table-body');
    const pendingTableBody = document.getElementById('pending-table-body');
    const privateTableBody = document.getElementById('private-table-body');
    const approvedCountSpan = document.getElementById('approved-count');
    const pendingCountSpan = document.getElementById('pending-count');
    const privateCountSpan = document.getElementById('private-count');
    
    const viewShareCodeModal = new bootstrap.Modal(document.getElementById('viewShareCodeModal'));
    const modalCodeHashSpan = document.getElementById('modalCodeHash');
    const modalShareCodeTextarea = document.getElementById('modalShareCodeContent');
    const copyModalShareCodeBtn = document.getElementById('copyModalShareCode');
    const originalCopyModalBtnHtml = copyModalShareCodeBtn.innerHTML;

    async function fetchAdminApi(endpoint, method = 'GET', body = null) {
        const options = {
            method: method,
            headers: { 'Content-Type': 'application/json' },
        };
        if (body) {
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
            console.error(`请求 ${endpoint} 失败:`, error);
            alert(`操作失败: ${error.message}`);
            throw error; // 重新抛出以便调用者处理
        }
    }

    async function loadAllShares() {
        try {
            const data = await fetchAdminApi('/get_shares');
            if (data.success) {
                populateTable(approvedTableBody, data.approved, approvedCountSpan);
                populateTable(pendingTableBody, data.pending, pendingCountSpan);
                populateTable(privateTableBody, data.private, privateCountSpan);
            } else {
                alert(`加载分享数据失败: ${data.message}`);
            }
        } catch (error) {
            //错误已在 fetchAdminApi 中处理
        }
    }

    function populateTable(tbody, shares, countSpan) {
        tbody.innerHTML = ''; 
        countSpan.textContent = shares.length;
        if (shares.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">暂无记录</td></tr>`;
            return;
        }
        shares.forEach(share => {
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
                <td>${new Date(share.timeStamp).toLocaleString()}</td>
                <td>${statusBadge}</td>
                <td class="action-buttons">
                    ${generateActionButtons(share.codeHash, share.visibleFlag, share.rootFolderName)}
                </td>
            `;
        });
    }
    
    function generateActionButtons(codeHash, visibleFlag, currentName) {
        let buttons = `<button class="btn btn-outline-info btn-sm edit-name-btn" data-currentname="${escapeHtml(currentName)}">编辑名称</button>`;
        if (visibleFlag === null) { // 待审核
            buttons += `<button class="btn btn-success btn-sm update-status-btn" data-newstatus="approved">审核通过</button>`;
            buttons += `<button class="btn btn-secondary btn-sm update-status-btn" data-newstatus="private">转私密</button>`;
        } else if (visibleFlag === true) { // 已审核
            buttons += `<button class="btn btn-warning btn-sm update-status-btn" data-newstatus="pending">设为待审</button>`;
            buttons += `<button class="btn btn-secondary btn-sm update-status-btn" data-newstatus="private">转私密</button>`;
        } else if (visibleFlag === false) { // 私密
            buttons += `<button class="btn btn-info btn-sm update-status-btn" data-newstatus="pending">设为待审</button>`;
        }
        buttons += `<button class="btn btn-danger btn-sm delete-share-btn">删除</button>`;
        return buttons;
    }

    document.body.addEventListener('click', async function(event) {
        const target = event.target;
        const row = target.closest('tr');
        if (!row && !target.classList.contains('view-full-code')) return; // 确保 view-full-code 也能触发

        // 查看完整长分享码 (事件委托)
        if (target.classList.contains('view-full-code')) {
            const codeHash = target.dataset.codehash;
            const shareCode = target.dataset.sharecode;
            modalCodeHashSpan.textContent = codeHash;
            modalShareCodeTextarea.value = shareCode;
            viewShareCodeModal.show();
            return; // 处理完模态框事件后返回
        }

        if (!row) return; // 后面的操作都需要row
        const codeHash = row.dataset.codeHash;

        if (target.classList.contains('edit-name-btn')) {
            const nameCell = row.querySelector('.root-folder-name-cell');
            const currentName = target.dataset.currentname;
            nameCell.innerHTML = `
                <div class="input-group input-group-sm edit-input-group">
                    <input type="text" class="form-control form-control-sm" value="${escapeHtml(currentName)}">
                    <button class="btn btn-success btn-sm save-name-btn">确认</button>
                    <button class="btn btn-secondary btn-sm cancel-edit-btn" data-original="${escapeHtml(currentName)}">取消</button>
                </div>`;
            target.style.display = 'none';
        } else if (target.classList.contains('save-name-btn')) {
            const inputField = row.querySelector('.root-folder-name-cell input[type="text"]');
            const newName = inputField.value;
            await updateShareName(codeHash, newName, row);
        } else if (target.classList.contains('cancel-edit-btn')) {
            const nameCell = row.querySelector('.root-folder-name-cell');
            const originalName = target.dataset.original;
            nameCell.textContent = originalName;
            const editButton = row.querySelector('.edit-name-btn');
            if(editButton) editButton.style.display = 'inline-block';
        } else if (target.classList.contains('update-status-btn')) {
            const newStatus = target.dataset.newstatus;
            await updateShareStatus(codeHash, newStatus);
        } else if (target.classList.contains('delete-share-btn')) {
            await deleteShareConfirmation(codeHash);
        }
    });
        
    async function updateShareName(codeHash, newName, rowElement) {
        if (!newName.trim()) {
            alert("分享名称不能为空。");
            return;
        }
        if (!confirm(`确定要将短码 ${escapeHtml(codeHash)} 的名称修改为 "${escapeHtml(newName)}" 吗？`)) {
            return;
        }
        try {
            const data = await fetchAdminApi('/update_share_name', 'POST', { codeHash, newName });
            if (data.success) {
                alert(data.message);
                // 更新UI（或直接调用 loadAllShares() 重新加载）
                const nameCell = rowElement.querySelector('.root-folder-name-cell');
                nameCell.textContent = escapeHtml(data.cleanedName); 
                const editButton = rowElement.querySelector('.edit-name-btn');
                if(editButton) {
                    editButton.dataset.currentname = data.cleanedName;
                    editButton.style.display = 'inline-block'; 
                }
                await loadAllShares(); // 确保数据完全同步
            } else {
                alert(`修改名称失败: ${data.message}`);
            }
        } catch (error) { /* 错误已在fetchAdminApi处理 */ }
    }

    async function updateShareStatus(codeHash, newStatus) {
        let statusTextMap = { approved: "审核通过", pending: "设为待审核", private: "转为私密" };
        if (!confirm(`确定要将短码 ${escapeHtml(codeHash)} 的状态改为 "${statusTextMap[newStatus]}" 吗？`)) {
            return;
        }
        try {
            const data = await fetchAdminApi('/update_share_status', 'POST', { codeHash, newStatus });
            if (data.success) {
                alert(data.message);
                loadAllShares(); 
            } else {
                alert(`更新状态失败: ${data.message}`);
            }
        } catch (error) { /* 错误已在fetchAdminApi处理 */ }
    }

    async function deleteShareConfirmation(codeHash) {
        if (!confirm(`确定要永久删除短码为 ${escapeHtml(codeHash)} 的分享记录吗？此操作不可恢复！`)) {
            return;
        }
        try {
            const data = await fetchAdminApi('/delete_share', 'POST', { codeHash });
            if (data.success) {
                alert(data.message);
                loadAllShares(); 
            } else {
                alert(`删除失败: ${data.message}`);
            }
        } catch (error) { /* 错误已在fetchAdminApi处理 */ }
    }

    copyModalShareCodeBtn.addEventListener('click', function() {
        copyToClipboard(modalShareCodeTextarea, copyModalShareCodeBtn, '已复制!', originalCopyModalBtnHtml);
    });

    loadAllShares(); // 初始加载数据
});