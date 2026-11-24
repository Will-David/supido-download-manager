// Certains sites ne mettent pas l'URL du flux dans le HTML de la page :
// le lecteur la récupère dans une iframe, puis l'extrait du HTML de cette iframe.
// Ce module reproduit ce chemin avant de confier l'URL à yt-dlp.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

// Chaque tentative a son propre délai : un embed lent ne doit pas
// consommer le temps réservé au repli sur l'endpoint du site.
function attemptSignal(signal, ms) {
  const timer = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timer]) : timer;
}

async function fetchText(url, referer, signal) {
  const headers = {
    "user-agent": UA,
    accept: "text/html,application/json;q=0.9,*/*;q=0.8",
  };
  if (referer) headers.referer = referer;
  const response = await fetch(url, { headers, signal, redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function extractTitle(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return null;
  return match[1]
    .replace(/<[^>]*>/g, "")
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&eacute;/gi, "é")
    .replace(/[\u2011\u2013\u2014\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || null;
}

function extractM3u8(html) {
  if (!html) return null;
  const patterns = [
    /\bsources\s*:\s*\[\s*\{\s*file\s*:\s*['"](https:\/\/[^'"\s]+)['"]/i,
    /['"]file['"]\s*:\s*['"](https:\/\/[^'"\s]+\.m3u8[^'"\s]*)['"]/i,
    /(https:\/\/[a-zA-Z0-9.-]+\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (!match) continue;
    const url = match[1].replace(/\\\//g, "/").replace(/\\u0026/gi, "&");
    if (/\.m3u8(\?|$)/i.test(url)) return url;
  }
  return null;
}

function extractEmbeds(html, base) {
  const found = [];
  const add = (raw) => {
    try {
      const url = new URL(raw, base);
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      if (!found.includes(url.href)) found.push(url.href);
    } catch {}
  };

  // Lecteur principal du site : option data-player-type="af-hls".
  for (const match of html.matchAll(/<option\b[^>]*>/gi)) {
    if (!/af-hls/i.test(match[0])) continue;
    const value = /value\s*=\s*["']([^"']+)["']/i.exec(match[0]);
    if (value) add(value[1]);
  }
  // URLs d'embed classiques (embed-xxxx.html).
  for (const match of html.matchAll(/https?:\/\/[^\s"'<>]+\/embed-[a-zA-Z0-9_-]{5,}\.html/gi)) add(match[0]);
  // Attributs data-* pointant vers un lecteur.
  for (const match of html.matchAll(/(?:data-(?:src|url|video|file|player|embed)|value)\s*=\s*["']([^"']+)["']/gi)) {
    if (/embed|player|lpayer|vidmoly|voembed|ansembed/i.test(match[1])) add(match[1]);
  }
  return found.slice(0, 6);
}

async function resolveVoiranime(pageUrl, html, signal) {
  const embeds = extractEmbeds(html, pageUrl);
  if (!embeds.length) return null;

  // 1. Le HTML de l'embed contient souvent directement le master.m3u8.
  for (const embed of embeds) {
    try {
      const m3u8 = extractM3u8(await fetchText(embed, pageUrl, attemptSignal(signal, 8000)));
      if (m3u8) return m3u8;
    } catch {}
  }

  // 2. Repli : le site expose son propre endpoint d'extraction.
  for (const embed of embeds) {
    try {
      const proxy = new URL(pageUrl);
      proxy.hash = "";
      proxy.searchParams.set("vr_extract_embed", "1");
      proxy.searchParams.set("url", embed);
      const data = JSON.parse(await fetchText(proxy.href, pageUrl, attemptSignal(signal, 15000)));
      if (data.ok && data.m3u8) return data.m3u8;
    } catch {}
  }
  return null;
}

/**
 * Retourne { url, title, resolved }.
 * Si aucun flux n'est trouvé, l'URL d'origine est conservée et yt-dlp essaie quand même.
 */
export async function resolveMediaUrl(url, signal) {
  const result = { url, title: null, resolved: false };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return result;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return result;

  const host = parsed.hostname.toLowerCase();
  const isVoiranime = host.includes("voiranime");
  const isEmbed = /\/(?:embed-|e\/|w\/)/i.test(parsed.pathname) ||
    /(embed|player|lpayer|vidmoly|voembed|ansembed)/i.test(host);
  if (!isVoiranime && !isEmbed) return result;

  // Le site peut répondre une page incomplète de façon transitoire : on
  // retente avec un court délai avant de laisser yt-dlp échouer.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (isEmbed && !isVoiranime) {
        const html = await fetchText(url, null, attemptSignal(signal, 10000));
        result.title = extractTitle(html) || result.title;
        const m3u8 = extractM3u8(html);
        if (m3u8) {
          result.url = m3u8;
          result.resolved = true;
          return result;
        }
      }

      if (isVoiranime) {
        const html = await fetchText(url, null, attemptSignal(signal, 15000));
        result.title = extractTitle(html) || result.title;
        const m3u8 = await resolveVoiranime(url, html, signal);
        if (m3u8) {
          result.url = m3u8;
          result.resolved = true;
          return result;
        }
      }
    } catch {
      // En cas d'échec réseau, on laisse yt-dlp tenter avec l'URL d'origine.
    }
    if (signal?.aborted || attempt === 1) break;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return result;
}
