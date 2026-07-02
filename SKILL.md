---
name: auto-google-ai-search
description: 自动通过 Google AI 搜索模式（AI Mode，udm=50）搜索查询并返回 AI 综合回答 + 完整引用 URL 列表。复用 web-access skill 的 CDP Proxy 直接驱动用户已登录的 Chrome。触发场景：用户说"用 google ai 搜"、"ai 搜索一下"、"google 一下"、"ai 查一下"、"/auto_google_ai_search <query>"等需要获取 AI 综合性回答（而非普通搜索结果）的场景。特别适合医疗、医学、健康、科普、技术等需要权威引用源的话题。
---

# auto_google_ai_search Skill

一行命令完成 Google AI 模式搜索：构造 URL → 创建后台 tab → 等待 AI 渲染 → 提取回答 + 引用 URL → 关闭 tab，返回结构化 JSON。

## 何时触发

- 用户明确提到 "google ai"、"ai 搜索"、"ai 模式"、"用 ai 搜一下"、"ai 查"
- 用户希望获取**综合性 AI 回答**而非普通搜索结果列表
- 用户需要回答中**附带权威引用源链接**（医疗、医学、政策、学术、科普）
- 用户用 `/<skill-name>` 显式调用本 skill

不触发场景：
- 用户只是要找具体网站/页面（用普通 WebSearch 即可）
- 用户要查 PubMed/USPSTF 等专业数据库（用对应专用 skill）

## 前置依赖

**本 skill 是 web-access skill 的"专项配方"，不重复实现 CDP 通信**。前置条件：

1. 已安装 web-access skill（路径：`.claude/skills/web-access/`）
2. CDP Proxy 已就绪——执行 `node .claude/skills/web-access/scripts/check-deps.mjs` 启动并校验
3. 用户已在 Chrome 中登录 Google 账号（AI 模式对登录态有要求；未登录时按 web-access 通用登录墙处理）

若 web-access 未就绪，先调用 web-access skill 完成 check-deps。

## 核心调用方式

```bash
# 方式 1：英文查询或 Linux/macOS 下中文（argv）
node .claude/skills/auto_google_ai_search/scripts/run_search.mjs "<query>"

# 方式 2：中文查询（Windows bash 推荐，避开 argv 编码损坏）
echo "<query>" | node .claude/skills/auto_google_ai_search/scripts/run_search.mjs

# 方式 3：从文件读取（最稳，跨平台）
node .claude/skills/auto_google_ai_search/scripts/run_search.mjs -f query.txt
```

**输出**：结构化 JSON，打印到 stdout（详见下方"输出结构"）。

## 完整调用模板（agent 推荐）

```bash
# 一行命令完成搜索，结果存入 result.json
echo "<query>" | node .claude/skills/auto_google_ai_search/scripts/run_search.mjs --max-wait 30 > /tmp/result.json 2>/tmp/err.log

# 检查
[ -s /tmp/result.json ] && echo "SUCCESS" || { echo "FAIL:"; cat /tmp/err.log; }
```

agent 拿到 JSON 后，按"输出解析规则"提取需要的内容返回给用户。

## 输出结构

```json
{
  "query": "用户输入的查询",
  "search_url": "https://www.google.com/search?udm=50&q=...",
  "page_title": "<query> - Google 搜索",
  "page_url": "实际页面 URL（含 Google 追踪参数）",
  "ai_answer": "AI 综合回答全文（含分点结构、内联引用标记如 '上海交通大学学报（医学版） +2'）",
  "references": [
    {
      "url": "https://...",
      "method": "anchor",        // 或 "favicon"
      "ping": "/url?sa=t&...",   // 仅 anchor 有
      "domain": "example.com"    // 仅 favicon 有
    }
  ],
  "stats": {
    "wait_seconds": 12,
    "ready": true,
    "anchor_count": 3,
    "reference_count": 15,
    "favicon_domain_count": 15
  }
}
```

### 引用 URL 提取方式

| method | 含义 | 可靠性 |
|--------|------|-------|
| `anchor` | 来自 `<a href>`，前 3 个稳定渲染 | 高 |
| `favicon` | 来自 faviconV2 接口反查 + 域名正则补全 | 中-高（覆盖剩余引用） |

