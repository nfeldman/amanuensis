// Structural comparison between two Amanuensis conspectuses. Opens
// both DBs read-only and reports an overlap / divergence summary:
// subsystems in common vs. unique to each side, findings overlap
// keyed on (subsystem_id, symptom, root_cause), evidence-quality
// distribution, vocabulary / field-note / contradiction / open-
// question counts, and which runs the same diagnosticity matrices
// opened (if any).
//
// Intended use: produce two conspectuses of the same codebase (one
// local, one cloud autoprogress) and compare the output. The diff is
// rendered both as a JSON result and, on request, as a markdown page
// under docs/comparison.md.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { ok, optBool, optString, requireString, type ToolDefinition } from "../helpers.js";

type Row = Record<string, unknown>;

function openReadOnly(dbPath: string): Database.Database {
  if (!existsSync(dbPath)) {
    throw new Error(`no memory.db at ${dbPath}`);
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  return db;
}

function rows(db: Database.Database, sql: string): Row[] {
  return db.prepare(sql).all() as Row[];
}

function count(db: Database.Database, sql: string): number {
  const r = db.prepare(sql).get() as { n: number } | undefined;
  return r?.n ?? 0;
}

interface Counts {
  subsystems: number;
  mapped: number;
  concerns: number;
  dispositions: number;
  findings: number;
  findings_critical: number;
  findings_high: number;
  evidence: number;
  field_notes: number;
  vocabulary: number;
  contradictions: number;
  open_questions: number;
  diagnosticity_matrices: number;
}

function gatherCounts(db: Database.Database): Counts {
  // Some tables may not exist on old DBs (e.g. open_questions on a
  // conspectus produced before Phase 2b). Guard each lookup.
  const hasTable = (name: string): boolean =>
    !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  const safeCount = (sql: string): number => {
    try {
      return count(db, sql);
    } catch {
      return 0;
    }
  };
  return {
    subsystems: safeCount("SELECT COUNT(*) AS n FROM subsystems"),
    mapped: safeCount("SELECT COUNT(*) AS n FROM subsystems WHERE status='mapped'"),
    concerns: safeCount("SELECT COUNT(*) AS n FROM concerns WHERE status='active'"),
    dispositions: safeCount("SELECT COUNT(*) AS n FROM dispositions"),
    findings: safeCount("SELECT COUNT(*) AS n FROM findings"),
    findings_critical: safeCount("SELECT COUNT(*) AS n FROM findings WHERE severity='CRITICAL'"),
    findings_high: safeCount("SELECT COUNT(*) AS n FROM findings WHERE severity='HIGH'"),
    evidence: safeCount("SELECT COUNT(*) AS n FROM evidence"),
    field_notes: safeCount("SELECT COUNT(*) AS n FROM field_notes"),
    vocabulary: safeCount("SELECT COUNT(*) AS n FROM vocabulary"),
    contradictions: safeCount("SELECT COUNT(*) AS n FROM contradictions"),
    open_questions: hasTable("open_questions")
      ? safeCount("SELECT COUNT(*) AS n FROM open_questions")
      : 0,
    diagnosticity_matrices: safeCount("SELECT COUNT(*) AS n FROM diagnosticity_sessions"),
  };
}

function setIds(db: Database.Database, sql: string): Set<string> {
  return new Set((rows(db, sql) as { id: string }[]).map((r) => r.id));
}

function overlap(a: Set<string>, b: Set<string>) {
  const both = [...a].filter((x) => b.has(x)).sort();
  const onlyA = [...a].filter((x) => !b.has(x)).sort();
  const onlyB = [...b].filter((x) => !a.has(x)).sort();
  return { both, onlyA, onlyB };
}

function findingSignatures(db: Database.Database): Map<string, Row> {
  const rs = rows(
    db,
    "SELECT finding_id, subsystem_id, symptom, root_cause, severity, status FROM findings",
  );
  const out = new Map<string, Row>();
  for (const r of rs) {
    // Two runs of the same survey rarely assign the same finding_id
    // (they're sequence-allocated within each run). The structural
    // signature is what matters: same subsystem, same symptom, same
    // root cause.
    const key = `${String(r.subsystem_id)}::${String(r.symptom).trim().toLowerCase()}::${String(r.root_cause).trim().toLowerCase()}`;
    out.set(key, r);
  }
  return out;
}

function evidenceKindHistogram(db: Database.Database): Record<string, number> {
  const rs = rows(db, "SELECT kind, COUNT(*) AS n FROM evidence GROUP BY kind");
  const out: Record<string, number> = {};
  for (const r of rs) out[String(r.kind)] = Number(r.n);
  return out;
}

function concernCoverage(db: Database.Database): Map<string, string> {
  // Which (subsystem, concern) pairs have dispositions, and the
  // classification each side reached.
  const rs = rows(db, "SELECT subsystem_id, concern_code, classification FROM dispositions");
  const out = new Map<string, string>();
  for (const r of rs) out.set(`${r.subsystem_id}::${r.concern_code}`, String(r.classification));
  return out;
}

function priorityMap(db: Database.Database): Map<string, number> {
  // Subsystems with a non-null priority, keyed by id. Missing priority
  // means the side has no opinion — we exclude those from agreement
  // math rather than pretending zero.
  let rs: Row[];
  try {
    rs = rows(db, "SELECT id, priority FROM subsystems WHERE priority IS NOT NULL");
  } catch {
    // Pre-migration DB that doesn't have the column. Treat as no
    // priorities recorded.
    return new Map();
  }
  const out = new Map<string, number>();
  for (const r of rs) out.set(String(r.id), Number(r.priority));
  return out;
}

// Kendall tau-b on the shared subsystem set, tolerating ties. Counts
// pairs (i,j) where the relative order of priority matches between the
// two runs vs. disagrees. Returns a value in [-1, 1] where 1 means
// perfect agreement on ordering, 0 means random, -1 means reversed.
function kendallTau(shared: string[], prA: Map<string, number>, prB: Map<string, number>): number {
  const n = shared.length;
  if (n < 2) return n === 1 ? 1 : 0;
  let concordant = 0;
  let discordant = 0;
  let tiesA = 0;
  let tiesB = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const keyI = shared[i];
      const keyJ = shared[j];
      if (keyI === undefined || keyJ === undefined) continue;
      const a1 = prA.get(keyI);
      const a2 = prA.get(keyJ);
      const b1 = prB.get(keyI);
      const b2 = prB.get(keyJ);
      if (a1 === undefined || a2 === undefined || b1 === undefined || b2 === undefined) continue;
      const signA = Math.sign(a1 - a2);
      const signB = Math.sign(b1 - b2);
      if (signA === 0 && signB === 0) {
        tiesA++;
        tiesB++;
      } else if (signA === 0) {
        tiesA++;
      } else if (signB === 0) {
        tiesB++;
      } else if (signA === signB) {
        concordant++;
      } else {
        discordant++;
      }
    }
  }
  const denom =
    Math.sqrt(concordant + discordant + tiesA) * Math.sqrt(concordant + discordant + tiesB);
  if (denom === 0) return 0;
  // Clamp to [-1, 1]: the sqrt product can overshoot by a float-
  // precision epsilon when all pairs are concordant (or all
  // discordant), producing values like 1.0000000000000002.
  const tau = (concordant - discordant) / denom;
  return Math.max(-1, Math.min(1, tau));
}

