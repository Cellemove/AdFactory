import assert from "node:assert/strict";
import test from "node:test";
import {
  extractMilanoteEvidence,
  milanoteRichTextToPlainText,
  parseMilanoteBoardLink,
  type MilanoteApiElement,
  type MilanoteBoardResponse,
} from "./milanote-api";

test("parses Milanote board and permission IDs", () => {
  assert.deepEqual(
    parseMilanoteBoardLink("https://app.milanote.com/board-123/a-title?p=permission-456"),
    { boardId: "board-123", permissionId: "permission-456" },
  );
});

test("converts Milanote rich text without inventing copy", () => {
  assert.equal(milanoteRichTextToPlainText({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "First line" }, { type: "hardBreak" }, { type: "text", text: "Second line" }] },
      { type: "paragraph", content: [{ type: "text", text: "Third line" }] },
    ],
  }).trim(), "First line\nSecond line\nThird line");
});

test("matches a shared-board column and excludes instruction cards", () => {
  const response = board("root", [
    element("target", "COLUMN", "root", "SU0600052\n3 Reasons Your Postpartum Cellulite Is Getting Worse"),
    card("prompt", "target", "We target the new mom. The angle is anti-cellulitis. Take your time. 3 different hooks, it's mandatory."),
    card("hook", "target", "HOOK A — THE STAT\nVO: 85% of mothers notice this after pregnancy."),
    card("body", "target", "Pregnancy stretched the fibers holding fat in place. Every step creates graduated compression through the leg."),
  ]);
  const result = extractMilanoteEvidence(response, "root", {
    externalId: "SU0600052",
    title: "3 Reasons Your Postpartum Cellulite Is Getting Worse",
  }, 3);
  assert.equal(result.status, "matched");
  if (result.status !== "matched") return;
  assert.match(result.extraction.scriptText, /HOOK A/);
  assert.match(result.extraction.scriptText, /Pregnancy stretched/);
  assert.doesNotMatch(result.extraction.scriptText, /We target the new mom/);
});

test("reads only final script columns on a direct board and separates deconstruction", () => {
  const response = board("root", [
    element("system", "COLUMN", "root", "SYSTEM PROMPT — CREATIVE"),
    card("system-card", "system", "You are a world-class creative strategist. Your objective is to create an ad."),
    element("deconstruction", "COLUMN", "root", "Deconstruction of the ads"),
    card("deconstruction-card", "deconstruction", "The ad uses a visual interruption before presenting proof."),
    element("hook-column", "COLUMN", "root", "HOOK 1"),
    card("hook-card", "hook-column", "VO: My legs used to feel heavy every evening."),
    element("body-column", "COLUMN", "root", "BODY"),
    card("body-card", "body-column", "BEAT 1 | PROBLEM\nVO: By six o'clock I had to sit down."),
  ], "SU09000022IO — 3 reasons I regret");
  const result = extractMilanoteEvidence(response, "root", {
    externalId: "SU09000022IO",
    title: "3 reasons I regret",
  }, 1);
  assert.equal(result.status, "matched");
  if (result.status !== "matched") return;
  assert.deepEqual(result.extraction.sectionLabels, ["HOOK 1", "BODY"]);
  assert.equal(result.extraction.deconstructionText, "The ad uses a visual interruption before presenting proof.");
  assert.doesNotMatch(result.extraction.scriptText, /world-class creative strategist/);
});

test("uses the evidence title to disambiguate duplicate external IDs", () => {
  const response = board("root", [
    element("a", "COLUMN", "root", "SU0600054 — Dropped a full pant size"),
    card("a-script", "a", "HOOK A\nI dropped a full pant size in seven days and this is what changed."),
    element("b", "COLUMN", "root", "SU0600054 — Sweating legging concept"),
    card("b-script", "b", "HOOK B\nThese leggings made me sweat through my morning walk."),
  ]);
  const result = extractMilanoteEvidence(response, "root", {
    externalId: "SU0600054",
    title: "Dropped a full pant size",
  }, 2);
  assert.equal(result.status, "matched");
  if (result.status !== "matched") return;
  assert.match(result.extraction.scriptText, /full pant size/);
  assert.doesNotMatch(result.extraction.scriptText, /morning walk/);
});

function board(rootId: string, elements: MilanoteApiElement[], title = "Shared board"): MilanoteBoardResponse {
  return {
    elements: Object.fromEntries([element(rootId, "BOARD", "parent", title), ...elements].map((item) => [item.id!, item])),
    childrenReturned: { [rootId]: true },
  };
}

function element(id: string, elementType: string, parentId: string, title = ""): MilanoteApiElement {
  return { id, elementType, content: { title }, location: { parentId, position: { index: 0, score: 0 } } };
}

function card(id: string, parentId: string, text: string): MilanoteApiElement {
  return {
    id,
    elementType: "CARD",
    content: { textContent: { type: "doc", content: text.split("\n").map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] })) } },
    location: { parentId, position: { index: 0, score: 0 } },
  };
}

