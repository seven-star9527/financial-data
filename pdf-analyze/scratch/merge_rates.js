const fs = require('fs');
const path = require('path');

const EXPORT_JSON = path.join(__dirname, '..', '..', 'boc_fx_rates_export.json');
const MONTHLY_RATES_FILE = path.join(__dirname, '..', 'boc_fx_rates_monthly.json');

function mergeRates() {
    if (!fs.existsSync(EXPORT_JSON)) {
        console.error("Export file not found:", EXPORT_JSON);
        return;
    }

    const crawlerData = JSON.parse(fs.readFileSync(EXPORT_JSON, 'utf-8'));
    let monthlyRates = {};
    if (fs.existsSync(MONTHLY_RATES_FILE)) {
        monthlyRates = JSON.parse(fs.readFileSync(MONTHLY_RATES_FILE, 'utf-8'));
    }

    let mergeCount = 0;
    for (const [currency, valueMap] of Object.entries(crawlerData)) {
        if (!monthlyRates[currency]) {
            monthlyRates[currency] = {};
        }
        for (const [month, rate] of Object.entries(valueMap)) {
            if (monthlyRates[currency][month] !== rate) {
                monthlyRates[currency][month] = rate;
                mergeCount++;
            }
        }
    }

    fs.writeFileSync(MONTHLY_RATES_FILE, JSON.stringify(monthlyRates, null, 2), 'utf-8');
    console.log(`Successfully merged ${mergeCount} rates into ${MONTHLY_RATES_FILE}`);
}

mergeRates();
