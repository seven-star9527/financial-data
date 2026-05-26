const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

const text = `
Seller-fulfilled selling fees
0.56
Promotional rebate refunds
Can include Amazon Marketplace, Fulfilment by Amazon (FBA), and Amazon Webstore transactions
0
131.53
0
-1,625.93
Product, delivery and gift wrap taxes collected
0
0
A-to-z Guarantee Claims
subtotals
subtotals
subtotals
subtotals
Amazon Shipping Reimbursement
-5.12
0
0
FBA inventory and inbound services fees
0
Tax
Tax
Liquidations fees
Delivery label refunds
Seller-fulfilled product sale refunds
0
0
Cost of Advertising
19.50
Gift wrap credits
Failed transfers to bank account
Service fees
-170.17
6,478.35
Summaries
All amounts in GBP, unless specified
FBA inventory credit
Debits
Debits
Debits
Debits
-32.91
0
0
-13.38
Delivery label purchases
-1,625.93
0
0
-3,092.36
Postage credits
-1,175.49
0
-598.48
0
Other transaction fee refunds
Amazon Shipping Charges
0
-1,625.93
2.60
Chargebacks
Fees, including Amazon service fees, selling fees, FBA fees, and delivery
Refund administration fees
Display name:
Deposits and withdrawals
Information in this statement does not constitute accounting, tax, legal, or other professional advice.
-1,055.59
SAFE-T reimbursement
Selling fee refunds
-4.26
1,227.90
Commingling VAT
Commingling VAT
Page 1 of 1
0
-3,063.59
19.50
-1,356.12
-30.69
Credits
Credits
Credits
Credits
Legal name:
FBA Liquidations proceeds adjustments
0
-1,625.93
Sales, credits, and refunds
Delivery credit refunds
0
Receivables Deductions
Nanchangxibaoxuankejiyouxiangongsi
0
Transfers
Transfers
6,031.79
0
All fees listed include any applicable VAT.
10.00
-3,063.59
0
25.61
0
-32.98
Account activity from Jan 1, 2026 00:00 GMT to Jan 31, 2026 23:59 GMT
1,227.90
Seller-fulfilled product sales
FBA transaction fees
42.34
FBA transaction fee refunds
Refund for Advertiser
FBA liquidation proceeds
FBA selling fees
Carrier delivery label adjustments
0
FBA product sales
-446.56
Product, delivery and gift wrap taxes refunded
-1,208.40
URCGP
Amazon obligated tax withheld
FBA product sale refunds
0
Income
Income
0
0
Adjustments
6,031.79
28.77
Expenses
Expenses
Gift wrap credit refunds
Net taxes collected on product sales and services
Receivables Reversals
Totals
Promotional rebates
Charges to credit card and other debt recovery
Other transaction fees
Transfers to bank account
6,294.48
-272.13
`;

async function runTest(mode) {
    const isThinking = mode === 'enabled';
    console.log(`\n🚀 [测试启动] 正在进行 Mode = ${mode.toUpperCase()} (Thinking: ${isThinking ? '开启' : '关闭'}) ...`);
    
    const startTime = Date.now();
    try {
        const response = await axios.post('https://api.deepseek.com/chat/completions', {
            model: "deepseek-v4-flash",
            messages: [
                {
                    role: "system",
                    content: `你是一个专业的 Amazon 财务账单审计专家。
### 任务目标：
从极其错乱的 PDF 文本中还原财务核心数据。文本中的数字和标题往往是脱离的，请利用你的逻辑推理能力进行“对账”。

### 寻找策略（非常重要）：
1. **汇总数据 (Summaries)**：
   - **Income (收入总额)**：通读全文，寻找代表收入结算的总额。它通常是整个报表中最大的正数之一。
   - **Expenses (支出总额)**：寻找代表支出结算的总额。它通常是整个报表中绝对值最大的负数之一。

2. **详细费用项目 (Detailed Items)**：
   - **Cost of Advertising (广告费)**：寻找 Expenses 列表中的广告项。注意：不要误抓“总税额”或其他小额费用。它通常是一个显著的负数。
   - **Tax Collected (已收税款)**：在 Tax 区域寻找。寻找 "Product, delivery and gift wrap taxes collected" 对应的数值，通常是一个较大的正数。
   - **Tax Refunded (税款退款)**：在 Tax 区域寻找。寻找与 "taxes refunded" 明确对应的数值，通常是一个较小的负数。

### 注意事项：
- **忽略物理顺序**：数字可能在标题前，也可能在标题后，请通过金额特征（正负号、大小级数）来匹配。
- **排除干扰**：不要将“Net taxes”或“Subtotals”误认为单项费用。
- **数值符号**：必须保留原始的正负号。

请以 JSON 格式返回：
{
  "dateRange": "string",
  "income": number,
  "expenses": number,
  "adsCost": number,
  "taxCollected": number,
  "taxRefunded": number
}
只需返回 JSON。`
                },
                {
                    role: "user",
                    content: text
                }
            ],
            thinking: { type: mode },
            response_format: { type: 'json_object' }
        }, {
            headers: {
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        const data = JSON.parse(response.data.choices[0].message.content);
        const reasoning = response.data.choices[0].message.reasoning_content || '无思考过程';
        
        console.log(`✅ [Mode = ${mode.toUpperCase()}] 处理完成！耗时: ${duration}s`);
        console.log("提取出的数据结果:", JSON.stringify(data, null, 2));
        if (isThinking) {
            console.log(`思考过程长度: ${reasoning.length} 字符`);
        }
        
        return {
            mode,
            duration: parseFloat(duration),
            data,
            reasoningLen: reasoning.length
        };
    } catch (e) {
        console.error(`❌ [Mode = ${mode.toUpperCase()}] 发生错误:`, e.message);
        if (e.response) {
            console.error(JSON.stringify(e.response.data));
        }
        return { mode, error: e.message };
    }
}

async function testAll() {
    console.log("==================================================");
    console.log("     DeepSeek-v4-flash 提取性能对比测试 (测速)");
    console.log("==================================================");
    
    // 1. 测试启用 thinking
    const t1 = await runTest('enabled');
    
    // 2. 测试禁用 thinking
    const t2 = await runTest('disabled');
    
    console.log("\n=================== 对比结论 ===================");
    if (!t1.error && !t2.error) {
        const speedup = (t1.duration / t2.duration).toFixed(1);
        console.log(`1. 耗时对比:`);
        console.log(`   - 开启 Thinking: ${t1.duration} 秒 (其中思考了大约 ${t1.reasoningLen} 字符)`);
        console.log(`   - 禁用 Thinking: ${t2.duration} 秒 (0 字符思考直接输出)`);
        console.log(`   ➔ 禁用 Thinking 后，速度提升了 ${speedup} 倍！🚀`);
        
        console.log(`\n2. 提取质量对比 (数据对比):`);
        console.log(`   - 开启:`, JSON.stringify(t1.data));
        console.log(`   - 禁用:`, JSON.stringify(t2.data));
        
        const isSame = JSON.stringify(t1.data) === JSON.stringify(t2.data);
        console.log(`   ➔ 数据提取结果是否100%一致: ${isSame ? '✅ 100%完全一致！(零质量损失)' : '⚠️ 存在细微差别，需评估质量'}`);
    } else {
        console.log("测试过程中存在错误，请检查 API Key 或网络环境。");
    }
    console.log("================================================");
}

testAll();
