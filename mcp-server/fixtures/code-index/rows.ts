// Fixture for the code-index extractor: every TypeScript row of PLAN §4.2.
import { readFileSync } from "node:fs";
import type { Stats } from "node:fs";

/** Adds two numbers. */
export function add(a: number, b: number): number {
  return a + b;
}

function* counter(limit: number) {
  for (let i = 0; i < limit; i++) yield i;
}

// The shape every widget has.
export interface Widget {
  name: string;
  render(): string;
}

export type WidgetName = Widget["name"];

enum Color {
  Red,
  Green,
}

/**
 * A labelled widget.
 */
@sealed
export class Label implements Widget {
  name = "label";
  static count: number;
  #secret = 0;

  constructor(name: string) {
    this.name = name;
  }

  // Read the text.
  get text(): string {
    return this.name;
  }

  set text(value: string) {
    this.name = value;
  }

  render(): string {
    function pad(s: string) {
      return ` ${s} `;
    }
    return pad(this.name);
  }
}

export namespace Shapes {
  export const sides = 4;
  export function area(w: number): number {
    return w * w;
  }
}

export const double = (n: number): number => n * 2;

let settings = { verbose: false, depth: 2, describe: () => "settings" };

var legacy = 1, alsoLegacy = 2;

for (let i = 0; i < 2; i++) counter(i);

export default function () {
  return readFileSync;
}
