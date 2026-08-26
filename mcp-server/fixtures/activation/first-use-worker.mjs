#!/usr/bin/env node
import { openDatabase } from "../../dist/db.js";
import { ensureProjectStorage, resolveProject } from "../../dist/project.js";

const [repository, interruptAfter] = process.argv.slice(2);
if (!repository || !interruptAfter) {
  process.stderr.write("usage: first-use-worker.mjs REPOSITORY BOUNDARY|none\n");
  process.exit(2);
}

const project = resolveProject(repository, {
  selectionSource: "a23-first-use-worker",
  serverVersion: "test",
});
const result = ensureProjectStorage(
  project,
  (databasePath) => {
    const db = openDatabase(databasePath);
    db.close();
  },
  {
    afterMutation(boundary, path) {
      if (boundary !== interruptAfter) return;
      process.stderr.write(`A23_INTERRUPT boundary=${boundary} path=${path}\n`);
      process.exit(86);
    },
  },
);

process.stdout.write(
  `${JSON.stringify({
    projectKey: project.projectKey,
    projectIdentity: project.bindingReceipt.projectIdentity,
    canonicalRoot: project.workspacePath,
    storagePath: project.storagePath,
    result,
  })}\n`,
);
