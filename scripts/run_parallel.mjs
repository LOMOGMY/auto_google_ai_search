#!/usr/bin/env node
// run_parallel.mjs — 多查询并发执行（work-stealing 动态调度）
//
// 维护一个最多 N 个活跃子进程的并发池：任意一个子进程完成后，
// 立刻从待执行队列拉下一个启动，直到全部完成。比"分批"调度更高效：
//
//   例：8 个查询耗时 [5, 5, 5, 5, 10, 10, 10, 20] 秒，上限 5
//     - 简单分批（5 + 3）：max(第一批) + max(第二批) = 10 + 20 = 30 秒
//     - 动态调度：任一完成即补位                          ≈ 20 秒
//
// 用法：
//   node run_parallel.mjs "query1" "query2" ...
//   node run_parallel.mjs -f queries.txt
//   cat queries.txt | node run_parallel.mjs
//
// 选项：
//   -c, --concurrency <n>   最大并发数（默认 5）
//   --max-wait <sec>        透传给 run_search.mjs（每个查询独立）
//   --proxy <url>           透传给 run_search.mjs
//   -f, --file <path>       从文件读查询（每行一个）
//
// 输出：合并 JSON 到 stdout
//   {
//     "queries": [...],
//     "concurrency": 5,
//     "stats": { "total_seconds": 18.4, "success_count": 8, "failure_count": 0 },
//     "results": [
//       { "query": "q1", "status": "fulfilled", "duration_seconds": 5.2, "result": {...} },
//       { "query": "q8", "status": "fulfilled", "duration_seconds": 18.1, "result": {...} },
//       ...
//     ]
//   }
//
// 前置依赖：同 run_search.mjs（CDP Proxy 已就绪）

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUN_SEARCH = resolve(__dirname, 'run_search.mjs');

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_MAX_WAIT = 30;
const DEFAULT_PROXY = process.env.WEB_ACCESS_PROXY || 'http://127.0.0.1:3456';

function parseArgs(argv) {
  const opts = {
    concurrency: DEFAULT_CONCURRENCY,
    maxWait: DEFAULT_MAX_WAIT,
    proxy: DEFAULT_PROXY,
    file: null,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-c' || a === '--concurrency') {
      opts.concurrency = parseInt(argv[++i], 10);
    } else if (a === '--max-wait') {
      opts.maxWait = parseInt(argv[++i], 10);
    } else if (a === '--proxy') {
      opts.proxy = argv[++i];
    } else if (a === '-f' || a === '--file') {
      opts.file = argv[++i];
    } else {
      positional.push(a);
    }
  }
  return { opts, positional };
}

function loadQueries(opts, positional) {
  if (opts.file) {
    const content = readFileSync(opts.file, 'utf-8');
    return content.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }
  if (positional.length > 0) return positional;
  if (process.stdin.isTTY) return [];
  const stdinContent = readFileSync(0, 'utf-8');
  return stdinContent.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

// 启动一个 run_search.mjs 子进程处理单个 query
function runOne(query, opts) {
  return new Promise((resolve) => {
    const start = Date.now();
    const args = [
      RUN_SEARCH,
      '--max-wait', String(opts.maxWait),
      '--proxy', opts.proxy,
    ];
    const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', (err) => {
      resolve({
        query, status: 'rejected',
        duration_seconds: (Date.now() - start) / 1000,
        error: 'spawn error: ' + err.message,
      });
    });
    child.on('close', (code) => {
      const duration = (Date.now() - start) / 1000;
      if (code !== 0) {
        resolve({
          query, status: 'rejected',
          duration_seconds: duration,
          error: 'exit code ' + code + (stderr ? '\nstderr: ' + stderr.slice(0, 500) : ''),
        });
        return;
      }
      try {
        const result = JSON.parse(stdout);
        resolve({ query, status: 'fulfilled', duration_seconds: duration, result });
      } catch (e) {
        resolve({
          query, status: 'rejected',
          duration_seconds: duration,
          error: 'JSON parse error: ' + e.message + '\nstdout head: ' + stdout.slice(0, 300),
        });
      }
    });
    child.stdin.write(query + '\n');
    child.stdin.end();
  });
}

// 并发池：N 个 worker 共享 nextIdx，任何 worker 完成就拉下一个
async function runParallel(queries, concurrency, opts) {
  const N = queries.length;
  const results = new Array(N);
  let nextIdx = 0;
  let completed = 0;

  async function worker(workerId) {
    while (true) {
      const myIdx = nextIdx++;
      if (myIdx >= N) return;
      const q = queries[myIdx];
      const slot = `[${myIdx + 1}/${N}]`;
      process.stderr.write(`[worker ${workerId}] ${slot} start: ${q.slice(0, 50)}\n`);
      const r = await runOne(q, opts);
      results[myIdx] = r;
      completed++;
      const tag = r.status === 'fulfilled' ? 'OK' : 'FAIL';
      process.stderr.write(`[worker ${workerId}] ${slot} ${tag} (${r.duration_seconds.toFixed(1)}s): ${q.slice(0, 50)}\n`);
    }
  }

  const workerCount = Math.min(concurrency, N);
  await Promise.all(Array.from({ length: workerCount }, (_, i) => worker(i)));
  return results;
}

async function main() {
  const { opts, positional } = parseArgs(process.argv.slice(2));
  const queries = loadQueries(opts, positional);

  if (queries.length === 0) {
    process.stderr.write('ERROR: no queries provided (use argv / -f / stdin)\n');
    process.exit(2);
  }
  if (opts.concurrency < 1) {
    process.stderr.write('ERROR: --concurrency must be >= 1\n');
    process.exit(2);
  }

  process.stderr.write(`[parallel] ${queries.length} queries, concurrency=${opts.concurrency}\n`);

  const start = Date.now();
  const results = await runParallel(queries, opts.concurrency, opts);
  const total = (Date.now() - start) / 1000;

  const success = results.filter(r => r.status === 'fulfilled').length;
  const failure = results.length - success;

  const output = {
    queries,
    concurrency: opts.concurrency,
    stats: {
      total_seconds: Math.round(total * 10) / 10,
      success_count: success,
      failure_count: failure,
    },
    results,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.exit(failure > 0 ? 1 : 0);
}

main().catch(err => {
  process.stderr.write('FATAL: ' + (err.stack || err.message) + '\n');
  process.exit(2);
});