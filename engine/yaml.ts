import { parseDocument } from "../vendor/yaml/index.js";

export type YamlResult = { ok: true; value: unknown } | { ok: false; error: string };

const fail = (error: string): YamlResult => ({ ok: false, error });

/** Parses one plain YAML document. Never throws. */
export function parseYaml(text: string): YamlResult {
  try {
    const doc = parseDocument(text);
    const first = doc.errors[0];
    if (first) return fail(first.message);
    return { ok: true, value: doc.toJS() };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

const lines = (markdown: string): string[] => markdown.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);

/** Parses the `---` block at the very top of a Markdown file. */
export function parseFrontmatter(markdown: string): YamlResult {
  const all = lines(markdown);
  if (all[0]?.trimEnd() !== "---") return fail("no frontmatter: the file must start with a --- line");
  const end = all.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line));
  if (end === -1) return fail("unterminated frontmatter: no closing --- line");
  return parseYaml(all.slice(1, end).join("\n"));
}

const OPEN_FENCE = /^ {0,3}(`{3,})\s*([^`\s]*)[^`]*$/;

/**
 * Parses the first ```yaml fenced block whose first non-blank line is `marker`
 * (for example `schema: numberone/v1`). Other fenced blocks are skipped whole,
 * so a ```yaml that sits inside a longer fence is not mistaken for a block.
 */
export function parseFencedBlock(markdown: string, marker: string): YamlResult {
  const all = lines(markdown);
  let i = 0;
  while (i < all.length) {
    const open = OPEN_FENCE.exec(all[i] ?? "");
    if (!open) {
      i++;
      continue;
    }
    const ticks = open[1]!.length;
    const lang = open[2]!.toLowerCase();
    const close = new RegExp(`^ {0,3}\`{${ticks},}\\s*$`);
    let end = i + 1;
    while (end < all.length && !close.test(all[end]!)) end++;
    if (lang === "yaml" || lang === "yml") {
      const body = all.slice(i + 1, end);
      const head = body.find((line) => line.trim() !== "");
      if (head?.trim() === marker.trim()) return parseYaml(body.join("\n"));
    }
    i = end + 1;
  }
  return fail(`no \`\`\`yaml block starting with "${marker}"`);
}
