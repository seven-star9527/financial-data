const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

// Copying functions exactly as they will be in the patched server.js to test layout extraction
async function parsePdfWithLayout(filePath) {
    const dataBuffer = fs.readFileSync(filePath);
    let hasLabelLoss = false;
    let layoutRows = [];

    const options = {
        pagerender: async function (pageData) {
            const textContent = await pageData.getTextContent();
            
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

async function run() {
    const jpFile = path.join(__dirname, '..', 'data', '1月泰扬日本2026JanMonthlySummary.pdf');
    console.log("Parsing Japanese PDF:", jpFile);
    const layoutRes = await parsePdfWithLayout(jpFile);
    console.log("Label Loss Detected:", layoutRes.hasLabelLoss);
    
    const extracted = extractDataByLayout(layoutRes.layoutRows);
    console.log("\n--- Extraction Results ---");
    console.log(JSON.stringify(extracted, null, 2));

    const expected = {
        income: 1635005,
        expenses: -805057,
        adsCost: -262153,
        taxCollected: 164375,
        taxRefunded: -697,
        adsRefund: 0
    };

    console.log("\n--- Validation ---");
    let allMatch = true;
    for (let key in expected) {
        const actual = extracted[key];
        const match = actual === expected[key];
        console.log(`  ${match ? '✅' : '❌'} ${key}: Expected=${expected[key]}, Actual=${actual}`);
        if (!match) allMatch = false;
    }
    
    if (allMatch) {
        console.log("\n🎉 SUCCESS! All layout-based extraction matches exactly!");
    } else {
        console.log("\n❌ FAILED! Mismatches found.");
        process.exit(1);
    }
}

run().catch(console.error);