function topK(priorities: Map<string, number>, k: number): string[] {
  // Return the k subsystems with the smallest priority numbers (best
  // rank). Ties broken by subsystem id for determinism.
  return [...priorities.entries()]
    .sort((a, b) => (a[1] !== b[1] ? a[1] - b[1] : a[0].localeCompare(b[0])))
    .slice(0, k)
    .map(([id]) => id);
}

interface Comparison {
  paths: { a: string; b: string };
  labels: { a: string; b: string };
  counts: { a: Counts; b: Counts };
  subsystems: {
    both: string[];
    only_a: string[];
    only_b: string[];
    jaccard: number;
  };
  findings: {
    shared_signatures: number;
    only_a_signatures: number;
    only_b_signatures: number;
    jaccard: number;
  };
  concerns_coverage: {
    cells_both: number;
    cells_only_a: number;
    cells_only_b: number;
    same_verdict: number;
    diverged_verdict: number;
  };
  evidence_kinds: { a: Record<string, number>; b: Record<string, number> };
  priorities: {
    // How many subsystems each side assigned a priority to. A side
    // that ran onboarding without recording priorities reports 0.
    ranked_a: number;
    ranked_b: number;
    // Subsystems that both sides ranked — the substrate for agreement.
    shared_ranked: number;
    // Kendall tau-b on the shared ranked set. [-1, 1]; 1 = perfect
    // ordering agreement, 0 = no correlation, -1 = reversed.
    kendall_tau: number | null;
    // Top-K agreement: the set intersection of A's top K and B's top K,
    // divided by K. Reported for K = 1, 3, 5 (K capped at the smaller
    // ranked set size).
    top1_agreement: number | null;
    top3_agreement: number | null;
    top5_agreement: number | null;
    // Per-side top-5 for the markdown report.
    top5_a: string[];
    top5_b: string[];
  };
}

