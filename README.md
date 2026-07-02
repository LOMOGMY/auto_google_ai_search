<!-- 顶部横幅图位置（建议尺寸 1280x320+）：展示一次 AI 搜索结果 + 引用卡片 -->

<p align="center">
  <b>一行命令完成 Google AI 模式搜索：AI 综合回答 + 全部引用源 URL。</b><br/>
  <a href="#30-秒跑起来">30 秒跑起来</a> · <a href="./SKILL.md">SKILL.md</a> · <a href="#故障排查">故障排查</a>
</p>

**auto_google_ai_search** 是一个 Claude Code Skill，让 Agent 用 Google AI 模式（`udm=50`，内置 Gemini 综合）搜索查询，自动提取 AI 回答全文 + 完整引用源 URL，一次返回结构化 JSON。适合医疗、医学、健康、政策、科普、技术等需要权威引用源的话题。

> 复用 [web-access Skill](https://github.com/eze-is/web-access)（[一泽 Eze](https://github.com/eze-is) 开发）的 CDP Proxy，无需独立浏览器、复用用户 Chrome 的 Google 登录态。本 skill 是 web-access 的"AI 搜索专项配方"，不重复实现浏览器自动化能力。

---

## 能力一览

| 能力 | 说明 |
|------|------|
| 一行命令端到端 | 创建后台 tab → 等待 AI 渲染 → 提取回答 + 引用 → 关闭 tab，输出 JSON |
| 完整引用 URL 还原 | 前 3 个稳定 anchor + favicon 反查，实测最多 22 个引用源全部还原 |
| 跨平台 | Windows / macOS / Linux 同名命令；中文查询 stdin 输入避开编码问题 |
| 自清理 | 后台 tab 用完自动关闭，不影响用户当前浏览器页面 |
| 默认串行 + 支持并行 | 单查询串行执行；用户说"同时"/"并行"或多并列查询时并行派发（上限 5 个，避免开太多 tab 卡顿） |
| 30 秒接入 | git clone + 一行 check-deps 即可使用，不需要任何配置文件 |

---

## 30 秒跑起来

```bash
# 1. 安装 skill
git clone https://github.com/LOMOGMY/auto_google_ai_search.git \
  .claude/skills/auto_google_ai_search

# 2. 确认 web-access 已就绪（首次会自动启动 CDP Proxy）
#    如未安装：git clone https://github.com/eze-is/web-access.git .claude/skills/web-access
node .claude/skills/web-access/scripts/check-deps.mjs

# 3. 一行命令搜索
echo "二甲双胍副作用与禁忌症" | node .claude/skills/auto_google_ai_search/scripts/run_search.mjs
```

输出（在 stdout，截取部分）：

```json
{
  "query": "二甲双胍副作用与禁忌症",
  "ai_answer": "二甲双胍（Metformin）是治疗 2 型糖尿病的第一线口服药物...",
  "references": [
    { "url": "https://news.bioon.com/article/dc4e843838d3.html", "method": "anchor" },
    { "url": "https://e.dxy.cn/wisdom/front/zhihuihao/6280", "method": "anchor" },
    { "url": "https://mpa.xinjiang.gov.cn/...", "method": "anchor" }
  ],
  "stats": { "ready": true, "reference_count": 9, "wait_seconds": 6 }
}
```

完事。AI 回答已在 `ai_answer`，全部引用源 URL 在 `references`。

---

## 安装

**方式一：git clone 到项目内（最直接）**

```bash
# Claude Code 项目级
git clone https://github.com/LOMOGMY/auto_google_ai_search.git \
  .claude/skills/auto_google_ai_search

# 全局（所有项目可用）
git clone https://github.com/LOMOGMY/auto_google_ai_search.git \
  ~/.claude/skills/auto_google_ai_search
```

**方式二：让 Agent 自动安装**

```
帮我安装这个 skill：https://github.com/LOMOGMY/auto_google_ai_search
```

Agent 会自动识别并部署到正确位置。

---

## 前置条件

| 条件 | 说明 |
|------|------|
| **[web-access skill](https://github.com/eze-is/web-access)** | 提供 CDP Proxy，必须先安装到 `.claude/skills/web-access/`（**本 skill 的运行时依赖**） |
| **Node.js 22+** | 脚本使用原生 `fetch`（Node 18+ 也兼容，但建议升级） |
| **用户已登录 Google 账号** | 本 skill 复用用户 Chrome 登录态。未登录时按 web-access 通用登录墙处理 |
| **Chrome / Edge 开启远程调试** | 一次性配置（`chrome://inspect/#remote-debugging` 勾选），详见 [web-access 文档](https://github.com/eze-is/web-access#%E5%89%8D%E7%BD%AE%E9%85%8D%E7%BD%AE) |

首次使用先运行：

```bash
node .claude/skills/web-access/scripts/check-deps.mjs
```

> Agent 每次任务启动时会自动跑这个前置检查，无需手动执行。

---

## 用法

### 对 Claude 说

skill 加载后，Agent 看到以下提示会自动触发：

- "用 google ai 搜一下 X"
- "ai 搜索：X"
- "用 ai 模式查 X"
- "google 一下 X"（带"综合回答"语境时）
- 显式调用：`/auto_google_ai_search X`

Agent 拿到 JSON 后，会自动把 AI 回答和引用源整理成结构化表格返回。

### 多查询并行（默认串行，可选并行）

**默认**：单查询串行调用一次 `run_search.mjs`。

**触发并行**（任一满足时）：

- 用户明确说"同时"/"并行"/"一起"/"分别"——例如："**同时**打开两个页面并行搜索"
- 用户给了多个并列的具体查询——例如："搜一下 1 型糖尿病治疗方案 和 2 型糖尿病治疗方案"
- 简单对比场景——例如："X 和 Y 的区别"、"X vs Y"
- 主题类输入——例如："糖尿病防治"（先拆为 3-5 个具体查询再并行）

**并行上限 5**：同时执行的任务数 ≤ 5。

**两种实现方式**：

| 场景 | 推荐方式 |
|------|---------|
| 任意数量（含 > 5） | **`run_parallel.mjs`**：调一次，内部动态池调度（work-stealing），任一完成立刻补位 |
| ≤ 5 个查询且需要子 Agent 各自处理 | web-access 子 Agent 分治：主 Agent 派 N 个子 Agent |

> 实测 8 查询示例：`run_parallel.mjs` 动态池比"分批（5+3 串行）"快约 14%。

详见 [SKILL.md 并行章节](./SKILL.md#执行模式默认串行支持并行上限-5)。

### 直接命令行调用

```bash
# 1) 英文查询（argv 直接传）
node scripts/run_search.mjs "metformin side effects"

# 2) 中文查询（Windows bash 推荐 stdin 传，避开 argv 中文编码损坏）
echo "二甲双胍副作用" | node scripts/run_search.mjs

# 3) 从文件读（最稳，跨平台一致）
node scripts/run_search.mjs -f my-query.txt

# 4) 复杂查询延长等待（默认 30 秒）
echo "atezolizumab immune checkpoint inhibitor adverse effects" \
  | node scripts/run_search.mjs --max-wait 60

# 5) 仅生成 AI 模式 URL，不调用浏览器
node scripts/build_url.mjs "vitamin D deficiency"
# → https://www.google.com/search?udm=50&q=vitamin%20D%20deficiency

# 6) 多查询并发（动态池调度，上限 5）
node scripts/run_parallel.mjs "metformin side effects" "lisinopril side effects" "amlodipine side effects"

# 7) 多查询并发，从文件读（每行一个）
node scripts/run_parallel.mjs -f queries.txt

# 8) 多查询并发 + 自定义并发上限
node scripts/run_parallel.mjs -c 3 -f queries.txt
```

### 命令行参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `<query>` (位置参数) | — | 直接传查询 |
| `-f <file>` / `--file <file>` | — | 从文件读查询（推荐用于中文） |
| (stdin) | — | 无参数且 stdin 非 TTY 时从 stdin 读 |
| `--max-wait <sec>` | 30 | AI 回答渲染最长等待秒数 |
| `--keep-tab` | false | 不关闭自创建的 tab（调试用） |
| `--proxy <url>` | `http://127.0.0.1:3456` | CDP Proxy 地址 |

### run_parallel.mjs 专属参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `<query>...` (位置参数，N 个) | — | 直接传多个查询 |
| `-f <file>` / `--file <file>` | — | 从文件读查询（每行一个） |
| (stdin) | — | 无参数且 stdin 非 TTY 时从 stdin 读 |
| `-c <n>` / `--concurrency <n>` | 5 | 最大并发数 |
| `--max-wait <sec>` | 30 | 透传给每个 run_search.mjs 子进程 |
| `--proxy <url>` | `http://127.0.0.1:3456` | CDP Proxy 地址 |

**输出**：合并 JSON 数组（按原始查询顺序），每个结果含 `status`（fulfilled / rejected）、`duration_seconds`、`result`（run_search.mjs 的输出）。

**退出码**：0 = 全部成功；1 = 有失败；2 = 使用错误。

---

## 输出结构

```json
{
  "query": "原始查询",
  "search_url": "https://www.google.com/search?udm=50&q=...",
  "page_title": "<query> - Google 搜索",
  "page_url": "实际页面 URL（含 Google 追踪参数）",
  "ai_answer": "AI 综合回答全文（含分点结构 + 内联引用标记）",
  "references": [
    {
      "url": "https://www.nhs.uk/medicines/metformin/...",
      "method": "anchor",        // 或 "favicon"
      "ping": "/url?sa=t&...",   // 仅 anchor 有，Google 跳转追踪
      "domain": "nhs.uk"         // 仅 favicon 有
    }
  ],
  "stats": {
    "wait_seconds": 6,
    "ready": true,
    "anchor_count": 3,
    "reference_count": 15,
    "favicon_domain_count": 15
  }
}
```

**字段使用建议**：

- `ai_answer`：直接展示给用户，保留分点结构
- `references`：整理为 markdown 表格（仅看 `url` 和 `method` 即可）
- `stats`：仅 `reference_count` 对用户有意义

**引用 URL 提取方式**：

| method | 含义 | 可靠性 |
|--------|------|-------|
| `anchor` | 来自页面 `<a href>`，前 3 个稳定渲染 | 高 |
| `favicon` | faviconV2 接口反查 + 域名正则补全 | 中-高（覆盖剩余引用） |

---

## 工作原理（4 步）

1. **构造 URL**：`https://www.google.com/search?udm=50&q=<encoded>` —— `udm=50` 是 AI 模式标识符
2. **等待 AI 渲染**：轮询 `div.ub891.notranslate div.YoEHmf` 出现，作为 AI 回答完成标志（避免"再多想一会儿"等流式渲染干扰）
3. **提取回答 + 展开引用**：先读 `document.body.innerText` 得 AI 全文，再点击 "全部显示" 按钮展开全部引用卡片
4. **提取 URL**：3 个稳定 anchor（直接拿 href）+ faviconV2 反查剩余 12-22 个域名（每个域名取最长路径 URL）

详见 [SKILL.md](./SKILL.md) 中的"已知陷阱"章节（含调试时遇到的真实坑位）。

---

## 故障排查

| 症状 | 原因 | 处理 |
|------|------|------|
| `fetch failed` | CDP Proxy 没运行 | 跑 `node .claude/skills/web-access/scripts/check-deps.mjs` |
| `attach 失败: No target` | tab 已关闭或 targetId 失效 | 重跑（脚本会创建新 tab） |
| 中文 argv 乱码 | Windows bash 中文编码损坏 | 改用 stdin：`echo "<query>" \| node run_search.mjs` |
| `ready: false` 或 wait 拉满 | AI 回答 30 秒内未渲染完成 | 加 `--max-wait 60` |
| references 只有 3 个 | 展开按钮未生效或页面结构变化 | 加 `--keep-tab` 调试，检查 DOM |
| 登录墙提示 | 用户 Chrome 未登录 Google | 告诉用户"请登录 Google 账号后重试" |
| `run_parallel.mjs` Chrome 卡顿 | 并发过高，单 tab 内存 100-200MB | 减 `-c` 到 3 或更少 |
| `run_parallel.mjs` 部分查询 status=rejected | 单个 run_search.mjs 失败 | 看 stderr 的 worker 日志定位具体查询 |

详细故障排查见 [SKILL.md 故障排查清单](./SKILL.md#故障排查清单)。

---

## 文件结构

```
.claude/skills/auto_google_ai_search/
├── SKILL.md              # Claude Code 加载：触发条件、调用方式、详细陷阱
├── README.md             # 本文件：用户视角快速入门
└── scripts/
    ├── build_url.mjs     # 轻量工具：query → AI 模式 URL（不调浏览器）
    ├── run_search.mjs    # 端到端主脚本：单查询搜索 + 抓取 + 输出 JSON
    ├── run_parallel.mjs  # 多查询并发（动态池调度，上限 5，推荐用于 N≥2）
    └── extract_refs.js   # 浏览器内引用的提取逻辑（被 run_search.mjs 调用）
```

---

## 验证场景

| 查询类型 | 示例 | 引用数 | 状态 |
|---------|------|--------|------|
| 药物安全（英） | metformin side effects | 15 | ✅ |
| 药物安全（中） | 二甲双胍副作用与禁忌症 | 9+ | ✅ |
| 疾病治疗（中） | 高血压分级与一线治疗方案 | 10 | ✅ |
| 营养学（中） | 维生素 D 缺乏表现 | 19 | ✅ |
| 肿瘤免疫（英） | atezolizumab adverse effects | 22 | ✅ |

---

## 设计哲学

> Skill = 哲学 + 技术事实，不是操作手册。讲清 tradeoff 让 AI 自己选，不替它推理。

本 skill 继承 [web-access](https://github.com/eze-is/web-access) 的设计哲学：
- **不重复造轮子**：复用 web-access 的 CDP Proxy，本 skill 只做"AI 搜索"专项逻辑
- **JSON 黑盒输出**：对外只暴露结构化结果，Agent 不需要懂 DOM / 反爬 / CDP
- **可降级**：网络失败或 Google 改版时输出明确错误而非静默错误

详情见 [SKILL.md](./SKILL.md)。

---

## 依赖与致谢

本 skill 依赖以下开源项目：

- **[web-access](https://github.com/eze-is/web-access)** by [一泽 Eze](https://github.com/eze-is) — 提供 CDP Proxy 浏览器自动化能力（CDP / new / eval / click / close 等 HTTP API）。本 skill 复用其 Proxy 完成所有浏览器操作，未修改其源码。

特别感谢 web-access 提供的"Skill = 哲学 + 技术事实"设计哲学和 [设计详解](https://mp.weixin.qq.com/s/rps5YVB6TchT9npAaIWKCw) 文章。

---

## License

MIT
