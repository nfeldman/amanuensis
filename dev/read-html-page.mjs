// What the `dev/` readers of a published page need from its HTML, in one place.
//
// The publication is HTML only (store-only PLAN §3.2 step 3), so a reader that
// wants a section, a status or a table reads them from the page the way a person
// would, not from a Markdown file that is no longer published. The pages are the
// materializer's own output, so a small reader over their fixed shapes is enough;
// it is not a general HTML parser and refuses nothing it does not recognise.
//
// `textOf` keeps the three inline marks a reader's sentences were written with,
// so a check that looks for a sentence, or for a provenance line that opens
// `*Written by`, finds the same text it always did:
//   <code>x</code> → `x`     <em>x</em> → *x*     <strong>x</strong> → **x**
// Paragraphs, list items, table rows and other blocks are separated by a newline.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1].toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

const BLOCK = "(?:p|li|ul|ol|dl|dt|dd|div|section|article|header|footer|blockquote|details|summary|figure|figcaption|table|thead|tbody|tfoot|tr|caption|pre|h[1-6]|br|hr)";

/** A fragment as the text a reader sees: tags gone, inline marks kept, blocks on their own lines. */
export function textOf(fragment) {
  const text = String(fragment)
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?(code)\b[^>]*>/gi, "`")
    .replace(/<\/?(em|i)\b[^>]*>/gi, "*")
    .replace(/<\/?(strong|b)\b[^>]*>/gi, "**")
    .replace(/<\/?(td|th)\b[^>]*>/gi, " ")
    .replace(new RegExp(`</?${BLOCK}\\b[^>]*>`, "gi"), "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** The page's own content: the `<article class="content …">` element, without the rail or the header. */
export function articleOf(html) {
  const start = /<article\b[^>]*class="content\b[^"]*"[^>]*>/i.exec(html);
  if (!start) return null;
  const from = start.index + start[0].length;
  const end = html.indexOf("</article>", from);
  return html.slice(from, end < 0 ? undefined : end);
}

function headingText(inner) {
  return textOf(inner).replace(/^§\s*/, "").trim();
}

/**
 * The inner HTML of the level-two section titled `heading`, up to the next
 * level-two heading or the end of its `<section>`. Null when the page has no such
 * heading.
 */
export function sectionOf(html, heading) {
  const pattern = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
  for (let found = pattern.exec(html); found; found = pattern.exec(html)) {
    if (headingText(found[1]) !== heading) continue;
    const from = found.index + found[0].length;
    const rest = html.slice(from);
    const stops = [rest.search(/<h2\b/i), rest.indexOf("</section>")].filter((index) => index >= 0);
    return stops.length ? rest.slice(0, Math.min(...stops)) : rest;
  }
  return null;
}

/** A section's text, or null when the page has no such heading. */
export function sectionText(html, heading) {
  const body = sectionOf(html, heading);
  return body === null ? null : textOf(body);
}

/**
 * The subsystem status the page's status line prints: the last `status-<word>`
 * class on the span after "Status". The first such class names the family
 * (`status-survey`) and is not the word.
 */
export function statusOf(html) {
  const line = /<strong>Status<\/strong>:\s*<span\b[^>]*class="([^"]*)"/i.exec(html);
  if (!line) return null;
  const words = line[1]
    .split(/\s+/)
    .filter((token) => token.startsWith("status-") && token !== "status-survey")
    .map((token) => token.slice("status-".length));
  return words.length ? words[words.length - 1] : null;
}

/** Every table in a fragment: its header cells and each body row's cells, as text. */
export function tablesOf(fragment) {
  const tables = [];
  for (const table of String(fragment).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
      [...row[1].matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((cell) => textOf(cell[2]).replace(/\s*\n\s*/g, " ")),
    );
    const head = rows.find((row, index) => index === 0) ?? [];
    tables.push({ header: head, rows: rows.slice(1) });
  }
  return tables;
}

/**
 * The runtime boundary map's rows, one per `runtime-detail` entry: the runtime
 * or process, its language, and each labelled value (`Communicates with`,
 * `Mechanism`, `Recorded note`).
 */
export function runtimeDetailsOf(fragment) {
  return [...String(fragment).matchAll(/<article\b[^>]*class="runtime-detail"[^>]*>([\s\S]*?)<\/article>/gi)].map((entry) => {
    const body = entry[1];
    const fields = {};
    for (const field of body.matchAll(/<span class="runtime-detail-label">([\s\S]*?)<\/span>([\s\S]*?)<\/p>/gi)) {
      fields[textOf(field[1])] = textOf(field[2]);
    }
    return {
      runtime: textOf(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i.exec(body)?.[1] ?? ""),
      language: textOf(/<span class="runtime-detail-language">([\s\S]*?)<\/span>/i.exec(body)?.[1] ?? ""),
      fields,
    };
  });
}

/** The text of every record field printed under `label` (a `record-label` paragraph and the copy after it). */
export function recordFieldsOf(html, label) {
  return [...String(html).matchAll(/<p class="record-label">([\s\S]*?)<\/p>\s*<div class="record-copy">([\s\S]*?)<\/div>/gi)]
    .filter((field) => textOf(field[1]) === label)
    .map((field) => textOf(field[2]));
}
