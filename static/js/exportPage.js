// static/js/exportPage.js

document.addEventListener('DOMContentLoaded', async function () {
    // 客户端侧检查IP是否为中国大陆地区
    await checkRegionAndRedirect(); 

    const exportForm = document.getElementById('exportForm');
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

    const userSpecifiedBaseNameInput = document.getElementById('userSpecifiedBaseName');
    const generateShortCodeCheckbox = document.getElementById('generateShortCode');
    const shareProjectCheckbox = document.getElementById('shareProject');

    // 从全局配置或 data-* 属性获取 API URL
    const API_EXPORT_URL = window.APP_CONFIG.apiExportUrl || '/api/export'; 

    let currentLongShareData = null;
    let currentFilename = "exported_data.123share";
    
    // 存储按钮的原始 HTML 内容，用于恢复
    const originalCopyShortBtnHtml = copyShortShareCodeBtn.innerHTML;
    const originalCopyLongBtnHtml = copyShareCodeBtn.innerHTML;
    const originalDownloadBtnHtml = downloadShareCodeBtn.innerHTML;

    // UI元素集合，方便传递给通用函数
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

    // 从 Cookie 加载凭据
    const savedUsername = getCookie('username');
    const savedPassword = getCookie('password');
    if (savedUsername) document.getElementById('username').value = savedUsername;
    if (savedPassword) document.getElementById('password').value = savedPassword;
            
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
            
    exportForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        resultArea.style.display = 'block';
        resetResultDisplay(uiElements);
        currentLongShareData = null;

        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const userSpecifiedBaseNameValue = userSpecifiedBaseNameInput.value.trim();
        const homeFilePath = document.getElementById('homeFilePath').value;
        const generateShortCode = generateShortCodeCheckbox.checked; // 获取当前复选框状态
        const shareProject = shareProjectCheckbox.checked;

        if (shareProject && !userSpecifiedBaseNameValue) {
            updateStatusMessage(statusMessageEl, '错误: 加入资源共享计划时，必须填写根目录名 (分享名)。', 'danger'); // 中文提示
            userSpecifiedBaseNameInput.focus();
            return;
        }

        setCookie('username', username, 30); 
        setCookie('password', password, 30); 

        const payload = {
            username: username,
            password: password,
            userSpecifiedBaseName: userSpecifiedBaseNameValue,
            homeFilePath: homeFilePath,
            generateShortCode: generateShortCode,
            shareProject: shareProject
        };
                
        const timestamp = Math.floor(Date.now() / 1000);
        if (userSpecifiedBaseNameValue) {
            currentFilename = `${userSpecifiedBaseNameValue}.123share`;
        } else {
            currentFilename = `export_${timestamp}.123share`;
        }
        currentFilename = currentFilename.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');

        handleApiStreamRequest({
            endpoint: API_EXPORT_URL,
            payload: payload,
            statusElement: statusMessageEl,
            logElement: logOutputEl,
            callbacks: {
                onSuccess: function(data) { // data 是从API返回的JSON对象
                    // 调用 displayShareCodesAndActions 并传递 generateShortCode 的状态
                    currentLongShareData = displayShareCodesAndActions(data, uiElements, generateShortCode);
                },
                onFailure: function(message) {
                    // 状态已由 streamApiHandler 更新
                },
                onRequestError: function(error) {
                     // 状态已由 streamApiHandler 更新
                }
            }
        });
    });

    downloadShareCodeBtn.addEventListener('click', function() {
        // 调用 downloadFile 时传递按钮元素和原始HTML
        downloadFile(currentLongShareData, currentFilename, downloadShareCodeBtn, originalDownloadBtnHtml);
    });

    copyShareCodeBtn.addEventListener('click', function() {
        copyToClipboard(shareCodeOutputEl, copyShareCodeBtn, '已复制!', originalCopyLongBtnHtml); // 中文提示
    });
            
    copyShortShareCodeBtn.addEventListener('click', function() {
        copyToClipboard(shortShareCodeOutputEl, copyShortShareCodeBtn, '已复制!', originalCopyShortBtnHtml); // 中文提示
    });
});