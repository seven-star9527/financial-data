const express = require('express');
const multer = require('multer');
const axios = require('axios');
const xlsx = require('xlsx');
const ExcelJS = require('exceljs');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cheerio = require('cheerio');
const cron = require('node-cron');
const COS = require('cos-nodejs-sdk-v5');
const pdfParse = require('pdf-parse');
require('dotenv').config();

const app = express();
const upload = multer({ dest: os.tmpdir() });

app.use(express.static('public'));
app.use(express.json());

// API Keys & Config
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const RATES_FILE = path.join(__dirname, 'exchange_rates.json');
const MONTHLY_RATES_FILE = path.join(__dirname, 'boc_fx_rates_monthly.json');
const MAPPINGS_FILE = path.join(__dirname, 'company_mappings.json');
const HISTORY_FILE = path.join(__dirname, 'analysis_history.json');
const HISTORY_DIR = path.join(__dirname, 'data', 'history');
if (!fs.existsSync(path.dirname(HISTORY_FILE))) fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });

// 国家/站点到货币的详细映射（按中文名查找）
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

/**
 * 从 PDF 文件名中解析站点、国家和结算币种。
 * 解析优先级：
 *   1. 优先从文件名末尾括号中提取 ISO 2字母国家代码，例如 "雅甄2026JanMonthlySummary (DE).pdf" -> DE -> 德国/EUR
 *   2. 若无括号代码，则尝试从品牌前缀中匹配中文国家关键词（原有逻辑）
 * 站点名 = 品牌名（文件名开头的中文/字母部分）+ 国家中文名
 *
 * @param {string} originalName - 原始文件名（含扩展名）
 * @returns {{ siteName: string, countryInfo: object|null, brandPrefix: string }}
 */
function parseFileNameInfo(originalName) {
    let nameWithoutExt = originalName.replace(/\.pdf$/i, '').trim();
    
    // 1. 智能滤除文件开头的月份/日期前缀，如 "1月 "、"01月 "、"2026年1月 " 等
    nameWithoutExt = nameWithoutExt.replace(/^(?:\d{4}年)?\d{1,2}月/g, '').trim();

    // 2. 智能滤除文件开头的各种英文月度汇总报告的前缀，如 "2026MarMonthlySummary-"、"2026MarMonthlyUnifiedSummary-" 等
    nameWithoutExt = nameWithoutExt.replace(/^(?:20\d{2}|\d{4})?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-zA-Z0-9\-_]*(?:MonthlySummary|MonthlyUnifiedSummary|CustomSummary|CustomUnifiedSummary)?/i, '').trim();

    // 3. 滤除文件开头遗留的无用连字符、下划线和空格（例如由上述规则剥离后留下的 "-启坤德国"）
    nameWithoutExt = nameWithoutExt.replace(/^[-_\s]+/g, '').trim();

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

    // Step 1.2: 优先扫描文件名中是否包含明确的中文国家名称或特定中文简称（这是极高置信度的信号，如 "英国", "德国", "澳洲", "日本"）
    if (!countryInfo) {
        const cnCountries = [
            { name: '美国', key: '美国' }, { name: '加拿大', key: '加拿大' }, { name: '墨西哥', key: '墨西哥' },
            { name: '英国', key: '英国' }, { name: '德国', key: '德国' }, { name: '法国', key: '法国' },
            { name: '意大利', key: '意大利' }, { name: '西班牙', key: '西班牙' }, { name: '荷兰', key: '荷兰' },
            { name: '比利时', key: '比利时' }, { name: '奥地利', key: '奥地利' }, { name: '希腊', key: '希腊' },
            { name: '爱尔兰', key: '爱尔兰' }, { name: '澳大利亚', key: '澳大利亚' }, { name: '澳大利亚', key: '澳洲' },
            { name: '日本', key: '日本' }, { name: '瑞典', key: '瑞典' }, { name: '波兰', key: '波兰' },
            { name: '土耳其', key: '土耳其' }, { name: '沙特', key: '沙特' }, { name: '阿联酋', key: '阿联酋' },
            { name: '印度', key: '印度' }, { name: '新加坡', key: '新加坡' }, { name: '香港', key: '香港' },
            { name: '巴西', key: '巴西' }, { name: '泰国', key: '泰国' }, { name: '丹麦', key: '丹麦' },
            { name: '菲律宾', key: '菲律宾' }, { name: '新西兰', key: '新西兰' }, { name: '瑞士', key: '瑞士' },
            { name: '马来西亚', key: '马来西亚' }, { name: '俄罗斯', key: '俄罗斯' }, { name: '匈牙利', key: '匈牙利' },
            { name: '以色列', key: '以色列' }, { name: '越南', key: '越南' }, { name: '台湾', key: '台湾' },
            { name: '捷克', key: '捷克' }
        ];
        for (const item of cnCountries) {
            if (nameWithoutExt.includes(item.key)) {
                countryInfo = countryCurrencyMap[item.name];
                countryName = item.name;
                console.log(`[Decision Tree] 检测到高置信度中文国家名称 "${item.key}"，直接锁定国家为 "${item.name}"`);
                break;
            }
        }
    }

    // Step 1.5: 如果括号与中文名称中都没有找到，则扫描文件名中任何以非英文字母为边界 of 独立二位国家代码（如 "-DE3月" 中的 "DE"，"FR3月" 中的 "FR"）
    if (!countryInfo) {
        // 使用现代 lookarounds 避免因单个边界字符重合导致的消费性匹配遗漏问题
        const boundaryRegex = /(?<![a-zA-Z])([A-Z]{2})(?![a-zA-Z])/gi;
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

        const now = new Date();
        const data = { rates, updateTime: now.toISOString() };
        fs.writeFileSync(RATES_FILE, JSON.stringify(data, null, 2));
        console.log("Exchange rates updated successfully.");

        // 同步写入月度汇率文件
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        let monthlyRates = {};
        if (fs.existsSync(MONTHLY_RATES_FILE)) {
            monthlyRates = JSON.parse(fs.readFileSync(MONTHLY_RATES_FILE, 'utf-8'));
        }
        for (const [currency, value] of Object.entries(rates)) {
            if (!monthlyRates[currency]) {
                monthlyRates[currency] = {};
            }
            monthlyRates[currency][currentMonth] = value;
        }
        fs.writeFileSync(MONTHLY_RATES_FILE, JSON.stringify(monthlyRates, null, 2), 'utf-8');
        console.log(`Monthly rates synced for ${currentMonth}.`);

        return data;
    } catch (error) {
        console.error("Failed to update exchange rates:", error.message);
        throw error;
    }
}

