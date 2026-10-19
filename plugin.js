
const BASE = "https://kaj.seriesturcastv.to";
const UA = "Mozilla/5.0 (compatible; KinoTV plugin)";

const SITE_ORIGIN = new URL(BASE).origin;

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
    return new URL(url).origin === SITE_ORIGIN;
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

function extractItems(html, pageUrl = BASE, limit = 100) {
  const found = new Map();

  const linkRe =
    /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while (
    (match = linkRe.exec(html)) !== null &&
    found.size < limit
  ) {
    const href = absoluteUrl(match[2], pageUrl);

    if (!href || !isSiteUrl(href)) continue;

    let parsed;

    try {
      parsed = new URL(href);
    } catch {
      continue;
    }

    const path = parsed.pathname.replace(/\/+$/, "");

    // Las series de este sitio usan páginas de primer nivel.
    if (!path || path.split("/").filter(Boolean).length !== 1) {
      continue;
    }

    // Evitar convertir enlaces del menú en series.
    if (
      /capitulo|episodio|temporada|sitemap|politica|contacto|genero|subtitulado|doblado|audio|series|home|login|registro|buscar|calendario|privacidad|terminos|cookies/i.test(
        path
      )
    ) {
      continue;
    }

    const inner = match[3];
    const imgMatch = inner.match(/<img\b[^>]*>/i);

    // No considerar como serie un enlace sin imagen de portada.
    if (!imgMatch) continue;

    const img = imgMatch[0];

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
      attr(img, "alt") ||
      attr(img, "title") ||
      attr(match[0], "title") ||
      "";

    const item = makeItem(href, title, poster);

    if (item && !found.has(item.ref)) {
      found.set(item.ref, item);
    }
  }

  return [...found.values()].slice(0, limit);
}

async function getPage(url) {
  const res = await kino.fetch(url, {
    headers: {
      "User-Agent": UA,
      "Referer": BASE + "/"
    }
  });

  if (!res.ok) {
    throw new Error("No se pudo cargar el sitio (" + res.status + ")");
  }

  return await res.text();
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
  } catch {
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
        ref: "/home/",
        items
      }
    ];
  } catch {
    return [];
  }
}

export async function browse(ref, cursor) {
  let url;

  try {
    const target =
      typeof ref === "string" && ref
        ? ref
        : "/home/";

    url = new URL(target, BASE);

    if (url.origin !== SITE_ORIGIN) {
      url = new URL("/home/", BASE);
    }
  } catch {
    url = new URL("/home/", BASE);
  }

  const page = Math.max(
    1,
    parseInt(cursor || "1", 10) || 1
  );

  if (page > 1) {
    url.searchParams.set("paged", String(page));
  }

  const html = await getPage(url.href);
  const items = extractItems(html, url.href, 60);

  return {
    items,
    next: items.length >= 20 ? String(page + 1) : null
  };
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

    if (
      !episodeUrl ||
      !isSiteUrl(episodeUrl) ||
      episodeUrl === url ||
      !/cap[ií]tulo|episodio|temporada|episode/i.test(
        label + " " + episodeUrl
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

    episodeList.push({
      id: slugFrom(episodeUrl),
      ref: episodeUrl,
      title: label || "Capítulo " + number,
      season: 1,
      number
    });
  }

  episodeList.sort((a, b) => a.number - b.number);

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

export async function resolve(ref) {
  const url = absoluteUrl(ref);

  if (!url || !isSiteUrl(url)) {
    throw new Error("Referencia no válida");
  }

  const html = await getPage(url);

  // Solo acepta direcciones directas de vídeo expuestas en la página.
  const direct = html.match(
    /https?:\/\/[^"'<>\\\s]+?\.(?:m3u8|mp4)(?:\?[^"'<>\\\s]*)?/i
  );

  if (direct) {
    return {
      url: direct[0],
      headers: {
        Referer: url
      }
    };
  }

  throw new Error(
    "No se encontró un vídeo directo compatible. " +
    "Puede que esta página use un reproductor externo."
  );
}
