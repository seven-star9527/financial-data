const express = require('express');
const multer = require('multer');
const axios = require('axios');
const xlsx = require('xlsx');
const ExcelJS = require('exceljs');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');
const cheerio = require('cheerio');
const cron = require('node-cron');
const COS = require('cos-nodejs-sdk-v5');
const pdfParse = require('pdf-parse');
const os = require('os');
const cors = require('cors');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, 'pdf-analyze', '.env') });

const app = express();
app.use(cors());

// --- 访问记录与工具使用记录日志中间件 ---
const statusTextMap = {
    200: "OK",
    201: "Created",
    204: "No Content",
    304: "Not Modified",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    500: "Internal Server Error"
};

const toolMappings = {
    '/pdf-analyze': '亚马逊 PDF 解析',
    '/收款汇总表处理工具v1.0.html': '收款汇总处理',
    '/物流账单处理工具v1.0.html': '物流账单处理',
    '/国内运费账单处理工具v1.0.html': '国内运费对账'
};

app.use((req, res, next) => {
    const isProgress = req.originalUrl.includes('process-progress');
    const isConsoleLog = req.originalUrl === '/api/log';
    
    if (isProgress || isConsoleLog) {
        return next();
    }

    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const date = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const formattedTime = `${year}-${month}-${date} ${hours}:${minutes}:${seconds}`;

        let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip;
        ip = ip.replace('::ffff:', '');
        if (ip === '::1') ip = '127.0.0.1';
        const port = req.connection.remotePort || '';
        const ipPort = port ? `${ip}:${port}` : ip;

        const status = res.statusCode;
        const statusText = statusTextMap[status] || 'OK';

        let colorPrefix = '\x1b[32m'; 
        let colorSuffix = '\x1b[0m';
        if (status >= 400) {
            colorPrefix = '\x1b[31m'; 
        }

        const infoLabel = status >= 400 ? '\x1b[31mINFO:\x1b[0m    ' : '\x1b[32mINFO:\x1b[0m    ';
        const logLine = `${infoLabel}[${formattedTime}] ${ipPort} - "${req.method} ${req.originalUrl} HTTP/1.1" ${colorPrefix}${status} ${statusText}${colorSuffix}`;
        console.log(logLine);

        if (req.method === 'GET') {
            let matchedTool = null;
            for (const [route, name] of Object.entries(toolMappings)) {
                if (req.originalUrl.startsWith(route)) {
                    matchedTool = name;
                    break;
                }
            }
            if (matchedTool) {
                console.log(`\n\x1b[44m\x1b[37m【工具使用记录】\x1b[0m \x1b[36m打工人 IP: ${ip} 正在启动/使用【${matchedTool}】工具...\x1b[0m\n`);
            }
        }
    });
    next();
});

// --- 目录与上传配置 ---
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
const upload = multer({ dest: UPLOADS_DIR });

// --- 静态资源与路由整合 (Tool Hub 扩展) ---
// 1. 服务于主页 Tool Hub
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 2. 服务于 pdf-analyze 前端 (映射到 /pdf-analyze)
app.use('/pdf-analyze', express.static(path.join(__dirname, 'pdf-analyze', 'public')));

// 3. 服务于根目录下的静态 HTML 工具和静态资源
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use(express.static(__dirname));

app.use(express.json());


// =========================================================================
//以下内容完全保留自 pdf-analyze/server.js 的原始逻辑，未做任何删减
// =========================================================================

// API Keys & Config
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const RATES_FILE = path.join(__dirname, 'pdf-analyze', 'exchange_rates.json');
const MONTHLY_RATES_FILE = path.join(__dirname, 'pdf-analyze', 'boc_fx_rates_monthly.json');
const MAPPINGS_FILE = path.join(__dirname, 'pdf-analyze', 'company_mappings.json');
const LOGISTICS_CONFIG_FILE = path.join(__dirname, 'logistics_config.json');
const HISTORY_FILE = path.join(__dirname, 'pdf-analyze', 'analysis_history.json');
const HISTORY_DIR = path.join(__dirname, 'pdf-analyze', 'data', 'history');
if (!fs.existsSync(path.dirname(HISTORY_FILE))) fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });

// 国家/站点到货币的详细映射
const countryCurrencyMap = {
    '美国': { name: '美国', currency: '美元', code: 'USD' },
    '加拿大': { name: '加拿大', currency: '加拿大元', code: 'CAD' },
    '墨西哥': { name: '墨西哥', currency: '墨西哥比索', code: 'MXN' },
    '英国': { name: '英国', currency: '英镑', code: 'GBP' },
    '德国': { name: '德国', currency: '欧元', code: 'EUR' },
    '法国': { name: '法国', currency: '欧元', code: 'EUR' },
    '意大利': { name: '意大利', currency: '欧元', code: 'EUR' },
    '西班牙': { name: '西班牙', currency: '欧元', code: 'EUR' },
    '荷兰': { name: '荷兰', currency: '欧元', code: 'EUR' },
    '比利时': { name: '比利时', currency: '欧元', code: 'EUR' },
    '奥地利': { name: '奥地利', currency: '欧元', code: 'EUR' },
    '希腊': { name: '希腊', currency: '欧元', code: 'EUR' },
    '爱尔兰': { name: '爱尔兰', currency: '欧元', code: 'EUR' },
    '澳大利亚': { name: '澳大利亚', currency: '澳大利亚元', code: 'AUD' },
    '澳洲': { name: '澳大利亚', currency: '澳大利亚元', code: 'AUD' },
    '日本': { name: '日本', currency: '日元', code: 'JPY' },
    '瑞典': { name: '瑞典', currency: '瑞典克朗', code: 'SEK' },
    '波兰': { name: '波兰', currency: '波兰兹罗提', code: 'PLN' },
    '土耳其': { name: '土耳其', currency: '土耳其里拉', code: 'TRY' },
    '沙特': { name: '沙特', currency: '沙特里亚尔', code: 'SAR' },
    '印度': { name: '印度', currency: '印度卢比', code: 'INR' },
    '香港': { name: '香港', currency: '港币', code: 'HKD' },
    '巴西': { name: '巴西', currency: '巴西雷亚尔', code: 'BRL' },
    '阿联酋': { name: '阿联酋', currency: '阿联酋迪拉姆', code: 'AED' },
    '新加坡': { name: '新加坡', currency: '新加坡元', code: 'SGD' },
    '泰国': { name: '泰国', currency: '泰国铢', code: 'THB' },
    '丹麦': { name: '丹麦', currency: '丹麦克朗', code: 'DKK' },
    '菲律宾': { name: '菲律宾', currency: '菲律宾比索', code: 'PHP' },
    '新西兰': { name: '新西兰', currency: '新西兰元', code: 'NZD' },
    '瑞士': { name: '瑞士', currency: '瑞士法郎', code: 'CHF' },
    '马来西亚': { name: '马来西亚', currency: '林吉特', code: 'MYR' },
    '俄罗斯': { name: '俄罗斯', currency: '卢布', code: 'RUB' },
    '匈牙利': { name: '匈牙利', currency: '匈牙利福林', code: 'HUF' },
    '以色列': { name: '以色列', currency: '以色列谢克尔', code: 'ILS' },
    '越南': { name: '越南', currency: '越南盾', code: 'VND' },
    '台湾': { name: '台湾', currency: '新台币', code: 'TWD' },
    '捷克': { name: '捷克', currency: '捷克克朗', code: 'CZK' }
};

// ISO 2字母国家代码 -> 国家信息（用于从文件名括号中识别）
const countryCodeMap = {
    'US': { name: '美国', currency: '美元', code: 'USD' },
    'CA': { name: '加拿大', currency: '加拿大元', code: 'CAD' },
    'MX': { name: '墨西哥', currency: '墨西哥比索', code: 'MXN' },
    'UK': { name: '英国', currency: '英镑', code: 'GBP' },
    'GB': { name: '英国', currency: '英镑', code: 'GBP' },
    'DE': { name: '德国', currency: '欧元', code: 'EUR' },
    'FR': { name: '法国', currency: '欧元', code: 'EUR' },
    'IT': { name: '意大利', currency: '欧元', code: 'EUR' },
    'ES': { name: '西班牙', currency: '欧元', code: 'EUR' },
    'NL': { name: '荷兰', currency: '欧元', code: 'EUR' },
    'BE': { name: '比利时', currency: '欧元', code: 'EUR' },
    'AT': { name: '奥地利', currency: '欧元', code: 'EUR' },
    'GR': { name: '希腊', currency: '欧元', code: 'EUR' },
    'IE': { name: '爱尔兰', currency: '欧元', code: 'EUR' },
    'AU': { name: '澳大利亚', currency: '澳大利亚元', code: 'AUD' },
    'JP': { name: '日本', currency: '日元', code: 'JPY' },
    'SE': { name: '瑞典', currency: '瑞典克朗', code: 'SEK' },
    'PL': { name: '波兰', currency: '波兰兹罗提', code: 'PLN' },
    'TR': { name: '土耳其', currency: '土耳其里拉', code: 'TRY' },
    'SA': { name: '沙特', currency: '沙特里亚尔', code: 'SAR' },
    'IN': { name: '印度', currency: '印度卢比', code: 'INR' },
    'HK': { name: '香港', currency: '港币', code: 'HKD' },
    'BR': { name: '巴西', currency: '巴西雷亚尔', code: 'BRL' },
    'AE': { name: '阿联酋', currency: '阿联酋迪拉姆', code: 'AED' },
    'SG': { name: '新加坡', currency: '新加坡元', code: 'SGD' },
    'TH': { name: '泰国', currency: '泰国铢', code: 'THB' },
    'DK': { name: '丹麦', currency: '丹麦克朗', code: 'DKK' },
    'PH': { name: '菲律宾', currency: '菲律宾比索', code: 'PHP' },
    'NZ': { name: '新西兰', currency: '新西兰元', code: 'NZD' },
    'CH': { name: '瑞士', currency: '瑞士法郎', code: 'CHF' },
    'MY': { name: '马来西亚', currency: '林吉特', code: 'MYR' },
    'RU': { name: '俄罗斯', currency: '卢布', code: 'RUB' },
    'HU': { name: '匈牙利', currency: '匈牙利福林', code: 'HUF' },
    'IL': { name: '以色列', currency: '以色列谢克尔', code: 'ILS' },
    'VN': { name: '越南', currency: '越南盾', code: 'VND' },
    'TW': { name: '台湾', currency: '新台币', code: 'TWD' },
    'CZ': { name: '捷克', currency: '捷克克朗', code: 'CZK' }
};

// 允许获取的货币白名单
const allowedCurrencies = [
    '美元', '加拿大元', '英镑', '欧元', '澳大利亚元', '日元', '瑞典克朗',
    '波兰兹罗提', '土耳其里拉', '沙特里亚尔', '墨西哥比索', '印度卢比',
    '港币', '巴西雷亚尔', '阿联酋迪拉姆', '新加坡元', '泰国铢', '丹麦克朗',
    '菲律宾比索', '新西兰元', '瑞士法郎', '林吉特', '卢布', '匈牙利福林',
    '以色列谢克尔', '越南盾', '新台币', '捷克克朗'
];

