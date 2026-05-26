const fs = require('fs');
const path = require('path');

// Mock data needed from server.js
const countryCurrencyMap = {
    '美国': { name: '美国', currency: '美元', code: 'USD' },
    '加拿大': { name: '加拿大', currency: '加拿大元', code: 'CAD' },
    '墨西哥': { name: '墨西哥', currency: '墨西哥比索', code: 'MXN' },
    '英国': { name: '英国', currency: '英镑', code: 'GBP' },
    '德国': { name: '德国', currency: '欧元', code: 'EUR' },
    '法国': { name: '法国', currency: '欧元', code: 'EUR' },
    '波兰': { name: '波兰', currency: '波兰兹罗提', code: 'PLN' }
};

const countryCodeMap = {
    'US': { name: '美国', currency: '美元', code: 'USD' },
    'CA': { name: '加拿大', currency: '加拿大元', code: 'CAD' },
    'MX': { name: '墨西哥', currency: '墨西哥比索', code: 'MXN' },
    'UK': { name: '英国', currency: '英镑', code: 'GBP' },
    'DE': { name: '德国', currency: '欧元', code: 'EUR' },
    'PL': { name: '波兰', currency: '波兰兹罗提', code: 'PLN' }
};

// Re-declare server functions to test them locally
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

    // Step 3: 不区分大小写的增强地名/代号匹配（用于无括号时的扫描识别）
    if (!countryInfo) {
        const enhancedAliases = {
            '美国': ['us', 'usd', '美国', '🇺🇸'],
            '加拿大': ['ca', 'cad', '加拿大', '🇨🇦'],
            '墨西哥': ['mx', 'mxn', '墨西哥', '🇲🇽'],
            '英国': ['uk', 'gb', 'gbp', '英国', '🇬🇧'],
            '德国': ['de', 'eur', '德国', '🇩🇪'],
            '法国': ['fr', '法国', '🇫🇷'],
            '波兰': ['pl', 'pln', '波兰', '🇵🇱']
        };

        let allEntries = [];
        for (const [cName, aliases] of Object.entries(enhancedAliases)) {
            for (const alias of aliases) {
                allEntries.push({ cName, alias, length: alias.length });
            }
        }
        allEntries.sort((a, b) => b.length - a.length);

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

    if (!siteName) {
        const brandMatch = nameWithoutExt.match(/^([\u4e00-\u9fa5]+)/);
        siteName = brandMatch ? brandMatch[1] : nameWithoutExt.split(/[\s(\-]/)[0];
    }

    siteName = siteName.replace(/[-_\s(]+$/, '').trim();

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

function extractCurrencyFromText(text) {
    if (!text) return null;
    const amountMatch = text.match(/amounts?\s+in\s+([A-Z]{3})\b/i);
    if (amountMatch) return amountMatch[1].toUpperCase();

    const timezoneMatch = text.match(/Account activity from[\s\S]*?\b(PST|PDT|EST|EDT|GMT|BST|CET|CEST|JST|AEST|AEDT)\b/i);
    if (timezoneMatch) {
        const tz = timezoneMatch[1].toUpperCase();
        if (tz === 'PST' || tz === 'PDT' || tz === 'EST' || tz === 'EDT') return 'USD';
        if (tz === 'GMT' || tz === 'BST') return 'GBP';
        if (tz === 'CET' || tz === 'CEST') return 'EUR';
        if (tz === 'JST') return 'JPY';
        if (tz === 'AEST' || tz === 'AEDT') return 'AUD';
    }

    if (text.includes('USD') || text.includes('U.S. Dollar')) return 'USD';
    if (text.includes('CAD') || text.includes('Canadian Dollar')) return 'CAD';
    if (text.includes('GBP') || text.includes('Great Britain Pound')) return 'GBP';
    if (text.includes('EUR') || text.includes('Euro')) return 'EUR';
    if (text.includes('PLN') || text.includes('Polish Zloty')) return 'PLN';
    return null;
}

// RUN TEST CASES
const testCases = [
    { filename: "隆亚北美us2026JanMonthlyUnifiedSummary.pdf", expectedSite: "隆亚北美", expectedCountry: "美国" },
    { filename: "隆亚北美MXN2026JanMonthlySummary.pdf", expectedSite: "隆亚北美MXN", expectedCountry: "墨西哥" },
    { filename: "隆亚北美CA2026JanMonthlySummary.pdf", expectedSite: "隆亚北美", expectedCountry: "加拿大" },
    { filename: "雅甄2026JanMonthlySummary (DE).pdf", expectedSite: "雅甄德国", expectedCountry: "德国" },
    { filename: "雅甄2026JanMonthlySummary（DE）.pdf", expectedSite: "雅甄德国", expectedCountry: "德国" },
    { filename: "雅甄2026JanMonthlySummary (DE) (1).pdf", expectedSite: "雅甄德国", expectedCountry: "德国" },
    { filename: "雅甄2026JanMonthlySummary (DE)(2).pdf", expectedSite: "雅甄德国", expectedCountry: "德国" },
    { filename: "雅甄 (DE) 2026JanMonthlySummary.pdf", expectedSite: "雅甄德国", expectedCountry: "德国" },
    { filename: "宝徕泽.pdf", expectedSite: "宝徕泽", expectedCountry: null }
];

console.log("=== 文件名解析单元测试 ===");
testCases.forEach((tc, idx) => {
    const result = parseFileNameInfo(tc.filename);
    const success = result.siteName === tc.expectedSite && (tc.expectedCountry === null ? result.countryInfo === null : result.countryInfo.name === tc.expectedCountry);
    console.log(`[测试用例 ${idx + 1}] ${tc.filename}`);
    console.log(`  解析站点: ${result.siteName} (期望: ${tc.expectedSite})`);
    console.log(`  解析国家: ${result.countryInfo ? result.countryInfo.name : 'null'} (期望: ${tc.expectedCountry})`);
    console.log(`  结果: ${success ? '✅ 通过' : '❌ 失败'}`);
});

console.log("\n=== 正文币种/时区反向推导单元测试 ===");
const textCases = [
    { text: "Account activity from Jan 1, 2026 00:00 PST through Jan 31, 2026 23:59 PST", expectedCurrency: "USD" },
    { text: "All amounts in USD, unless specified", expectedCurrency: "USD" },
    { text: "All amounts in PLN, unless specified", expectedCurrency: "PLN" },
    { text: "Account activity from Jan 1, 2026 00:00 GMT through Jan 31, 2026 23:59 GMT", expectedCurrency: "GBP" }
];

textCases.forEach((tc, idx) => {
    const currency = extractCurrencyFromText(tc.text);
    const success = currency === tc.expectedCurrency;
    console.log(`[测试用例 ${idx + 1}] Text snippet: "${tc.text.substring(0, 40)}..."`);
    console.log(`  反推结算币种: ${currency} (期望: ${tc.expectedCurrency})`);
    console.log(`  结果: ${success ? '✅ 通过' : '❌ 失败'}`);
});
