# 泽坤财务工具中台 (Financial Tool Hub)

这是一个专为泽坤财务部门打造的、高度集成的自动化工具中台。它整合了多项日常财务核算、物流账单处理以及结算报表分析功能，旨在通过自动化流程提升办公效率。

---

## 🚀 快速启动

1.  **直接运行**：双击根目录下的 **`start.bat`** 即可自动运行安装依赖并启动服务。
2.  **访问工具**：启动后会自动打开浏览器，或者手动在浏览器中访问 [http://localhost:8081](http://localhost:8081)。

---

## 🛠 核心工具介绍

### 1. PDF 结算报表分析 (AI 驱动) - `/pdf-analyze`
*   **功能**：深度解析 Amazon 原始 PDF 结算报告（支持德语、法语、西班牙语等多语言）。
*   **特性**：
    *   集成 **DeepSeek AI + 本地解析双重引擎**，自动提取销售额 (Income)、各项费用 (Expenses)、广告费 (Ads) 以及税费明细。
    *   自动抓取 **中国银行实时汇率**，完成汇率自动换算，并生成标准月度汇总 Excel 报表。
    *   支持配置“关键字 -> 公司主体”的映射关系，实现报表自动化归属。

### 2. 国内运费账单处理
*   **功能**：快速匹配自建仓发货数据与 4PX 运费账单。
*   **特性**：
    *   支持 **多文件批量上传**。
    *   自动建立“运单号”索引，实现毫秒级数据匹配与差异核对。
    *   输出结果直接填充至标准财务模板，保留原始格式。

### 3. 收款汇总表处理
*   **功能**：财务月度流水对账。
*   **特性**：
    *   高效整合 **万里汇 (WorldFirst)**、**PayPal**、**Shopify** 三方平台流水。
    *   自动核算各主体、各站点的收款情况，支持自定义汇率表统一折算。

### 4. 物流账单处理
*   **功能**：处理物流周/月度总账单。
*   **特性**：
    *   支持跨表汇总、费用分摊与店铺分组统计，提供详细的异常日志。

---

## 📁 项目结构说明

```text
financial-data/
├── pdf-analyze/                # PDF 结算报表分析子系统 (Express 后端 + 原生前端)
│   ├── public/                 # 报表分析系统前端静态资源 (HTML/CSS/JS)
│   ├── uploads/                # PDF 临时上传及解析缓存目录 (已在 Git 屏蔽)
│   ├── data/history/           # 导出的历史 Excel 报表目录 (已在 Git 屏蔽)
│   ├── .env.example            # 报表分析系统环境变量模板
│   ├── server.js               # 报表分析系统后端服务
│   └── package.json            # 报表分析依赖配置
│
├── uploads/                    # 主系统临时文件上传目录 (已在 Git 屏蔽)
├── .env.example                # 主系统环境变量模板
├── .gitignore                  # Git 屏蔽规则配置文件 (保护秘钥和缓存)
├── fx_crawler_pro.py           # 中国银行外汇牌价实时抓取脚本 (Python)
├── yes_captcha_solver.py       # 验证码识别辅助脚本 (Python)
├── server.js                   # 财务中台中央控制端服务
├── start.bat                   # 一键安装依赖并运行的批处理脚本
├── index.html                  # 财务中台门户主页
├── 国内运费账单处理工具v1.0.html # 运费核算单页面工具 (纯前端)
├── 收款汇总表处理工具v1.0.html   # 流水对账单页面工具 (纯前端)
└── 物流账单处理工具v1.0.html     # 物流总账单页面工具 (纯前端)
```

---

## 🔒 敏感信息与环境配置

出于安全考虑，敏感 API 密钥与本地运行时产生的缓存数据已全部在 Git 中屏蔽。启动前请根据以下步骤配置环境变量：

### 1. 中台主系统配置
*   复制根目录下的 `.env.example` 并重命名为 `.env`：
    ```bash
    cp .env.example .env
    ```
*   编辑 `.env` 文件，填入您的 **YesCaptcha 客户端 Key**：
    ```env
    YESCAPTCHA_CLIENT_KEY=您的客户端密钥
    TARGET_SOURCE=investing
    ```

### 2. PDF 分析子系统配置
*   进入 `pdf-analyze/` 目录，复制 `.env.example` 并重命名为 `.env`：
    ```bash
    cp pdf-analyze/.env.example pdf-analyze/.env
    ```
*   编辑 `.env` 文件，填入您的 **DeepSeek API Key** 以及 **腾讯云 COS 存储桶凭证**（用于临时托管上传的 PDF，解析后自动清理）：
    ```env
    COS_SECRET_ID=您的腾讯云COS密钥ID
    COS_SECRET_KEY=您的腾讯云COS密钥KEY
    COS_BUCKET=您的存储桶名称
    COS_REGION=ap-shanghai
    DEEPSEEK_API_KEY=您的DeepSeek_API密钥
    ```

---

## 🔧 环境要求

*   **Node.js**: v16.x 或更高版本（建议安装 LTS 版本）。
*   **Python**: v3.8+（抓取汇率脚本运行环境，如不需要实时更新汇率可不配置）。
*   **浏览器**: 推荐使用 Google Chrome 或新版 Microsoft Edge。

---

© 2026 泽坤AI部团队
