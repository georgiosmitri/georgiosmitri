// Refreshes two README sections. Runs in GitHub Actions (see .github/workflows/update.yml).
//   CURRENTLY: the first line under "## Building now" in each repo's STATUS.md (works for private repos with STATUS_TOKEN).
//   VIDEOS: newest YouTube Shorts (RSS, no key) and Instagram Reels (Graph API token), if configured.
import { readFileSync, writeFileSync } from "node:fs";

const README = "README.md";
const REPOS = (process.env.STATUS_REPOS ?? "").split(",").map((s) => s.trim()).filter(Boolean); // "owner/repo:Label"
const TOKEN = process.env.STATUS_TOKEN || process.env.GITHUB_TOKEN;

function replace(md, key, body) {
  const re = new RegExp(`(<!-- ${key}:START -->)[\\s\\S]*?(<!-- ${key}:END -->)`);
  return md.replace(re, `$1\n${body.trim()}\n$2`);
}

async function currently() {
  const lines = [];
  for (const entry of REPOS) {
    const [repo, label] = entry.split(":");
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/STATUS.md`, {
      headers: { Accept: "application/vnd.github.raw+json", ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    });
    if (!res.ok) continue;
    const md = await res.text();
    // Only the public "## Building now" section is ever published; private to-dos stay private.
    const next = md.split(/^## Building now\s*$/m)[1]?.split(/^## /m)[0] ?? "";
    const first = next.split("\n").map((l) => l.replace(/^\s*(\d+\.|[-*])\s+/, "").trim()).find(Boolean);
    if (!first) continue;
    // Strip owner notes like "Georgios:" and markdown links so the line reads as public progress
    const clean = first.replace(/^Georgios:\s*/i, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/`/g, "").slice(0, 140);
    lines.push(`- **${label || repo.split("/")[1]}**: ${clean}`);
  }
  return lines.join("\n");
}

async function videos() {
  const items = [];
  const channel = process.env.YT_CHANNEL_ID;
  if (channel) {
    const xml = await (await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`)).text();
    for (const m of xml.matchAll(/<entry>[\s\S]*?<yt:videoId>([^<]+)<\/yt:videoId>[\s\S]*?<title>([^<]+)<\/title>[\s\S]*?<published>([^<]+)<\/published>/g)) {
      items.push({ url: `https://youtube.com/shorts/${m[1]}`, thumb: `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`, title: m[2], date: m[3] });
    }
  }
  const ig = process.env.IG_ACCESS_TOKEN;
  if (ig) {
    const r = await (await fetch(`https://graph.instagram.com/me/media?fields=media_type,permalink,thumbnail_url,caption,timestamp&limit=12&access_token=${ig}`)).json();
    for (const p of r.data ?? []) if (p.media_type === "VIDEO" && p.thumbnail_url) items.push({ url: p.permalink, thumb: p.thumbnail_url, title: (p.caption ?? "Reel").split("\n")[0].slice(0, 60), date: p.timestamp });
  }
  if (!items.length) return null;
  items.sort((a, b) => b.date.localeCompare(a.date));
  const cells = items.slice(0, 4).map((v) => `<td width="25%" valign="top"><a href="${v.url}"><img src="${v.thumb}" width="100%" alt=""></a><br><sub>${v.title.replace(/[<>]/g, "")}</sub></td>`);
  return `<table><tr>${cells.join("")}</tr></table>`;
}

let md = readFileSync(README, "utf8");
const c = await currently();
if (c) md = replace(md, "CURRENTLY", c);
const v = await videos().catch(() => null);
if (v) md = replace(md, "VIDEOS", v);
writeFileSync(README, md);
console.log(`currently: ${c ? "updated" : "unchanged"}, videos: ${v ? "updated" : "unchanged"}`);
