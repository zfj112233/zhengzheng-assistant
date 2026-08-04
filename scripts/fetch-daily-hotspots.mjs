import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const outFile = existsSync(resolve(process.cwd(), "public"))
  ? resolve(process.cwd(), "public/data/hotspots.json")
  : resolve(process.cwd(), "data/hotspots.json");
const now = new Date();
const badUrlWords = /ad|ads|login|passport|download|apk|appdownload|redirect|jump|track|union|promo|market/i;
const badTitleWords = /广告|推广|优惠|返利|招商|加盟|贷款|理财|下载|APP|直播间|带货|福利|抽奖|必买|秒杀|标题党|携手|报名|免费接驳|赞助|冠名/;
const trustedHosts = [
  "cctv.com", "people.com.cn", "xinhuanet.com", "news.cn", "baidu.com", "sina.com.cn", "sina.cn", "chinanews.com.cn",
  "thepaper.cn", "yicai.com", "jiemian.com", "caixin.com", "gmw.cn", "china.com.cn"
];

const sources = [
  { name: "人民网", type: "rss", url: "http://www.people.com.cn/rss/politics.xml" },
  { name: "新华网", type: "rss", url: "http://www.xinhuanet.com/politics/news_politics.xml" },
  { name: "中新网", type: "rss", url: "https://www.chinanews.com.cn/rss/scroll-news.xml" },
  { name: "界面新闻", type: "rss", url: "https://a.jiemian.com/index.php?m=article&a=rss" },
  { name: "百度热榜", type: "baidu", url: "https://top.baidu.com/api/board?platform=wise&tab=realtime" },
  { name: "新浪新闻要闻", type: "sina", url: "https://interface.sina.cn/news/wap/fymap2020_data.d.json" }
];

function stripHtml(value = "") {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function compactSummary(title, summary = "") {
  const clean = stripHtml(summary).replace(title, "").trim();
  const text = clean || "来自公开可信来源的最新资讯，点击可查看原文。";
  return text.length > 80 ? `${text.slice(0, 78)}…` : text;
}

function validUrl(url) {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    if (badUrlWords.test(url)) return false;
    return trustedHosts.some(host => parsed.hostname.endsWith(host));
  } catch {
    return false;
  }
}

function freshEnough(publishedAt) {
  if (!publishedAt) return true;
  const age = now.getTime() - new Date(publishedAt).getTime();
  return Number.isFinite(age) && age > -6 * 3600_000 && age < 36 * 3600_000;
}

function normalizeUrl(url = "") {
  return url.replace(/^http:\/\//, "https://").replace(/[?#].*utm_[^#]+/i, "");
}

function dateFromUrl(url = "") {
  const match = url.match(/\/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\//) || url.match(/\/(20\d{2})(\d{2})(\d{2})\//);
  if (!match) return "";
  const [, y, m, d] = match;
  return new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T08:00:00+08:00`).toISOString();
}

function parseRss(xml, source) {
  const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)];
  return items.map(match => {
    const raw = match[0];
    const pick = tag => stripHtml(raw.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "");
    const title = pick("title");
    const link = normalizeUrl(pick("link"));
    const pub = pick("pubDate") || pick("lastBuildDate");
    const publishedAt = pub ? new Date(pub).toISOString() : dateFromUrl(link);
    return { title, summary: compactSummary(title, pick("description")), source, url: link, publishedAt, fetchedAt: now.toISOString() };
  });
}

function parseBaidu(json) {
  const data = json?.data?.cards?.flatMap(card => card.content || []).flatMap(item => item.content || item) || json?.data?.realtime || [];
  return data.map(item => {
    const title = stripHtml(item.word || item.query || item.title);
    const url = normalizeUrl(item.url || `https://www.baidu.com/s?wd=${encodeURIComponent(title)}`);
    return {
      title,
      summary: compactSummary(title, item.desc || item.abstract || `百度热榜正在关注：${title}`),
      source: "百度热榜",
      url,
      publishedAt: now.toISOString(),
      fetchedAt: now.toISOString()
    };
  });
}