function jaccard(a: number, b: number, both: number): number {
  const union = a + b - both;
  if (union === 0) return 1;
  return both / union;
}

function compare(aPath: string, bPath: string, labels: { a: string; b: string }): Comparison {
  const a = openReadOnly(aPath);
  const b = openReadOnly(bPath);
  try {
    const countsA = gatherCounts(a);
    const countsB = gatherCounts(b);

    // Subsystems by id.
    const ssA = setIds(a, "SELECT id FROM subsystems");
    const ssB = setIds(b, "SELECT id FROM subsystems");
    const ss = overlap(ssA, ssB);

    // Findings — signature-based.
    const fsA = findingSignatures(a);
    const fsB = findingSignatures(b);
    const sharedFs = [...fsA.keys()].filter((k) => fsB.has(k));

    // Concern coverage cells.
    const ccA = concernCoverage(a);
    const ccB = concernCoverage(b);
    let cellsBoth = 0;
    let sameVerdict = 0;
    let divergedVerdict = 0;
    for (const [k, vA] of ccA) {
      if (ccB.has(k)) {
        cellsBoth++;
        if (vA === ccB.get(k)) sameVerdict++;
        else divergedVerdict++;
      }
    }

    // Priority agreement. Compare rankings only on subsystems both
    // sides ranked — otherwise the tau/top-K numbers are meaningless.
    const prA = priorityMap(a);
    const prB = priorityMap(b);
    const sharedRanked = [...prA.keys()].filter((id) => prB.has(id)).sort();
    const tau = sharedRanked.length >= 2 ? kendallTau(sharedRanked, prA, prB) : null;
    const kForTop = Math.min(prA.size, prB.size);
    const topAgreement = (k: number): number | null => {
      if (kForTop < k) return null;
      const inA = new Set(topK(prA, k));
      const inB = new Set(topK(prB, k));
      let intersection = 0;
      for (const id of inA) if (inB.has(id)) intersection++;
      return intersection / k;
    };

    return {
      paths: { a: aPath, b: bPath },
      labels,
      counts: { a: countsA, b: countsB },
      subsystems: {
        both: ss.both,
        only_a: ss.onlyA,
        only_b: ss.onlyB,
        jaccard: jaccard(ssA.size, ssB.size, ss.both.length),
      },
      findings: {
        shared_signatures: sharedFs.length,
        only_a_signatures: fsA.size - sharedFs.length,
        only_b_signatures: fsB.size - sharedFs.length,
        jaccard: jaccard(fsA.size, fsB.size, sharedFs.length),
      },
      concerns_coverage: {
        cells_both: cellsBoth,
        cells_only_a: ccA.size - cellsBoth,
        cells_only_b: ccB.size - cellsBoth,
        same_verdict: sameVerdict,
        diverged_verdict: divergedVerdict,
      },
      evidence_kinds: {
        a: evidenceKindHistogram(a),
        b: evidenceKindHistogram(b),
      },
      priorities: {
        ranked_a: prA.size,
        ranked_b: prB.size,
        shared_ranked: sharedRanked.length,
        kendall_tau: tau,
        top1_agreement: topAgreement(1),
        top3_agreement: topAgreement(3),
        top5_agreement: topAgreement(5),
        top5_a: topK(prA, 5),
        top5_b: topK(prB, 5),
      },
    };
  } finally {
    a.close();
    b.close();
  }
}

