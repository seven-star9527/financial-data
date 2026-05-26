document.addEventListener('DOMContentLoaded', () => {
    const pdfDropZone = document.getElementById('pdf-drop-zone');
    const pdfInput = document.getElementById('pdf-input');
    const pdfFolderInput = document.getElementById('pdf-folder-input');
    const uploadEntranceBtn = document.getElementById('upload-entrance-btn');
    const uploadMenuPopup = document.getElementById('upload-menu-popup');
    const pdfFileCount = document.getElementById('pdf-file-count');

    const addMappingBtn = document.getElementById('add-mapping-btn');
    const mappingList = document.getElementById('mapping-list');

    const processBtn = document.getElementById('process-btn');
    const resetBtn = document.getElementById('reset-btn');
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const statusText = document.getElementById('status-text');
    const logList = document.getElementById('log-list');

    const resultContainer = document.getElementById('result-container');
    const downloadBtn = document.getElementById('download-btn');

    // Monthly rate elements
    const monthlyRateMonthSelect = document.getElementById('monthly-rate-month-select');
    const monthlyRateCurrencySelect = document.getElementById('monthly-rate-currency-select');
    const monthlyRateInput = document.getElementById('monthly-rate-input');
    const monthlyRateSaveBtn = document.getElementById('monthly-rate-save-btn');
    const rateUpdateTime = document.getElementById('rate-update-time');

    let pdfFiles = [];
    let allMonthlyData = {}; // full data from /api/rates/monthly
    let estimateInterval = null; // 全局预计时间倒计时定时器
    let currentHistoryRecord = null; // 当前正在查看的历史任务记录

    // ─── Company Mapping Logic (Server-side persistence) ─────────────────────
    function createMappingRow(keyword = '', company = '') {
        const row = document.createElement('div');
        row.className = 'mapping-row';
        row.innerHTML = `
            <input type="text" placeholder="文件名关键字 (如: 惜抱轩)" class="mapping-keyword" value="${escapeHtml(keyword)}">
            <input type="text" placeholder="公司主体名称" class="mapping-company" value="${escapeHtml(company)}">
            <button class="remove-btn">&times;</button>
        `;

        row.querySelector('.remove-btn').addEventListener('click', () => {
            row.remove();
            saveMappings();
        });

        row.querySelectorAll('input').forEach(input => {
            input.addEventListener('change', saveMappings);
        });

        mappingList.appendChild(row);
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    async function saveMappings() {
        const mappings = {};
        document.querySelectorAll('.mapping-row').forEach(row => {
            const kw = row.querySelector('.mapping-keyword').value.trim();
            const co = row.querySelector('.mapping-company').value.trim();
            if (kw) mappings[kw] = co;
        });

        try {
            await fetch('/api/mappings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mappings })
            });
        } catch (e) {
            console.error('Failed to save mappings to server:', e);
        }
    }

    // 公司主体配置区域展开与收起交互绑定
    const configSectionHeader = document.getElementById('config-section-header');
    const configSectionContent = document.getElementById('config-section-content');
    const configToggleArrow = document.getElementById('config-toggle-arrow');

    if (configSectionHeader && configSectionContent && configToggleArrow) {
        configSectionHeader.addEventListener('click', (e) => {
            if (e.target.closest('#add-mapping-btn')) {
                return;
            }
            const isCollapsed = configSectionContent.classList.toggle('hidden');
            if (isCollapsed) {
                configToggleArrow.style.transform = 'rotate(-90deg)';
            } else {
                configToggleArrow.style.transform = 'rotate(0deg)';
            }
        });
    }

    async function loadMappings() {
        try {
            const res = await fetch('/api/mappings');
            const result = await res.json();
            if (result.success && result.data && Object.keys(result.data).length > 0) {
                Object.entries(result.data).forEach(([kw, co]) => {
                    createMappingRow(kw, co);
                });
                return;
            }
        } catch (e) {
            console.error('Failed to load mappings from server, trying localStorage fallback:', e);
        }

        // Fallback: load from localStorage (migration)
        const saved = localStorage.getItem('amazon_company_mappings');
        if (saved) {
            try {
                const mappings = JSON.parse(saved);
                Object.entries(mappings).forEach(([kw, co]) => {
                    createMappingRow(kw, co);
                });
                saveMappings();
                localStorage.removeItem('amazon_company_mappings');
            } catch (e) { }
        }

        if (mappingList.children.length === 0) {
            createMappingRow('惜抱轩', '南昌惜抱轩科技有限公司');
        }
    }

    addMappingBtn.addEventListener('click', () => createMappingRow());

    // ─── Monthly Rate Logic (Multiple modes & Charting) ──────────────────────
    let rateChartInstance = null;

    async function loadMonthlyRateViewer() {
        try {
            console.log('Fetching monthly rates data...');
            const res = await fetch('/api/rates/monthly');
            const result = await res.json();

            if (!result.success) {
                console.error('Failed to load monthly data:', result.error);
                rateUpdateTime.textContent = '加载失败';
                return;
            }

            const { currencies, months, data } = result;
            allMonthlyData = data || {};
            console.log(`Loaded ${currencies?.length} currencies and ${months?.length} months.`);

            // Populate month select
            if (monthlyRateMonthSelect) {
                const curVal = monthlyRateMonthSelect.value;
                monthlyRateMonthSelect.innerHTML = '<option value="">选择月份...</option>';
                const sortedMonths = (months || []).sort((a, b) => b.localeCompare(a)); // newest first
                sortedMonths.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m;
                    opt.textContent = m;
                    monthlyRateMonthSelect.appendChild(opt);
                });
                if (curVal && sortedMonths.includes(curVal)) monthlyRateMonthSelect.value = curVal;
            }

            // Populate currency select
            if (monthlyRateCurrencySelect) {
                const curVal = monthlyRateCurrencySelect.value;
                monthlyRateCurrencySelect.innerHTML = '<option value="">选择货币...</option>';
                const sortedCurrencies = (currencies || []).sort((a, b) => a.localeCompare(b, 'zh'));
                sortedCurrencies.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c;
                    opt.textContent = c;
                    monthlyRateCurrencySelect.appendChild(opt);
                });
                if (curVal) monthlyRateCurrencySelect.value = curVal;
            }

            // Show latest update time
            const latestRes = await fetch('/api/rates').then(r => r.json()).catch(() => ({}));
            if (latestRes.success && latestRes.data?.updateTime) {
                const d = new Date(latestRes.data.updateTime);
                rateUpdateTime.textContent = `最新: ${d.toLocaleDateString('zh-CN')}`;
            } else {
                rateUpdateTime.textContent = '已就绪';
            }
        } catch (e) {
            console.error('Failed to load monthly rates:', e);
            rateUpdateTime.textContent = '网络错误';
        }
    }

    // Main query dispatcher
    async function queryMonthlyRate() {
        const month = monthlyRateMonthSelect?.value || '';
        const currency = monthlyRateCurrencySelect?.value || '';
        const resultContainer = document.getElementById('monthly-result-container');
        const chartCanvas = document.getElementById('monthly-rate-chart');
        const tableContainer = document.getElementById('monthly-rate-table-container');

        if (!month && !currency) {
            resultContainer.classList.add('hidden');
            monthlyRateInput.value = '';
            monthlyRateInput.disabled = true;
            monthlyRateSaveBtn.disabled = true;
            return;
        }

        resultContainer.classList.remove('hidden');

        if (month && currency) {
            // Mode 1: Single point lookup & edit
            tableContainer.classList.add('hidden');
            chartCanvas.style.display = 'none';
            document.getElementById('monthly-result-title').textContent = `${month} ${currency} 汇率详情`;

            let rawValue = null;
            if (allMonthlyData[currency] && allMonthlyData[currency][month] !== undefined) {
                rawValue = allMonthlyData[currency][month];
            }
            if (rawValue !== null) {
                monthlyRateInput.value = (rawValue / 100).toFixed(4);
                monthlyRateInput.disabled = false;
                monthlyRateSaveBtn.disabled = false;
            } else {
                monthlyRateInput.value = '无数据';
                monthlyRateInput.disabled = true;
                monthlyRateSaveBtn.disabled = true;
            }
        } else if (currency) {
            // Mode 2: Currency trend (All months for one currency) -> Chart
            monthlyRateInput.value = '请选择月份';
            monthlyRateInput.disabled = true;
            monthlyRateSaveBtn.disabled = true;
            tableContainer.classList.add('hidden');
            chartCanvas.style.display = 'block';
            document.getElementById('monthly-result-title').textContent = `${currency} 历史趋势`;
            renderRateChart(currency);
        } else if (month) {
            // Mode 3: Month overview (All currencies for one month) -> Table
            monthlyRateInput.value = '请选择货币';
            monthlyRateInput.disabled = true;
            monthlyRateSaveBtn.disabled = true;
            chartCanvas.style.display = 'none';
            tableContainer.classList.remove('hidden');
            document.getElementById('monthly-result-title').textContent = `${month} 货币概览`;
            renderMonthTable(month);
        }
    }

    function renderRateChart(currency) {
        const dataMap = allMonthlyData[currency] || {};
        const labels = Object.keys(dataMap).sort();
        const values = labels.map(m => dataMap[m] / 100);

        if (rateChartInstance) rateChartInstance.destroy();

        const ctx = document.getElementById('monthly-rate-chart').getContext('2d');
        rateChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: `${currency} 汇率 (1外币 = ? RMB)`,
                    data: values,
                    borderColor: '#4f46e5',
                    backgroundColor: 'rgba(79, 70, 229, 0.1)',
                    tension: 0.3,
                    fill: true,
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: false,
                        ticks: { callback: value => value.toFixed(4) }
                    }
                },
                plugins: {
                    legend: { display: true, position: 'top' },
                    tooltip: {
                        callbacks: {
                            label: (context) => `汇率: ${context.parsed.y.toFixed(4)}`
                        }
                    }
                }
            }
        });
    }

    function renderMonthTable(month) {
        const tbody = document.getElementById('monthly-rate-table-body');
        tbody.innerHTML = '';

        const currencies = Object.keys(allMonthlyData).sort((a, b) => a.localeCompare(b, 'zh'));
        let found = false;

        currencies.forEach(c => {
            const raw = allMonthlyData[c][month];
            if (raw !== undefined) {
                found = true;
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td style="padding: 0.75rem; border-bottom: 1px solid #f1f5f9; font-weight: 500;">${c}</td>
                    <td style="padding: 0.75rem; border-bottom: 1px solid #f1f5f9; font-family: monospace;">${raw.toFixed(2)}</td>
                    <td style="padding: 0.75rem; border-bottom: 1px solid #f1f5f9; color: var(--primary-color); font-weight: 600;">${(raw / 100).toFixed(4)}</td>
                `;
                tbody.appendChild(row);
            }
        });

        if (!found) {
            tbody.innerHTML = '<tr><td colspan="3" style="padding: 2rem; text-align: center; color: var(--text-secondary);">该月份暂无汇率记录</td></tr>';
        }
    }

    // Save edited rate back to server
    monthlyRateSaveBtn.addEventListener('click', async () => {
        const month = monthlyRateMonthSelect.value;
        const currency = monthlyRateCurrencySelect.value;
        const displayValue = parseFloat(monthlyRateInput.value);

        if (!month || !currency || isNaN(displayValue)) {
            alert('请先选择月份和货币，并输入有效数值。');
            return;
        }

        // Convert display value (1外币=?) back to raw (100外币=?)
        const rawValue = Math.round(displayValue * 100 * 100) / 100;

        monthlyRateSaveBtn.disabled = true;
        monthlyRateSaveBtn.textContent = '保存中...';

        try {
            const res = await fetch('/api/rates/monthly/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    month,
                    rates: { [currency]: rawValue }
                })
            });
            const result = await res.json();
            if (result.success) {
                // Update cache
                if (!allMonthlyData[currency]) allMonthlyData[currency] = {};
                allMonthlyData[currency][month] = rawValue;
                monthlyRateSaveBtn.textContent = '✅ 已保存';
                setTimeout(() => {
                    monthlyRateSaveBtn.textContent = '💾 保存修改';
                    monthlyRateSaveBtn.disabled = false;
                }, 1500);
            } else {
                alert('保存失败: ' + (result.error || '未知错误'));
                monthlyRateSaveBtn.textContent = '💾 保存修改';
                monthlyRateSaveBtn.disabled = false;
            }
        } catch (e) {
            alert('网络错误，请稍后再试');
            monthlyRateSaveBtn.textContent = '💾 保存修改';
            monthlyRateSaveBtn.disabled = false;
        }
    });

    // Fetch History Rates (Sync)
    const fetchHistoryBtn = document.getElementById('fetch-history-rates-btn');
    if (fetchHistoryBtn) {
        fetchHistoryBtn.addEventListener('click', async () => {
            const month = monthlyRateMonthSelect.value;
            if (!month) {
                alert('请先选择要同步的月份！');
                return;
            }

            fetchHistoryBtn.disabled = true;
            fetchHistoryBtn.textContent = '🔄 同步中...';

            try {
                const res = await fetch('/api/rates/fetch-history', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ month })
                });
                const result = await res.json();
                if (result.success) {
                    alert(`${month} 汇率抓取成功！`);
                    await loadMonthlyRateViewer(); // Refresh dropdowns and cache
                    queryMonthlyRate(); // Refresh current view
                } else {
                    alert('抓取失败: ' + result.error);
                }
            } catch (e) {
                alert('网络错误，请稍后再试');
            } finally {
                fetchHistoryBtn.disabled = false;
                fetchHistoryBtn.textContent = '🌐 同步该月';
            }
        });
    }

    // Bind events
    if (monthlyRateMonthSelect) monthlyRateMonthSelect.addEventListener('change', queryMonthlyRate);
    if (monthlyRateCurrencySelect) monthlyRateCurrencySelect.addEventListener('change', queryMonthlyRate);

    // Init
    loadMonthlyRateViewer();
    loadMappings();
    // ─── Drag and Drop Handlers & Folder Upload ─────────────────────────────

    // 阻止默认拖放事件
    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    // 增量文件追加与去重逻辑
    function addFiles(filesArray) {
        filesArray.forEach(file => {
            if (file.name.toLowerCase().endsWith('.pdf')) {
                // 按文件名和大小去重，保护已有导入成果
                const exists = pdfFiles.some(f => f.name === file.name && f.size === file.size);
                if (!exists) {
                    pdfFiles.push(file);
                }
            }
        });
        renderFileList();
        checkReady();
    }

    // 递归读取并提取文件夹/文件的所有 PDF 文件 (HTML5 webkitGetAsEntry 深度级算法)
    async function scanFiles(dataTransfer) {
        const files = [];

        const traverseEntry = (entry) => {
            return new Promise((resolve) => {
                if (entry.isFile) {
                    entry.file((file) => {
                        if (file.name.toLowerCase().endsWith('.pdf')) {
                            files.push(file);
                        }
                        resolve();
                    });
                } else if (entry.isDirectory) {
                    const dirReader = entry.createReader();
                    const readAllEntries = () => {
                        dirReader.readEntries((entries) => {
                            if (entries.length === 0) {
                                resolve();
                            } else {
                                const promises = entries.map(traverseEntry);
                                Promise.all(promises).then(readAllEntries);
                            }
                        }, () => resolve());
                    };
                    readAllEntries();
                } else {
                    resolve();
                }
            });
        };

        const promises = [];
        const items = dataTransfer.items;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry();
                if (entry) {
                    promises.push(traverseEntry(entry));
                }
            }
        }
        await Promise.all(promises);
        return files;
    }

    // 渲染待分析文件列表 DOM
    function renderFileList() {
        const listContainer = document.getElementById('file-list-container');
        const listBody = document.getElementById('imported-file-list');
        const countBadge = document.getElementById('file-list-count');

        if (pdfFiles.length === 0) {
            listContainer.classList.add('hidden');
            listBody.innerHTML = '';
            countBadge.textContent = '0';
            return;
        }

        listContainer.classList.remove('hidden');
        countBadge.textContent = pdfFiles.length;

        listBody.innerHTML = pdfFiles.map((file, index) => {
            const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
            return `
                <div class="file-item-row" data-index="${index}">
                    <div class="file-item-info">
                        <span class="file-icon">📄</span>
                        <span class="file-name-text" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
                        <span class="file-item-size">(${sizeMB} MB)</span>
                    </div>
                    <button class="file-item-remove-btn" title="剔除文件" data-index="${index}">&times;</button>
                </div>
            `;
        }).join('');

        // 绑定单文件剔除删除事件
        listBody.querySelectorAll('.file-item-remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute('data-index'));
                pdfFiles.splice(idx, 1);
                renderFileList();
                checkReady();
            });
        });
    }

    // 绑定一键清空待导入列表
    const clearAllFilesBtn = document.getElementById('clear-all-files-btn');
    if (clearAllFilesBtn) {
        clearAllFilesBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            pdfFiles = [];
            renderFileList();
            checkReady();
        });
    }

    // 拖拽区拖入监听与递归扫描
    if (pdfDropZone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            pdfDropZone.addEventListener(eventName, preventDefaults, false);
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            pdfDropZone.addEventListener(eventName, () => pdfDropZone.classList.add('dragover'), false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            pdfDropZone.addEventListener(eventName, () => pdfDropZone.classList.remove('dragover'), false);
        });

        pdfDropZone.addEventListener('drop', async (e) => {
            const items = e.dataTransfer.items;
            if (items && items.length > 0) {
                const scannedFiles = await scanFiles(e.dataTransfer);
                addFiles(scannedFiles);
            } else {
                addFiles(Array.from(e.dataTransfer.files));
            }
        });
    }

    // 绑定单一点击入口与下拉菜单控制
    if (uploadEntranceBtn && uploadMenuPopup) {
        uploadEntranceBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            uploadMenuPopup.classList.toggle('hidden');
        });

        // 外部点击关闭菜单气泡
        document.addEventListener('click', () => {
            uploadMenuPopup.classList.add('hidden');
        });

        document.getElementById('menu-select-files').addEventListener('click', (e) => {
            e.stopPropagation();
            uploadMenuPopup.classList.add('hidden');
            pdfInput.click();
        });

        document.getElementById('menu-select-folder').addEventListener('click', (e) => {
            e.stopPropagation();
            uploadMenuPopup.classList.add('hidden');
            pdfFolderInput.click();
        });
    }

    // 绑定原生隐藏 input files 的 change
    if (pdfInput) {
        pdfInput.addEventListener('change', function () {
            addFiles(Array.from(this.files));
            this.value = '';
        });
    }
    if (pdfFolderInput) {
        pdfFolderInput.addEventListener('change', function () {
            addFiles(Array.from(this.files));
            this.value = '';
        });
    }

    function checkReady() {
        processBtn.disabled = pdfFiles.length === 0;
    }

    function addLog(msg, type = '') {
        const li = document.createElement('li');
        li.textContent = msg;
        if (type) li.classList.add(type);
        logList.prepend(li);
        return li;
    }

    function resetAll() {
        pdfFiles = [];
        if (pdfInput) pdfInput.value = '';
        if (pdfFolderInput) pdfFolderInput.value = '';
        renderFileList();

        // 销毁预计时间定时器与温馨卡片
        if (estimateInterval) {
            clearInterval(estimateInterval);
            estimateInterval = null;
        }
        const estimateCard = document.getElementById('estimate-time-card');
        if (estimateCard) estimateCard.classList.add('hidden');

        logList.innerHTML = '';
        progressBar.style.width = '0%';
        progressBar.style.backgroundColor = '';
        statusText.textContent = '准备中...';
        progressContainer.classList.add('hidden');
        resultContainer.classList.add('hidden');
        processBtn.disabled = true;
        processBtn.textContent = '开始分析并生成报表';

        const mainContainer = document.querySelector('.container');
        if (mainContainer) mainContainer.classList.remove('wide-container');

        const headerTr = document.getElementById('preview-table-header');
        if (headerTr) headerTr.innerHTML = '';
        const bodyTbody = document.getElementById('preview-table-body');
        if (bodyTbody) bodyTbody.innerHTML = '';

        // 重置历史记录状态与重新分析按钮可见性
        currentHistoryRecord = null;
        const reAnalyzeContainer = document.getElementById('re-analyze-container');
        if (reAnalyzeContainer) reAnalyzeContainer.classList.add('hidden');
    }

    resetBtn.addEventListener('click', resetAll);

    // ─── Process Logic (SSE-based with Timer Countdown) ─────────────────────
    processBtn.addEventListener('click', async () => {
        processBtn.disabled = true;
        progressContainer.classList.remove('hidden');
        resultContainer.classList.add('hidden');
        logList.innerHTML = '';
        progressBar.style.width = '0%';
        progressBar.style.backgroundColor = '';
        statusText.textContent = '准备上传...';

        // 开启倒计时卡片及计算
        if (estimateInterval) clearInterval(estimateInterval);
        let timeLeft = pdfFiles.length * 8;
        const estimateCard = document.getElementById('estimate-time-card');
        const estimateTimeText = document.getElementById('estimate-time-left');

        if (estimateCard && estimateTimeText) {
            estimateCard.classList.remove('hidden');
            const renderTime = () => {
                if (timeLeft > 0) {
                    const m = Math.floor(timeLeft / 60);
                    const s = timeLeft % 60;
                    estimateTimeText.textContent = m > 0 ? `${m}分${s}秒` : `${s}秒`;
                } else {
                    estimateTimeText.textContent = '深度分析收尾中...';
                }
            };
            renderTime();

            estimateInterval = setInterval(() => {
                if (timeLeft > 0) {
                    timeLeft--;
                    renderTime();
                }
            }, 1000);
        }

        const fileLogMap = new Map();
        addLog(`准备上传: ${pdfFiles.length} 个 PDF 文件`);

        const mappings = {};
        document.querySelectorAll('.mapping-row').forEach(row => {
            const kw = row.querySelector('.mapping-keyword').value.trim();
            const co = row.querySelector('.mapping-company').value.trim();
            if (kw) mappings[kw] = co;
        });

        const formData = new FormData();
        formData.append('companyMapping', JSON.stringify(mappings));
        pdfFiles.forEach(file => formData.append('pdfs', file));

        try {
            statusText.textContent = '正在上传文件...';
            const uploadRes = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            const uploadData = await uploadRes.json();
            if (!uploadData.success) throw new Error(uploadData.error);

            const jobId = uploadData.jobId;
            statusText.textContent = '开始分析数据...';

            const eventSource = new EventSource(`/api/process-progress/${jobId}`);

            eventSource.onmessage = (event) => {
                const data = JSON.parse(event.data);

                if (data.progress !== undefined) {
                    progressBar.style.width = `${data.progress}%`;
                }

                if (data.status === 'processing_file') {
                    statusText.textContent = `正在分析 (${data.index}/${data.total}): ${data.file}`;
                    const li = addLog(`⏳ 分析中: ${data.file}`);
                    fileLogMap.set(data.file, li);
                } else if (data.status === 'generating_excel') {
                    statusText.textContent = '正在生成 Excel 报表...';
                    addLog('数据分析完成，正在整理表格...');
                } else if (data.status === 'completed') {
                    eventSource.close();

                    // 销毁倒计时与咖啡温馨卡片
                    if (estimateInterval) {
                        clearInterval(estimateInterval);
                        estimateInterval = null;
                    }
                    if (estimateCard) estimateCard.classList.add('hidden');

                    statusText.textContent = '处理完成！';
                    progressBar.style.width = '100%';

                    data.log.forEach(item => {
                        const existingLi = fileLogMap.get(item.file);
                        if (existingLi) {
                            if (item.status === 'success') {
                                existingLi.textContent = `✅ 成功: ${item.file}`;
                                existingLi.className = 'success';
                            } else {
                                existingLi.textContent = `❌ 失败: ${item.file} - ${item.message}`;
                                existingLi.className = 'error';
                            }
                        } else {
                            if (item.status === 'success') {
                                addLog(`✅ 成功: ${item.file}`, 'success');
                            } else {
                                addLog(`❌ 失败: ${item.file} - ${item.message}`, 'error');
                            }
                        }
                    });

                    // 动态渲染报表数据预览
                    const headerTr = document.getElementById('preview-table-header');
                    if (headerTr && data.headers) {
                        headerTr.innerHTML = data.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
                    }

                    const bodyTbody = document.getElementById('preview-table-body');
                    if (bodyTbody && data.previewRows) {
                        bodyTbody.innerHTML = data.previewRows.map(row => {
                            const cellsHtml = row.map((cell, colIndex) => {
                                if (typeof cell === 'number') {
                                    if (colIndex === 5) {
                                        // 汇率列
                                        return `<td class="num-cell">${cell.toFixed(4)}</td>`;
                                    }
                                    const formatted = cell.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                    if (cell < 0) {
                                        return `<td class="num-cell-negative">${formatted}</td>`;
                                    } else {
                                        return `<td class="num-cell">${formatted}</td>`;
                                    }
                                }
                                return `<td>${escapeHtml(cell !== null && cell !== undefined ? cell.toString() : '')}</td>`;
                            }).join('');
                            return `<tr>${cellsHtml}</tr>`;
                        }).join('');
                    }

                    // 扩展容器宽度以适应大表格
                    const mainContainer = document.querySelector('.container');
                    if (mainContainer) mainContainer.classList.add('wide-container');

                    resultContainer.classList.remove('hidden');

                    // 初始化自定义文件名并监听变化
                    const filenameInput = document.getElementById('export-filename-input');
                    if (filenameInput) {
                        filenameInput.value = `亚马逊汇总表`;
                        downloadBtn.href = `${data.downloadUrl}&filename=${encodeURIComponent(filenameInput.value)}`;

                        const newFilenameHandler = () => {
                            downloadBtn.href = `${data.downloadUrl}&filename=${encodeURIComponent(filenameInput.value.trim() || `亚马逊汇总表`)}`;
                        };
                        filenameInput.removeEventListener('input', filenameInput._handler);
                        filenameInput.addEventListener('input', newFilenameHandler);
                        filenameInput._handler = newFilenameHandler;
                    } else {
                        downloadBtn.href = data.downloadUrl;
                    }

                    // 自动刷新历史记录
                    loadHistory();

                    processBtn.disabled = true;
                    processBtn.textContent = '✅ 已生成报表';
                } else if (data.status === 'error') {
                    eventSource.close();
                    throw new Error(data.message);
                }
            };

            eventSource.onerror = () => {
                eventSource.close();
                statusText.textContent = '连接中断';
                addLog('分析过程中断，请重试', 'error');
                processBtn.disabled = false;
                processBtn.textContent = '开始分析并生成报表';
            };

        } catch (error) {
            statusText.textContent = '处理失败';
            progressBar.style.backgroundColor = 'var(--error-color)';
            addLog(`出错: ${error.message}`, 'error');
            processBtn.disabled = false;
            processBtn.textContent = '开始分析并生成报表';
        }
    });

    // ─── 历史记录方法实现 ───────────────────────────────────────────────────────
    async function loadHistory() {
        const tbody = document.getElementById('history-table-body');
        if (!tbody) return;

        try {
            const res = await fetch('/api/history');
            const result = await res.json();
            if (result.success && result.data) {
                if (result.data.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="4" style="padding: 1.5rem; text-align: center; color: var(--text-secondary);">暂无历史分析记录</td></tr>';
                    return;
                }

                tbody.innerHTML = result.data.map(item => {
                    const filesStr = escapeHtml(item.files.join(', '));
                    return `
                        <tr>
                            <td style="padding: 0.6rem; border-bottom: 1px solid #f1f5f9; white-space: nowrap; font-family: monospace;">${escapeHtml(item.timestamp)}</td>
                            <td style="padding: 0.6rem; border-bottom: 1px solid #f1f5f9; font-weight: 600; color: var(--primary-color);">${escapeHtml(item.month)}月</td>
                            <td style="padding: 0.6rem; border-bottom: 1px solid #f1f5f9; color: var(--text-secondary);" title="${filesStr}">${item.fileCount} 个文件</td>
                            <td style="padding: 0.6rem; border-bottom: 1px solid #f1f5f9; text-align: center; white-space: nowrap;">
                                <button class="secondary-btn small show-history-btn" data-id="${item.id}" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; background: #eff6ff; color: #2563eb; border-color: #bfdbfe; cursor: pointer; transition: all 0.2s;">📂 载入预览</button>
                                <button class="secondary-btn small delete-history-btn" data-id="${item.id}" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; background: #fef2f2; color: #ef4444; border-color: #fca5a5; cursor: pointer; transition: all 0.2s; margin-left: 4px;">🗑️ 删除</button>
                            </td>
                        </tr>
                    `;
                }).join('');

                // 绑定载入历史按钮的事件
                tbody.querySelectorAll('.show-history-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const id = btn.getAttribute('data-id');
                        const record = result.data.find(r => r.id === id);
                        if (record) {
                            loadHistoryRecordToPreview(record);
                        }
                    });
                });

                // 绑定删除单个历史按钮的事件
                tbody.querySelectorAll('.delete-history-btn').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        if (confirm('确定要删除这条历史分析记录吗？对应的 Excel 文件也将从磁盘中物理删除。')) {
                            const id = btn.getAttribute('data-id');
                            try {
                                const delRes = await fetch(`/api/history/${id}`, { method: 'DELETE' });
                                const delResult = await delRes.json();
                                if (delResult.success) {
                                    alert('历史记录已成功删除！');
                                    loadHistory(); // 重新装载历史
                                } else {
                                    alert('删除失败: ' + delResult.error);
                                }
                            } catch (err) {
                                console.error('Failed to delete single history item:', err);
                                alert('网络错误，删除失败');
                            }
                        }
                    });
                });
            }
        } catch (e) {
            console.error('Failed to load history list:', e);
        }
    }

    function loadHistoryRecordToPreview(record) {
        currentHistoryRecord = record;

        // 显示重新分析按钮容器
        const reAnalyzeContainer = document.getElementById('re-analyze-container');
        if (reAnalyzeContainer) reAnalyzeContainer.classList.remove('hidden');

        // 渲染表头
        const headerTr = document.getElementById('preview-table-header');
        if (headerTr && record.headers) {
            headerTr.innerHTML = `
                <th style="width: 50px; text-align: center; border-right: 1px solid var(--border-color);">
                    <input type="checkbox" id="check-all-rows" style="cursor: pointer; transform: scale(1.15);">
                </th>
            ` + record.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
        }

        // 动态填充行数据
        const bodyTbody = document.getElementById('preview-table-body');
        if (bodyTbody && record.previewRows) {
            bodyTbody.innerHTML = record.previewRows.map((row, idx) => {
                const cellsHtml = row.map((cell, colIndex) => {
                    if (typeof cell === 'number') {
                        if (colIndex === 5) {
                            return `<td class="num-cell">${cell.toFixed(4)}</td>`;
                        }
                        const formatted = cell.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                        if (cell < 0) {
                            return `<td class="num-cell-negative">${formatted}</td>`;
                        } else {
                            return `<td class="num-cell">${formatted}</td>`;
                        }
                    }
                    return `<td>${escapeHtml(cell !== null && cell !== undefined ? cell.toString() : '')}</td>`;
                }).join('');

                const filename = record.files[idx] || '';
                return `
                    <tr>
                        <td style="text-align: center; border-right: 1px solid #f1f5f9;">
                            <input type="checkbox" class="row-checkbox" data-filename="${escapeHtml(filename)}" style="cursor: pointer; transform: scale(1.15);">
                        </td>
                        ${cellsHtml}
                    </tr>
                `;
            }).join('');
        }

        // 绑定全选与单选联动状态交互
        const checkAll = document.getElementById('check-all-rows');
        if (checkAll) {
            checkAll.checked = false;
            checkAll.addEventListener('change', (e) => {
                const checked = e.target.checked;
                document.querySelectorAll('.row-checkbox').forEach(cb => {
                    cb.checked = checked;
                });
            });
        }

        // 展开宽屏容器
        const mainContainer = document.querySelector('.container');
        if (mainContainer) mainContainer.classList.add('wide-container');

        // 展示结果区域并载入下载配置
        resultContainer.classList.remove('hidden');

        const filenameInput = document.getElementById('export-filename-input');
        if (filenameInput) {
            filenameInput.value = `亚马逊汇总表-${record.month}月`;
            downloadBtn.href = `${record.downloadUrl}&filename=${encodeURIComponent(filenameInput.value)}`;

            const newFilenameHandler = () => {
                downloadBtn.href = `${record.downloadUrl}&filename=${encodeURIComponent(filenameInput.value.trim() || `亚马逊汇总表-${record.month}月`)}`;
            };
            filenameInput.removeEventListener('input', filenameInput._handler);
            filenameInput.addEventListener('input', newFilenameHandler);
            filenameInput._handler = newFilenameHandler;
        } else {
            downloadBtn.href = record.downloadUrl;
        }

        // 滚动到预览位置
        resultContainer.scrollIntoView({ behavior: 'smooth' });
    }

    async function clearHistory() {
        if (!confirm('确认清空所有分析历史记录与已生成的 Excel 文件吗？')) return;
        try {
            const res = await fetch('/api/history', { method: 'DELETE' });
            const result = await res.json();
            if (result.success) {
                alert('历史分析记录已成功清空！');
                loadHistory();
                resetAll();
            } else {
                alert('清空失败: ' + result.error);
            }
        } catch (e) {
            alert('网络错误，清空失败');
        }
    }

    // ─── 历史任务多选文件局部重新解析逻辑 ───────────────────────────────────────
    const reAnalyzeBtn = document.getElementById('re-analyze-btn');
    const reAnalyzeInput = document.getElementById('re-analyze-input');

    if (reAnalyzeBtn && reAnalyzeInput) {
        reAnalyzeBtn.addEventListener('click', () => {
            // 获取已勾选行的文件名列表
            const checkedCheckboxes = document.querySelectorAll('.row-checkbox:checked');
            if (checkedCheckboxes.length === 0) {
                alert('请先在左侧预览表格中勾选有误的数据行！');
                return;
            }
            reAnalyzeInput.click();
        });

        reAnalyzeInput.addEventListener('change', async function () {
            if (!this.files || this.files.length === 0) return;

            const checkedCheckboxes = document.querySelectorAll('.row-checkbox:checked');
            const checkedFilenames = Array.from(checkedCheckboxes).map(cb => cb.dataset.filename);

            const selectedFiles = Array.from(this.files);
            // 筛选出属于已勾选行文件名的 PDF 文件
            const matchedFiles = selectedFiles.filter(file => checkedFilenames.includes(file.name));

            if (matchedFiles.length === 0) {
                alert('您上传的文件名与勾选行的数据不匹配，请上传正确的 PDF 账单文件！');
                this.value = '';
                return;
            }

            const skippedCount = selectedFiles.length - matchedFiles.length;
            if (skippedCount > 0) {
                if (!confirm(`已选择 ${selectedFiles.length} 个文件，其中 ${matchedFiles.length} 个文件与勾选行匹配，其余 ${skippedCount} 个不匹配将被跳过。\n确定要开始重新解析吗？`)) {
                    this.value = '';
                    return;
                }
            }

            // 拉起高保真磨砂玻璃加载遮罩
            const tableContainer = document.getElementById('preview-table-container');
            let overlay = document.getElementById('re-analyze-overlay');
            if (!overlay && tableContainer) {
                overlay = document.createElement('div');
                overlay.className = 'table-overlay';
                overlay.id = 're-analyze-overlay';
                overlay.innerHTML = `
                    <div class="spinner" style="margin-bottom: 12px;"></div>
                    <div style="font-weight: 600; color: #1e293b; font-size: 0.95rem;">正在重新解析选定文件...</div>
                    <div style="font-size: 0.8rem; color: #64748b; margin-top: 4px;">大约需要几秒钟，请稍候</div>
                `;
                tableContainer.appendChild(overlay);
            }

            // 禁用按钮防重复提交
            reAnalyzeBtn.disabled = true;
            reAnalyzeBtn.textContent = '🔄 重新解析中...';

            const formData = new FormData();
            matchedFiles.forEach(file => {
                formData.append('pdfs', file);
            });

            try {
                const response = await fetch(`/api/history/${currentHistoryRecord.id}/re-analyze`, {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();
                if (result.success) {
                    // 更新缓存中的行数据
                    currentHistoryRecord.previewRows = result.previewRows;

                    // 弹出精美提示，汇总成果
                    const successCount = result.log.filter(l => l.status === 'success').length;
                    const failLogs = result.log.filter(l => l.status === 'error');

                    let msg = `🎉 重新分析完成！\n成功更新：${successCount} 个文件`;
                    if (failLogs.length > 0) {
                        msg += `\n失败：${failLogs.length} 个文件\n失败原因：\n` + failLogs.map(l => `- ${l.file}: ${l.error}`).join('\n');
                    }
                    alert(msg);

                    // 刷新表格与一键下载导出配置
                    loadHistoryRecordToPreview(currentHistoryRecord);
                    // 刷新左侧历史记录列表
                    loadHistory();
                } else {
                    alert('重新解析失败: ' + (result.error || '未知错误'));
                }
            } catch (err) {
                console.error('Failed to execute re-analyze:', err);
                alert('网络出错，重新解析失败！');
            } finally {
                // 清理工作
                document.getElementById('re-analyze-overlay')?.remove();
                reAnalyzeBtn.disabled = false;
                reAnalyzeBtn.textContent = '🔄 重新解析勾选文件';
                reAnalyzeInput.value = '';
            }
        });
    }

    // 初始化时加载历史记录
    loadHistory();

    // 绑定清空历史按钮事件
    const clearHistoryBtn = document.getElementById('clear-history-btn');
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', clearHistory);
    }
});
