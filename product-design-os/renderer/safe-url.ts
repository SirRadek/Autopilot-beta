const safeAbsoluteHrefSchemes = new Set(["https", "http", "mailto", "tel"]);

export function isSafeHref(rawHref: string): boolean {
  const href = rawHref.trim();
  if (href.length === 0) {
    return false;
  }

  if (/[\u0000-\u001F\u007F\s]/.test(href)) {
    return false;
  }

  if (href.startsWith("#") || href.startsWith("./") || href.startsWith("../")) {
    return true;
  }

  if (href.startsWith("/")) {
    return !href.startsWith("//");
  }

  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(href);
  if (schemeMatch === null) {
    return false;
  }

  const scheme = schemeMatch[1];
  return scheme !== undefined && safeAbsoluteHrefSchemes.has(scheme.toLowerCase());
}