function renderMarkdown(c: Comparison): string {
  const { a: la, b: lb } = c.labels;
  const row = (label: string, av: unknown, bv: unknown) => `| ${label} | ${av} | ${bv} |`;
  const pad = (n: number) => String(n).padStart(4);
  const out: string[] = [];
  out.push("# Conspectus comparison");
  out.push("");
  out.push(`- **${la}**: \`${c.paths.a}\``);
  out.push(`- **${lb}**: \`${c.paths.b}\``);
  out.push("");
  out.push("## Counts");
  out.push("");
  out.push(`| Metric | ${la} | ${lb} |`);
  out.push("|---|---|---|");
  const metrics: Array<keyof Counts> = [
    "subsystems",
    "mapped",
    "concerns",
    "dispositions",
    "findings",
    "findings_critical",
    "findings_high",
    "evidence",
    "field_notes",
    "vocabulary",
    "contradictions",
    "open_questions",
    "diagnosticity_matrices",
  ];
  for (const m of metrics) {
    out.push(row(m, pad(c.counts.a[m]), pad(c.counts.b[m])));
  }
  out.push("");
  out.push("## Subsystems");
  out.push("");
  out.push(
    `- Overlap (Jaccard): **${(c.subsystems.jaccard * 100).toFixed(0)}%** ` +
      `— ${c.subsystems.both.length} shared, ${c.subsystems.only_a.length} only in ${la}, ` +
      `${c.subsystems.only_b.length} only in ${lb}`,
  );
  if (c.subsystems.only_a.length) {
    out.push(`- Only in ${la}: ${c.subsystems.only_a.map((s) => `\`${s}\``).join(", ")}`);
  }
  if (c.subsystems.only_b.length) {
    out.push(`- Only in ${lb}: ${c.subsystems.only_b.map((s) => `\`${s}\``).join(", ")}`);
  }
  out.push("");
  out.push("## Findings");
  out.push("");
  out.push(
    `- Structural-signature overlap (Jaccard): ` +
      `**${(c.findings.jaccard * 100).toFixed(0)}%** — ` +
      `${c.findings.shared_signatures} both sides, ` +
      `${c.findings.only_a_signatures} only ${la}, ` +
      `${c.findings.only_b_signatures} only ${lb}`,
  );
  out.push(
    `- Signature = (subsystem_id, symptom, root_cause). IDs differ " +` +
      `between runs so this is the meaningful comparison.`,
  );
  out.push("");
  out.push("## Concern coverage");
  out.push("");
  const cov = c.concerns_coverage;
  out.push(
    `- Cells populated on both sides: ${cov.cells_both} ` +
      `(only ${la}: ${cov.cells_only_a}, only ${lb}: ${cov.cells_only_b})`,
  );
  out.push(
    `- Same verdict on shared cells: ${cov.same_verdict}/${cov.cells_both} ` +
      `(diverged: ${cov.diverged_verdict})`,
  );
  out.push("");
  out.push("## Priority agreement");
  out.push("");
  const p = c.priorities;
  out.push(
    `- ${la} ranked ${p.ranked_a} subsystem(s); ${lb} ranked ${p.ranked_b}. ` +
      `Shared ranked set: **${p.shared_ranked}**.`,
  );
  if (p.kendall_tau !== null) {
    out.push(
      `- **Kendall τ**: ${p.kendall_tau.toFixed(3)} ` +
        `(1 = perfect order agreement, 0 = random, -1 = reversed)`,
    );
  } else {
    out.push("- **Kendall τ**: not applicable (need ≥2 shared ranked subsystems).");
  }
  const topLine = (k: number, v: number | null): string =>
    v === null ? `top-${k}: not applicable` : `top-${k}: ${Math.round(v * 100)}%`;
  out.push(
    `- Top-K agreement: ${topLine(1, p.top1_agreement)}, ` +
      `${topLine(3, p.top3_agreement)}, ${topLine(5, p.top5_agreement)}`,
  );
  if (p.top5_a.length || p.top5_b.length) {
    out.push("");
    out.push(`| Rank | ${la} top 5 | ${lb} top 5 |`);
    out.push("|---|---|---|");
    const len = Math.max(p.top5_a.length, p.top5_b.length);
    for (let i = 0; i < len; i++) {
      out.push(`| ${i + 1} | ${p.top5_a[i] ?? "—"} | ${p.top5_b[i] ?? "—"} |`);
    }
  }
  out.push("");
  out.push("## Evidence-quality distribution");
  out.push("");
  const allKinds = new Set([
    ...Object.keys(c.evidence_kinds.a),
    ...Object.keys(c.evidence_kinds.b),
  ]);
  const kinds = [...allKinds].sort();
  if (kinds.length === 0) {
    out.push("_No evidence rows on either side._");
  } else {
    out.push(`| Kind | ${la} | ${lb} |`);
    out.push("|---|---|---|");
    for (const k of kinds) {
      out.push(row(`\`${k}\``, c.evidence_kinds.a[k] ?? 0, c.evidence_kinds.b[k] ?? 0));
    }
  }
  out.push("");
  return `${out.join("\n")}\n`;
}

