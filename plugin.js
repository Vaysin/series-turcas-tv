const BASE = "https://kaj.seriesturcastv.to";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Dominio raíz (seriesturcastv.to): acepta cualquier subdominio del sitio.
const ROOT = new URL(BASE).hostname.split(".").slice(-2).join(".");

function log(message) {
  try {
    kino.log(String(message));
  } catch {
    // kino.log no disponible
  }
}

function decodeEntities(s = "") {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCharCode(Number(n))
    );
}

function textOnly(s = "") {
  return decodeEntities(
    String(s)
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

function absoluteUrl(url, from = BASE) {
  if (!url) return "";

  try {
    return new URL(decodeEntities(url), from).href;
  } catch {
    return "";
  }
}

function isSiteUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === ROOT || host.endsWith("." + ROOT);
  } catch {
    return false;
  }
}

function attr(block, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    "\\b" + escapedName + "\\s*=\\s*(['\"])(.*?)\\1",
    "i"
  );

  const match = String(block).match(re);
  return match ? decodeEntities(match[2]) : "";
}

function slugFrom(url) {
  try {
    const u = new URL(url);
    return (
      u.pathname.replace(/\/+$/, "").split("/").pop() ||
      u.hostname
    );
  } catch {
    return String(url).replace(/[^a-z0-9]+/gi, "-");
  }
}

function makeItem(
  url,
  title,
  poster = "",
  kind = "series",
  overview = ""
) {
  const ref = absoluteUrl(url);

  if (!ref || !isSiteUrl(ref)) return null;
  if (ref === BASE || ref === BASE + "/") return null;

  const cleanTitle = textOnly(title);
  if (!cleanTitle || cleanTitle.length < 2) return null;

  const image = poster ? absoluteUrl(poster, ref) : "";

  return {
    id: slugFrom(ref),
    ref,
    title: cleanTitle,
    kind,
    poster: image || undefined,
    backdrop: image || undefined,
    overview: textOnly(overview) || undefined
  };
}

// Páginas del menú/pie que no son series (se compara el slug completo).
const NON_SERIES_SLUG =
  /^(home|series|series-subtituladas|series-audio|capitulos|capitulos-subtituladas|capitulos-audio|calendario|contacto|politicas-de-privacidad|terminos-y-condiciones|login|registro|buscar|sitemap_index\.xml|feed)$/i;

function extractItems(html, pageUrl = BASE, limit = 100) {
  const found = new Map();

  const linkRe =
    /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;

  let match;
  let anchors = 0;
  let withImg = 0;

  while (
    (match = linkRe.exec(html)) !== null &&
    found.size < limit
  ) {
    anchors++;

    const href = absoluteUrl(match[2], pageUrl);

    if (!href || !isSiteUrl(href)) continue;

    let parsed;

    try {
      parsed = new URL(href);
    } catch {
      continue;
    }

    const path = parsed.pathname.replace(/\/+$/, "");
    const segments = path.split("/").filter(Boolean);

    // Las series de este sitio usan páginas de primer nivel.
    if (segments.length !== 1) continue;

    const slug = segments[0];

    // Evitar convertir enlaces del menú o capítulos en series.
    if (NON_SERIES_SLUG.test(slug)) continue;
    if (/capitulo|episodio|temporada/i.test(slug)) continue;

    const inner = match[3];
    const imgMatch = inner.match(/<img\b[^>]*>/i);

    // No considerar como serie un enlace sin imagen de portada.
    if (!imgMatch) continue;

    withImg++;

    const img = imgMatch[0];
    const openTag = match[0].slice(0, match[0].indexOf(">") + 1);

    const srcset = attr(img, "srcset");
    const poster =
      attr(img, "data-src") ||
      attr(img, "data-lazy-src") ||
      attr(img, "data-original") ||
      attr(img, "src") ||
      (srcset
        ? srcset.split(",")[0].trim().split(/\s+/)[0]
        : "");

    const heading = inner.match(
      /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i
    );

    const title =
      (heading && textOnly(heading[1])) ||
      attr(openTag, "title") ||
      attr(img, "alt") ||
      attr(img, "title") ||
      "";

    const item = makeItem(href, title, poster);

    if (item && !found.has(item.ref)) {
      found.set(item.ref, item);
    }
  }

  log(
    "extractItems: anchors=" + anchors +
    " conImagen=" + withImg +
    " items=" + found.size
  );

  return [...found.values()].slice(0, limit);
}