// 每月 1 日 23:59 自动抓取（每月最后1分钟）
cron.schedule('59 23 1 * *', () => {
    console.log("Cron triggered: updating exchange rates (monthly) ...");
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

// 获取本地保存的汇率
app.get('/api/rates', (req, res) => {
    if (fs.existsSync(RATES_FILE)) {
        res.json({ success: true, data: JSON.parse(fs.readFileSync(RATES_FILE)) });
    } else {
        res.json({ success: true, data: null });
    }
});

// ─── 历史分析记录 API ──────────────────────────────────────────────────────────
function migrateHistoryRecord(item) {
    if (item.headers && item.headers[0] === '领星店铺名称') {
        console.log(`[Migration] Migrating old format history record in child server: ${item.id}`);
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
                console.log("[Migration] CHILD HISTORY_FILE legacy records auto-migrated and synchronized.");
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

                // 智能纠偏：若重解析得到的月份是默认的 '1'，或者根本没有提取到日期范围，
                // 则看文件名是否包含明确的月份信息 (如 2月, Feb, Mar)，有则以文件名月份强力纠偏！
                const fileMonth = getMonthFromFileName(originalName);
                if (fileMonth) {
                    if (detectedMonth === '1' || !extracted || !extracted.dateRange) {
                        console.log(`[Month Corrector] [Re-analyze] 正文解析月份为 "${detectedMonth}"，但文件名 "${originalName}" 明确包含月份 "${fileMonth}月"，已强力纠偏为: ${fileMonth}`);
                        detectedMonth = fileMonth;
                    }
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

// ─── 公司主体映射 API ──────────────────────────────────────────────────────────
// 读取公司映射配置
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

// 保存公司映射配置（全量覆盖）
app.post('/api/mappings', (req, res) => {
    try {
        const mappings = req.body.mappings || {};
        fs.writeFileSync(MAPPINGS_FILE, JSON.stringify(mappings, null, 2), 'utf-8');
        console.log('公司映射已保存:', mappings);
        res.json({ success: true, data: mappings });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── 月度汇率 API ──────────────────────────────────────────────────────────────
// 获取月度汇率数据（全部或指定月份）
app.get('/api/rates/monthly', (req, res) => {
    try {
        if (!fs.existsSync(MONTHLY_RATES_FILE)) {
            return res.json({ success: true, data: {}, currencies: [] });
        }
        const allRates = JSON.parse(fs.readFileSync(MONTHLY_RATES_FILE, 'utf-8'));
        const currencies = Object.keys(allRates);
        console.log(`[API] Loaded ${currencies.length} currencies from monthly file.`);
        
        const month = req.query.month; // 可选: YYYY-MM

        if (month) {
            // 返回指定月份的各货币汇率
            const result = {};
            for (const [currency, monthlyMap] of Object.entries(allRates)) {
                if (monthlyMap[month] !== undefined) {
                    result[currency] = monthlyMap[month];
                }
            }
            res.json({ success: true, data: result, month });
        } else {
            // 返回全部数据
            const currencies = Object.keys(allRates);
            // 收集所有出现的月份
            const monthSet = new Set();
            for (const monthlyMap of Object.values(allRates)) {
                for (const m of Object.keys(monthlyMap)) {
                    monthSet.add(m);
                }
            }
            const months = [...monthSet].sort();
            res.json({ success: true, data: allRates, currencies, months });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 手动更新月度汇率（通过 ak share 抓取指定月份数据 — 由 boc_fx_collector.py 完成）
// 这里提供保存接口，供前端/boc_fx_collector 写入
app.post('/api/rates/monthly/save', (req, res) => {
    try {
        const { month, rates } = req.body; // month: "YYYY-MM", rates: { "美元": 685.89, ... }
        if (!month || !rates) {
            return res.status(400).json({ success: false, error: '缺少 month 或 rates 参数' });
        }

        // 读取现有月度数据
        let allRates = {};
        if (fs.existsSync(MONTHLY_RATES_FILE)) {
            allRates = JSON.parse(fs.readFileSync(MONTHLY_RATES_FILE, 'utf-8'));
        }

        // 写入指定月份的数据
        for (const [currency, value] of Object.entries(rates)) {
            if (!allRates[currency]) {
                allRates[currency] = {};
            }
            allRates[currency][month] = value;
        }

        fs.writeFileSync(MONTHLY_RATES_FILE, JSON.stringify(allRates, null, 2), 'utf-8');
        console.log(`月度汇率已更新: ${month}, ${Object.keys(rates).length} 种货币`);
        res.json({ success: true, month, count: Object.keys(rates).length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 保存当前汇率修改（更新最新汇率和对应月份数据）
app.post('/api/rates/save', (req, res) => {
    try {
        const newRates = req.body.rates || {};
        // 更新 exchange_rates.json（当前最新）
        const data = { rates: newRates, updateTime: new Date().toISOString() };
        fs.writeFileSync(RATES_FILE, JSON.stringify(data, null, 2));

        // 同步更新月度汇率表（当前月份）
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        let allRates = {};
        if (fs.existsSync(MONTHLY_RATES_FILE)) {
            allRates = JSON.parse(fs.readFileSync(MONTHLY_RATES_FILE, 'utf-8'));
        }
        for (const [currency, value] of Object.entries(newRates)) {
            if (!allRates[currency]) {
                allRates[currency] = {};
            }
            allRates[currency][currentMonth] = value;
        }
        fs.writeFileSync(MONTHLY_RATES_FILE, JSON.stringify(allRates, null, 2), 'utf-8');

        console.log(`汇率已保存，同步到月度表 ${currentMonth}`);
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
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
  * '広告費用' / '広告費' / 'Werbekosten' / 'Costo de la publicidad' / 'Costo della pubblicità' / 'Prix de la publicité' / 'Gastos de publicidad' -> 'Cost of Advertising'
  * '広告費の返金' / 'Gutschrift für Inserenten' / 'Rimborso per inserzionista' / 'Reembolso para el promotor' / 'Reembolso para anunciante' / 'Remboursement pour le publicitaire' -> 'Refund for Advertiser'
  * '商品、配送、ギフト包装に対して税金が徴収されました' / 'Eingezogene Produkt-, Versand- und Geschenkverpackungssteuern' / 'Impuestos de producto, envío y envoltura de regalo cobrados' -> 'Product, delivery and gift wrap taxes collected'
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
            thinking: { type: 'disabled' }
        }, {
            headers: {
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });

        const translatedText = translateResponse.data.choices[0].message.content;
        // console.log("--- [DEBUG] Translated Text (First 500 chars) ---\n", translatedText.substring(0, 500), "\n---");

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
            thinking: { type: 'disabled' }
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
        console.error("DeepSeek extraction failed:", error.message);
        if (error.response) {
            console.error("Error details:", error.response.data);
        }
        return null;
    }
}

// 辅助函数：从文件名中提取月份
function getMonthFromFileName(fileName) {
    if (!fileName) return null;
    
    // 1. 尝试匹配 "1月", "2月" ... "12月"
    const cnMatch = fileName.match(/(\d{1,2})\s*月/);
    if (cnMatch) {
        const m = parseInt(cnMatch[1], 10);
        if (m >= 1 && m <= 12) {
            return String(m);
        }
    }
    
    // 2. 尝试匹配英文月份名
    const monthMap = {
        'jan': '1', 'january': '1',
        'feb': '2', 'february': '2',
        'mar': '3', 'march': '3',
        'apr': '4', 'april': '4',
        'may': '5',
        'jun': '6', 'june': '6',
        'jul': '7', 'july': '7',
        'aug': '8', 'august': '8',
        'sep': '9', 'september': '9',
        'oct': '10', 'october': '10',
        'nov': '11', 'november': '11',
        'dec': '12', 'december': '12'
    };
    
    // 寻找英文月份单词
    const enMatch = fileName.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/i);
    if (enMatch) {
        const key = enMatch[1].toLowerCase();
        if (monthMap[key]) {
            return monthMap[key];
        }
    }
    
    // 3. 另外支持非单词边界但在年份后的匹配（有些文件名中英文字符与年份连在一起，例如 2026FebMonthlySummary.pdf）
    // 通过要求月份前必须有 4 位或 2 位年份数字来避免匹配到类似 "Marketplace" 中的 "mar"
    const enMatchLoose = fileName.match(/(?:\d{4}|\d{2})(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)/i);
    if (enMatchLoose) {
        const key = enMatchLoose[1].toLowerCase();
        if (monthMap[key]) {
            return monthMap[key];
        }
    }
    
    return null;
}

// 辅助函数：获取月份 (支持多国语言日期格式及数字型日期格式)
function getMonthFromRange(dateRange) {
    if (!dateRange) return '1';
    
    // 1. 尝试匹配中文字符 1月 到 12月
    const cnMatch = dateRange.match(/(\d{1,2})\s*月/);
    if (cnMatch) {
        const m = parseInt(cnMatch[1], 10);
        if (m >= 1 && m <= 12) return String(m);
    }

    // 2. 尝试匹配 YYYY/MM/DD 或 YYYY-MM-DD
    const ymdMatch = dateRange.match(/\b\d{4}[/\-](\d{1,2})[/\-]\d{1,2}\b/);
    if (ymdMatch) {
        const m = parseInt(ymdMatch[1], 10);
        if (m >= 1 && m <= 12) return String(m);
    }

    // 3. 尝试匹配 DD.MM.YYYY (德国等)
    const dmyDotMatch = dateRange.match(/\b\d{1,2}\.(\d{1,2})\.\d{4}\b/);
    if (dmyDotMatch) {
        const m = parseInt(dmyDotMatch[1], 10);
        if (m >= 1 && m <= 12) return String(m);
    }

    // 4. 尝试匹配 DD/MM/YYYY (其他数字型)
    const dmySlashMatch = dateRange.match(/\b\d{1,2}\/(\d{1,2})\/\d{4}\b/);
    if (dmySlashMatch) {
        const m = parseInt(dmySlashMatch[1], 10);
        if (m >= 1 && m <= 12) return String(m);
    }

    // 5. 语言月份缩写/全称映射
    const multiLangMonthMap = {
        // English
        'jan': '1', 'feb': '2', 'mar': '3', 'apr': '4', 'may': '5', 'jun': '6',
        'jul': '7', 'aug': '8', 'sep': '9', 'oct': '10', 'nov': '11', 'dec': '12',
        'january': '1', 'february': '2', 'march': '3', 'april': '4', 'june': '6',
        'july': '7', 'august': '8', 'september': '9', 'october': '10', 'november': '11', 'december': '12',
        
        // German
        'januar': '1', 'februar': '2', 'märz': '3', 'maerz': '3', 'juni': '6', 'juli': '7', 'oktober': '10', 'dezember': '12',
        
        // French
        'janv': '1', 'févr': '2', 'fevr': '2', 'mars': '3', 'avr': '4', 'juin': '6', 'juil': '7', 'août': '8', 'aout': '8', 'sept': '9', 'déc': '12', 'dec': '12',
        
        // Spanish & Italian
        'ene': '1', 'gen': '1', 'abr': '4', 'mag': '5', 'ago': '8', 'set': '9', 'ott': '10', 'dic': '12',
        
        // Swedish
        'maj': '5', 'okt': '10',
        
        // Turkish
        'oca': '1', 'şub': '2', 'sub': '2', 'nis': '4', 'haz': '6', 'tem': '7', 'ağu': '8', 'agu': '8', 'eyl': '9', 'eki': '10', 'kas': '11', 'ara': '12'
    };

    // 提取所有可能的字母型单词
    const words = dateRange.match(/[a-zA-Zàâäéèêëîïôöùûüÿçşğııİııııııııııııııı]+/gi);
    if (words) {
        for (let word of words) {
            const w = word.toLowerCase();
            if (multiLangMonthMap[w]) {
                return multiLangMonthMap[w];
            }
            const w3 = w.substring(0, 3);
            if (multiLangMonthMap[w3]) {
                return multiLangMonthMap[w3];
            }
        }
    }

    return '1';
}

// 辅助函数：从文本中正则提取数据 (增强版：基于行搜索)
function extractDataFromText(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // 提取日期范围
    const dateRegex = /Account activity from\s+([^至到\n]+)\s+(?:to|至|到)\s+([^至到\n]+)/i;
    const dateMatch = text.match(dateRegex);
    const dateRange = dateMatch ? `${dateMatch[1]} to ${dateMatch[2]}` : '';

    const findAmountAfterLabel = (label, searchLimit = 8) => {
        const index = lines.findIndex(l => l.toLowerCase().includes(label.toLowerCase()));
        if (index === -1) return 0;

        // 向上或向下寻找最近的数字 (支持 JPY 等整数格式)
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

// 1. 上传接口：仅负责接收文件并返回任务 ID
app.post('/api/upload', upload.array('pdfs'), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, error: '未选择文件' });
        }

        const jobId = Date.now().toString();
        const mapping = JSON.parse(req.body.companyMapping || '{}');

        jobs.set(jobId, {
            files: req.files,
            mapping: mapping,
            status: 'pending',
            progress: 0,
            logs: [],
            resultUrl: null
        });

        res.json({ success: true, jobId });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. SSE 进度接口：负责执行任务并推送进度
app.get('/api/process-progress/:jobId', async (req, res) => {
    const jobId = req.params.jobId;
    const job = jobs.get(jobId);

    if (!job) {
        return res.status(404).end();
    }

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendProgress = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        job.status = 'processing';
        const processedData = [];
        const resultsLog = [];

        // 加载月度汇率表（优先按月份匹配），以及最新汇率作为兜底
        let monthlyRates = {};
        let latestRates = {};
        if (fs.existsSync(MONTHLY_RATES_FILE)) {
            monthlyRates = JSON.parse(fs.readFileSync(MONTHLY_RATES_FILE, 'utf-8'));
        }
        if (fs.existsSync(RATES_FILE)) {
            latestRates = JSON.parse(fs.readFileSync(RATES_FILE)).rates || {};
        }

        for (let i = 0; i < job.files.length; i++) {
            const pdf = job.files[i];

            // 解决 Multer 中文文件名乱码
            let originalName = pdf.originalname;
            try {
                const decodedBinary = Buffer.from(pdf.originalname, 'binary').toString('utf8');
                const decodedLatin1 = Buffer.from(pdf.originalname, 'latin1').toString('utf8');
                if (/[一-防]/.test(decodedBinary)) originalName = decodedBinary;
                else if (/[一-防]/.test(decodedLatin1)) originalName = decodedLatin1;
            } catch (e) {
                console.error("Filename decoding failed:", e.message);
            }

            sendProgress({
                status: 'processing_file',
                file: originalName,
                index: i + 1,
                total: job.files.length,
                progress: Math.round(((i) / job.files.length) * 100)
            });

            let detectedMonth = '1';
            let detectedYear = new Date().getFullYear().toString();
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
                    const isExtractedEmpty = !extracted || (
                        extracted.income === 0 &&
                        extracted.expenses === 0 &&
                        extracted.adsCost === 0 &&
                        extracted.taxCollected === 0 &&
                        extracted.taxRefunded === 0
                    );
                    if (isExtractedEmpty) {
                        console.log("DeepSeek failed or returned all zeros, using fallback regex...");
                        extracted = extractDataFromText(textResult);
                    }
                }

                // console.log(`[DEBUG] Final Extracted Data for ${originalName}:`, JSON.stringify(extracted, null, 2));

                if (extracted && extracted.dateRange) {
                    detectedMonth = getMonthFromRange(extracted.dateRange);
                    // 从日期范围中提取年份
                    const yrMatch = extracted.dateRange.match(/\b(20\d{2})\b/);
                    if (yrMatch) detectedYear = yrMatch[1];
                }

                // 智能纠偏：若正文解析得到的月份是默认的 '1'，或者根本没有提取到日期范围，
                // 则看文件名是否包含明确的月份信息 (如 2月, Feb, Mar)，有则以文件名月份强力纠偏！
                const fileMonth = getMonthFromFileName(originalName);
                if (fileMonth) {
                    if (detectedMonth === '1' || !extracted || !extracted.dateRange) {
                        console.log(`[Month Corrector] 正文解析月份为 "${detectedMonth}"，但文件名 "${originalName}" 明确包含月份 "${fileMonth}月"，已强力纠偏为: ${fileMonth}`);
                        detectedMonth = fileMonth;
                    }
                }

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

                    // 汇率查找优先级：
                    // 1. 从月度汇率表按 YYYY-MM 精确匹配
                    // 2. 兜底使用最新汇率（exchange_rates.json）
                    const yearMonthKey = `${detectedYear}-${String(detectedMonth).padStart(2, '0')}`;
                    let conversionRateRaw = null;

                    if (monthlyRates[currencyName] && monthlyRates[currencyName][yearMonthKey] !== undefined) {
                        conversionRateRaw = monthlyRates[currencyName][yearMonthKey];
                        console.log(`[Rate] 使用月度汇率: ${currencyName} ${yearMonthKey} = ${conversionRateRaw}`);
                    } else if (latestRates[currencyName]) {
                        conversionRateRaw = latestRates[currencyName];
                        console.log(`[Rate] 月度汇率缺失(${yearMonthKey})，使用最新汇率兜底: ${currencyName} = ${conversionRateRaw}`);
                    } else {
                        console.log(`[Rate] 未找到汇率: ${currencyName}`);
                    }

                    conversionPrice = conversionRateRaw ? (conversionRateRaw / 100) : null;
                } else {
                    console.log(`[Rate] 文件未识别到国家，结算币种和汇率设为空值`);
                }

                let finalLegalName = '';
                for (const keyword of Object.keys(job.mapping)) {
                    // 优先用品牌前缀匹配，再用站点名匹配，最后用原始文件名兜底包含匹配
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
                    conversionPrice
                });

                resultsLog.push({ file: originalName, status: 'success' });
            } catch (err) {
                console.error(`Error processing ${originalName}:`, err.message);
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
        const sheet = workbook.addWorksheet('亚马逊汇总表', {
            views: [{ state: 'frozen', xSplit: 5, ySplit: 1 }]
        });

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
                if (colNumber >= 6) {
                    cell.numFmt = colNumber === 6 ? '0.0000' : numFormat;
                }
            });
        });

        // 开启筛选
        sheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: header.length }
        };

        // 自适应列宽逻辑
        sheet.columns.forEach((column, i) => {
            const colIndex = i + 1;
            if (colIndex >= 6) {
                // 从汇率列开始，固定宽度为 11
                column.width = 11;
            } else {
                // 前 5 列使用自适应宽度
                let maxColumnLength = 0;
                column.eachCell({ includeEmpty: true }, (cell) => {
                    let cellValue = cell.value ? cell.value.toString() : '';
                    let length = 0;
                    for (let j = 0; j < cellValue.length; j++) {
                        if (cellValue.charCodeAt(j) > 255) {
                            length += 2.2; // 中文
                        } else {
                            length += 1.1; // 英文/数字
                        }
                    }
                    if (length > maxColumnLength) maxColumnLength = length;
                });
                column.width = Math.max(12, maxColumnLength + 4);
            }
        });

        const outputPath = path.join(__dirname, 'data', `亚马逊汇总表_${month}月.xlsx`);
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
            console.log("[History] Standalone saved analysis record successfully.");
        } catch (e) {
            console.error("Failed to save history in standalone:", e.message);
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
        console.error("SSE Process Error:", err);
        sendProgress({ status: 'error', message: err.message });
        res.end();
    }
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

const PORT = 3000;
const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Error: Port ${PORT} is already in use. Please close the previous server process.`);
    } else {
        console.error('Server error:', err);
    }
});
