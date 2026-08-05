import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const outFile = existsSync(resolve(process.cwd(), "public"))
  ? resolve(process.cwd(), "public/data/hotspots.json")
  : resolve(process.cwd(), "data/hotspots.json");
const now = new Date();
const badUrlWords = /ad|ads|login|passport|download|apk|appdownload|redirect|jump|track|union|promo|market/i;
const badTitleWords = /广告|推广|优惠|返利|招商|加盟|贷款|理财|下载|APP|直播间|带货|福利|抽奖|必买|秒杀|标题党|携手|报名|免费接驳|赞助|冠名|采购公告|招标公告|中标公告|谈判采购|询价采购|招租|拍卖|招聘公告|基金净值|ETF|LOF|债券基金|异动拉升|涨停|跌停|板块拉升|板块走强|板块走弱|成交额|换手率|吸金|冲击\d+连涨|融资余额|评级调整|研报|股价|A股|港股|美股|期货|现货|净流入|净流出|达成战略合作|签署战略合作|正式签约|合作协议|荣获|发布新品|新品发布|收购.*股权|股权案|批准.*收购|厂内验证|客户送样|技术指标/;
const badSummaryWords = /数据来源：|采购人|招标人|中标人|项目编号|公告期限|证券板块|基金|ETF|股价|涨停|跌停|净值|融资|研报|成交额|达成战略合作|签署战略合作|合作协议|品牌|新品|收购股权|股权案|厂内验证|客户送样|技术指标/;
const lightFinanceWords = /经济|消费|产业|公司|市场|外贸|就业|物价|房价|汽车|商业|创业|AI|人工智能|科技|产业链/;
const topicRules = [
  { topic: "社会", score: 9, re: /社会|民生|教育|医疗|法院|警方|公安|消防|灾害|天气|高温|暴雨|台风|地震|出行|交通|学校|学生|老人|儿童|女性|就业|消费维权|食品安全/ },
  { topic: "科技", score: 8, re: /科技|AI|人工智能|机器人|航天|卫星|芯片|算法|新能源|可控核聚变|智能|数字|互联网|大模型|数据|手机|无人机/ },
  { topic: "文化", score: 8, re: /文化|文旅|博物馆|非遗|考古|历史|阅读|文学|电影|音乐|艺术|展览|体育|赛事|国潮|传统/ },
  { topic: "娱乐", score: 7, re: /娱乐|明星|综艺|电影|剧集|演唱会|票房|音乐节|演员|导演|歌手|短剧/ },
  { topic: "生活方式", score: 7, re: /生活|健康|饮食|旅行|旅游|城市|宠物|穿搭|美妆|运动|健身|家居|情绪|睡眠|年轻人|亲子/ },
  { topic: "公共新闻", score: 6, re: /国务院|最高法|政策|发布会|国际|外交|美国|韩国|法国|欧盟|联合国|以色列|俄乌|中方|全球/ },
  { topic: "经济观察", score: 2, re: /经济|产业|消费|公司|市场|外贸|汽车|房企|企业|商业|创业/ },
  { topic: "低价值财经", score: -10, re: /ETF|基金|股票|涨停|跌停|异动|板块|A股|港股|美股|期货|净值|研报|融资|成交额|证券/ },
  { topic: "公告", score: -12, re: /公告|采购|招标|中标|招聘|公示|项目编号|报名|谈判/ },
];
const trustedHosts = [
  "cctv.com", "people.com.cn", "xinhuanet.com", "news.cn", "baidu.com", "sina.com.cn", "sina.cn", "chinanews.com.cn",
  "thepaper.cn", "yicai.com", "jiemian.com", "caixin.com", "gmw.cn", "china.com.cn", "solidot.org"
];

const sources = [
  { name: "人民网", type: "rss", url: "http://www.people.com.cn/rss/politics.xml" },
  { name: "新华网", type: "rss", url: "http://www.xinhuanet.com/politics/news_politics.xml" },
  { name: "中新网", type: "rss", url: "https://www.chinanews.com.cn/rss/scroll-news.xml" },
  { name: "中新网文化", type: "rss", url: "https://www.chinanews.com.cn/rss/culture.xml" },
  { name: "中新网娱乐", type: "rss", url: "https://www.chinanews.com.cn/rss/ent.xml" },
  { name: "中新网体育", type: "rss", url: "https://www.chinanews.com.cn/rss/sports.xml" },
  { name: "界面新闻", type: "rss", url: "https://a.jiemian.com/index.php?m=article&a=rss" },
  { name: "Solidot科技", type: "rss", url: "https://feeds.feedburner.com/solidot" },
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

function classify(item) {
  const text = `${item.title || ""} ${item.summary || ""}`;
  const hits = topicRules.filter(rule => rule.re.test(text));
  const positive = hits.filter(x => x.score > 0).sort((a, b) => b.score - a.score)[0];
  const score = hits.reduce((sum, rule) => sum + rule.score, 0);
  return { topic: positive?.topic || "综合", score };
}

function sourceScore(source) {
  return ({
    "央视新闻": 8,
    "人民网": 7,
    "新华网": 7,
    "百度热榜": 6,
    "中新网": 5,
    "中新网文化": 6,
    "中新网娱乐": 5,
    "中新网体育": 5,
    "界面新闻": 3,
    "Solidot科技": 5,
    "新浪新闻要闻": 3,
  })[source] ?? 2;
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
      summary: compactSummary(title, item.desc || item.abstract || `百度热榜话题，点击查看实时讨论与最新报道：${title}`),
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
    .filter(item => !badSummaryWords.test(item.summary || ""))
    .filter(item => validUrl(item.url))
    .filter(item => freshEnough(item.publishedAt))
    .map(item => {
      const classified = classify(item);
      return { ...item, topic: classified.topic, qualityScore: classified.score + sourceScore(item.source) + (lightFinanceWords.test(`${item.title} ${item.summary}`) ? 2 : 0) };
    })
    .filter(item => item.qualityScore >= 3)
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
  for (const list of buckets.values()) {
    list.sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0));
  }
  const sourceOrder = ["人民网", "新华网", "央视新闻", "百度热榜", "中新网", "中新网文化", "中新网娱乐", "中新网体育", "Solidot科技", "界面新闻", "新浪新闻要闻"];
  const orderedSources = [...sourceOrder.filter(source => buckets.has(source)), ...[...buckets.keys()].filter(source => !sourceOrder.includes(source))];
  const picked = [];
  const capFor = source => source === "百度热榜" ? 3 : source === "界面新闻" ? 2 : source.startsWith("中新网") ? 2 : orderedSources.length >= 4 ? 3 : 4;
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
  return picked
    .sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0))
    .slice(0, total)
    .map(({ qualityScore, ...item }) => item);
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
