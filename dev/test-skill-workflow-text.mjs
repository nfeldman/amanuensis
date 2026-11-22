#!/usr/bin/env node
// GATE O10 (design/orientation/PLAN.md §4 O10; W1-W6, decision D4).
//
// Turns red when:
//   - open-questions.md still says "option **A**", tells the human to call a tool
//     (`resolve_open_question`), or "Reviewing the queue" lacks the statement that the person
//     tells the agent, which then calls `resolve_open_question` (no sentence gives that call to
//     the person), and a reference to the
//     "Decisions needed" page; or it still names "a global queue on the findings index";
//   - subsystem-survey.md contains "(approved)";
//   - in phase-5-packaging.md the "Advance status" heading comes after "Materialize" or
//     "Seam assessability", or the final commit heading is no longer the last step; or in
//     subsystem-survey.md's Phase 5 summary list the "Advance status" step comes after the
//     "Materialize" or "Seam assessability" step;
//   - (W6) subsystem-survey.md contains `status=<phase_name>`, lacks the "When each phase sets
//     the status" table, or the table's (phase, status, when) rows differ from the contract's
//     `survey_passes` (mcp-server/contracts/conspectus-vocabulary.json; "before the phase
//     starts" = start, "when the phase ends" = end); lacks a "Before the phase starts" step
//     naming the server's prerequisite for `concerns` and `adversarial`; its resume list does
//     not read each status as the pass under way; or it still says Phase 4 "returns, status
//     advances to `adversarial`";
//   - (W6) in phase-3-concerns.md the first `set_disposition` comes before a sentence saying the
//     subsystem is already at `concerns`, or a line says the coordinator "advances to
//     `concerns`", or the file does not say the coordinator advances to `adversarial`
//     immediately; the same for phase-4-adversarial.md with `adversarial` (first
//     `set_disposition` or pass_type="adversarial") and "runs Phase 5 packaging immediately";
//   - (W6) SKILL.md's ladder block still has an arrow row putting phases under statuses, or the
//     sentences under it do not give each rung its phase and timing as the contract says, or
//     (W4) the `mapped` sentence does not place it after the explanations are settled and
//     before the phase publishes.
// Reads the skill files and the contract only; it touches no store.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skill = join(root, ".claude", "skills", "amanuensis");

function red(reason) {
  console.log(`GATE O10 RED: ${reason}`);
  process.exit(1);
}

function load(path, label) {
  if (!existsSync(path)) red(`${label} is missing`);
  try {
    return readFileSync(path, "utf8");
  } catch {
    red(`${label} is unreadable`);
  }
  return "";
}

const WHEN = { start: "before the phase starts", end: "when the phase ends" };