export const compareTools: ToolDefinition[] = [
  {
    name: "compare_conspectuses",
    description:
      "Diff two Amanuensis memory.db files structurally. Useful for " +
      "comparing a local vs. cloud autoprogress run of the same " +
      "codebase, or before/after a methodology change. Paths point " +
      "at the memory.db files directly, not at storage directories. " +
      "Returns a JSON summary; if write_to is set, also renders the " +
      "diff as a markdown page at that path.",
    inputSchema: {
      type: "object",
      properties: {
        path_a: { type: "string" },
        path_b: { type: "string" },
        label_a: { type: "string" },
        label_b: { type: "string" },
        write_to: {
          type: "string",
          description: "Optional: render a markdown report to this path too",
        },
      },
      required: ["path_a", "path_b"],
      additionalProperties: false,
    },
    handler: (args, _ctx) => {
      const pathA = requireString(args, "path_a");
      const pathB = requireString(args, "path_b");
      const labelA = optString(args, "label_a") ?? "A";
      const labelB = optString(args, "label_b") ?? "B";
      const writeTo = optString(args, "write_to");
      const withMarkdown = optBool(args, "_include_markdown", false);

      const result = compare(pathA, pathB, { a: labelA, b: labelB });

      if (writeTo) {
        mkdirSync(join(writeTo, "..").replace(/\/$/, ""), { recursive: true });
        writeFileSync(writeTo, renderMarkdown(result), "utf8");
      }

      return ok({
        ...result,
        markdown: withMarkdown ? renderMarkdown(result) : undefined,
      });
    },
  },
];
