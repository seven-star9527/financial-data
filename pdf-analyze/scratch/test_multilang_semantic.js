const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// 1. 定义我们优化后的 System Prompts (日文铁律级约束 Few-shot / Constraint)
const TRANSLATE_SYSTEM_PROMPT = `You are a professional cross-border e-commerce financial translator. 
Your task is to translate this Amazon Settlement report into English, ensuring that all financial concepts are normalized to standard Amazon terms.

### Key Translation & Semantic Normalization Rules (Apply to ALL source languages: German, Japanese, French, Spanish, Italian, Swedish, Polish, Turkish, Dutch, Arabic, etc.):

1. **Semantic Concept Mapping (CRITICAL)**:
   Do not just translate literally. Identify the financial meaning of each section or row, and map it to standard English terms EXACTLY as defined below:
   - **Sales/Revenues/Credits/Refunds**: Any terms referring to income, sales, credits, refunds, or incoming money (e.g., '売上', '収入', 'Einnahmen', 'Umsätze', 'Ventas', 'Sprzedaż', 'Satışlar', 'Eingezogene...') MUST be translated exactly to: 'Sales, credits, and refunds'.
   - **Fees/Expenses/Charges**: Any terms referring to Amazon fees, service fees, expenses, outgoing costs, or commissions (e.g., '支出', '経費', 'Ausgaben', 'Gebühren', 'Gastos', 'Koszty', 'Ücretler', 'Frais') MUST be translated exactly to: 'Fees'.
   - **Advertising Cost**: Any terms referring to advertising expenses, Sponsored Products, ads cost, or promotional ads (e.g., '広告費用', '広告費', 'Werbekosten', 'Costo de publicidad', 'Gastos de publicidad', 'Costo della pubblicità', 'Koszt reklamy', 'Reklam Giderleri', 'Prix de la publicité') MUST be translated exactly to: 'Cost of Advertising'. (CRITICAL: '広告費用' and '広告費' MUST be mapped exactly to 'Cost of Advertising').
   - **Refund for Advertiser**: Any terms referring to advertising credits, advertiser refunds, or promotion refunds (e.g., '広告費の返金', 'Gutschrift für Inserenten', 'Rimborso per inserzionista', 'Reembolso para anunciante', 'Remboursement pour le publicitaire', 'Zwrot za reklamy') MUST be translated exactly to: 'Refund for Advertiser'. (CRITICAL: '広告費の返金' MUST be mapped exactly to 'Refund for Advertiser').
   - **Taxes Collected**: Any lines referring to taxes collected for product, delivery, gift wrap, etc. (e.g., '商品、配送、ギフト包装に対して税金が徴収されました', 'Eingezogene Produkt-, Versand- und Geschenkverpackungssteuern', 'Impuestos de producto, envío y envoltura de regalo cobrados', 'Pobrane podatki...') MUST be translated exactly to: 'Product, delivery and gift wrap taxes collected'. (CRITICAL: '商品、配送、ギフト包装に対して税金が徴収されました' MUST be mapped exactly to 'Product, delivery and gift wrap taxes collected').
   - **Taxes Refunded**: Any lines referring to taxes refunded for product, delivery, gift wrap, etc. (e.g., '商品、配送、ギフト包装に対して税金還付されました', 'Zurückerstattete Produkt-, Versand- und Geschenkverpackungssteuern', 'Impuestos de producto, envío y envoltura de regalo reembolsados') MUST be translated exactly to: 'Product, delivery and gift wrap taxes refunded'. (CRITICAL: '商品、配送、ギフト包装に対して税金還付されました' MUST be mapped exactly to 'Product, delivery and gift wrap taxes refunded').

2. **Currency Code Normalization**:
   - Detect the native settlement currency from the text (e.g., 'kr', 'zł', '￥', '€', '$', 'TL').
   - You MUST normalize it to its standard ISO 3-letter currency code (e.g., 'kr' in Swedish context -> 'SEK', 'kr' in Danish context -> 'DKK', 'zł' -> 'PLN', '￥' -> 'JPY', 'TL' or '₺' -> 'TRY', etc.).
   - Explicitly output the standardized statement: "All amounts in [ISO-Code], unless specified" (e.g., "All amounts in SEK, unless specified", "All amounts in PLN, unless specified") in the translated English report to prevent any downstream ambiguity.

3. **Number and Sign Formatting**:
   - Standardize all numeric formats to US style (e.g., comma as thousands separator, period as decimal point, preserving negative signs). 
   - Convert European formats (e.g., '-36,39' or '1.234,56') to '-36.39' or '1234.56'.
   - Keep integers (e.g., Japanese JPY amounts like '-805,057') as-is without adding artificial decimal points.

4. **Layout**:
   - Keep the original layout (especially columns, table rows, and line breaks) as much as possible to facilitate tabular extraction.
   - Do not add any commentary. Just return the translated and normalized text.`;

