#!/usr/bin/env node
// run_search.mjs — 端到端 Google AI 搜索模式（AI Mode）抓取脚本
//
// 一行命令完成：创建后台 tab → 导航到 AI 搜索 → 等待 AI 回答 → 提取回答 + 引用 URL → 关闭 tab
// 输出：结构化 JSON（打印到 stdout）
//
// 用法（同 build_url.mjs）：
//   node run_search.mjs "<query>"
//   node run_search.mjs -f query.txt
//   echo "<query>" | node run_search.mjs
//
// 选项：
//   --max-wait <sec>     AI 回答渲染最长等待时间（默认 30）
//   --keep-tab           不关闭自创建的 tab（用于调试）
//   --proxy <url>        CDP Proxy 地址（默认 http://localhost:3456）
//
// 前置依赖：web-access skill 的 CDP Proxy 必须已就绪
//   (运行 `node .../web-access/scripts/check-deps.mjs` 启动)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_PROXY = process.env.WEB_ACCESS_PROXY || 'http://127.0.0.1:3456';
const DEFAULT_MAX_WAIT = 30;

function parseArgs(argv) {
  const opts = { maxWait: DEFAULT_MAX_WAIT, keepTab: false, proxy: DEFAULT_PROXY, filePath: null, query: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--max-wait') opts.maxWait = parseInt(argv[++i], 10);
    else if (a === '--keep-tab') opts.keepTab = true;
    else if (a === '--proxy') opts.proxy = argv[++i];
    else if (a === '-f' || a === '--file') opts.filePath = argv[++i];
    else if (!a.startsWith('--')) opts.query = (opts.query ? opts.query + ' ' : '') + a;
  }
  return opts;
}

