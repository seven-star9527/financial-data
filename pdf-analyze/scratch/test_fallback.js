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
            if (/^-?[\d,]+\.\d{2}$/.test(cleanLine) || /^-?\$?[\d,]+\.\d{2}$/.test(cleanLine)) {
                return parseFloat(cleanLine.replace(/\$/g, '')) || 0;
            }
        }
        const lineMatch = lines[index].match(/-?[\d,]+\.\d{2}/);
        if (lineMatch) return parseFloat(lineMatch[0].replace(/,/g, '')) || 0;
        return 0;
    };

    const income = findAmountAfterLabel("Income");
    const expenses = findAmountAfterLabel("Expenses");
    const adsCost = findAmountAfterLabel("Cost of Advertising")
        || findAmountAfterLabel("Werbekosten")
        || findAmountAfterLabel("Costo della pubblicità")
        || findAmountAfterLabel("Costo de la publicidad")
        || findAmountAfterLabel("Prix de la publicité")
        || findAmountAfterLabel("Gastos de publicidad");

    const taxCollected = findAmountAfterLabel("Product, delivery and gift wrap taxes collected");
    const taxRefunded = findAmountAfterLabel("Product, delivery and gift wrap taxes refunded");

    // NEW: extract Refund for Advertiser
    const adsRefund = findAmountAfterLabel("Refund for Advertiser")
        || findAmountAfterLabel("Gutschrift für Inserenten")
        || findAmountAfterLabel("Rimborso per inserzionista")
        || findAmountAfterLabel("Reembolso para el promotor")
        || findAmountAfterLabel("Reembolso para anunciante")
        || findAmountAfterLabel("Remboursement pour le publicitaire");

    return { dateRange, income, expenses, adsCost, taxCollected, taxRefunded, adsRefund };
}

async function run() {
    const dataDir = path.join(__dirname, '..', 'data');
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.pdf'));

    for (const file of files) {
        console.log(`\nFILE: ${file}`);
        const text = await parsePdfLocally(path.join(dataDir, file));
        const res = extractDataFromText(text);
        console.log(JSON.stringify(res, null, 2));
    }
}

run().catch(console.error);
