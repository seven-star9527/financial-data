const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

async function test() {
    console.log("DEEPSEEK_API_KEY:", DEEPSEEK_API_KEY ? "Loaded" : "Not found");
    const systemPrompt = `你是一个幽默、有超强“活人感”的打工人。请根据今天的日期、星期几和本周的大小周放假状态，生成一句极具共鸣的打工人上班心情语录。`;
    const userPrompt = `今天是 2026-05-25，星期一，本周放假状态为：【双休】。请为我写一句今天的心情语录。`;

    try {
        console.log("Sending request to deepseek-v4-flash...");
        const response = await axios.post('https://api.deepseek.com/chat/completions', {
            model: "deepseek-v4-flash",
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
            }
        });
        
        console.log("Raw Response Data:", JSON.stringify(response.data, null, 2));
    } catch (e) {
        console.error("Error:", e.message);
        if (e.response) {
            console.error("Error details:", JSON.stringify(e.response.data, null, 2));
        }
    }
}

test();
