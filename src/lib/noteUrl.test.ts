import test from "node:test";
import assert from "node:assert/strict";
import { noteUrl, notePathFromUrl } from "./noteUrl.ts";

test("a note's address survives the round trip", () => {
  for (const path of [
    "notes/Second Brain.md",
    "notes/ideas/a note with spaces.md",
    "collections/budget/_index.md",
    "notes/Ünïcode — dashes & ampersands.md",
    "notes/question?.md",
    "notes/100% done.md",
    "notes/a#b.md",
  ]) {
    assert.equal(notePathFromUrl(noteUrl(path)), path, path);
  }
});

test("the slashes stay slashes, so the address reads like the vault", () => {
  assert.equal(noteUrl("notes/ideas/Second Brain.md"), "/n/notes/ideas/Second%20Brain.md");
});

test("an address that names no note", () => {
  assert.equal(notePathFromUrl("/"), null);
  assert.equal(notePathFromUrl("/n/"), null);
  assert.equal(notePathFromUrl("/settings"), null);
  assert.equal(notePathFromUrl("/assets/index-abc.js"), null);
});

test("a full URL works as well as a pathname", () => {
  assert.equal(notePathFromUrl("http://127.0.0.1:4870/n/notes/a.md"), "notes/a.md");
  assert.equal(notePathFromUrl("https://host.ts.net:8443/n/notes/a.md?x=1#frag"), "notes/a.md");
});

test("an address cannot climb out of the vault", () => {
  assert.equal(notePathFromUrl("/n/../../etc/passwd"), null);
  assert.equal(notePathFromUrl("/n/notes/%2e%2e/secrets.md"), null);
  assert.equal(notePathFromUrl("/n/notes/%00.md"), null);
});

test("a half-written escape is refused rather than thrown over", () => {
  assert.equal(notePathFromUrl("/n/notes/%E0%A4%A.md"), null);
});

test("an empty path has no address of its own", () => {
  assert.equal(noteUrl(""), "/");
});