function readStdin() {
  return new Promise(resolve => {
    let data = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getQuery(opts) {
  if (opts.filePath) return readFileSync(opts.filePath, 'utf-8').trim();
  if (opts.query) return opts.query.trim();
  return await readStdin();
}

// ====== CDP Proxy API 封装 ======

async function proxyNewTab(proxy, url) {
  const res = await fetch(`${proxy}/new`, { method: 'POST', body: url });
  if (!res.ok) throw new Error(`/new failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.targetId;
}

async function proxyNavigate(proxy, targetId, url) {
  const res = await fetch(`${proxy}/navigate?target=${targetId}`, { method: 'POST', body: url });
  if (!res.ok) throw new Error(`/navigate failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function proxyEval(proxy, targetId, jsCode) {
  const res = await fetch(`${proxy}/eval?target=${targetId}`, { method: 'POST', body: jsCode });
  if (!res.ok) throw new Error(`/eval failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (data.error) throw new Error(`/eval JS error: ${data.error}`);
  // Proxy 返回 {value: "<JSON 字符串化的 JS 返回值>"}，需要二次 parse
  return data.value;
}

async function proxyClick(proxy, targetId, selector) {
  const res = await fetch(`${proxy}/click?target=${targetId}`, { method: 'POST', body: selector });
  if (!res.ok) throw new Error(`/click failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function proxyClose(proxy, targetId) {
  const res = await fetch(`${proxy}/close?target=${targetId}`);
  if (!res.ok) throw new Error(`/close failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

// ====== 业务逻辑 ======

async function waitForAiReady(proxy, targetId, maxWaitSec) {
  // 完成标志：div.ub891.notranslate div.YoEHmf 出现（"全部显示" 按钮渲染 = AI 回答完成）
  const checkJs = '(()=>{const b=document.querySelector("div.ub891.notranslate div.YoEHmf");return !!b;})()';
  const start = Date.now();
  while (Date.now() - start < maxWaitSec * 1000) {
    await sleep(3000);
    try {
      const v = await proxyEval(proxy, targetId, checkJs);
      if (v === true || v === 'true') return { ready: true, waitedSec: Math.round((Date.now() - start) / 1000) };
    } catch (e) { /* tab 切换中，忽略 */ }
  }
  return { ready: false, waitedSec: maxWaitSec };
}

const EXTRACT_REFS_JS = readFileSync(join(__dirname, 'extract_refs.js'), 'utf-8');

const EXTRACT_TEXT_JS = '(()=>JSON.stringify({title:document.title,url:location.href,text:document.body.innerText}))()';

async function runSearch(query, opts) {
  const proxy = opts.proxy;
  const url = 'https://www.google.com/search?udm=50&q=' + encodeURIComponent(query);

  // 1) 创建后台 tab（先到 google.com 首页）
  const targetId = await proxyNewTab(proxy, 'https://www.google.com/');

  try {
    // 2) 导航到 AI 模式 URL
    await proxyNavigate(proxy, targetId, url);

    // 3) 等待 AI 回答完成
    const { ready, waitedSec } = await waitForAiReady(proxy, targetId, opts.maxWait);
    if (!ready) {
      // 即便没等到 "全部显示" 按钮，也尝试提取已有内容（可能回答部分渲染）
      process.stderr.write(`[warn] AI 回答在 ${opts.maxWait}s 内未完全就绪，仍尝试提取已有内容\n`);
    }

    // 4) 提取 AI 回答全文
    const textRaw = await proxyEval(proxy, targetId, EXTRACT_TEXT_JS);
    const textData = JSON.parse(textRaw);

    // 5) 点击 "全部显示" 展开引用
    let expandOk = false;
    try {
      await proxyClick(proxy, targetId, 'div.YoEHmf');
      await sleep(3000);
      expandOk = true;
    } catch (e) {
      process.stderr.write(`[warn] 点击展开按钮失败: ${e.message}\n`);
    }

    // 6) 提取引用 URL（anchor + favicon 反查）
    let refData = { found: false, anchors: [], domainUrls: {} };
    if (expandOk) {
      const refRaw = await proxyEval(proxy, targetId, EXTRACT_REFS_JS);
      refData = JSON.parse(refRaw);
    }

    // 7) 组装结构化引用列表
    const references = [];
    if (refData.found) {
      // anchor 来源
      refData.anchors.forEach(a => {
        // ping 属性中的 url= 参数是原始 URL
        let cleanUrl = a.href;
        if (a.ping) {
          const m = a.ping.match(/[?&]url=([^&]+)/);
          if (m) cleanUrl = decodeURIComponent(m[1]);
        }
        references.push({ url: cleanUrl, method: 'anchor', ping: a.ping });
      });
      // favicon 反查的域名 URL
      for (const [domain, urls] of Object.entries(refData.domainUrls)) {
        const alreadyListed = references.some(r => r.url.includes(domain));
        if (!alreadyListed && urls.length > 0) {
          // 取最长路径的 URL（通常是文章页，而非首页）
          const best = urls.filter(u => !u.includes('%25')).sort((a, b) => b.length - a.length)[0] || urls[0];
          references.push({ url: best, method: 'favicon', domain });
        }
      }
    }

    return {
      query,
      search_url: url,
      page_title: textData.title,
      page_url: textData.url,
      ai_answer: textData.text,
      references,
      stats: {
        wait_seconds: waitedSec,
        ready: ready,
        anchor_count: refData.anchors ? refData.anchors.length : 0,
        reference_count: references.length,
        favicon_domain_count: refData.domainUrls ? Object.keys(refData.domainUrls).length : 0
      }
    };
  } finally {
    // 8) 关闭 tab（除非 --keep-tab）
    if (!opts.keepTab) {
      try { await proxyClose(proxy, targetId); } catch (e) { /* 忽略关闭失败 */ }
    } else {
      process.stderr.write(`[info] tab 保留: targetId=${targetId}\n`);
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const query = await getQuery(opts);
  if (!query) {
    process.stderr.write('Error: empty query\n');
    process.stderr.write('Usage:\n');
    process.stderr.write('  node run_search.mjs "<query>"\n');
    process.stderr.write('  node run_search.mjs -f query.txt\n');
    process.stderr.write('  echo "<query>" | node run_search.mjs\n');
    process.exit(1);
  }

  try {
    const result = await runSearch(query, opts);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (e) {
    process.stderr.write(`Error: ${e.message}\n`);
    process.exit(1);
  }
}

main();