async function getPage(url) {
  const res = await kino.fetch(url, {
    headers: {
      "User-Agent": UA,
      "Referer": BASE + "/"
    }
  });

  log("GET " + url + " -> " + res.status);

  if (!res.ok) {
    throw new Error("No se pudo cargar el sitio (" + res.status + ")");
  }

  const html = await res.text();

  if (/just a moment|cf-challenge|attention required/i.test(html)) {
    log("Posible bloqueo de Cloudflare en " + url);
  }

  return html;
}

export async function search(query) {
  const q =
    typeof query === "string"
      ? query
      : (query && (query.q || query.query)) || "";

  if (!q.trim()) return [];

  const url = BASE + "/?s=" + encodeURIComponent(q.trim());

  try {
    const html = await getPage(url);
    return extractItems(html, url, 60);
  } catch (error) {
    log("search error: " + String(error?.message || error));
    return [];
  }
}

export async function home() {
  const url = BASE + "/home/";

  try {
    const html = await getPage(url);
    const items = extractItems(html, url, 60);

    if (!items.length) return [];

    return [
      {
        id: "series-destacadas",
        title: "Series destacadas",
        ref: "/series/",
        items
      }
    ];
  } catch (error) {
    log("home error: " + String(error?.message || error));
    return [];
  }
}

export async function browse(ref, cursor) {
  let url;

  try {
    const target =
      typeof ref === "string" && ref
        ? ref
        : "/series/";

    url = new URL(target, BASE);

    if (!isSiteUrl(url.href)) {
      url = new URL("/series/", BASE);
    }
  } catch {
    url = new URL("/series/", BASE);
  }

  const page = Math.max(
    1,
    parseInt(cursor || "1", 10) || 1
  );

  let pageUrl = url.href;

  // WordPress pagina como /series/page/2/
  if (page > 1) {
    const basePath = url.pathname
      .replace(/\/page\/\d+\/?$/, "")
      .replace(/\/+$/, "");

    pageUrl = new URL(basePath + "/page/" + page + "/", BASE).href;
  }

  try {
    const html = await getPage(pageUrl);
    const items = extractItems(html, pageUrl, 60);

    return {
      items,
      next: items.length >= 20 ? String(page + 1) : null
    };
  } catch (error) {
    log("browse error: " + String(error?.message || error));

    if (page > 1) {
      return { items: [], next: null };
    }

    throw error;
  }
}

