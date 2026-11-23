// Fixture for the code-index extractor: every JavaScript row of PLAN §4.2.
import { join } from "node:path";
const fs = require("node:fs");

/** Joins parts. */
export function joinAll(...parts) {
  return join(...parts);
}

export function* walk(dir) {
  yield dir;
}

export class Store {
  items = [];
  static #instances = 0;

  constructor(path) {
    this.path = path;
  }

  get size() {
    return this.items.length;
  }

  set size(n) {
    this.items.length = n;
  }

  // Add one item.
  add(item) {
    this.items.push(item);
  }
}

export const handler = async (event) => {
  return fs.existsSync(event.path);
};

let options = { retries: 3 };

var counter = 0;

export default {
  joinAll,
  walk,
};
