const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

async function parsePdfLocally(filePath) {
    const dataBuffer = fs.readFileSync(filePath);
    const options = {
        pagerender: async function (pageData) {
            const textContent = await pageData.getTextContent();
            let lastY = null;
            let text = '';
            let items = textContent.items.sort((a, b) => {
                const yDiff = b.transform[5] - a.transform[5];
                if (Math.abs(yDiff) > 5) return yDiff;
                return a.transform[4] - b.transform[4];
            });
            for (let item of items) {
                const currentY = item.transform[5];
                if (lastY !== null && Math.abs(lastY - currentY) > 5) {
                    text += '\n';
                } else if (lastY !== null) {
                    text += '    ';
                }
                text += item.str;
                lastY = currentY;
            }
            return text;
        }
    };
    const data = await pdfParse(dataBuffer, options);
    return data.text;
}

async function run() {
    const dataDir = path.join(__dirname, '..', 'data');
    
    const deFile = path.join(dataDir, '惜抱轩德国-2026Jan1-2026Jan31CustomSummary (1).pdf');
    console.log("=== GERMAN CUSTOM SUMMARY ===");
    console.log(await parsePdfLocally(deFile));

    const itFile = path.join(dataDir, '雅甄2026JanMonthlySummary (IT).pdf');
    if (fs.existsSync(itFile)) {
        console.log("=== ITALIAN MONTHLY SUMMARY ===");
        console.log(await parsePdfLocally(itFile));
    }
}

run().catch(console.error);