function parseSina(json) {
  const rows = Object.values(json?.data || {}).flatMap(value => Array.isArray(value) ? value : []);
  return rows.map(item => {
    const title = stripHtml(item.title || item.name);
    return {
      title,
      summary: compactSummary(title, item.summary || item.desc || "新浪新闻要闻"),
      source: "新浪新闻要闻",
      url: normalizeUrl(item.url || item.link || ""),
      publishedAt: item.time ? new Date(item.time).toISOString() : now.toISOString(),
      fetchedAt: now.toISOString()
    };
  });
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 zhengzheng-assistant hotspot fetcher",
      "accept": "application/rss+xml,application/json,text/xml,text/html;q=0.8,*/*;q=0.5"
    },
    redirect: "follow"
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

async function collect() {
  const results = await Promise.allSettled(sources.map(async source => {
    const text = await fetchText(source.url);
    if (source.type === "rss") return parseRss(text, source.name);
    const json = JSON.parse(text);
    if (source.type === "baidu") return parseBaidu(json);
    if (source.type === "sina") return parseSina(json);
    return [];
  }));
  return results.flatMap(result => result.status === "fulfilled" ? result.value : []);
}

function dedupeAndFilter(rows) {
  const seen = new Set();
  return rows
    .map(item => {
      const url = normalizeUrl(item.url || "");
      return { ...item, title: stripHtml(item.title || ""), url, publishedAt: item.publishedAt || dateFromUrl(url) };
    })
    .filter(item => item.title.length >= 6 && item.title.length <= 60)
    .filter(item => !badTitleWords.test(item.title))
    .filter(item => validUrl(item.url))
    .filter(item => freshEnough(item.publishedAt))
    .filter(item => {
      const key = item.title.replace(/[，。、“”：《》\s]/g, "").slice(0, 18);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function pickDiverse(rows, total = 10) {
  const buckets = new Map();
  for (const item of rows) {
    if (!buckets.has(item.source)) buckets.set(item.source, []);
    buckets.get(item.source).push(item);
  }
  const sourceOrder = ["百度热榜", "人民网", "新华网", "中新网", "界面新闻", "央视新闻", "新浪新闻要闻"];
  const orderedSources = [...sourceOrder.filter(source => buckets.has(source)), ...[...buckets.keys()].filter(source => !sourceOrder.includes(source))];
  const picked = [];
  const capFor = source => source === "百度热榜" ? 5 : orderedSources.length >= 4 ? 3 : 4;
  const maxRound = orderedSources.length ? Math.max(...orderedSources.map(capFor)) : 0;
  for (let round = 0; picked.length < total && round < maxRound; round += 1) {
    for (const source of orderedSources) {
      if (round >= capFor(source)) continue;
      const item = buckets.get(source)?.[round];
      if (item) picked.push(item);
      if (picked.length >= total) break;
    }
  }
  for (const source of orderedSources) {
    for (const item of buckets.get(source) || []) {
      if (picked.length >= total) break;
      if (!picked.includes(item) && picked.filter(x => x.source === source).length < capFor(source)) picked.push(item);
    }
  }
  return picked.slice(0, total);
}

let previous = { items: [] };
try {
  previous = JSON.parse(await readFile(outFile, "utf8"));
} catch {}

const items = pickDiverse(dedupeAndFilter(await collect()));
const finalItems = items.length >= 10 ? items : pickDiverse(dedupeAndFilter([...items, ...(previous.items || [])]));

if (finalItems.length < 5) {
  throw new Error(`Only collected ${finalItems.length} valid hotspots; keep previous file instead of writing low-quality data.`);
}

await mkdir(resolve(outFile, ".."), { recursive: true });
await writeFile(outFile, JSON.stringify({
  updatedAt: now.toISOString(),
  timezone: "Asia/Shanghai",
  criteria: "Mainland-accessible Chinese news and hot-rank sources; ads, login pages, downloads, obvious clickbait, duplicates and stale items filtered.",
  items: finalItems
}, null, 2), "utf8");

console.log(`Wrote ${finalItems.length} hotspots to ${outFile}`);
