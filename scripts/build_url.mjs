#!/usr/bin/env node
// build_url.mjs — 把任意查询字符串转为 Google AI 模式（udm=50）搜索 URL
//
// 用法（按推荐度排序）：
//   1) 文件输入（最稳，跨平台，避免 shell 编码问题）：
//        node build_url.mjs path/to/query.txt
//        node build_url.mjs -f path/to/query.txt
//
//   2) stdin 输入（heredoc 友好）：
//        echo "二甲双胍副作用" | node build_url.mjs
//        node build_url.mjs <<EOF
//        二甲双胍副作用
//        EOF
//
//   3) argv 输入（Linux/macOS 友好；Windows 下中文可能损坏，不推荐）：
//        node build_url.mjs "二甲双胍副作用"
//
// 输出：单行 URL，例如：
//   https://www.google.com/search?udm=50&q=%E4%BA%8C%E7%94%B2%E5%8F%8C...

import { readFileSync } from 'node:fs';

function readStdin() {
  return new Promise(resolve => {
    let data = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
  });
}

function buildUrl(query) {
  return 'https://www.google.com/search?udm=50&q=' + encodeURIComponent(query);
}

async function main() {
  const argv = process.argv.slice(2);
  let query = '';

  // 处理 -f / --file 标志
  const fileIdx = argv.findIndex(a => a === '-f' || a === '--file');
  let filePath = null;
  if (fileIdx >= 0) {
    filePath = argv[fileIdx + 1];
    argv.splice(fileIdx, 2);
  }

  if (filePath) {
    // 文件输入
    query = readFileSync(filePath, 'utf-8').trim();
  } else if (argv.length > 0) {
    // argv 输入
    query = argv.join(' ').trim();
  } else {
    // stdin 输入
    query = await readStdin();
  }

  if (!query) {
    process.stderr.write('Error: empty query\n');
    process.stderr.write('Usage:\n');
    process.stderr.write('  node build_url.mjs "<query>"\n');
    process.stderr.write('  node build_url.mjs -f query.txt\n');
    process.stderr.write('  echo "<query>" | node build_url.mjs\n');
    process.exit(1);
  }

  process.stdout.write(buildUrl(query) + '\n');
}

main();