export async function episodes(ref) {
  const url = absoluteUrl(ref);

  if (!url || !isSiteUrl(url) || url === BASE + "/") {
    throw new Error("Referencia de serie no válida");
  }

  const html = await getPage(url);

  const titleMatch = html.match(
    /<h1\b[^>]*>([\s\S]*?)<\/h1>/i
  );

  const title = titleMatch
    ? textOnly(titleMatch[1])
    : textOnly(url.split("/").filter(Boolean).pop());

  const descriptionMatch = html.match(
    /<meta\b(?=[^>]*\bname\s*=\s*["']description["'])[^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*>/i
  );

  const imageMatch = html.match(
    /<meta\b(?=[^>]*\bproperty\s*=\s*["']og:image["'])[^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*>/i
  );

  const series = {
    title,
    overview: descriptionMatch
      ? decodeEntities(descriptionMatch[1])
      : "",
    poster: imageMatch
      ? absoluteUrl(imageMatch[1], url)
      : undefined
  };

  const episodeList = [];
  const seen = new Set();

  const linkRe =
    /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = linkRe.exec(html)) !== null) {
    const episodeUrl = absoluteUrl(match[2], url);
    const label = textOnly(match[3]);

    const cleanLabel = label
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();

    const episodeText = (cleanLabel + " " + episodeUrl)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    if (
      !episodeUrl ||
      !isSiteUrl(episodeUrl) ||
      episodeUrl === url ||
      /^(capitulos?|subtitulado|doblado|audio)$/.test(cleanLabel) ||
      !/(?:capitulo|episodio|episode|temporada)\D{0,12}\d+/i.test(
        episodeText
      )
    ) {
      continue;
    }

    if (seen.has(episodeUrl)) continue;
    seen.add(episodeUrl);

    const numberMatch = (
      label + " " + episodeUrl
    ).match(
      /(?:cap[ií]tulo|episodio|episode)[^\d]{0,12}(\d+)/i
    );

    const number = numberMatch
      ? parseInt(numberMatch[1], 10)
      : episodeList.length + 1;

    // "Capitulo 1 Temporada 1" -> "Capitulo 1"
    const shownLabel = label
      .replace(/\s*temporada\s*\d+/i, "")
      .trim();

    episodeList.push({
      id: slugFrom(episodeUrl),
      ref: episodeUrl,
      title: shownLabel || "Capítulo " + number,
      season: 1,
      number
    });
  }

  episodeList.sort((a, b) => a.number - b.number);

  log("episodes: " + episodeList.length + " capítulos en " + url);

  // Si no se detectan capítulos, permitir abrir la página de la serie.
  if (!episodeList.length) {
    episodeList.push({
      id: slugFrom(url),
      ref: url,
      title: title || "Abrir contenido",
      season: 1,
      number: 1
    });
  }

  return {
    series,
    episodes: episodeList
  };
}

function extractEmbeds(html, pageUrl) {
  const out = new Set();
  const re =
    /<iframe\b[^>]*?\b(?:data-lazy-src|data-src|src)\s*=\s*(["'])(.*?)\1/gi;
  let m;

  while ((m = re.exec(html)) !== null) {
    const u = absoluteUrl(m[2], pageUrl);
    if (/^https?:/i.test(u)) out.add(u);
  }

  return [...out];
}

async function tryCapture(target) {
  try {
    const captured = await kino.browser.capture(target);
    const media = captured?.media?.find(
      item => item && typeof item.url === "string" && item.url
    );

    if (media) {
      return {
        url: media.url,
        headers: media.headers || {}
      };
    }
  } catch (error) {
    log(
      "capture falló (" + target + "): " +
      String(error?.message || error)
    );
  }

  return null;
}

export async function resolve(ref) {
  const url = absoluteUrl(ref);

  if (!url || !isSiteUrl(url)) {
    throw new Error("Referencia no válida");
  }

  // 1. Página del capítulo
  let result = await tryCapture(url);
  if (result) return result;

  // 2. Iframes de los servidores
  const html = await getPage(url);
  const embeds = extractEmbeds(html, url);

  log(
    "iframes encontrados: " + embeds.length +
    (embeds.length ? " -> " + embeds.join(" | ") : "")
  );

  for (const embed of embeds.slice(0, 5)) {
    result = await tryCapture(embed);
    if (result) return result;
  }

  // 3. URL directa en el HTML
  const direct = html.match(
    /https?:\/\/[^"'<>\\\s]+?\.(?:m3u8|mp4)(?:\?[^"'<>\\\s]*)?/i
  );

  if (direct) {
    return {
      url: direct[0],
      headers: { Referer: url }
    };
  }

  throw new Error(
    "No se encontró un vídeo compatible. " +
    "Comprueba si el reproductor externo permite la captura."
  );
}