// 汇率抓取逻辑
async function updateExchangeRates() {
    try {
        console.log("Fetching exchange rates from BOC...");
        const response = await axios.get('https://www.boc.cn/sourcedb/whpj/index.html', {
            responseType: 'arraybuffer',
            timeout: 15000
        });

        const html = response.data.toString('utf-8');
        const $ = cheerio.load(html);
        const rates = {};

        $('table tr').each((i, el) => {
            if (i === 0) return; // skip header
            const tds = $(el).find('td');
            if (tds.length >= 6) {
                const currencyName = $(tds[0]).text().trim();

                // 仅保留白名单中的货币
                if (allowedCurrencies.includes(currencyName)) {
                    const conversionPrice = parseFloat($(tds[5]).text().trim());
                    if (!isNaN(conversionPrice)) {
                        rates[currencyName] = conversionPrice;
                    }
                }
            }
        });

        const data = { rates, updateTime: new Date().toISOString() };
        fs.writeFileSync(RATES_FILE, JSON.stringify(data, null, 2));
        console.log("Exchange rates updated successfully.");
        return data;
    } catch (error) {
        console.error("Failed to update exchange rates:", error);
        throw error;
    }
}

// 每月 2 日 00:00 自动抓取
cron.schedule('0 0 2 * *', () => {
    console.log("Cron triggered: updating exchange rates...");
    updateExchangeRates().catch(console.error);
});