function check() {
  // The contract is the one source; the skill must agree with what the site prints.
  let passes;
  try {
    passes = JSON.parse(
      load(join(root, "mcp-server", "contracts", "conspectus-vocabulary.json"), "the contract"),
    ).survey_passes;
  } catch {
    return "the contract is not valid JSON";
  }
  if (!Array.isArray(passes) || passes.length !== 5) return "the contract lacks five survey_passes";
  for (const p of passes) {
    if (!(p.set_when in WHEN)) return `survey_passes ${p.status} has set_when ${p.set_when}`;
  }

  // W1/W2/W3: open-questions.md
  const oq = load(join(skill, "references", "open-questions.md"), "open-questions.md");
  if (/option \*\*A/.test(oq)) return 'open-questions.md still says "option **A**"';
  if (!/Run the inferred scope to completion/.test(oq))
    return 'open-questions.md lacks "Run the inferred scope to completion"';
  if (/global queue on the findings index/.test(oq))
    return "open-questions.md still sends questions to a global queue on the findings index";
  const rev = oq.match(/\n## Reviewing the queue\n([\s\S]*?)(?=\n## )/);
  if (!rev) return 'open-questions.md has no "Reviewing the queue" section';
  const review = rev[1];
  if (!/Decisions needed/.test(review))
    return 'the "Reviewing the queue" section does not name the "Decisions needed" page';
  if (!/(person|human)[^.]*\b(tells?|telling)\b[^.]*\bagent\b/i.test(review))
    return 'the "Reviewing the queue" section does not say the person answers by telling the agent';
  for (const para of review.split(/\n\s*\n/)) {
    if (/resolve_open_question/.test(para) && !/\bagent\b|\bcoordinator\b/i.test(para))
      return "open-questions.md has the human calling resolve_open_question themselves";
  }
  const calls = review
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter((s) => /resolve_open_question/.test(s));
  if (calls.some((s) => /\b(person|human|you|they)\b\s+(then\s+)?((can|should|must|may)\s+)?calls?\b/i.test(s)))
    return "open-questions.md has the human calling resolve_open_question themselves";
  if (!calls.some((s) => /\b(agent|coordinator)\b[^.]*?\bcalls?\b[^.]*?`resolve_open_question/i.test(s)))
    return 'the "Reviewing the queue" section does not say the agent then calls `resolve_open_question`';
  if (/Answer the question\s*[—-]\s*`resolve_open_question/.test(review))
    return "open-questions.md still lists the tool call as the human's answer";

  // W3/W6: subsystem-survey.md
  const ss = load(join(skill, "references", "subsystem-survey.md"), "subsystem-survey.md");
  if (/\(approved\)/.test(ss)) return 'subsystem-survey.md still says "(approved)"';
  if (/status=<phase_name>/.test(ss))
    return "subsystem-survey.md still sets a generic status=<phase_name> after every phase";
  if (/Phase 4 returns,\s*status advances/.test(ss.replace(/\s+/g, " ")))
    return "subsystem-survey.md still says the status advances to `adversarial` after Phase 4";

  const at = ss.indexOf("When each phase sets the status");
  if (at < 0) return 'subsystem-survey.md lacks the "When each phase sets the status" table';
  const rows = [];
  let header = null;
  for (const line of ss.slice(at).split("\n").slice(1)) {
    if (!line.trim().startsWith("|")) {
      if (header) break;
      continue;
    }
    const cells = line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
    if (!header) {
      header = cells.map((c) => c.toLowerCase());
      continue;
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    rows.push(cells);
  }
  if (!header || header.join("|") !== "phase|status|when")
    return 'the "When each phase sets the status" table lacks the columns Phase | Status | When';
  if (rows.length !== passes.length)
    return `the status table has ${rows.length} rows, the contract has ${passes.length}`;
  for (const p of passes) {
    const row = rows.find((r) => r[0].replace(/\D/g, "") === String(p.phase));
    if (!row) return `the status table has no row for Phase ${p.phase}`;
    if (row[1].replace(/`/g, "") !== p.status)
      return `Phase ${p.phase} sets status ${row[1]} in the skill, ${p.status} in the contract`;
    if (row[2] !== WHEN[p.set_when])
      return `Phase ${p.phase} sets ${p.status} "${row[2]}" in the skill, "${WHEN[p.set_when]}" in the contract`;
  }

  const beforeAt = ss.search(/Before the phase starts/i);
  if (beforeAt < 0)
    return 'subsystem-survey.md lacks a "Before the phase starts" step in "Running a phase"';
  const beforeEnd = ss.slice(beforeAt).search(/\n#{2,3}\s/);
  const flat = ss
    .slice(beforeAt, beforeEnd < 0 ? undefined : beforeAt + beforeEnd)
    .replace(/\s+/g, " ");
  if (!/`concerns`[^.]*structure narrative/.test(flat))
    return 'the "Before the phase starts" step does not name the structure narrative `concerns` needs';
  if (!/`adversarial`[^.]*disposition/.test(flat))
    return 'the "Before the phase starts" step does not name the disposition `adversarial` needs';

  const resume = ss.match(/## Resume logic[\s\S]*?(?=\n## )/);
  if (!resume) return 'subsystem-survey.md has no "Resume logic" section';
  const items = resume[0].split(/\n\s*-\s+/).slice(1).map((s) => s.replace(/\s+/g, " "));
  const item = (status) => items.find((s) => s.startsWith(`\`${status}\``)) ?? "";
  if (!/Phase 1/.test(item("unmapped"))) return "the resume list sends `unmapped` somewhere other than Phase 1";
  if (!/Phase 2/.test(item("scoping"))) return "the resume list sends `scoping` somewhere other than Phase 2";
  const st = item("structural");
  if (!(/advance[^.]*`concerns`/i.test(st) && /Phase 3/.test(st)))
    return "the resume list does not advance `structural` to `concerns` before Phase 3";
  const co = item("concerns");
  if (
    !(
      /Phase 3/.test(co) &&
      /get_concern_coverage/.test(co) &&
      /advance[^.]*`adversarial`/i.test(co) &&
      /Phase 4/.test(co)
    )
  )
    return "the resume list does not finish Phase 3 (get_concern_coverage), then advance to `adversarial` and run Phase 4";
  const ad = item("adversarial");
  if (!(/Phase 4/.test(ad) && /record_claim_challenge/.test(ad) && /Phase 5/.test(ad)))
    return "the resume list does not finish Phase 4 (record_claim_challenge), then run Phase 5";

  // W4/W5: the coordinator's Phase 5 summary list in subsystem-survey.md
  const step = (re) => {
    const m = ss.match(re);
    return m ? m.index : -1;
  };
  const ssAdv = step(/^\d+\.\s+\*\*Advance status/m);
  const ssMat = step(/^\d+\.\s+\*\*Materialize/m);
  const ssSeam = step(/^\d+\.\s+\*\*Seam assessability/m);
  if (ssAdv < 0 || ssMat < 0 || ssSeam < 0)
    return "subsystem-survey.md's Phase 5 list lost an Advance status, Materialize or Seam assessability step";
  if (ssAdv > ssMat) return 'subsystem-survey.md\'s Phase 5 list advances status after "Materialize"';
  if (ssAdv > ssSeam) return 'subsystem-survey.md\'s Phase 5 list advances status after "Seam assessability"';

  // W3/W4/W5: phase-5-packaging.md
  const p5 = load(join(skill, "references", "phase-5-packaging.md"), "phase-5-packaging.md");
  const heads = [...p5.matchAll(/^###\s+(?:\d+\.\s+)?(.+)$/gm)].map((m) => ({
    title: m[1].trim(),
    at: m.index,
  }));
  const find = (re) => heads.find((h) => re.test(h.title));
  const adv = find(/^Advance status/i);
  const mat = find(/^Materialize/i);
  const seam = find(/^Seam assessability/i);
  const commit = find(/^Commit the final gate/i);
  if (!adv || !mat || !seam || !commit) return "phase-5-packaging.md lost an Advance, Materialize, Seam or Commit heading";
  if (adv.at > mat.at) return 'phase-5-packaging.md advances status after "Materialize"';
  if (adv.at > seam.at) return 'phase-5-packaging.md advances status after "Seam assessability"';
  if (heads[heads.length - 1] !== commit) return "phase-5-packaging.md no longer ends with the commit step";
  if (/advanced status to `adversarial`/.test(p5.replace(/\s+/g, " ")) && !/already/.test(p5.slice(0, 600)))
    return "phase-5-packaging.md opens by advancing to `adversarial` after Phase 4";

  // W6: phase 3 and 4 openings
  for (const [file, status, first, tail] of [
    ["phase-3-concerns.md", "concerns", /set_disposition/, /advances to `adversarial` and starts adversarial\s+review immediately/],
    [
      "phase-4-adversarial.md",
      "adversarial",
      /set_disposition|pass_type="adversarial"/,
      /runs Phase 5 packaging immediately/,
    ],
  ]) {
    const text = load(join(skill, "references", file), file);
    const flatText = text.replace(/[ \t]*\n[ \t]*/g, " ");
    const said = new RegExp(`already advanced this subsystem to \`${status}\``).exec(flatText);
    if (!said) return `${file} never says the subsystem is already at \`${status}\``;
    const firstUse = first.exec(flatText);
    if (!firstUse || firstUse.index < said.index)
      return `${file} uses ${firstUse ? firstUse[0] : "its first write"} before saying the subsystem is already at \`${status}\``;
    if (new RegExp(`advances (?:status )?to \`${status}\``).test(flatText))
      return `${file} still has the coordinator advancing to \`${status}\` after the phase`;
    if (!tail.test(flatText)) return `${file} lacks the corrected hand-off sentence at its end`;
  }

  // W6: SKILL.md ladder and the sentences that replace the arrow row
  const sk = load(join(skill, "SKILL.md"), "SKILL.md");
  const ladder = sk.match(/\n```\n(unmapped[^\n]*)\n([\s\S]*?)```\n([\s\S]*?)\nAuthorized claims/);
  if (!ladder) return "SKILL.md has no status ladder before the Authorized claims table";
  if (/Phase\s*\d/.test(ladder[2])) return "SKILL.md's ladder block still has an arrow row that puts a phase under a status";
  const prose = ladder[3].replace(/\s+/g, " ");
  const ladderLine = ladder[1].split("→").map((s) => s.trim());
  if (ladderLine.join(",") !== "unmapped,scoping,structural,concerns,adversarial,mapped")
    return "SKILL.md's ladder line changed";
  for (const p of passes) {
    const timing = p.set_when === "start" ? `before Phase ${p.phase} starts` : `when Phase ${p.phase} ends`;
    const sentence = prose.split(/(?<=\.)\s+/).find((s) => s.includes(`\`${p.status}\``));
    if (!sentence) return `SKILL.md says nothing under the ladder about \`${p.status}\``;
    if (!sentence.includes(timing))
      return `SKILL.md's sentence for \`${p.status}\` does not say it is set ${timing}`;
    const other = p.set_when === "start" ? `when Phase ${p.phase} ends` : `before Phase ${p.phase} starts`;
    if (sentence.includes(other)) return `SKILL.md's sentence for \`${p.status}\` also says ${other}`;
  }
  // W4: `mapped` is set partway through Phase 5, so its sentence must say where: after the
  // explanations are settled and before the phase publishes. "When Phase 5 ends, before the
  // phase materializes" contradicts itself.
  const mappedSentence = prose.split(/(?<=\.)\s+/).find((s) => s.includes("`mapped`")) ?? "";
  if (!(/after[^.]*explanations/i.test(mappedSentence) && /before[^.]*publish/i.test(mappedSentence)))
    return "SKILL.md's sentence for `mapped` does not place it after the explanations are settled and before the phase publishes";
  return null;
}

const failure = check();
if (failure) red(failure);
console.log("GATE O10 GREEN");
