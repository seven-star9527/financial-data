# 亚马逊 PDF 批量分析工具 (Amazon PDF Analyzer)

这是一个专为亚马逊卖家设计的财务报表自动化工具。它可以批量解析亚马逊 Seller Central 导出的汇总 PDF 报表，自动识别国家、折算汇率，并直接生成标准化的 Excel 汇总表。

## 🌟 核心功能

- **自动化解析**：采用 DeepSeek LLM + 本地解析双重机制，精准提取 `Income` (收入)、`Expenses` (费用)、`Ads` (广告)、`Tax` (税金) 等核心财务数据。
- **动态汇率折算**：
    - 实时从 **中国银行 (BOC)** 抓取 30+ 种主流货币的现汇买入价。
    - 自动根据 PDF 文件名识别国家并匹配对应汇率。
- **灵活配置**：
    - **公司主体映射**：支持在前端配置“关键字 -> 公司名称”的映射规则（如：文件名含“惜抱轩”则自动填入“南昌惜抱轩科技有限公司”）。
    - **本地持久化**：配置规则自动保存于浏览器，无需重复输入。
- **标准化报表生成**：
    - 直接生成格式规范的 `亚马逊汇总表.xlsx`。
    - **动态表头**：自动根据账单月份更新表头（如 `1月--销售额汇总`）。
    - **财务格式**：所有数值保留两位小数，**负数自动标红**。
- **云端存储集成**：集成腾讯云 COS，实现解析过程中的临时文件托管与自动清理。

## 🛠️ 技术栈

- **后端**：Node.js + Express
- **前端**：原生 HTML5 + CSS3 (Glassmorphism 风格) + JavaScript
- **AI 引擎**：DeepSeek Chat API
- **Excel 处理**：SheetJS (xlsx)
- **存储**：腾讯云 COS SDK

## 🚀 快速开始

### 1. 环境准备
确保已安装 [Node.js](https://nodejs.org/) (建议 v16+)。

### 2. 配置环境变量
在项目根目录创建 `.env` 文件，并填入以下配置：
```env
# DeepSeek API
DEEPSEEK_API_KEY=your_deepseek_api_key

# 腾讯云 COS 配置
COS_SECRET_ID=your_cos_id
COS_SECRET_KEY=your_cos_key
COS_BUCKET=your_bucket_name
COS_REGION=ap-shanghai
```

### 3. 安装依赖
```bash
npm install
```

### 4. 启动服务
```bash
node server.js
```
访问 `http://localhost:3000` 即可开始使用。

## 📝 使用说明

1. **配置映射**：在网页“公司主体配置”板块添加您的匹配规则。
2. **更新汇率**：点击“手动获取最新汇率”确保换算准确。
3. **上传 PDF**：直接拖入或选择从亚马逊下载的 `CustomSummary.pdf` 文件（支持批量）。
4. **生成下载**：系统处理完成后，点击下载生成的 Excel 报表。

## 📂 目录结构

- `/public`: 前端网页资源 (HTML/JS/CSS)
- `/uploads`: 临时文件处理目录
- `server.js`: 后端核心逻辑与 API
- `exchange_rates.json`: 缓存的汇率数据

## ⚖️ 许可证

MIT License
