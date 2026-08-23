import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const panelRoot = resolve(import.meta.dirname, '..');
const target = resolve(panelRoot, 'prototype/index.html');
const html = readFileSync(target, 'utf8');
const currentTarget = resolve(panelRoot, 'prototype-current/index.html');
const currentHtml = readFileSync(currentTarget, 'utf8');
const failures = [];
const passes = [];

function check(condition, label, detail = '') {
  if (condition) passes.push(label);
  else failures.push(detail ? `${label}: ${detail}` : label);
}

check(/^<!doctype html>/i.test(html), 'HTML5 doctype');
check(/<html\s+lang="en"/.test(html), 'document language');
check(/<meta\s+name="viewport"/.test(html), 'responsive viewport');
check(/<a class="skip-link" href="#main">/.test(html), 'skip link targets main content');
check(/<main[^>]+id="main"/.test(html), 'main landmark');
check(/<nav[^>]+aria-label=/.test(html), 'labelled navigation');
check(/<aside[^>]+aria-label=/.test(html), 'labelled complementary regions');
check(/<label[^>]+for="report-search"/.test(html), 'search input has an explicit label');
check(/prefers-reduced-motion/.test(html), 'reduced-motion handling');
check(/@media print/.test(html), 'print treatment');
check(/<noscript>/.test(html), 'no-JavaScript treatment');
check(/25 of 34 mapped/.test(html) && /Fourteen confirmed open findings/.test(html), 'frozen source-capture values');
check(/Comparison unavailable/.test(html), 'unknown comparison baseline is explicit');
check(/Registers agree/.test(html), 'publication integrity is explicit');
check(/Code verified/.test(html) && /Visible qualification/.test(html), 'epistemic qualifier remains visible');

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
check(duplicates.length === 0, 'unique IDs', duplicates.join(', '));

const idSet = new Set(ids);
const fragments = [...html.matchAll(/\shref="#([^"]+)"/g)].map((match) => match[1]);
const missingFragments = [...new Set(fragments.filter((fragment) => !idSet.has(fragment)))];
check(missingFragments.length === 0, 'internal fragments resolve', missingFragments.join(', '));

const controls = [...html.matchAll(/\saria-controls="([^"]+)"/g)].map((match) => match[1]);
const missingControls = [...new Set(controls.filter((control) => !idSet.has(control)))];
check(missingControls.length === 0, 'aria-controls targets resolve', missingControls.join(', '));

const externalAssetPatterns = [
  /<link\b[^>]*\brel=["']?stylesheet/i,
  /<(?:script|img|source|iframe)\b[^>]*\bsrc=["']https?:/i,
  /@import\s+(?:url\()?\s*["']?https?:/i,
  /url\(\s*["']?https?:/i,
];
check(externalAssetPatterns.every((pattern) => !pattern.test(html)), 'no external runtime assets');

const httpHrefs = [...html.matchAll(/\shref="(https?:[^"]+)"/g)].map((match) => match[1]);
check(httpHrefs.length === 0, 'prototype navigation is local-only', httpHrefs.join(', '));

const buttons = [...html.matchAll(/<button\b([^>]*)>/g)].map((match) => match[1]);
const untypedButtons = buttons.filter((attributes) => !/\btype="button"/.test(attributes));
check(untypedButtons.length === 0, 'all buttons declare type=button');

const detailsCount = (html.match(/<details\b/g) || []).length;
const summaryCount = (html.match(/<summary\b/g) || []).length;
check(detailsCount === summaryCount, 'every details element has a summary', `${detailsCount} details / ${summaryCount} summaries`);

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
let scriptSyntaxError = '';
for (const source of scripts) {
  try { new Function(source); }
  catch (error) { scriptSyntaxError = error.message; break; }
}
check(!scriptSyntaxError, 'inline JavaScript parses', scriptSyntaxError);

check(!html.includes('\u0000'), 'no NUL placeholders');
check((html.match(/<h1\b/g) || []).length === 1, 'exactly one h1');
check((html.match(/<article\b/g) || []).length >= 6, 'semantic article records');

check(/^<!doctype html>/i.test(currentHtml), 'current fixture: HTML5 doctype');
check(/<html\s+lang="en"/.test(currentHtml), 'current fixture: document language');
check(/<h1>AxiomDB<\/h1>/.test(currentHtml), 'current fixture: project name is the primary heading');
check(/<strong>AxiomDB<\/strong><span>Architecture survey · Amanuensis<\/span>/.test(currentHtml), 'current fixture: Amanuensis identity is secondary');
check(/Decision docket/.test(currentHtml) && /<summary>Warrants<\/summary>/.test(currentHtml), 'current fixture: retained precise register');
check(/Project status/.test(currentHtml) && /Continue reviewing/.test(currentHtml) && /Supporting evidence/.test(currentHtml), 'current fixture: direct practitioner labels');
check(!/(?:Casefiles?|Resume this report|Evidence trail|Unseen territory|Field Docket)/i.test(currentHtml), 'current fixture: retired labels are absent');
check(!/(?:--paper|--ink|linear-gradient|background-image)/i.test(currentHtml), 'current fixture: literal paper and texture tokens are absent');
check(/Iowan Old Style/.test(currentHtml) && /#235b58/i.test(currentHtml), 'current fixture: green-gray palette and mid-century type are present');
const currentRadii = [...currentHtml.matchAll(/border-radius:\s*([^;}]+)/gi)].map((match) => match[1].trim());
check(currentRadii.every((value) => /^0(?:\D|$)/.test(value)), 'current fixture: geometry stays square', currentRadii.join(', '));
check((currentHtml.match(/<nav\b/g) || []).length === 1 && (currentHtml.match(/<nav[\s\S]*?<\/nav>/g)?.[0].match(/<a\b/g) || []).length === 4, 'current fixture: navigation is bounded');
check((currentHtml.match(/<article\b/g) || []).length === 3, 'current fixture: three semantic finding records');
check(!/<script\b/.test(currentHtml), 'current fixture: no JavaScript required');
check(externalAssetPatterns.every((pattern) => !pattern.test(currentHtml)), 'current fixture: no external runtime assets');

const currentIds = [...currentHtml.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const currentIdSet = new Set(currentIds);
check(currentIdSet.size === currentIds.length, 'current fixture: unique IDs');
const currentFragments = [...currentHtml.matchAll(/\shref="#([^"]+)"/g)].map((match) => match[1]);
const currentMissingFragments = [...new Set(currentFragments.filter((fragment) => !currentIdSet.has(fragment)))];
check(currentMissingFragments.length === 0, 'current fixture: internal fragments resolve', currentMissingFragments.join(', '));

if (failures.length) {
  console.error(`Prototype validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Prototype validation passed: ${passes.length} checks.`);
for (const pass of passes) console.log(`- ${pass}`);