// 手动拉取汇率接口
app.get('/api/rates/fetch', async (req, res) => {
    try {
        const data = await updateExchangeRates();
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 触发 Python 爬虫获取历史汇率接口
app.post('/api/rates/fetch-history', (req, res) => {
    const targetMonth = req.body.month; // 格式 YYYY-MM
    if (!targetMonth || !/^\d{4}-\d{2}$/.test(targetMonth)) {
        return res.status(400).json({ success: false, error: "无效的月份格式，应为 YYYY-MM" });
    }

    console.log(`[API] 收到拉取历史汇率请求，目标月份: ${targetMonth}`);
    const pythonProcess = spawn('python', ['fx_crawler_pro.py', '--target-month', targetMonth], {
        cwd: __dirname
    });

    pythonProcess.stdout.on('data', (data) => {
        console.log(`[Crawler stdout]: ${data}`);
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`[Crawler stderr]: ${data}`);
    });

    pythonProcess.on('close', (code) => {
        if (code === 0) {
            // 重新读取刚导出的 JSON 返回给前端
            let exportData = null;
            if (fs.existsSync(HISTORY_RATES_FILE)) {
                exportData = JSON.parse(fs.readFileSync(HISTORY_RATES_FILE));
            }
            res.json({ success: true, message: "爬取完成", data: exportData });
        } else {
            res.status(500).json({ success: false, error: `爬虫执行异常退出，退出码: ${code}` });
        }
    });
});

// 获取本地保存的汇率
app.get('/api/rates', (req, res) => {
    if (fs.existsSync(RATES_FILE)) {
        res.json({ success: true, data: JSON.parse(fs.readFileSync(RATES_FILE)) });
    } else {
        res.json({ success: true, data: null });
    }
});

// 保存修改后的汇率接口
app.post('/api/rates/save', (req, res) => {
    try {
        const newRates = req.body.rates;
        if (!newRates) throw new Error("Invalid rates data");

        let data = { rates: {}, updateTime: new Date().toISOString() };
        if (fs.existsSync(RATES_FILE)) {
            data = JSON.parse(fs.readFileSync(RATES_FILE));
        }
        
        data.rates = { ...data.rates, ...newRates };
        data.updateTime = new Date().toISOString();

        fs.writeFileSync(RATES_FILE, JSON.stringify(data, null, 2));
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- 物流账单配置接口 ---
app.get('/api/logistics/config', (req, res) => {
    if (fs.existsSync(LOGISTICS_CONFIG_FILE)) {
        res.json({ success: true, data: JSON.parse(fs.readFileSync(LOGISTICS_CONFIG_FILE)) });
    } else {
        res.json({ success: true, data: null });
    }
});

app.post('/api/logistics/config', (req, res) => {
    try {
        const config = req.body;
        fs.writeFileSync(LOGISTICS_CONFIG_FILE, JSON.stringify(config, null, 2));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 辅助函数：本地解析 PDF (增强版：支持物理布局重构、字体编码异常检测及坐标提取)
async function parsePdfLocally(filePath) {
    console.log(`Parsing PDF with layout reconstruction: ${filePath}`);
    const dataBuffer = fs.readFileSync(filePath);
    let hasLabelLoss = false;
    let layoutRows = [];

    // 自定义页面渲染函数，尝试通过坐标还原表格布局
    const options = {
        pagerender: async function (pageData) {
            const textContent = await pageData.getTextContent();
            
            // 1. 字体编码异常 (Label Loss) 检测：若大量字符被渲染成空串且显示 g_font_error 字体，标记异常
            let gFontErrorCount = 0;
            let totalItemsCount = textContent.items.length;
            for (let item of textContent.items) {
                if (item.fontName === 'g_font_error') {
                    gFontErrorCount++;
                }
            }
            if (totalItemsCount > 0 && (gFontErrorCount / totalItemsCount) > 0.3) {
                hasLabelLoss = true;
            }

            // 将文本项按照 Y 坐标（从上到下）和 X 坐标（从左到右）排序
            let items = textContent.items.sort((a, b) => {
                const yDiff = b.transform[5] - a.transform[5];
                if (Math.abs(yDiff) > 5) {
                    return yDiff;
                }
                return a.transform[4] - b.transform[4];
            });

            let currentYRows = [];
            let lastY = null;
            let currentRow = [];

            for (let item of items) {
                const y = item.transform[5];
                const x = item.transform[4];
                const w = item.width || 0;
                
                if (lastY !== null && Math.abs(lastY - y) > 5) {
                    currentYRows.push(currentRow);
                    currentRow = [];
                }
                currentRow.push({
                    str: item.str,
                    x: x,
                    y: y,
                    w: w,
                    fontName: item.fontName
                });
                lastY = y;
            }
            if (currentRow.length > 0) {
                currentYRows.push(currentRow);
            }

            let pageText = '';
            for (let rIndex = 0; rIndex < currentYRows.length; rIndex++) {
                const rItems = currentYRows[rIndex].sort((a, b) => a.x - b.x);
                let rText = '';
                let lastItemX = null;
                let lastItemW = 0;
                for (let it of rItems) {
                    if (lastItemX !== null) {
                        const gap = it.x - (lastItemX + lastItemW);
                        if (gap > 35) {
                            rText += '    ';
                        } else if (gap > 2) {
                            rText += ' ';
                        }
                    }
                    rText += it.str;
                    lastItemX = it.x;
                    lastItemW = it.w || (it.str.length * 6);
                }
                pageText += rText + '\n';
                
                layoutRows.push({
                    y: Math.round(rItems[0].y),
                    items: rItems.map(it => ({
                        str: it.str,
                        x: Math.round(it.x),
                        w: Math.round(it.w),
                        fontName: it.fontName || '?'
                    }))
                });
            }
            return pageText;
        }
    };

    const data = await pdfParse(dataBuffer, options);
    layoutRows.sort((a, b) => b.y - a.y);
    
    return {
        text: data.text,
        layoutRows: layoutRows,
        hasLabelLoss: hasLabelLoss
    };
}

function extractDataByLayout(layoutRows) {
    let income = 0;
    let expenses = 0;
    let adsCost = 0;
    let taxCollected = 0;
    let taxRefunded = 0;
    let adsRefund = 0;

    const parseNum = (str) => {
        if (!str) return 0;
        return parseFloat(str.replace(/,/g, '')) || 0;
    };

    // 1. 寻找顶部的汇总区域 (Y 处于 400 到 520 之间，连续 4 行)
    let summarySequence = [];
    for (let i = 0; i < layoutRows.length - 3; i++) {
        let candidate = [];
        for (let j = 0; j < 4; j++) {
            let row = layoutRows[i + j];
            if (row.y < 400 || row.y > 520) break;
            let numItem = row.items.find(it => /^-?[\d,]+$/.test(it.str.trim()) && it.x > 700);
            if (numItem) {
                candidate.push({ row, numItem });
            } else {
                break;
            }
        }
        if (candidate.length === 4) {
            let uniform = true;
            for (let k = 0; k < 3; k++) {
                let diff = candidate[k].row.y - candidate[k+1].row.y;
                if (diff < 5 || diff > 20) {
                    uniform = false;
                    break;
                }
            }
            if (uniform) {
                summarySequence = candidate;
                break;
            }
        }
    }

    if (summarySequence.length === 4) {
        income = parseNum(summarySequence[0].numItem.str);
        expenses = parseNum(summarySequence[1].numItem.str);
        console.log(`[Local Layout] Extracted Summary: income=${income}, expenses=${expenses}`);
    }

    // 2. 寻找广告费 (Y 处于 200 到 400 之间) - 采用双重优先级匹配
    let adsCostCandidates = [];
    for (let row of layoutRows) {
        if (row.y >= 200 && row.y <= 400) {
            let hasLabelError = row.items.some(it => (it.str.trim() === "" && it.fontName === 'g_font_error') && it.x >= 400 && it.x <= 415);
            if (hasLabelError) {
                let adsItem = row.items.find(it => /^-?[\d,]+$/.test(it.str.trim()) && it.x >= 650 && it.x <= 690);
                if (adsItem) {
                    let val = parseNum(adsItem.str);
                    let hasAdsCode = row.items.some(it => it.str.trim() === "105" && it.x >= 350 && it.x <= 385);
                    adsCostCandidates.push({ val, y: row.y, hasAdsCode });
                }
            }
        }
    }

    if (adsCostCandidates.length > 0) {
        let best = adsCostCandidates.find(c => c.hasAdsCode);
        if (best) {
            adsCost = best.val;
            console.log(`[Local Layout] Extracted adsCost (preferred code 105): ${adsCost} at Y=${best.y}`);
        } else {
            adsCostCandidates.sort((a, b) => a.val - b.val); // 升序，最负的在前面
            adsCost = adsCostCandidates[0].val;
            console.log(`[Local Layout] Extracted adsCost (fallback largest negative): ${adsCost} at Y=${adsCostCandidates[0].y}`);
        }
    }

    // 3. 寻找已收/退还税额 (Y 处于 50 到 150 之间)
    for (let row of layoutRows) {
        if (row.y >= 50 && row.y <= 150) {
            let hasLabelError = row.items.some(it => (it.str.trim() === "" && it.fontName === 'g_font_error') && it.x >= 400 && it.x <= 415);
            if (hasLabelError) {
                let colItem = row.items.find(it => /^[\d,]+$/.test(it.str.trim()) && it.str.trim() !== "0" && it.x >= 730 && it.x <= 760);
                if (colItem && taxCollected === 0) {
                    taxCollected = parseNum(colItem.str);
                    console.log(`[Local Layout] Extracted taxCollected: ${taxCollected} at Y=${row.y}`);
                }
                let refItem = row.items.find(it => /^-?[\d,]+$/.test(it.str.trim()) && it.x >= 670 && it.x <= 700);
                if (refItem && taxRefunded === 0) {
                    taxRefunded = parseNum(refItem.str);
                    console.log(`[Local Layout] Extracted taxRefunded: ${taxRefunded} at Y=${row.y}`);
                }
            }
        }
    }

    return { income, expenses, adsCost, taxCollected, taxRefunded, adsRefund: 0 };
}

// 辅助函数：使用 DeepSeek 提取数据
async function extractDataWithDeepSeek(text) {
    if (!DEEPSEEK_API_KEY) {
        console.warn("DEEPSEEK_API_KEY is not set, falling back to regex extraction.");
        return null;
    }

    try {
        console.log("Step 1: Translating report to English via DeepSeek...");
        const translateResponse = await axios.post('https://api.deepseek.com/chat/completions', {
            model: "deepseek-v4-flash",
            messages: [
                {
                    role: "system",
                    content: `You are a professional financial translator. 
Your task is to translate this Amazon Settlement report into English. 
- Keep the original layout (especially columns and line breaks) as much as possible.
- Translate all financial terms to standard Amazon English terms EXACTLY as follows:
  * '収入' / '売上' / 'Einnahmen' / 'Umsätze, Einnahmen und Erstattungen' / 'Ventas, créditos y reembolsos' -> 'Sales, credits, and refunds'
  * '支出' / '経費' / 'Ausgaben' / 'Gebühren...' / 'Gastos' -> 'Fees'
  * '広告費用' / '広告費' / 'Werbekosten' / 'Costo de the publicidad' / 'Costo della pubblicità' / 'Prix de la publicité' / 'Gastos de publicidad' -> 'Cost of Advertising'
  * '広告費の返金' / 'Gutschrift für Inserenten' / 'Rimborso per inserzionista' / 'Reembolso para el promotor' / 'Reembolso para anunciante' / 'Remboursement pour le publicitaire' -> 'Refund for Advertiser'
  * '商品、配送、ギフト包装に対して税金が徴収されました' / 'Eingezogene Produkt-, Versand- und Geschenkver包装税金' / 'Eingezogene Produkt-, Versand- und Geschenkverpackungssteuern' / 'Impuestos de producto, envío y envoltura de regalo cobrados' -> 'Product, delivery and gift wrap taxes collected'
  * '商品、配送、ギフト包装に対して税金還付されました' / 'Zurückerstattete Produkt-, Versand- und Geschenkverpackungssteuern' / 'Impuestos de producto, envío y envoltura de regalo reembolsados' -> 'Product, delivery and gift wrap taxes refunded'
- Convert European numeric formats (e.g., -36,39 or 1.234,56) to standard US format (e.g., -36.39 or 1234.56).
- If you see native currency declarations such as 'Alla belopp i kr' in Swedish or similar in other languages, you MUST translate 'kr' to its standard ISO code (e.g. 'SEK' for Swedish Krona, 'DKK' for Danish Krone) in English to prevent ambiguity.
- Do not add any commentary, just return the translated text.`
                },
                {
                    role: "user",
                    content: text.substring(0, 30000)
                }
            ],
            thinking: { type: "disabled" }
        }, {
            headers: {
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });

        const translatedText = translateResponse.data.choices[0].message.content;

        console.log("Step 2: Extracting data from translated text...");
        const response = await axios.post('https://api.deepseek.com/chat/completions', {
            model: "deepseek-v4-flash",
            messages: [
                {
                    role: "system",
                    content: `你是一个精通 Amazon 财务报表的专家。你的任务是从翻译成英文后的报表文本中精准提取财务数据。

### 核心规则 (优先级最高)：
1. **日期范围 (dateRange)**：
   - 寻找包含 "Transactions from" 或 "Vorgänge vom" (翻译后应为 "Transactions from") 的行，提取完整的日期范围字符串。

2. **税款提取 (CRITICAL)**：
   - **不要** 提取 "Totals" 或 "Summaries" 区域中那个总的 "Tax" 或 "Net taxes" 数值。
   - **必须** 寻找报表底部 "Tax" 明细区域的具体行：
     - **已收税款 (taxCollected)**: 寻找包含 "Product, delivery and gift wrap taxes collected" 的行。
     - **税款退款 (taxRefunded)**: 寻找包含 "Product, delivery and gift wrap taxes refunded" 的行。
   - 如果明细区数值为 0，才返回 0。

3. **广告费 (adsCost)**：
   - 提取 "Cost of Advertising" 对应的数值。
   - 如果有 "Refund for Advertiser"，请确保提取的是净支出（通常为负）。

4. **收入 (income) 与 支出 (expenses)**：
   - 提取 "Summary" 或 "Zusammenfassungen" 区域对应的：
     - **income**: "Sales, credits, and refunds" 的数值。
     - **expenses**: "Fees" 或 "Fees, including..." 的数值。

5. **广告退款 (adsRefund)**：
   - 提取 "Refund for Advertiser" 对应的数值（通常为正数或 0）。

6. **币种三字码 (currency)**：
   - 寻找包含 "All amounts in ..., unless specified" 或类似币种指示的语句（例如 "All amounts in USD"、"All amounts in GBP"、"All amounts in PLN"）。
   - 提取其代表的 ISO 结算币种三字代码（如 USD, GBP, EUR, CAD, MXN, PLN, JPY, AUD 等）。如没找到，请返回 ""。

### 数值格式处理：
- **JSON 格式要求**：所有数值必须是合法的 number 类型，保留原始正负号。

### 返回格式：
{
  "dateRange": "string",
  "income": number,
  "expenses": number,
  "adsCost": number,
  "taxCollected": number,
  "taxRefunded": number,
  "adsRefund": number,
  "currency": "string"
}
只需返回 JSON，不要任何解释。`
                },
                {
                    role: "user",
                    content: translatedText
                }
            ],
            response_format: { type: 'json_object' },
            thinking: { type: "disabled" }
        }, {
            headers: {
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });

        const content = response.data.choices[0].message.content;
        return JSON.parse(content);
    } catch (error) {
        console.error("DeepSeek extraction failed:", error);
        return null;
    }
}

// 辅助函数：获取月份
function getMonthFromRange(dateRange) {
    if (!dateRange) return '1';
    const match = dateRange.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
    const m = match ? match[1] : 'Jan';
    const monthMap = {
        'Jan': '1', 'Feb': '2', 'Mar': '3', 'Apr': '4', 'May': '5', 'Jun': '6',
        'Jul': '7', 'Aug': '8', 'Sep': '9', 'Oct': '10', 'Nov': '11', 'Dec': '12'
    };
    return monthMap[m] || '1';
}

function parseFileNameInfo(originalName) {
    let nameWithoutExt = originalName.replace(/\.pdf$/i, '').trim();
    // 智能滤除文件开头的月份/日期前缀，如 "1月 "、"01月 "、"2026年1月 " 等以及多余空格
    nameWithoutExt = nameWithoutExt.replace(/^(?:\d{4}年)?\d{1,2}月\s*/g, '').trim();

    // Step 1: 扫描文件名中所有形如 (DE) 或 （DE） 的括号，寻找有效的二位国家代码（支持中文括号与任意位置，支持后跟编号如 (1)）
    let countryInfo = null;
    let countryName = '';

    const matches = nameWithoutExt.matchAll(/[（\(]([A-Z]{2})[）\)]/gi);
    for (const match of matches) {
        const isoCode = match[1].toUpperCase();
        if (countryCodeMap[isoCode]) {
            countryInfo = countryCodeMap[isoCode];
            countryName = countryInfo.name;
            break; // 优先使用第一个匹配到的有效国家代码
        }
    }

    // Step 1.5: 如果括号中没有找到，则扫描文件名中任何以非英文字母为边界的独立二位国家代码（如 "-DE3月" 中的 "DE"，"FR3月" 中的 "FR"）
    if (!countryInfo) {
        const boundaryRegex = /(?:[^a-zA-Z]|^)([A-Z]{2})(?:[^a-zA-Z]|$)/gi;
        const boundaryMatches = nameWithoutExt.matchAll(boundaryRegex);
        for (const m of boundaryMatches) {
            const isoCode = m[1].toUpperCase();
            if (countryCodeMap[isoCode]) {
                countryInfo = countryCodeMap[isoCode];
                countryName = countryInfo.name;
                break;
            }
        }
    }

    // Step 2: 提取品牌前缀，切分年份等分界线
    let prefix = nameWithoutExt;
    const yearMatch = nameWithoutExt.match(/(.*?)(20\d{2}|\d{4})/i);
    if (yearMatch) {
        prefix = yearMatch[1].trim();
    } else {
        const parts = nameWithoutExt.split(/[\s(\-]/);
        if (parts.length > 0) {
            prefix = parts[0].trim();
        }
    }

    const lowerPrefix = prefix.toLowerCase();
    const lowerName = nameWithoutExt.toLowerCase();

    // Step 3: 不区分大小写的增强地名/代号匹配
    if (!countryInfo) {
        // 36 国/地区及其代表性代号字典
        const enhancedAliases = {
            '美国': ['us', 'usd', '美国', '🇺🇸'],
            '加拿大': ['ca', 'cad', '加拿大', '🇨🇦'],
            '墨西哥': ['墨西哥', 'mx', 'mxn', '🇲🇽'],
            '英国': ['英国', 'uk', 'gb', 'gbp', '🇬🇧'],
            '德国': ['德国', 'de', 'eur', '🇩🇪'],
            '法国': ['法国', 'fr', '🇫🇷'],
            '意大利': ['意大利', 'it', '🇮🇹'],
            '西班牙': ['西班牙', 'es', '🇪🇸'],
            '荷兰': ['荷兰', 'nl', '🇳🇱'],
            '比利时': ['比利时', 'be', '🇧🇪'],
            '奥地利': ['奥地利', 'at', '🇦🇹'],
            '希腊': ['希腊', 'gr', '🇬🇷'],
            '爱尔兰': ['爱尔兰', 'ie', '🇮🇪'],
            '澳大利亚': ['澳大利亚', '澳洲', 'au', 'aud', '🇦🇺'],
            '日本': ['日本', 'jp', 'jpy', '🇯🇵'],
            '瑞典': ['瑞典', 'se', 'sek', '🇸🇪'],
            '波兰': ['波兰', 'pl', 'pln', '🇵🇱'],
            '土耳其': ['土耳其', 'tr', 'try', '🇹🇷'],
            '沙特': ['沙特', 'sa', 'sar', '🇸🇦'],
            '阿联酋': ['阿联酋', 'ae', 'aed', '🇦🇪'],
            '印度': ['印度', 'in', 'inr', '🇮🇳'],
            '新加坡': ['新加坡', 'sg', 'sgd', '🇸🇬'],
            '香港': ['香港', 'hk', 'hkd', '🇭🇰'],
            '巴西': ['巴西', 'br', 'brl', '🇧🇷'],
            '泰国': ['泰国', 'th', 'thb', '🇹🇭'],
            '丹麦': ['丹麦', 'dk', 'dkk', '🇩🇰'],
            '菲律宾': ['菲律宾', 'ph', 'php', '🇵🇭'],
            '新西兰': ['新西兰', 'nz', 'nzd', '🇳🇿'],
            '瑞士': ['瑞士', 'ch', 'chf', '🇨🇭'],
            '马来西亚': ['马来西亚', 'my', 'myr', '🇲🇾'],
            '俄罗斯': ['俄罗斯', 'ru', 'rub', '🇷🇺'],
            '匈牙利': ['匈牙利', 'hu', 'huf', '🇭🇺'],
            '以色列': ['以色列', 'il', 'ils', '🇮🇱'],
            '越南': ['越南', 'vn', 'vnd', '🇻🇳'],
            '台湾': ['台湾', 'tw', 'twd', '🇹🇼'],
            '捷克': ['捷克', 'cz', 'czk', '🇨🇿']
        };

        // 打平别名并进行长度排序（优先匹配长字符串，如 mxn 优先于 mx）
        let allEntries = [];
        for (const [cName, aliases] of Object.entries(enhancedAliases)) {
            for (const alias of aliases) {
                allEntries.push({ cName, alias, length: alias.length });
            }
        }
        allEntries.sort((a, b) => b.length - a.length);

        // 优先在前缀 prefix 中扫描匹配
        for (const entry of allEntries) {
            const isWord = /^[a-zA-Z]+$/.test(entry.alias);
            if (isWord) {
                const regex = new RegExp(`(?:[\\u4e00-\\u9fa5]+|\\b)${entry.alias}\\b`, 'i');
                if (regex.test(prefix)) {
                    countryInfo = countryCurrencyMap[entry.cName];
                    countryName = entry.cName;
                    break;
                }
            } else {
                if (prefix.includes(entry.alias)) {
                    countryInfo = countryCurrencyMap[entry.cName];
                    countryName = entry.cName;
                    break;
                }
            }
        }

        // 降级在整个文件名中扫描匹配
        if (!countryInfo) {
            for (const entry of allEntries) {
                const isWord = /^[a-zA-Z]+$/.test(entry.alias);
                if (isWord) {
                    const regex = new RegExp(`\\b${entry.alias}\\b`, 'i');
                    if (regex.test(nameWithoutExt)) {
                        countryInfo = countryCurrencyMap[entry.cName];
                        countryName = entry.cName;
                        break;
                    }
                } else {
                    if (nameWithoutExt.includes(entry.alias)) {
                        countryInfo = countryCurrencyMap[entry.cName];
                        countryName = entry.cName;
                        break;
                    }
                }
            }
        }
    }

    // High Level Fallback: 依然没有匹配出，但含有“北美”字样，则兜底为美国
    if (!countryInfo && (lowerPrefix.includes('北美') || lowerName.includes('北美'))) {
        countryInfo = countryCurrencyMap['美国'];
        countryName = '美国';
    }

    // Step 4: 抹除站点前缀中可能遗留的括号国家代号（如 (DE), （DE） 等）以及两字母英文国家代号
    let siteName = prefix;
    
    // 抹除各种格式的括号国家代号，如 "雅甄 (DE)" -> "雅甄"
    siteName = siteName.replace(/[（\(](?:DE|US|CA|MX|UK|GB|FR|IT|ES|NL|BE|AT|GR|IE|AU|JP|SE|PL|TR|SA|AE|IN|SG|HK|BRL|BR|TH|DK|PH|NZ|CH|MY|RU|HU|IL|VN|TW|CZ)[）\)]/gi, '').trim();

    const englishCodes = ['US', 'CA', 'MX', 'UK', 'GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'GR', 'IE', 'AU', 'JP', 'SE', 'PL', 'TR', 'SA', 'AE', 'IN', 'SG', 'HK', 'BR', 'TH', 'DK', 'PH', 'NZ', 'CH', 'MY', 'RU', 'HU', 'IL', 'VN', 'TW', 'CZ'];
    const stripRegex = new RegExp(`(?:[\\u4e00-\\u9fa5]+|\\b)(${englishCodes.join('|')})$`, 'i');
    const stripMatch = siteName.match(stripRegex);
    if (stripMatch) {
        const codeToStrip = stripMatch[1];
        const idx = siteName.lastIndexOf(codeToStrip);
        if (idx !== -1) {
            siteName = siteName.substring(0, idx).trim();
        }
    }

    // 抹除任何非括号的独立二位国家代码（例如 -DE3月、FR3月等，去掉代号和可能存在的月份后缀）
    if (countryInfo) {
        // 根据 countryInfo.name 反查 2位国家 ISO 代码，以确保对于 EUR 国家能得到正确的 DE/FR/ES 等代号
        let isoCode = null;
        for (const [code, info] of Object.entries(countryCodeMap)) {
            if (info.name === countryInfo.name) {
                isoCode = code.toUpperCase();
                break;
            }
        }
        if (!isoCode) {
            isoCode = countryInfo.code === 'USD' ? 'US' : (countryInfo.code === 'GBP' ? 'UK' : countryInfo.code);
        }
        
        const currencyCode = countryInfo.code ? countryInfo.code.toUpperCase() : null;
        const codesToStrip = [isoCode];
        if (currencyCode && currencyCode !== isoCode) {
            codesToStrip.push(currencyCode);
        }

        for (const code of codesToStrip) {
            // 使用 lookbehind (?<![a-zA-Z]) 和 lookahead (?![a-zA-Z]) 代替 \b，因为数字（如 3月）在 \b 中会被视为单词字符
            const nonBracketStrip = new RegExp(`[-_\\s]?(?<![a-zA-Z])${code}(?![a-zA-Z])(?:\\d{1,2}月)?`, 'i');
            siteName = siteName.replace(nonBracketStrip, '').trim();
        }
    }

    // 兜底站点名
    if (!siteName) {
        const brandMatch = nameWithoutExt.match(/^([\u4e00-\u9fa5]+)/);
        siteName = brandMatch ? brandMatch[1] : nameWithoutExt.split(/[\s(\-]/)[0];
    }

    // 清理尾部月份和无用标点
    siteName = siteName.replace(/\d{1,2}月\s*$/, '').trim();
    siteName = siteName.replace(/[-_\s(（]+$/, '').trim();

    // 智能追加国家后缀（如果文件名中有明确识别到国家，且站点名中还不包含任何国家地名时，例如 雅甄 (DE) -> 雅甄德国）
    if (countryInfo && countryInfo.name) {
        const regionKeywords = ['美国', '加拿大', '墨西哥', '英国', '德国', '法国', '意大利', '西班牙', '荷兰', '比利时', '奥地利', '希腊', '爱尔兰', '澳大利亚', '澳洲', '日本', '瑞典', '波兰', '土耳其', '沙特', '阿联酋', '印度', '新加坡', '香港', '巴西', '泰国', '丹麦', '菲律宾', '新西兰', '瑞士', '马来西亚', '俄罗斯', '匈牙利', '以色列', '越南', '台湾', '捷克', '北美', '欧洲', '南美'];
        let hasRegion = false;
        for (const kw of regionKeywords) {
            if (siteName.includes(kw)) {
                hasRegion = true;
                break;
            }
        }
        if (!hasRegion) {
            siteName = `${siteName}${countryInfo.name}`;
        }
    }

    return { siteName, countryInfo, brandPrefix: siteName };
}

/**
 * 从 PDF 纯文本中本地解析结算币种（作为 AI 提取失败或未配置时的强大兜底）
 * @param {string} text - PDF 纯文本
 * @returns {string|null} - 结算币种三字码（如 USD, EUR, PLN, GBP 等）
 */
function extractCurrencyFromText(text) {
    if (!text) return null;

    // 智能本地翻译与提取：如果包含瑞典文特定的克朗声明，例如 "Alla belopp i kr" (或变体)，先将其在本地翻译并直接返回 SEK
    if (/Alla belopp i kr/i.test(text) || /belopp i kr/i.test(text)) {
        console.log("[Local Translator] 识别到瑞典克朗本地财务声明，强力翻译并直接匹配为 SEK");
        return "SEK";
    }

    // 模式 1: 扫描 "amounts in USD" 等标明币种行
    const amountMatch = text.match(/amounts?\s+in\s+([A-Z]{3})\b/i);
    if (amountMatch) {
        return amountMatch[1].toUpperCase();
    }

    // 模式 2: 从日期和时区中反向推导国家与结算币种
    const timezoneMatch = text.match(/Account activity from[\s\S]*?\b(PST|PDT|EST|EDT|GMT|BST|CET|CEST|JST|AEST|AEDT)\b/i);
    if (timezoneMatch) {
        const tz = timezoneMatch[1].toUpperCase();
        if (tz === 'PST' || tz === 'PDT' || tz === 'EST' || tz === 'EDT') return 'USD';
        if (tz === 'GMT' || tz === 'BST') return 'GBP';
        if (tz === 'CET' || tz === 'CEST') return 'EUR';
        if (tz === 'JST') return 'JPY';
        if (tz === 'AEST' || tz === 'AEDT') return 'AUD';
    }

    // 模式 3: 根据高特异性的币种词汇扫描
    if (text.includes('USD') || text.includes('U.S. Dollar')) return 'USD';
    if (text.includes('CAD') || text.includes('Canadian Dollar')) return 'CAD';
    if (text.includes('GBP') || text.includes('Great Britain Pound') || text.includes('Pound sterling')) return 'GBP';
    if (text.includes('EUR') || text.includes('Euro')) return 'EUR';
    if (text.includes('PLN') || text.includes('Polish Zloty') || text.includes('polski złoty')) return 'PLN';
    if (text.includes('MXN') || text.includes('Mexican Peso')) return 'MXN';
    if (text.includes('JPY') || text.includes('Japanese Yen')) return 'JPY';
    if (text.includes('AUD') || text.includes('Australian Dollar')) return 'AUD';
    if (text.includes('SEK') || text.includes('Swedish Krona') || text.includes('svenska kronor') || text.includes('Krona')) return 'SEK';

    return null;
}

// 辅助函数：从文本中正则提取数据
function extractDataFromText(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    const dateRegex = /Account activity from\s+([^至到\n]+)\s+(?:to|至|到)\s+([^至到\n]+)/i;
    const dateMatch = text.match(dateRegex);
    const dateRange = dateMatch ? `${dateMatch[1]} to ${dateMatch[2]}` : '';

    const findAmountAfterLabel = (label, searchLimit = 8) => {
        const index = lines.findIndex(l => l.toLowerCase().includes(label.toLowerCase()));
        if (index === -1) return 0;
        for (let i = index + 1; i < Math.min(index + searchLimit, lines.length); i++) {
            const cleanLine = lines[i].replace(/,/g, '');
            if (/^-?[\d,]+(\.\d{2})?$/.test(cleanLine) || /^-?\$?[\d,]+(\.\d{2})?$/.test(cleanLine)) {
                return parseFloat(cleanLine.replace(/\$/g, '')) || 0;
            }
        }
        const lineMatch = lines[index].match(/-?[\d,]+(\.\d{2})?/);
        if (lineMatch) return parseFloat(lineMatch[0].replace(/,/g, '')) || 0;
        return 0;
    };

    const income = findAmountAfterLabel("Income") || findAmountAfterLabel("収入") || findAmountAfterLabel("売上");
    const expenses = findAmountAfterLabel("Expenses") || findAmountAfterLabel("支出") || findAmountAfterLabel("経費");
    const adsCost = findAmountAfterLabel("Cost of Advertising") || findAmountAfterLabel("広告費用") || findAmountAfterLabel("広告费");
    const taxCollected = findAmountAfterLabel("Product, delivery and gift wrap taxes collected")
        || findAmountAfterLabel("商品、配送、ギフト包装に対して税金が徴収されました")
        || findAmountAfterLabel("税金が徴収されました");
    const taxRefunded = findAmountAfterLabel("Product, delivery and gift wrap taxes refunded")
        || findAmountAfterLabel("商品、配送、ギフト包装に対して税金還付されました")
        || findAmountAfterLabel("税金還付されました");
    const adsRefund = findAmountAfterLabel("Refund for Advertiser")
        || findAmountAfterLabel("広告費の返金")
        || findAmountAfterLabel("Gutschrift für Inserenten")
        || findAmountAfterLabel("Rimborso per inserzionista")
        || findAmountAfterLabel("Reembolso para el promotor")
        || findAmountAfterLabel("Reembolso para anunciante")
        || findAmountAfterLabel("Remboursement pour le publicitaire");

    return { dateRange, income, expenses, adsCost, taxCollected, taxRefunded, adsRefund };
}

// 存储处理中的任务状态
const jobs = new Map();

// 1. 上传接口
app.post('/api/upload', upload.array('pdfs'), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, error: '未选择文件' });
        }
        const jobId = Date.now().toString();
        const mapping = JSON.parse(req.body.companyMapping || '{}');
        jobs.set(jobId, { files: req.files, mapping: mapping, status: 'pending', progress: 0, logs: [], resultUrl: null });
        res.json({ success: true, jobId });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. SSE 进度接口
app.get('/api/process-progress/:jobId', async (req, res) => {
    const jobId = req.params.jobId;
    const job = jobs.get(jobId);
    if (!job) return res.status(404).end();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendProgress = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
        job.status = 'processing';
        const processedData = [];
        const resultsLog = [];

        // 加载汇率配置
        let monthlyRates = {};
        let latestRates = {};
        if (fs.existsSync(MONTHLY_RATES_FILE)) monthlyRates = JSON.parse(fs.readFileSync(MONTHLY_RATES_FILE, 'utf-8'));
        if (fs.existsSync(RATES_FILE)) latestRates = JSON.parse(fs.readFileSync(RATES_FILE)).rates || {};

        for (let i = 0; i < job.files.length; i++) {
            const pdf = job.files[i];
            let originalName = pdf.originalname;
            try {
                const decodedBinary = Buffer.from(pdf.originalname, 'binary').toString('utf8');
                const decodedLatin1 = Buffer.from(pdf.originalname, 'latin1').toString('utf8');
                if (/[原-龥]/.test(decodedBinary)) originalName = decodedBinary;
                else if (/[原-龥]/.test(decodedLatin1)) originalName = decodedLatin1;
            } catch (e) { }

            sendProgress({ status: 'processing_file', file: originalName, index: i + 1, total: job.files.length, progress: Math.round((i / job.files.length) * 100) });

            let detectedMonth = '1';
            try {
                const { text: rawText, layoutRows, hasLabelLoss } = await parsePdfLocally(pdf.path);
                const textResult = rawText.split('\n').map(line => line.trim()).filter(line => line.length > 0).join('\n');

                let extracted;
                if (hasLabelLoss) {
                    console.log(`[Layout Engine] 检测到 PDF 字体编码异常 (Label Loss)，强力启用本地物理坐标还原解析...`);
                    extracted = extractDataByLayout(layoutRows);
                    const localExt = extractDataFromText(textResult);
                    extracted.dateRange = localExt.dateRange;
                    extracted.currency = 'JPY'; // 字体丢失通常发生在泰扬日本 PDF，兜底为 JPY
                } else {
                    extracted = await extractDataWithDeepSeek(textResult);
                    const isExtractedEmpty = !extracted || (extracted.income === 0 && extracted.expenses === 0 && extracted.adsCost === 0 && extracted.taxCollected === 0 && extracted.taxRefunded === 0);
                    if (isExtractedEmpty) extracted = extractDataFromText(textResult);
                }

                if (extracted && extracted.dateRange) detectedMonth = getMonthFromRange(extracted.dateRange);
                
                // 确定年份和完整的年月格式 (例如 2026-04)
                let detectedYear = new Date().getFullYear().toString();
                if (extracted && extracted.dateRange) {
                    const yearMatch = extracted.dateRange.match(/\d{4}/);
                    if (yearMatch) detectedYear = yearMatch[0];
                }
                const formattedMonth = detectedMonth.toString().padStart(2, '0');
                const detectedYearMonth = `${detectedYear}-${formattedMonth}`;

                // 从文件名智能解析站点、国家、结算币种（降级备用）
                const { siteName, countryInfo, brandPrefix } = parseFileNameInfo(originalName);

                // 双重正文提取：大模型提取 or 本地正则/时区提取
                let finalCurrencyCode = '';
                if (extracted && extracted.currency) {
                    finalCurrencyCode = extracted.currency.toUpperCase();
                }
                if (!finalCurrencyCode) {
                    finalCurrencyCode = extractCurrencyFromText(textResult);
                }

                // 核心决策树：文件名提取国别优先 (非空时绝对信任并映射其本币) vs 正文（PDF）解析结果兜底
                let finalCountryInfo = null;

                // 1. 以文件名提取的国家为主进行映射，若文件名明确识别出国家（countryInfo 非空），强力锁定主结论
                if (countryInfo) {
                    finalCountryInfo = countryInfo;
                    finalCurrencyCode = countryInfo.code; // 强制将结算币种指定为该国家的主权本位币
                    console.log(`[Decision Tree] 文件名国别优先锁定: 文件名指定为 "${countryInfo.name}"，直接映射主本位币 "${countryInfo.code}"`);
                } 
                // 2. 若文件名无法提取或为空，则采用从 PDF 正文中解析出来的结果进行兜底
                else if (finalCurrencyCode) {
                    if (finalCurrencyCode === 'EUR') {
                        // 欧元区兜底：无文件名地名时，正文 EUR 默认映射到最大欧元区实体德国
                        finalCountryInfo = countryCurrencyMap['德国'];
                    } else {
                        // 其它唯一映射币种直接查找
                        for (const info of Object.values(countryCurrencyMap)) {
                            if (info.code === finalCurrencyCode) {
                                finalCountryInfo = info;
                                break;
                            }
                        }
                    }
                    console.log(`[Decision Tree] 正文 PDF 解析兜底: 文件名无国家，根据正文币种 "${finalCurrencyCode}" 反推国家为 "${finalCountryInfo ? finalCountryInfo.name : '未知'}"`);
                }

                // 3. 极极底层兜底：若最终还是没有识别到
                if (!finalCountryInfo) {
                    finalCountryInfo = countryInfo;
                }

                // 终极双重保险：后置智能追加国家后缀
                // 如果通过正文最终识别/推导出了国家 finalCountryInfo，并且原 siteName 还不包含任何国家地名
                let finalSiteName = siteName;
                if (finalCountryInfo && finalCountryInfo.name) {
                    const regionKeywords = ['美国', '加拿大', '墨西哥', '英国', '德国', '法国', '意大利', '西班牙', '荷兰', '比利时', '奥地利', '希腊', '爱尔兰', '澳大利亚', '澳洲', '日本', '瑞典', '波兰', '土耳其', '沙特', '阿联酋', '印度', '新加坡', '香港', '巴西', '泰国', '丹麦', '菲律宾', '新西兰', '瑞士', '马来西亚', '俄罗斯', '匈牙利', '以色列', '越南', '台湾', '捷克', '北美', '欧洲', '南美'];
                    let hasRegion = false;
                    for (const kw of regionKeywords) {
                        if (finalSiteName.includes(kw)) {
                            hasRegion = true;
                            break;
                        }
                    }
                    if (!hasRegion) {
                        finalSiteName = `${finalSiteName}${finalCountryInfo.name}`;
                    }
                }

                console.log(`[Info] File: ${originalName} -> 原始站点: ${siteName}, 最终站点: ${finalSiteName}, 最终推导国家: ${finalCountryInfo ? finalCountryInfo.name : '未知'}, 最终结算币种: ${finalCountryInfo ? finalCountryInfo.code : '未匹配'}`);

                let conversionPrice = null;
                let settlementCode = '';

                if (finalCountryInfo) {
                    settlementCode = finalCountryInfo.code;
                    const currencyName = finalCountryInfo.currency;
                    
                    // 优先匹配月度历史汇率
                    const yearMonthKey = `${detectedYear}-${String(detectedMonth).padStart(2, '0')}`;
                    let conversionRateRaw = null;

                    if (monthlyRates[currencyName] && monthlyRates[currencyName][yearMonthKey] !== undefined) {
                        conversionRateRaw = monthlyRates[currencyName][yearMonthKey];
                        console.log(`[Rate Hub] Monthly: ${currencyName} ${yearMonthKey} = ${conversionRateRaw}`);
                    } else if (latestRates[currencyName]) {
                        conversionRateRaw = latestRates[currencyName];
                        console.log(`[Rate Hub] Latest Fallback: ${currencyName} = ${conversionRateRaw}`);
                    }

                    conversionPrice = conversionRateRaw ? (conversionRateRaw / 100) : null;
                } else {
                    console.log(`[Rate Hub] 文件未识别到国家，结算币种和汇率设为空值`);
                }

                let finalLegalName = '';
                for (const keyword of Object.keys(job.mapping)) {
                    if (brandPrefix.includes(keyword) || finalSiteName.includes(keyword) || keyword.includes(brandPrefix) || originalName.includes(keyword)) {
                        finalLegalName = job.mapping[keyword];
                        break;
                    }
                }

                processedData.push({
                    siteName: finalSiteName,
                    legalName: finalLegalName,
                    country: finalCountryInfo ? finalCountryInfo.name : '',
                    settlement: settlementCode,
                    month: detectedMonth, // 保存当前文件的专属解析月份
                    rate: conversionPrice || '',
                    income: extracted.income,
                    expenses: extracted.expenses,
                    tax: extracted.taxCollected,
                    taxRefund: extracted.taxRefunded,
                    ads: extracted.adsCost,
                    adsRefund: extracted.adsRefund || 0,
                    conversionPrice,
                    dateRange: extracted.dateRange
                });
                resultsLog.push({ file: originalName, status: 'success' });
            } catch (err) {
                resultsLog.push({ file: originalName, status: 'error', message: err.message });
            } finally {
                if (fs.existsSync(pdf.path)) fs.unlinkSync(pdf.path);
            }
        }

        sendProgress({ status: 'generating_excel', progress: 95 });
        
        // 收集所有唯一的解析月份，按数字升序并用逗号合并
        const uniqueMonths = Array.from(new Set(processedData.map(d => Number(d.month))))
            .sort((a, b) => a - b)
            .join(', ');
        const month = uniqueMonths || '1';

        const header = [
            '站点', '公司主体', '国家', '结算币种', '月份', '汇率',
            '销售额汇总（Income）', '费用（Expenses）', '税款', '税款退款', '广告费（Cost of Advertising）', '广告费退款（Refund for Advertiser）',
            '销售额汇总 (人民币)', '费用 (人民币)', '税款 (人民币)', '税款退款 (人民币)', '广告费 (人民币)', '广告费退款 (人民币)'
        ];

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('亚马逊汇总表', { views: [{ state: 'frozen', xSplit: 5, ySplit: 1 }] });
        const headerRow = sheet.addRow(header);
        headerRow.height = 72;
        headerRow.font = { name: '等线', size: 10, bold: true };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

        const borderStyle = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        const numFormat = '#,##0.00;[Red]-#,##0.00';

        processedData.forEach((d, idx) => {
            const rowNum = idx + 2;
            const row = sheet.addRow([
                d.siteName, d.legalName, d.country, d.settlement, `${d.month}月`, d.rate,
                d.income, d.expenses, d.tax, d.taxRefund, d.ads, d.adsRefund,
                { formula: `G${rowNum}*F${rowNum}` },
                { formula: `H${rowNum}*F${rowNum}` },
                { formula: `I${rowNum}*F${rowNum}` },
                { formula: `J${rowNum}*F${rowNum}` },
                { formula: `K${rowNum}*F${rowNum}` },
                { formula: `L${rowNum}*F${rowNum}` }
            ]);
            row.eachCell((cell, colNumber) => {
                cell.font = { name: colNumber >= 6 ? 'Tahoma' : '等线', size: 10 };
                cell.border = borderStyle;
                cell.alignment = { vertical: 'middle', horizontal: colNumber >= 6 ? 'right' : 'center' };
                if (colNumber >= 6) cell.numFmt = colNumber === 6 ? '0.0000' : numFormat;
            });
        });

        sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };
        sheet.columns.forEach((column, i) => {
            const colIndex = i + 1;
            if (colIndex >= 6) column.width = 11;
            else {
                let maxLen = 0;
                column.eachCell({ includeEmpty: true }, (cell) => {
                    let val = cell.value ? cell.value.toString() : '';
                    let len = 0;
                    for (let j = 0; j < val.length; j++) len += val.charCodeAt(j) > 255 ? 2.2 : 1.1;
                    if (len > maxLen) maxLen = len;
                });
                column.width = Math.max(12, maxLen + 4);
            }
        });

        const outputPath = path.join(UPLOADS_DIR, `亚马逊汇总表_${month}月.xlsx`);
        await workbook.xlsx.writeFile(outputPath);

        // 复制或保存一份到历史记录持久化文件夹
        const historyFilename = `亚马逊汇总表_${month}月_${Date.now()}.xlsx`;
        const persistentPath = path.join(HISTORY_DIR, historyFilename);
        await workbook.xlsx.writeFile(persistentPath);

        // 构建网页数据预览行
        const previewRows = processedData.map(d => {
            const calcRmb = (val) => (!val || val === 0 || !d.conversionPrice) ? 0 : Math.round((val * d.conversionPrice) * 100) / 100;
            return [
                d.siteName,
                d.legalName,
                d.country,
                d.settlement,
                `${d.month}月`,
                d.rate !== null && d.rate !== undefined && d.rate !== '' ? Number(d.rate) : '',
                d.income,
                d.expenses,
                d.tax,
                d.taxRefund,
                d.ads,
                d.adsRefund,
                calcRmb(d.income),
                calcRmb(d.expenses),
                calcRmb(d.tax),
                calcRmb(d.taxRefund),
                calcRmb(d.ads),
                calcRmb(d.adsRefund)
            ];
        });

        // 保存历史记录到 JSON 文件
        try {
            let historyList = [];
            if (fs.existsSync(HISTORY_FILE)) {
                historyList = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
            }
            const record = {
                id: Date.now().toString(),
                timestamp: new Date().toLocaleString('zh-CN', { hour12: false }),
                month: month,
                fileCount: job.files.length,
                files: job.files.map(f => {
                    let originalName = f.originalname;
                    try {
                        const decodedBinary = Buffer.from(f.originalname, 'binary').toString('utf8');
                        const decodedLatin1 = Buffer.from(f.originalname, 'latin1').toString('utf8');
                        if (/[一-龥]/.test(decodedBinary)) originalName = decodedBinary;
                        else if (/[一-龥]/.test(decodedLatin1)) originalName = decodedLatin1;
                    } catch (e) {}
                    return originalName;
                }),
                headers: header,
                previewRows: previewRows,
                mapping: job.mapping || {},
                downloadUrl: `/api/download?path=${encodeURIComponent(persistentPath)}&month=${encodeURIComponent(month)}`
            };
            historyList.unshift(record); // 最新记录在前
            if (historyList.length > 50) {
                const deletedRecords = historyList.slice(50);
                historyList = historyList.slice(0, 50);
                for (const r of deletedRecords) {
                    const match = r.downloadUrl.match(/path=([^&]+)/);
                    if (match) {
                        const pathToDelete = decodeURIComponent(match[1]);
                        if (fs.existsSync(pathToDelete)) fs.unlinkSync(pathToDelete);
                    }
                }
            }
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyList, null, 2), 'utf-8');
            console.log("[History] Hub saved analysis record successfully.");
        } catch (e) {
            console.error("Failed to save history in Hub:", e.message);
        }

        sendProgress({
            status: 'completed',
            progress: 100,
            downloadUrl: `/api/download?path=${encodeURIComponent(persistentPath)}&month=${encodeURIComponent(month)}`,
            log: resultsLog,
            headers: header,
            previewRows: previewRows,
            month: month
        });
        res.end();
    } catch (err) {
        sendProgress({ status: 'error', message: err.message });
        res.end();
    }
});

// 3. 客户端日志转发接口 (用于在终端显示前端报错)
app.post('/api/log', (req, res) => {
    const { type, message, time } = req.body;
    const colors = {
        'error': '\x1b[31m',   // Red
        'warning': '\x1b[33m', // Yellow
        'success': '\x1b[32m', // Green
        'info': '\x1b[36m'     // Cyan
    };
    const color = colors[type] || '\x1b[0m';
    const typeLabel = type ? type.toUpperCase() : 'LOG';
    
    console.log(`\x1b[90m[${time || new Date().toLocaleTimeString()}]\x1b[0m ${color}[${typeLabel}]\x1b[0m ${message}`);
    res.json({ success: true });
});

app.get('/api/download', (req, res) => {
    const filePath = req.query.path;
    const month = req.query.month || '月度';
    const customFilename = req.query.filename;

    if (fs.existsSync(filePath)) {
        let safeFilename = customFilename || `亚马逊汇总表-${month}月.xlsx`;
        if (!safeFilename.endsWith('.xlsx')) safeFilename += '.xlsx';

        const isHistory = filePath.includes('history');
        res.download(filePath, safeFilename, () => {
            if (!isHistory) {
                setTimeout(() => { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); }, 60000);
            }
        });
    } else {
        res.status(404).send('File not found');
    }
});

// ─── 大小周与打工人心情语录 API ──────────────────────────────────────────────────
const MOOD_FILE = path.join(__dirname, 'pdf-analyze', 'daily_mood.json');

// 本地打工人心情语录兜底库 (双休/单休 * 星期一至星期日)
const fallbackMoods = {
    '双休': {
        1: [
            "星期一，上班第一天！充满干劲（装的），新的一周继续搬砖！",
            "周一了，又是为了生活妥协的一天，打起精神搞钱！",
            "星期一：启动打工模式。只要我够努力，老板明年就能换新车！"
        ],
        2: [
            "周二啦，距离周末还有三天半，摸鱼大计正在有条不紊地进行。",
            "周二的打工人已经看淡生死，唯有奶茶能续命。",
            "周二了，工作堆积如山，但我选择先喝杯水冷静一下。"
        ],
        3: [
            "周三！星期三，撑过今天，这周就过了一半啦！加油！",
            "周三是星期三，打工人的分水岭。熬过今天，胜利就在前方！",
            "周三中午一过，周末的曙光就悄悄露出来了，坚持住！"
        ],
        4: [
            "周四了，疯狂星期四，肯德基v我50？哦不，今天只想早点下班。",
            "周四的眼神里已经没有了光，全是星期五放假的倒计时。",
            "周四，黎明前的黑暗，再坚持搬一天砖就是周五了！"
        ],
        5: [
            "周五啦！今天谁也别想让我加班，我的心已经飞去过周末了！",
            "星期五！即将放假！摸鱼的心情达到了巅峰，快乐起来了！",
            "周五下午的打工人：人还在工位，灵魂早已在家躺平。"
        ],
        6: [
            "周六啦！双休的第一天，睡到自然醒，感觉整个人又活过来了！",
            "周六大吉，不谈工作，只谈快乐，开启吃喝玩乐模式！"
        ],
        7: [
            "周日啦，快乐正在余额不足，焦虑感逐渐袭来……明天又是周一了。",
            "周日晚上的打工人：不想面对明天的闹钟，试图用意念拉长今天。"
        ]
    },
    '单休': {
        1: [
            "星期一，本周是苦逼的单休周，要上六天班，呼吸都是痛的……",
            "周一启动，单休周的第一天，我的精神状态已经开始超前消费了。"
        ],
        2: [
            "周二，还要上五天班……单休人的痛苦，谁懂啊？",
            "周二了，想想这周六还要搬砖，摸鱼的手握得更紧了。"
        ],
        3: [
            "周三，单休人的折返点。虽然过了今天是一半，但还有三天要熬！",
            "周三了，单休的痛让我清醒，今天必须多摸一会儿鱼来补偿自己。"
        ],
        4: [
            "周四，如果是双休明天就能解脱，但单休人明天还要继续冲锋！",
            "周四了，单休的阴霾笼罩着我，但还是要坚强地搬砖。"
        ],
        5: [
            "周五了，别人都在欢呼即将放假，而单休的我明天还要继续搬砖……",
            "星期五，如果是双休就放假了，但我们明天还要上班，苦涩中带点坚强。"
        ],
        6: [
            "周六，单休人还在苦逼搬砖，周六上班的痛，谁懂啊！",
            "今天是周六，但还要上班！我的灵魂已经放假了，只剩肉体在工位。"
        ],
        7: [
            "周日，单休人唯一的一天假！必须报复性躺平，谁也别叫我起床！",
            "周日放假一天，快乐太短暂了，明天又要周一，单休人太难了。"
        ]
    }
};

/**
 * 获取日期所处周的周一 00:00:00 (本地时间)
 */
function getMonday(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday;
}

/**
 * 计算单双休状态
 */
function getWeekStatus(date) {
    const baseMonday = new Date('2026-05-25');
    baseMonday.setHours(0, 0, 0, 0);
    
    const targetMonday = getMonday(date);
    const diffMs = targetMonday.getTime() - baseMonday.getTime();
    const diffWeeks = Math.round(diffMs / (7 * 24 * 3600 * 1000));
    
    return Math.abs(diffWeeks) % 2 === 0 ? '双休' : '单休';
}

/**
 * 调用 DeepSeek 生成打工人心情语录
 */
async function generateMoodWithAI(dateStr, dayOfWeekStr, weekStatus) {
    if (!DEEPSEEK_API_KEY) {
        throw new Error("DEEPSEEK_API_KEY is not configured");
    }

    const systemPrompt = `你是一个幽默、有超强“活人感”的打工人。请根据今天的日期、星期几和本周的大小周放假状态，生成一句极具共鸣的打工人上班心情语录。

### 规则：
1. 语言要生动、接地气，符合现代网络打工人风格，带有一点幽默、自嘲或对周末的渴望，切忌官方、空洞、陈词滥调。
2. 必须紧密贴合今天的星期几和单双休状态：
   - 如果是“双休”周，周五应当极度兴奋，周六周日开心放松，周一到周四逐渐期盼周末。
   - 如果是“单休”周，周五应当吐槽“明天还要苦逼上班”，周六应该吐槽“周六还在搬砖”，周日放假一天要表达“时间短暂、报复性休息”。
3. 语录中必须自然地提及今天的星期几或大小周状态（例如：“又是星期一...”、“本周单休，周六还要上班的痛...”、“今天是周五！即将放假...”）。
4. 长度控制在 10 到 35 字之间，非常简短有力。
5. **绝对不要** 返回任何解释、Markdown标记、前缀或引号，只需直接返回这一句语录。`;

    const userPrompt = `今天是 ${dateStr}，${dayOfWeekStr}，本周放假状态为：【${weekStatus}】。请为我写一句今天的心情语录。`;

    let model = "deepseek-v4-flash";
    try {
        console.log(`[Mood AI] Attempting to generate mood with model: ${model}`);
        const response = await axios.post('https://api.deepseek.com/chat/completions', {
            model: model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            thinking: { type: "disabled" },
            temperature: 0.85,
            max_tokens: 100
        }, {
            headers: {
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });
        return response.data.choices[0].message.content.trim().replace(/^["'“‘]|["'”’]$/g, '');
    } catch (error) {
        console.warn(`[Mood AI] Model ${model} failed, falling back to deepseek-v4-pro. Error:`, error.message);
        
        model = "deepseek-v4-pro";
        try {
            const response = await axios.post('https://api.deepseek.com/chat/completions', {
                model: model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                thinking: { type: "disabled" },
                temperature: 0.85,
                max_tokens: 100
            }, {
                headers: {
                    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 12000
            });
            return response.data.choices[0].message.content.trim().replace(/^["'“‘]|["'”’]$/g, '');
        } catch (err2) {
            console.error(`[Mood AI] Model ${model} failed too. Error:`, err2.message);
            throw err2;
        }
    }
}

app.get('/api/worker-mood', async (req, res) => {
    try {
        const dateParam = req.query.date;
        const now = dateParam ? new Date(dateParam) : new Date();
        
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        
        const dayOfWeekMap = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
        const dayOfWeekStr = dayOfWeekMap[now.getDay()];
        const dayOfWeekNum = now.getDay() === 0 ? 7 : now.getDay();
        
        const weekStatus = getWeekStatus(now);
        
        let cachedData = null;
        if (fs.existsSync(MOOD_FILE)) {
            try {
                cachedData = JSON.parse(fs.readFileSync(MOOD_FILE, 'utf-8'));
            } catch (e) {}
        }
        
        if (cachedData && cachedData.date === dateStr && cachedData.weekStatus === weekStatus) {
            return res.json({
                success: true,
                date: dateStr,
                dayOfWeek: dayOfWeekStr,
                weekStatus: weekStatus,
                mood: cachedData.mood,
                source: 'cache'
            });
        }
        
        let mood = "";
        let source = "ai";
        try {
            mood = await generateMoodWithAI(dateStr, dayOfWeekStr, weekStatus);
        } catch (err) {
            console.warn("[Mood API] DeepSeek generation failed. Falling back to local library. Error:", err.message);
            const moodsList = fallbackMoods[weekStatus][dayOfWeekNum] || fallbackMoods['双休'][dayOfWeekNum];
            mood = moodsList[Math.floor(Math.random() * moodsList.length)];
            source = "local_fallback";
        }
        
        const newCache = {
            date: dateStr,
            weekStatus: weekStatus,
            mood: mood
        };
        fs.writeFileSync(MOOD_FILE, JSON.stringify(newCache, null, 2), 'utf-8');
        
        res.json({
            success: true,
            date: dateStr,
            dayOfWeek: dayOfWeekStr,
            weekStatus: weekStatus,
            mood: mood,
            source: source
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── 历史分析记录 API ──────────────────────────────────────────────────────────
function migrateHistoryRecord(item) {
    if (item.headers && item.headers[0] === '领星店铺名称') {
        console.log(`[Migration] Migrating old format history record: ${item.id}`);
        const newHeaders = [
            '站点', '公司主体', '国家', '结算币种', '月份', '汇率',
            '销售额汇总（Income）', '费用（Expenses）', '税款', '税款退款', '广告费（Cost of Advertising）', '广告费退款（Refund for Advertiser）',
            '销售额汇总 (人民币)', '费用 (人民币)', '税款 (人民币)', '税款退款 (人民币)', '广告费 (人民币)', '广告费退款 (人民币)'
        ];

        const newPreviewRows = item.previewRows.map(row => [
            row[1], // 站点
            row[2], // 公司主体
            row[3], // 国家
            row[4], // 结算币种
            `${item.month}月`, // 月份
            row[5], // 汇率
            row[6], row[7], row[8], row[9], row[10], row[11],
            row[12], row[13], row[14], row[15], row[16], row[17]
        ]);

        item.headers = newHeaders;
        item.previewRows = newPreviewRows;
    }
    return item;
}

// 获取历史记录 (集成动态格式迁移)
app.get('/api/history', (req, res) => {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            let data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
            let migrated = false;
            data = data.map(item => {
                if (item.headers && item.headers[0] === '领星店铺名称') {
                    migrated = true;
                    return migrateHistoryRecord(item);
                }
                return item;
            });
            if (migrated) {
                fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), 'utf-8');
                console.log("[Migration] HISTORY_FILE legacy records auto-migrated and synchronized.");
            }
            res.json({ success: true, data });
        } else {
            res.json({ success: true, data: [] });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 清空历史记录
app.delete('/api/history', (req, res) => {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            fs.writeFileSync(HISTORY_FILE, '[]', 'utf-8');
        }
        if (fs.existsSync(HISTORY_DIR)) {
            const files = fs.readdirSync(HISTORY_DIR);
            for (const file of files) {
                fs.unlinkSync(path.join(HISTORY_DIR, file));
            }
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 删除单个历史记录
app.delete('/api/history/:id', (req, res) => {
    try {
        const idToDelete = req.params.id;
        if (!fs.existsSync(HISTORY_FILE)) {
            return res.json({ success: true });
        }
        
        let historyList = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
        const index = historyList.findIndex(r => r.id === idToDelete);
        
        if (index !== -1) {
            const record = historyList[index];
            // 自动删除对应的 Excel 落地文件
            const match = record.downloadUrl.match(/path=([^&]+)/);
            if (match) {
                const pathToDelete = decodeURIComponent(match[1]);
                if (fs.existsSync(pathToDelete)) {
                    fs.unlinkSync(pathToDelete);
                }
            }
            
            historyList.splice(index, 1);
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyList, null, 2), 'utf-8');
            res.json({ success: true, message: '记录已成功删除' });
        } else {
            res.status(404).json({ success: false, error: '未找到指定历史记录' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 重新分析历史记录中的部分文件接口
app.post('/api/history/:id/re-analyze', upload.array('pdfs'), async (req, res) => {
    try {
        const historyId = req.params.id;
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, error: '未选择文件' });
        }

        if (!fs.existsSync(HISTORY_FILE)) {
            return res.status(404).json({ success: false, error: '历史记录文件不存在' });
        }

        let historyList = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
        const recordIndex = historyList.findIndex(r => r.id === historyId);
        if (recordIndex === -1) {
            return res.status(404).json({ success: false, error: '未找到指定的历史任务' });
        }

        const record = historyList[recordIndex];
        const logs = [];

        // 加载汇率配置
        let monthlyRates = {};
        let latestRates = {};
        if (fs.existsSync(MONTHLY_RATES_FILE)) monthlyRates = JSON.parse(fs.readFileSync(MONTHLY_RATES_FILE, 'utf-8'));
        if (fs.existsSync(RATES_FILE)) latestRates = JSON.parse(fs.readFileSync(RATES_FILE)).rates || {};

        // 我们需要把上传的文件名进行中文乱码转换，并与该历史任务下的 files 列表进行匹配
        for (const file of req.files) {
            let originalName = file.originalname;
            try {
                const decodedBinary = Buffer.from(file.originalname, 'binary').toString('utf8');
                const decodedLatin1 = Buffer.from(file.originalname, 'latin1').toString('utf8');
                if (/[一-龥]/.test(decodedBinary)) originalName = decodedBinary;
                else if (/[一-龥]/.test(decodedLatin1)) originalName = decodedLatin1;
            } catch (e) { }

            // 寻找该文件名在 files 列表中的索引
            const fileIndex = record.files.findIndex(f => f === originalName);
            if (fileIndex === -1) {
                console.log(`[Re-analyze] 上传的文件 ${originalName} 不在历史任务的原始文件列表中，跳过`);
                if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
                continue;
            }

            console.log(`[Re-analyze] 匹配到历史文件，开始重解析: ${originalName} (索引: ${fileIndex})`);

            try {
                const { text: rawText, layoutRows, hasLabelLoss } = await parsePdfLocally(file.path);
                const textResult = rawText.split('\n').map(line => line.trim()).filter(line => line.length > 0).join('\n');

                let extracted;
                if (hasLabelLoss) {
                    console.log(`[Layout Engine] 检测到 PDF 字体编码异常 (Label Loss)，强力启用本地物理坐标还原解析...`);
                    extracted = extractDataByLayout(layoutRows);
                    const localExt = extractDataFromText(textResult);
                    extracted.dateRange = localExt.dateRange;
                    extracted.currency = 'JPY'; // 字体丢失通常发生在泰扬日本 PDF，兜底为 JPY
                } else {
                    extracted = await extractDataWithDeepSeek(textResult);
                    const isExtractedEmpty = !extracted || (extracted.income === 0 && extracted.expenses === 0 && extracted.adsCost === 0 && extracted.taxCollected === 0 && extracted.taxRefunded === 0);
                    if (isExtractedEmpty) extracted = extractDataFromText(textResult);
                }

                let detectedMonth = record.month; 
                let detectedYear = '2026';
                if (extracted && extracted.dateRange) {
                    detectedMonth = getMonthFromRange(extracted.dateRange);
                    const yearMatch = extracted.dateRange.match(/\d{4}/);
                    if (yearMatch) detectedYear = yearMatch[0];
                }

                // 文件名提取站点国别
                const { siteName, countryInfo, brandPrefix } = parseFileNameInfo(originalName);

                // 提取结算币种
                let finalCurrencyCode = '';
                if (extracted && extracted.currency) {
                    finalCurrencyCode = extracted.currency.toUpperCase();
                }
                if (!finalCurrencyCode) {
                    finalCurrencyCode = extractCurrencyFromText(textResult);
                }

                // 核心决策树：文件名提取优先 vs 正文提取兜底
                let finalCountryInfo = null;
                if (countryInfo) {
                    finalCountryInfo = countryInfo;
                    finalCurrencyCode = countryInfo.code;
                } else if (finalCurrencyCode) {
                    if (finalCurrencyCode === 'EUR') {
                        finalCountryInfo = countryCurrencyMap['德国'];
                    } else {
                        for (const info of Object.values(countryCurrencyMap)) {
                            if (info.code === finalCurrencyCode) {
                                finalCountryInfo = info;
                                break;
                            }
                        }
                    }
                }

                if (!finalCountryInfo) {
                    finalCountryInfo = countryInfo;
                }

                // 终极双重保险：后置智能追加国家后缀
                let finalSiteName = siteName;
                if (finalCountryInfo && finalCountryInfo.name) {
                    const regionKeywords = ['美国', '加拿大', '墨西哥', '英国', '德国', '法国', '意大利', '西班牙', '荷兰', '比利时', '奥地利', '希腊', '爱尔兰', '澳大利亚', '澳洲', '日本', '瑞典', '波兰', '土耳其', '沙特', '阿联酋', '印度', '新加坡', '香港', '巴西', '泰国', '丹麦', '菲律宾', '新西兰', '瑞士', '马来西亚', '俄罗斯', '匈牙利', '以色列', '越南', '台湾', '捷克', '北美', '欧洲', '南美'];
                    let hasRegion = false;
                    for (const kw of regionKeywords) {
                        if (finalSiteName.includes(kw)) {
                            hasRegion = true;
                            break;
                        }
                    }
                    if (!hasRegion) {
                        finalSiteName = `${finalSiteName}${finalCountryInfo.name}`;
                    }
                }

                let conversionPrice = null;
                let settlementCode = '';
                if (finalCountryInfo) {
                    settlementCode = finalCountryInfo.code;
                    const currencyName = finalCountryInfo.currency;
                    const yearMonthKey = `${detectedYear}-${String(detectedMonth).padStart(2, '0')}`;
                    let conversionRateRaw = null;

                    if (monthlyRates[currencyName] && monthlyRates[currencyName][yearMonthKey] !== undefined) {
                        conversionRateRaw = monthlyRates[currencyName][yearMonthKey];
                    } else if (latestRates[currencyName]) {
                        conversionRateRaw = latestRates[currencyName];
                    }
                    conversionPrice = conversionRateRaw ? (conversionRateRaw / 100) : null;
                }

                let finalLegalName = '';
                let activeMappings = {};
                if (fs.existsSync(MAPPINGS_FILE)) {
                    try {
                        activeMappings = JSON.parse(fs.readFileSync(MAPPINGS_FILE, 'utf-8'));
                    } catch (e) {}
                }
                const combinedMapping = Object.assign({}, record.mapping || {}, activeMappings);
                for (const keyword of Object.keys(combinedMapping)) {
                    if (brandPrefix.includes(keyword) || finalSiteName.includes(keyword) || keyword.includes(brandPrefix) || originalName.includes(keyword)) {
                        finalLegalName = combinedMapping[keyword];
                        break;
                    }
                }

                // 重新计算这一行的人民币折算值，用于预览行
                const calcRmb = (val) => (!val || val === 0 || !conversionPrice) ? 0 : Math.round((val * conversionPrice) * 100) / 100;
                
                const updatedRow = [
                    finalSiteName,
                    finalLegalName,
                    finalCountryInfo ? finalCountryInfo.name : '',
                    settlementCode,
                    `${detectedMonth}月`, // 月份列
                    conversionPrice !== null && conversionPrice !== undefined ? Number(conversionPrice) : '',
                    extracted.income,
                    extracted.expenses,
                    extracted.taxCollected,
                    extracted.taxRefunded,
                    extracted.adsCost,
                    extracted.adsRefund || 0,
                    calcRmb(extracted.income),
                    calcRmb(extracted.expenses),
                    calcRmb(extracted.taxCollected),
                    calcRmb(extracted.taxRefunded),
                    calcRmb(extracted.adsCost),
                    calcRmb(extracted.adsRefund || 0)
                ];

                // 替换历史记录预览数据中的对应行
                record.previewRows[fileIndex] = updatedRow;
                logs.push({ file: originalName, status: 'success' });
            } catch (err) {
                console.error(`Failed to re-analyze ${originalName}:`, err);
                logs.push({ file: originalName, status: 'error', error: err.message });
            } finally {
                if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
            }
        }

        // 重新计算并排序该历史记录中包含的所有唯一月份，实现多月份合并与实时更新
        const uniqueMonths = Array.from(new Set(record.previewRows.map(row => parseInt(row[4]))))
            .sort((a, b) => a - b)
            .join(', ');
        record.month = uniqueMonths || '1';

        // 重新生成该历史任务的物理 Excel 文件！
        const persistentPathMatch = record.downloadUrl.match(/path=([^&]+)/);
        if (persistentPathMatch) {
            const persistentPath = decodeURIComponent(persistentPathMatch[1]);
            // 同时更新下载 URL 中的月份属性，保证下载时文件名月份的正确性
            record.downloadUrl = `/api/download?path=${encodeURIComponent(persistentPath)}&month=${encodeURIComponent(record.month)}`;
            if (fs.existsSync(persistentPath)) {
                // 覆盖重新写入 Excel
                const workbook = new ExcelJS.Workbook();
                const sheet = workbook.addWorksheet('亚马逊汇总表', { views: [{ state: 'frozen', xSplit: 5, ySplit: 1 }] });
                const month = record.month;
                const headerRow = sheet.addRow(record.headers);
                headerRow.height = 72;
                headerRow.font = { name: '等线', size: 10, bold: true };
                headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

                const borderStyle = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
                const numFormat = '#,##0.00;[Red]-#,##0.00';

                record.previewRows.forEach((rowCells, idx) => {
                    const rowNum = idx + 2;
                    const excelRow = sheet.addRow([
                        rowCells[0], rowCells[1], rowCells[2], rowCells[3], rowCells[4], rowCells[5],
                        rowCells[6], rowCells[7], rowCells[8], rowCells[9], rowCells[10], rowCells[11],
                        { formula: `G${rowNum}*F${rowNum}` },
                        { formula: `H${rowNum}*F${rowNum}` },
                        { formula: `I${rowNum}*F${rowNum}` },
                        { formula: `J${rowNum}*F${rowNum}` },
                        { formula: `K${rowNum}*F${rowNum}` },
                        { formula: `L${rowNum}*F${rowNum}` }
                    ]);

                    excelRow.eachCell((cell, colNumber) => {
                        cell.font = { name: colNumber >= 6 ? 'Tahoma' : '等线', size: 10 };
                        cell.border = borderStyle;
                        cell.alignment = { vertical: 'middle', horizontal: colNumber >= 6 ? 'right' : 'center' };
                        if (colNumber >= 6) cell.numFmt = colNumber === 6 ? '0.0000' : numFormat;
                    });
                });

                sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: record.headers.length } };
                sheet.columns.forEach((column, i) => {
                    const colIndex = i + 1;
                    if (colIndex >= 6) column.width = 11;
                    else {
                        let maxLen = 0;
                        column.eachCell({ includeEmpty: true }, (cell) => {
                            let val = cell.value ? cell.value.toString() : '';
                            let len = 0;
                            for (let j = 0; j < val.length; j++) len += val.charCodeAt(j) > 255 ? 2.2 : 1.1;
                            if (len > maxLen) maxLen = len;
                        });
                        column.width = Math.max(12, maxLen + 4);
                    }
                });

                await workbook.xlsx.writeFile(persistentPath);
                console.log(`[Re-analyze] Excel 物理文件成功覆盖更新: ${persistentPath}`);
            }
        }

        // 保存更新后的历史记录 JSON 文件
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyList, null, 2), 'utf-8');

        res.json({
            success: true,
            previewRows: record.previewRows,
            log: logs
        });
    } catch (err) {
        console.error('Failed to re-analyze history record:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── 公司主体映射 API (同步到 Tool Hub) ──────────────────────────────────────────
app.get('/api/mappings', (req, res) => {
    try {
        if (fs.existsSync(MAPPINGS_FILE)) {
            const data = JSON.parse(fs.readFileSync(MAPPINGS_FILE, 'utf-8'));
            res.json({ success: true, data });
        } else {
            res.json({ success: true, data: {} });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/mappings', (req, res) => {
    try {
        const mappings = req.body.mappings || {};
        fs.writeFileSync(MAPPINGS_FILE, JSON.stringify(mappings, null, 2), 'utf-8');
        res.json({ success: true, data: mappings });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── 月度汇率 API (同步到 Tool Hub) ──────────────────────────────────────────────
app.get('/api/rates/monthly', (req, res) => {
    try {
        if (!fs.existsSync(MONTHLY_RATES_FILE)) {
            return res.json({ success: true, data: {}, currencies: [] });
        }
        const allRates = JSON.parse(fs.readFileSync(MONTHLY_RATES_FILE, 'utf-8'));
        const currencies = Object.keys(allRates);
        const month = req.query.month;
        if (month) {
            const result = {};
            for (const [currency, monthlyMap] of Object.entries(allRates)) {
                if (monthlyMap[month] !== undefined) result[currency] = monthlyMap[month];
            }
            res.json({ success: true, data: result, month });
        } else {
            const monthSet = new Set();
            for (const monthlyMap of Object.values(allRates)) {
                for (const m of Object.keys(monthlyMap)) monthSet.add(m);
            }
            const months = [...monthSet].sort();
            res.json({ success: true, data: allRates, currencies, months });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/rates/monthly/save', (req, res) => {
    try {
        const { month, rates } = req.body;
        if (!month || !rates) return res.status(400).json({ success: false, error: '缺少参数' });
        let allRates = {};
        if (fs.existsSync(MONTHLY_RATES_FILE)) allRates = JSON.parse(fs.readFileSync(MONTHLY_RATES_FILE, 'utf-8'));
        for (const [currency, value] of Object.entries(rates)) {
            if (!allRates[currency]) allRates[currency] = {};
            allRates[currency][month] = value;
        }
        fs.writeFileSync(MONTHLY_RATES_FILE, JSON.stringify(allRates, null, 2), 'utf-8');
        res.json({ success: true, month });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/rates/fetch-history', (req, res) => {
    const { month } = req.body;
    if (!month) return res.status(400).json({ success: false, error: '缺少月份' });
    console.log(`[Hub] Starting crawler for: ${month}`);
    const scriptPath = path.join(__dirname, 'fx_crawler_pro.py');
    const child = spawn('python', [scriptPath, '--target-month', month], {
        cwd: __dirname,
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });
    child.on('close', (code) => {
        console.log(`[Hub] Crawler exit ${code}`);
        const exportFile = path.join(__dirname, 'boc_fx_rates_export.json');
        if (fs.existsSync(exportFile)) {
            const crawlerData = JSON.parse(fs.readFileSync(exportFile, 'utf-8'));
            let monthlyRates = {};
            if (fs.existsSync(MONTHLY_RATES_FILE)) monthlyRates = JSON.parse(fs.readFileSync(MONTHLY_RATES_FILE, 'utf-8'));
            for (const [currency, valueMap] of Object.entries(crawlerData)) {
                if (!monthlyRates[currency]) monthlyRates[currency] = {};
                if (valueMap[month]) monthlyRates[currency][month] = valueMap[month];
            }
            fs.writeFileSync(MONTHLY_RATES_FILE, JSON.stringify(monthlyRates, null, 2), 'utf-8');
        }
    });
    res.json({ success: true, message: '抓取任务已启动' });
});

// =========================================================================
// Tool Hub 启动与 LAN 配置
// =========================================================================

const getLocalIP = () => {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    return 'localhost';
};

const PORT = 8081;
app.listen(PORT, '0.0.0.0', () => {
    const localIP = getLocalIP();
    console.log(`\n🚀 财务工具中台启动成功！`);
    console.log(`🏠 本地访问: http://localhost:${PORT}`);
    console.log(`🌐 局域网访问: http://${localIP}:${PORT}`);
    console.log(`\n按 Ctrl+C 停止服务。\n`);
});
