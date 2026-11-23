// Reading guidance shared by the gates that check it: SI9 over the skill, SI11 over the install
// documents. `restricts` is true for a sentence that forbids, defers, rations or gates reading a
// file, or sends the reader to the index instead of or ahead of it (design/semantic-index/PLAN.md
// §5: the index adds to reading and takes nothing away). SI9 runs it on bad and good sentences
// before it is trusted.

/** Sentences of a text, read whole across wrapped lines. */
export function sentences(text) {
  const out = [];
  for (const block of text.split(/\n\s*\n/)) {
    const flat = block.replace(/\n\s*(?:[-*]|\d+\.)\s+/g, "\n").replace(/\s+/g, " ").trim();
    for (const part of flat.split(/(?<=[.?!])\s+(?=[A-Z`*"(])|\s+-\s+(?=[A-Z`])/)) {
      const s = part.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

export const RESTRICTIONS = [
  /\b(do not|don't|never|avoid|must not|should not|shouldn't|refrain from|stop)\b[^.]*\b(read|reads|reading|open|opening)\b[^.]*\b(files?|source|whole|entire|full)\b/i,
  /\b(instead of|rather than|in place of)\b[^.]*\b(read|reading|whole files?|file reads?)\b/i,
  /\bprefer\b[^.]*\b(over|to)\b[^.]*\b(read|reading|whole files?)\b/i,
  /\b(before|until|unless|only after|first)\b[^.]*\b(read|reading|open|opening)\b[^.]*\b(files?|whole)\b/i,
  /\b(only|just)\b[^.]*\b(use|via|through|with)\b[^.]*\b(outline_file|read_symbol|find_symbol)\b/i,
  /\b(must|required to|always|need to|have to)\b[^.]*\b(outline_file|read_symbol|find_symbol)\b[^.]*\b(before|first|prior)\b/i,
  /\b(before|first|prior to)\b[^.]*\b(whole|entire|full) files?\b/i,
  /\b(whole|entire|full)[- ]files?\b[^.]*\b(discourag|expensive|wasteful|costly|too large|last resort|fall ?back|budget)/i,
  /\b(last resort|fall ?back)\b[^.]*\b(read|reading|whole file)/i,
  /\bration/i,
  /\b(saves?|cheaper|fewer tokens|reduces? reading|expensive)\b/i,
  /\b(ahead of|in preference to|in lieu of|sooner than)\b[^.]*\b(files?|read|reading)\b|\bfiles?\b[^.]*\b(ahead of|in preference to)\b/i,
  /\bbefore (the|a|any) (whole |entire |full )?files?\b/i,
];
// A sentence about reading or opening a file that limits when, or how much: "only after", "sparingly".
const READS_FILE = /\b(whole|entire|full)[- ]files?\b|\b(read|reads|reading|open|opens|opening)\b[^.;]*\bfiles?\b|\bfiles?\b[^.;]*\b(read|opened)\b/i;
const LIMITER =
  /\bonly\s+(after|when|if|once|where|as|for|in)\b|\bsparing(ly)?\b|\bminimi[sz]|\bseldom\b|\brarely\b|\bas (little|few)\b|\b(when|if|where) (strictly |really |absolutely )?(necessary|needed|required|unavoidable)\b|\bnot enough\b|\binsufficient\b|\bsparse/i;
export const restricts = (s) => RESTRICTIONS.some((re) => re.test(s)) || (READS_FILE.test(s) && LIMITER.test(s));
