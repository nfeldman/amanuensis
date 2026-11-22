// Ünïcödé fixture: offsets are UTF-8 bytes, not UTF-16 code units.
export const 名前 = "東京";

/** Grüße — returns a greeting with an emoji 😀. */
export function grüße(wer: string): string {
  return `Hallo, ${wer} 👋`;
}

export const after = "ß";