`favicon` 方式取每个域名的最长路径 URL（通常是文章页），自动跳过双重 URL 编码（`%25`）的变体。

## 输出解析规则（agent 拿到 JSON 后的处理）

1. **`ai_answer`**：直接展示给用户，保留分点结构和内联引用标记（如 `Drugs.com +2` 表示该结论有 2 个引用）
2. **`references`**：按需整理成 markdown 表格：

   ```markdown
   ### 参考来源（共 N 个）

   | # | 来源域名 | URL | 提取方式 |
   |---|---------|-----|---------|
   | 1 | nhs.uk | https://... | anchor |
   | 2 | drugs.com | https://... | anchor |
   | ... | ... | ... | ... |
   ```

3. **不要**把所有 stats 都展示给用户，仅 `reference_count` 有意义

## 执行模式：默认串行，支持并行（上限 5）

**默认行为是串行**——单查询直接调一次 `run_search.mjs`，拿到结果就返回。**并行只是可选能力**，不是默认。

### 触发并行的条件（满足任一即可）

| 条件 | 用户输入示例 | 推荐处理 |
|------|------------|---------|
| ① 单查询 | "二甲双胍副作用"、"metformin adverse effects" | **串行**（无需并行） |
| ② 主题类输入 | "糖尿病防治"、"高血压的治疗" | 拆为 3-5 个具体查询后并行 |
| ③ 用户明确要求并行 | "**同时**搜 A 和 B"、"**并行**打开两个页面" | **必须并行** |
| ④ 多个并列具体查询 | "搜一下 1 型糖尿病治疗方案 和 2 型糖尿病治疗方案" | 并行派发 N 个子 Agent |
| ⑤ 简单对比 | "X 和 Y 的区别"、"X vs Y" | 并行派发 2 个 |

**关键词触发器**（任一出现即触发并行）：`同时`、`并行`、`一起`、`分别`、`对比`、`vs`、`差异`。

### 并行上限：**最多 5 个同时执行**

- 任意数量查询都可触发并行，上限 5 个同时活跃
- 上限不能突破，避免同时打开过多后台 tab 导致 Chrome 卡顿 / CDP Proxy 过载

### 并行实现方式（按场景选择）

**方式 A：`run_parallel.mjs`（推荐，任意数量）**

调用一次，内部维护最多 5 个并发的子进程池，**任一完成立刻从队列补位**（work-stealing 动态调度）。适合任意查询数量，包括 > 5 个：

```bash
# 8 个查询，内部动态池调度（实测比"分批"快约 14%）
node scripts/run_parallel.mjs "q1" "q2" "q3" "q4" "q5" "q6" "q7" "q8"

# 从文件读（每行一个）
node scripts/run_parallel.mjs -f queries.txt

# 中文用 stdin（最稳）
printf "q1\nq2\nq3\nq4\nq5" | node scripts/run_parallel.mjs
```

Agent 只需要调一次拿到合并 JSON 数组，无需维护分批状态、不需要派多个子 Agent。

**方式 B：web-access 子 Agent 分治（适合 ≤ 5 个查询）**

适合 ≤ 5 个查询、希望子 Agent 各自有完整 prompt 上下文时使用：

1. 主 agent 派 N 个子 agent（每个处理 1 个查询）
2. 每个子 agent **必须加载 web-access skill**（在 prompt 中写 `必须加载 web-access skill 并遵循指引`）
3. 每个子 agent 调用 `run_search.mjs`，自行创建 / 操作 / 关闭自己的后台 tab
4. 子 agent 把 JSON 结果返回给主 agent
5. 主 agent 等待所有子 agent 完成后汇总

> **> 5 个查询不要用方式 B**：agent 同步阻塞无法动态调度，必须用方式 A。

### 动态调度 vs 简单分批

`run_parallel.mjs` 的 work-stealing 调度比"严格分批"更高效。实测 8 查询示例：

| 调度方式 | 总耗时 |
|----------|--------|
| 简单分批（5 + 3 串行） | 28.2 秒 |
| 动态池（实际） | **24.2 秒**（省 14%） |