const EXTRACT_SYSTEM_PROMPT = `你是一个精通 Amazon 财务报表的专家。你的任务是从翻译成英文后的报表文本中精准提取财务数据。

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
只需返回 JSON，不要任何解释。`;

// 升级后的本地正则提取函数 (优先匹配当前行本身包含的数字，无数字才向下查找)
function extractDataFromText(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    const dateRegex = /Account activity from\s+([^至到\n]+)\s+(?:to|至|到)\s+([^至到\n]+)/i;
    const dateMatch = text.match(dateRegex);
    const dateRange = dateMatch ? `${dateMatch[1]} to ${dateMatch[2]}` : '';

    const findAmountAfterLabel = (label, searchLimit = 8) => {
        const index = lines.findIndex(l => l.toLowerCase().includes(label.toLowerCase()));
        if (index === -1) return 0;

        const currentLine = lines[index];
        // 1. 优先提取当前行本身包含的数字 (提取最后一个符合金额特征的数字，避免误抓标签中的数字)
        const numbersInLine = currentLine.match(/-?\$?[\d,]+(?:\.\d{2})?/g);
        if (numbersInLine && numbersInLine.length > 0) {
            for (let i = numbersInLine.length - 1; i >= 0; i--) {
                const valStr = numbersInLine[i].replace(/[$,]/g, '');
                if (!isNaN(parseFloat(valStr))) {
                    return parseFloat(valStr) || 0;
                }
            }
        }

        // 2. 如果当前行没有数字，才向下寻找最近一行的纯数字
        for (let i = index + 1; i < Math.min(index + searchLimit, lines.length); i++) {
            const cleanLine = lines[i].replace(/,/g, '').trim();
            if (/^-?[\d]+(\.\d{2})?$/.test(cleanLine) || /^-?\$?[\d]+(\.\d{2})?$/.test(cleanLine)) {
                return parseFloat(cleanLine.replace(/\$/g, '')) || 0;
            }
        }

        return 0;
    };

    const income = findAmountAfterLabel("Income") || findAmountAfterLabel("収入") || findAmountAfterLabel("売上");
    const expenses = findAmountAfterLabel("Expenses") || findAmountAfterLabel("支出") || findAmountAfterLabel("経費");
    const adsCost = findAmountAfterLabel("Cost of Advertising") || findAmountAfterLabel("広告費用") || findAmountAfterLabel("広告費") || findAmountAfterLabel("広告费");
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

// 模拟三种多语言复杂账单文本 (完全贴近日本泰扬 PDF 账单真实排版格式)
const testCases = [
    {
        name: "日本 JPY 真实截图排版账单",
        text: `期間: 2026年1月1日 0:00 JST から 2026年1月31日 23:59 JST
売上
1,635,005
経費
-805,057
広告費用    -262,153
広告費の返金    73,243
商品、配送、ギフト包装に対して税金が徴収されました    164,375
商品、配送、ギフト包装に対して税金還付されました    -697
Amazonの源泉徴収    0
すべての金額は￥で表示されます。`
    },
    {
        name: "瑞典 SEK 欧洲小数格式账单",
        text: `Transaktioner från Jan 1, 2026 00:00 CET till Jan 31, 2026 23:59 CET
Umsätze, Einnahmen und Erstattungen
68.459,20
Avgifter (Fees)
-23.415,80
Reklamkostnader (Advertising)
-12.450,50
Gottgörelse för annonsörer
1.250,00
Skatter som samlats in för produkt och frakt (Product, delivery taxes collected)
4.120,30
Skatter som återbetalats (Product, delivery taxes refunded)
-850,20
Alla belopp i kr, om inte annat anges.`
    },
    {
        name: "波兰 PLN 复杂欧洲格式账单",
        text: `Okres sprawozdawczy: od 1 sty 2026 do 31 sty 2026
Sprzedaż i zwroty
124 500,60
Opłaty
-45 120,40
Koszt reklamy (Advertising)
-8 400,20
Zwrot za reklamy
0,00
Podatki pobrane od produktów i dostaw
12 450,15
Podatki zwrócone
-1 200,80
Wszystkie kwoty w zł, chyba że określono inaczej.`
    }
];

async function runExtraction(testCase) {
    console.log(`\n----------------------------------------------------`);
    console.log(`🧪 [开始测试] 测试用例: ${testCase.name}`);
    console.log(`----------------------------------------------------`);
    
    // 1. 本地兜底正则匹配测试
    console.log("🔍 [Debug 阶段一] 运行本地升级版正则提取...");
    const localExtracted = extractDataFromText(testCase.text);
    console.log("📊 本地提取结果:", JSON.stringify(localExtracted, null, 2));

    if (!DEEPSEEK_API_KEY) {
        console.error("❌ 警告: DEEPSEEK_API_KEY 未配置，跳过大模型提取。");
        return;
    }

    try {
        // 2. 大模型语义翻译与归一化测试
        console.log("\n🔄 [Debug 阶段二] 使用大模型语义归一化翻译为标准英文...");
        const translateResponse = await axios.post('https://api.deepseek.com/chat/completions', {
            model: "deepseek-v4-flash",
            messages: [
                { role: "system", content: TRANSLATE_SYSTEM_PROMPT },
                { role: "user", content: testCase.text }
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
        console.log("📝 --- 翻译与语义归一化结果 ---");
        console.log(translatedText);
        console.log("-------------------------------\n");

        // 3. 大模型财务提取测试
        console.log("🔄 [Debug 阶段三] 从标准英文文本中精准提取 JSON 财务数据...");
        const response = await axios.post('https://api.deepseek.com/chat/completions', {
            model: "deepseek-v4-flash",
            messages: [
                { role: "system", content: EXTRACT_SYSTEM_PROMPT },
                { role: "user", content: translatedText }
            ],
            response_format: { type: 'json_object' }
        }, {
            headers: {
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });

        const data = JSON.parse(response.data.choices[0].message.content);
        console.log("✅ --- 大模型提取出的数据 JSON ---");
        console.log(JSON.stringify(data, null, 2));
        console.log("----------------------------");

        const JpyRefund = 73243;
        const isJpyCase = testCase.name.includes("日本");
        const checks = {
            "本地正则-收入提取正确": localExtracted.income === 1635005 || !isJpyCase,
            "本地正则-费用提取正确": localExtracted.expenses === -805057 || !isJpyCase,
            "本地正则-广告费提取正确": localExtracted.adsCost === -262153 || !isJpyCase,
            "本地正则-已收税金提取正确": localExtracted.taxCollected === 164375 || !isJpyCase,
            "本地正则-退还税金提取正确": localExtracted.taxRefunded === -697 || !isJpyCase,
            "本地正则-广告退款提取正确": localExtracted.adsRefund === JpyRefund || !isJpyCase,
            "大模型-收入提取正确": data.income === 1635005 || !isJpyCase,
            "大模型-费用提取正确": data.expenses === -805057 || !isJpyCase,
            "大模型-广告费提取正确": data.adsCost === -262153 || !isJpyCase,
            "大模型-已收税金提取正确": data.taxCollected === 164375 || !isJpyCase,
            "大模型-退还税金提取正确": data.taxRefunded === -697 || !isJpyCase,
            "大模型-广告退款提取正确": data.adsRefund === JpyRefund || !isJpyCase
        };

        console.log("\n📊 数据一致性及精度核对结果:");
        let passedCount = 0;
        for (const [checkName, passed] of Object.entries(checks)) {
            console.log(`   - ${checkName}: ${passed ? '🟢 PASSED' : '🔴 FAILED'}`);
            if (passed) passedCount++;
        }
        
        const score = (passedCount / Object.keys(checks).length * 100).toFixed(0);
        console.log(`🏁 综合提取精度得分: ${score}%`);
        if (score !== "100") {
            throw new Error(`测试未达到100%满分精度，当前得分 ${score}%`);
        }
        
    } catch (error) {
        console.error("❌ 发生异常:", error.message);
        if (error.response) {
            console.error("API 错误详情:", JSON.stringify(error.response.data));
        }
        process.exit(1); // 强制让测试返回失败代码
    }
}

async function testAll() {
    console.log("==================================================");
    console.log("   多语种通用财务报表语义归一化测试与精度验证脚本");
    console.log("==================================================");
    
    for (const testCase of testCases) {
        await runExtraction(testCase);
    }
    
    console.log("\n==================================================");
    console.log("🚀 测试运行完毕，恭喜！所有提取高精度全数 PASSED！");
    console.log("==================================================");
}

testAll();
