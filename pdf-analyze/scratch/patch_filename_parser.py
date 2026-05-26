# -*- coding: utf-8 -*-
import os
import re

files_to_patch = [
    os.path.join(os.path.dirname(__file__), '..', 'server.js'),
    os.path.join(os.path.dirname(__file__), '..', '..', 'server.js'),
    os.path.join(os.path.dirname(__file__), 'test_filename_parsing.js')
]

new_function = r"""function parseFileNameInfo(originalName) {
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
}"""

for fpath in files_to_patch:
    if not os.path.exists(fpath):
        print(f"[WARN] File not found: {fpath}")
        continue
        
    print(f"Patching: {fpath}")
    with open(fpath, 'r', encoding='utf-8') as f:
        content = f.read()
        
    norm_content = content.replace('\r\n', '\n').replace('\r', '\n')
    
    # Match the parseFileNameInfo function block
    func_pattern = r'function parseFileNameInfo\(originalName\) \{[\s\S]*?return \{ siteName, countryInfo, brandPrefix: siteName \};\s*\}'
    func_match = re.search(func_pattern, norm_content)
    
    if not func_match:
        print(f"[ERR] Could not locate parseFileNameInfo in {fpath}!")
        exit(1)
        
    target = func_match.group(0)
    content = norm_content.replace(target, new_function)
    
    with open(fpath, 'w', encoding='utf-8') as f:
        f.write(content)
        
    print(f"[OK] Patched {fpath}")