### 不并行的边界（保持串行即可）

- 单查询无并行收益
- 简单查询用普通 WebSearch 更轻量，不必启动 CDP 浏览器
- 用户没明确说"同时"/"并行"且只给了 1 个查询时，不要自作主张并行

## 输入编码与陷阱

### 陷阱 1：Windows bash 中文 argv 损坏

`node run_search.mjs "二甲双胍副作用"` 在 Windows bash 下中文会被替换为 `EF BF BD`（Unicode 替换字符）。

**解决**：
- 中文查询用 stdin（`echo "<query>" | node ...`）或文件（`-f query.txt`）
- 英文查询可直接用 argv

### 陷阱 2：CDP Proxy 必须就绪

若 `fetch failed` 报错，先运行 `node .claude/skills/web-access/scripts/check-deps.mjs`。

### 陷阱 3：AI 回答是渐进式渲染

`run_search.mjs` 内部已轮询等待（默认 30 秒，可用 `--max-wait` 调整）。复杂查询可能需要更长时间，可加到 60 秒：

```bash
echo "<复杂查询>" | node run_search.mjs --max-wait 60
```

## 命令行参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `<query>` (argv) | - | 直接传查询 |
| `-f <file>` / `--file <file>` | - | 从文件读查询 |
| （无 argv，有 stdin） | - | 从 stdin 读查询 |
| `--max-wait <sec>` | 30 | AI 回答最长等待秒数 |
| `--keep-tab` | false | 不关闭自创建的 tab（调试用） |
| `--proxy <url>` | http://127.0.0.1:3456 | CDP Proxy 地址 |

## 工具脚本

```
.claude/skills/auto_google_ai_search/scripts/
├── build_url.mjs       # 仅构造 URL（轻量，不调用 CDP）
├── run_search.mjs      # 完整端到端搜索（单查询，推荐）
├── run_parallel.mjs    # 多查询并发（动态池调度，上限 5，推荐用于 N≥2）
└── extract_refs.js     # 浏览器内运行的引用提取逻辑（run_search.mjs 内部使用）
```

### run_parallel.mjs 命令行参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `<query>...` (位置参数，N 个) | - | 直接传多个查询（按空格分割） |
| `-f <file>` / `--file <file>` | - | 从文件读查询（每行一个，跨平台最稳） |
| （无 argv，有 stdin） | - | 从 stdin 读查询（每行一个） |
| `-c <n>` / `--concurrency <n>` | 5 | 最大并发数 |
| `--max-wait <sec>` | 30 | 透传给 run_search.mjs（每个查询独立） |
| `--proxy <url>` | http://127.0.0.1:3456 | 透传给 run_search.mjs |

**输出结构**：合并 JSON 数组（按原始查询顺序），含每个查询的 status / duration_seconds / result。

**退出码**：0 = 全部成功；1 = 有失败；2 = 使用错误。

## 故障排查

| 症状 | 原因 | 处理 |
|------|------|------|
| `fetch failed` | CDP Proxy 未运行 | 跑 check-deps.mjs |
| `attach 失败: No target` | tab 已关闭或 targetId 失效 | 重跑（脚本会创建新 tab） |
| 中文 argv 乱码 | Windows bash 编码损坏 | 改用 stdin 或 -f |
| `ready=false` | AI 回答 30 秒内未渲染完成 | 加 `--max-wait 60` |
| references 只有 3 个 | 展开按钮未生效或页面结构变化 | 加 `--keep-tab` 调试，检查 DOM |

## 验证记录

| 日期 | 查询 | 类型 | 引用数 | 状态 |
|------|------|------|--------|------|
| 2026-06-30 | metformin side effects (英) | 药物 | 15 | ✅ |
| 2026-06-30 | 二甲双胍副作用与禁忌症 (中) | 药物 | 9+ | ✅ |
| 2026-06-30 | 司美格鲁肽副作用 | 药物 | 8 | ✅ |
| 2026-06-30 | 维生素D缺乏表现 | 营养 | 19 | ✅ |
| 2026-06-30 | atezolizumab adverse effects | 肿瘤 | 22 | ✅ |
