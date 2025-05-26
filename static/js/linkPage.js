// static/js/linkPage.js

document.addEventListener('DOMContentLoaded', async function () {
    // 客户端侧检查IP是否为中国大陆地区
    await checkRegionAndRedirect(); 

    const linkForm = document.getElementById('linkForm');
    const resultArea = document.getElementById('resultArea');
    const statusMessageEl = document.getElementById('statusMessage');
    const logOutputEl = document.getElementById('logOutput');
    
    const longShareCodeAreaEl = document.getElementById('longShareCodeArea');
    const shareCodeOutputEl = document.getElementById('shareCodeOutput');
    const shortShareCodeAreaEl = document.getElementById('shortShareCodeArea');
    const shortShareCodeOutputEl = document.getElementById('shortShareCodeOutput');
    
    const actionButtonsAreaEl = document.getElementById('actionButtonsArea');
    const downloadShareCodeBtn = document.getElementById('downloadShareCodeBtn');
    const copyShareCodeBtn = document.getElementById('copyShareCodeBtn'); 
    const copyShortShareCodeBtn = document.getElementById('copyShortShareCodeBtn');
    
    const shareKeyInput = document.getElementById('shareKey'); 
    const userSpecifiedBaseNameInput = document.getElementById('userSpecifiedBaseName');
    const generateShortCodeCheckbox = document.getElementById('generateShortCode');
    const shareProjectCheckbox = document.getElementById('shareProject');
    
    const API_LINK_URL = window.APP_CONFIG.apiLinkUrl || '/api/link';

    let currentLongShareData = null; 
    let currentFilename = "shared_link_data.123share";
    
    const originalCopyShortBtnHtml = copyShortShareCodeBtn.innerHTML;
    const originalCopyLongBtnHtml = copyShareCodeBtn.innerHTML;

    const uiElements = {
        statusMessageElement: statusMessageEl,
        logOutputElement: logOutputEl,
        longShareCodeAreaElement: longShareCodeAreaEl,
        shareCodeOutputElement: shareCodeOutputEl,
        shortShareCodeAreaElement: shortShareCodeAreaEl,
        shortShareCodeOutputElement: shortShareCodeOutputEl,
        actionButtonsAreaElement: actionButtonsAreaEl,
        copyShareCodeBtnElement: copyShareCodeBtn,
        downloadShareCodeBtnElement: downloadShareCodeBtn,
        copyShortShareCodeBtnElement: copyShortShareCodeBtn
    };

    if (shareKeyInput) {
        shareKeyInput.addEventListener('input', function(event) {
            const currentVal = event.target.value; 
            let processedVal = currentVal; 
            if (processedVal.includes("/s/")) {
                const parts = processedVal.split("/s/");
                processedVal = parts[parts.length - 1]; 
            }
            if (processedVal) { 
                processedVal = processedVal.split("?")[0];
            }
            if (processedVal) {
                processedVal = processedVal.replace(/^\/+|\/+$/g, '');
            }
            if (currentVal !== processedVal && processedVal !== null) {
                const cursorPos = event.target.selectionStart; 
                const diff = currentVal.length - processedVal.length; 
                event.target.value = processedVal; 
                let newCursorPos = cursorPos - diff;
                if (newCursorPos < 0) newCursorPos = 0;
                if (newCursorPos > processedVal.length) newCursorPos = processedVal.length;
                event.target.setSelectionRange(newCursorPos, newCursorPos); 
            }
        });
    }
            
    shareProjectCheckbox.addEventListener('change', function() {
        if (this.checked) {
            generateShortCodeCheckbox.checked = true;
            generateShortCodeCheckbox.disabled = true;
            userSpecifiedBaseNameInput.required = true;
        } else {
            generateShortCodeCheckbox.disabled = false;
            userSpecifiedBaseNameInput.required = false;
        }
    });

    linkForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        resultArea.style.display = 'block';
        resetResultDisplay(uiElements);
        currentLongShareData = null;

        const shareKey = shareKeyInput.value;
        const sharePwd = document.getElementById('sharePwd').value;
        const parentFileId = document.getElementById('parentFileId').value;
        const userSpecifiedBaseNameValue = userSpecifiedBaseNameInput.value.trim();
        const generateShortCode = generateShortCodeCheckbox.checked;
        const shareProject = shareProjectCheckbox.checked;

        if (shareProject && !userSpecifiedBaseNameValue) {
            updateStatusMessage(statusMessageEl, '错误: 加入资源共享计划时，必须填写根目录名 (分享名)。', 'danger');
            userSpecifiedBaseNameInput.focus();
            return;
        }

        const payload = {
            shareKey: shareKey,
            sharePwd: sharePwd,
            parentFileId: parentFileId,
            userSpecifiedBaseName: userSpecifiedBaseNameValue,
            generateShortCode: generateShortCode,
            shareProject: shareProject
        };

        const timestamp = Math.floor(Date.now() / 1000);
        if (userSpecifiedBaseNameValue) {
            currentFilename = `${userSpecifiedBaseNameValue}.123share`;
        } else {
            const safeShareKeyPart = shareKey.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 20);
            currentFilename = `link_${timestamp}_${safeShareKeyPart}.123share`;
        }
        currentFilename = currentFilename.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');

        handleApiStreamRequest({
            endpoint: API_LINK_URL,
            payload: payload,
            statusElement: statusMessageEl,
            logElement: logOutputEl,
            callbacks: {
                onSuccess: function(data) {
                    currentLongShareData = displayShareCodesAndActions(data, uiElements);
                },
                onFailure: function(message) { /* Stream handler updates UI */ },
                onRequestError: function(error) { /* Stream handler updates UI */ }
            }
        });
    });

    downloadShareCodeBtn.addEventListener('click', function() {
        downloadFile(currentLongShareData, currentFilename);
    });

    copyShareCodeBtn.addEventListener('click', function() {
        copyToClipboard(shareCodeOutputEl, copyShareCodeBtn, '已复制!', originalCopyLongBtnHtml);
    });
            
    copyShortShareCodeBtn.addEventListener('click', function() {
        copyToClipboard(shortShareCodeOutputEl, copyShortShareCodeBtn, '已复制!', originalCopyShortBtnHtml);
    });
});