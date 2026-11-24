(() => {
  const VIDEO_FILE = /\.(mp4|webm|mkv|mov|avi|m4v|ogv|mp3|m4a|wav|ts)(\?|#|$)/i;
  const MANIFEST = /(\.m3u8|\.mpd|\/manifest)(\?|#|$)/i;
  const PLATFORM = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv|tiktok\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|reddit\.com|bilibili\.com|soundcloud\.com)$/i;
  const EMBED_HINT = /(embed|player|video|stream|watch|play|anime|vid|movie|cdn)/i;
  const ATTRS = ["src", "data-src", "data-video", "data-url", "data-file", "data-m3u8", "data-mpd", "data-stream"];

  const found = [];
  const seen = new Set();
  let hasPlayer = false;
  let hasBlob = false;

  function add(raw, label, source, forcedType) {
    if (!raw || typeof raw !== "string") return;
    let parsed;
    try {
      parsed = new URL(raw.trim(), location.href);
    } catch {
      return;
    }
    if (parsed.protocol === "blob:" || parsed.protocol === "mediastream:") {
      hasBlob = true;
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
    const url = parsed.href;
    if (seen.has(url)) return;
    seen.add(url);
    found.push({
      url,
      title: String(label || document.title || "Vidéo").slice(0, 120),
      source,
      type: forcedType || (VIDEO_FILE.test(url) ? "direct" : "video"),
      page: location.href,
    });
  }

  function labelOf(element) {
    const text = (element.textContent || element.getAttribute("title") || element.getAttribute("aria-label") || "").trim().split("\n")[0];
    return text || document.title || "Vidéo";
  }

  function scanAttributes(element, source) {
    for (const name of ATTRS) {
      const value = element.getAttribute?.(name);
      if (!value) continue;
      if (/^blob:/i.test(value)) { hasBlob = true; continue; }
      if (VIDEO_FILE.test(value) || MANIFEST.test(value) || PLATFORM.test(new URL(value, location.href).hostname)) {
        add(value, labelOf(element), source);
      }
    }
  }

  try {
    // 1. Page elle-même sur une plateforme connue.
    if (PLATFORM.test(location.hostname)) {
      add(location.href, document.title, "Page vidéo", "video");
    }

    // 2. Lecteurs audio/video, y compris leurs attributs data-*.
    document.querySelectorAll("video, audio").forEach((media) => {
      hasPlayer = true;
      if (media.currentSrc) add(media.currentSrc, labelOf(media), "Lecteur vidéo");
      scanAttributes(media, "Lecteur vidéo");
      media.querySelectorAll("source").forEach((source) => {
        scanAttributes(source, "Piste vidéo");
      });
    });

    // 3. Éléments portant une URL de média dans un attribut de données.
    document.querySelectorAll("[data-src], [data-video], [data-url], [data-file], [data-m3u8], [data-mpd], [data-stream]").forEach((element) => {
      scanAttributes(element, "Attribut de page");
    });

    // 4. Iframes (lecteurs hébergés sur un autre domaine).
    document.querySelectorAll("iframe[src]").forEach((frame) => {
      const raw = frame.getAttribute("src");
      if (!raw || raw.startsWith("about:")) return;
      let parsed;
      try { parsed = new URL(raw, location.href); } catch { return; }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
      if (EMBED_HINT.test(parsed.href)) {
        add(raw, labelOf(frame), "Iframe lecteur", "video");
      }
    });

    // 5. Lecteurs déclarés dans les options du site (embed HLS).
    document.querySelectorAll("option[value]").forEach((option) => {
      if (!/af-hls|hls/i.test(option.getAttribute("data-player-type") || "")) return;
      add(option.getAttribute("value"), labelOf(option), "Lecteur HLS", "video");
    });

    // 6. Liens et intégrations classiques.
    document.querySelectorAll("a[href], embed[src], object[data]").forEach((element) => {
      scanAttributes(element, "Lien de la page");
    });

    // 7. URLs de fichiers ou de flux dans le code source.
    const html = document.documentElement.outerHTML.slice(0, 500000);
    const regex = /https?:\/\/[^\s"'<>`\\]+?\.(?:mp4|webm|mkv|mov|m4v|mp3|m4a|m3u8|mpd|ts)(?:\?[^\s"'<>`\\]*)?/gi;
    for (const match of html.matchAll(regex)) {
      add(match[0], document.title, "Code source");
    }

    // 8. Repli : lecteur présent mais URL masquée (blob, MediaSource, JavaScript).
    // On propose alors l'URL de la frame à yt-dlp, qui sait extraire de nombreux sites.
    if (hasPlayer || hasBlob || !found.length) {
      add(location.href, document.title, "Page (extraction générique)", "video");
    }
  } catch (error) {
    return [{ url: "", title: `Erreur d'analyse : ${error.message}`, source: "erreur", type: "video", page: location.href }];
  }

  return found.slice(0, 50);
})();
