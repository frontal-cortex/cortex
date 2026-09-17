import test from "node:test";
import assert from "node:assert/strict";
import { yamlScalar, statsBlock, specReplaceKey, filterOf, statIdent, dateValueLabel, renameInFormula } from "./visualSpec.ts";

test("a scalar stays bare only when it reads back as the same string", () => {
  assert.equal(yamlScalar("amount"), "amount");
  assert.equal(yamlScalar("collections/expenses"), "collections/expenses");
  assert.equal(yamlScalar("Spent this month"), "Spent this month");
  assert.equal(yamlScalar("date >= @month"), '"date >= @month"');
  assert.equal(yamlScalar("Earned - Spent"), '"Earned - Spent"');
  assert.equal(yamlScalar("true"), '"true"');
  assert.equal(yamlScalar("12"), '"12"');
  assert.equal(yamlScalar('say "hi"'), '"say \\"hi\\""');
});

test("stats entries write one flow map per line, keys in a fixed order", () => {
  const block = statsBlock([
    { format: "currency", field: "amount", agg: "sum", label: "Spent", filter: "date >= @month", source: "collections/expenses" },
    { label: "Net", expr: "earned - spent", field: "" },
  ]);
  assert.equal(block, [
    "stats:",
    '  - {label: Spent, source: collections/expenses, agg: sum, field: amount, filter: "date >= @month", format: currency}',
    '  - {label: Net, expr: "earned - spent"}',
  ].join("\n"));
  assert.equal(statsBlock([{ label: "Result", expr: "" }]), 'stats:\n  - {label: Result, expr: ""}');
  assert.equal(statsBlock([]), "stats: []");
});

test("replacing a key swaps its whole block and keeps the rest of the spec", () => {
  const spec = "source: collections/expenses\ntype: stats\nstats:\n  - {label: A, agg: count}\n  - {label: B, agg: count}\nfilter: amount > 0\n";
  assert.equal(
    specReplaceKey(spec, "stats", "stats:\n  - {label: C, agg: sum, field: amount}"),
    "source: collections/expenses\ntype: stats\nstats:\n  - {label: C, agg: sum, field: amount}\nfilter: amount > 0\n",
  );
  assert.equal(specReplaceKey("source: x\ntype: stats\n", "stats", "stats: []"), "source: x\ntype: stats\nstats: []\n");
  // A flow list on one line and a `- ` list at column 0 are both one block.
  assert.equal(specReplaceKey("source: x\nstats: [{label: A}]\n", "stats", "stats: []"), "source: x\nstats: []\n");
  assert.equal(specReplaceKey("source: x\nstats:\n- {label: A}\ntype: stats\n", "stats", "stats: []"), "source: x\nstats: []\ntype: stats\n");
});

test("the filter line is read out of a serialized spec", () => {
  assert.equal(filterOf("source: x\nfilter: date >= @month and amount > 0\nsort: [date]\n"), "date >= @month and amount > 0");
  assert.equal(filterOf("source: x\n"), "");
});

test("tile identifiers match the engine's", () => {
  assert.equal(statIdent("Spent this month"), "spent_this_month");
  assert.equal(statIdent("  Net (€) "), "net");
  assert.equal(statIdent("Café total"), "café_total");
});

test("a renamed tile is renamed in the formulas that use it", () => {
  assert.equal(renameInFormula("Earned - Spent", "Spent", "Spent this month"), "Earned - spent_this_month");
  assert.equal(renameInFormula("earned - spent * 2", "Spent", "Outgoings"), "earned - outgoings * 2");
  assert.equal(renameInFormula("spent_total - spent", "Spent", "Out"), "spent_total - out", "only whole names");
  assert.equal(renameInFormula('concat("Spent", spent)', "Spent", "Out"), 'concat("Spent", out)', "not inside quotes");
  assert.equal(renameInFormula("a + b", "Spent", "Out"), "a + b");
});

test("relative dates read as words", () => {
  assert.equal(dateValueLabel("@month"), "This month");
  assert.equal(dateValueLabel("2026-09-01"), "2026-09-01");
});
