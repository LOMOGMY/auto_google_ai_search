// extract_refs.js — 浏览器内运行的引用源提取脚本（由 run_search.mjs 通过 fs 读取后传给 CDP /eval）
// 返回：JSON 字符串（含 found、anchors、domainUrls）
//
// 注意：本文件由 fs.readFileSync 读为字符串，原样传给浏览器 eval。
// 因此本文件中的 JS 转义规则与浏览器内 JS 完全一致，无需考虑 Node 模板字符串的双重转义。

(() => {
  const c = document.querySelector("div.ub891.notranslate");
  if (!c) return JSON.stringify({ found: false, anchors: [], domainUrls: {} });

  // a) 直接 anchor（前 3 个稳定）
  const anchors = Array.from(c.querySelectorAll("a"))
    .filter(a => a.href && a.href.startsWith("http") && !a.href.includes("google."))
    .map(a => ({ href: a.href, ping: a.getAttribute("ping") || null }));

  // b) favicon 反查所有候选域名
  const html = document.documentElement.outerHTML;
  const reFav = /faviconV2\?url=https?:\/\/([^&"]+)/g;
  const domains = new Set();
  let m;
  while ((m = reFav.exec(html)) !== null) domains.add(m[1]);

  // c) 每个域名补全完整 URL
  const domainUrls = {};
  domains.forEach(d => {
    const esc = d.replace(/\./g, '\\.');  // 字面 . 转义为 \.，传给 RegExp
    const re = new RegExp('https?://' + esc + '[A-Za-z0-9_./?=%-]*', 'g');
    const matches = (html.match(re) || []);
    domainUrls[d] = [...new Set(matches.map(u => u.replace(/&amp;/g, '&')))];
  });

  return JSON.stringify({ found: true, anchors, domainUrls });
})();
