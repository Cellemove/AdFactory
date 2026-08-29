import assert from "node:assert/strict";
import test from "node:test";
import { createInitialScriptDocument } from "./script-studio";
import { createTeardownBrief } from "./teardown-brief";

const workbook = {
  title: "THE WINNING AD DECONSTRUCTION WORKBOOK",
  sections: [
    { key: "hook", title: "PART 2: THE HOOK (0-3 SECONDS)", field_keys: ["first_words"] },
    { key: "problem", title: "PART 3: PROBLEM AMPLIFICATION", field_keys: ["pain"] },
    { key: "solution", title: "PART 4: SOLUTION INTRODUCTION", field_keys: ["mechanism"] },
    { key: "proof", title: "PART 5: PROOF SEQUENCE", field_keys: ["proof"] },
    { key: "offer", title: "PART 10: OFFER & CTA", field_keys: ["offer", "cta"] },
  ],
  fields: [
    { key: "first_words", label: "First Words", value: "My legs finally feel light again.", section: "PART 2: THE HOOK (0-3 SECONDS)", subsection: null, group: null, ordinal: 1 },
    { key: "pain", label: "Primary Pain Point", value: "Heavy, uncomfortable legs at the end of the day", section: "PART 3: PROBLEM AMPLIFICATION", subsection: null, group: null, ordinal: 2 },
    { key: "mechanism", label: "What Makes This Different", value: "Targeted graduated compression", section: "PART 4: SOLUTION INTRODUCTION", subsection: null, group: null, ordinal: 3 },
    { key: "proof", label: "Most Powerful Proof Element", value: "An extended uncut product demonstration", section: "PART 5: PROOF SEQUENCE", subsection: null, group: null, ordinal: 4 },
    { key: "offer", label: "Offer", value: "Two-pair bundle", section: "PART 10: OFFER & CTA", subsection: null, group: null, ordinal: 5 },
    { key: "cta", label: "CTA", value: "Choose your pair today", section: "PART 10: OFFER & CTA", subsection: null, group: null, ordinal: 6 },
  ],
};

test("maps the Teardown workbook into stable script-brief categories", () => {
  const brief = createTeardownBrief(workbook);
  assert.equal(brief.hook[0]?.value, "My legs finally feel light again.");
  assert.equal(brief.problem[0]?.label, "Primary Pain Point");
  assert.equal(brief.solution[0]?.value, "Targeted graduated compression");
  assert.equal(brief.proof[0]?.value, "An extended uncut product demonstration");
  assert.equal(brief.offer[0]?.value, "Two-pair bundle");
  assert.equal(brief.cta[0]?.value, "Choose your pair today");
});

test("adds selected Teardown intelligence to the editable script document", () => {
  const brief = createTeardownBrief(workbook);
  const document = createInitialScriptDocument({
    title: "Heavy legs concept",
    product: { id: "product-1", name: "3D Leggings", code: "V1" },
    avatar: null,
    angle: { id: "angle-1", name: "Heavy Legs" },
    framework: null,
    format: "UGC",
    targetDurationSec: 30,
    idea: "Open on the end-of-day struggle.",
    teardown: {
      id: "teardown-1",
      title: "Winning heavy-legs ad",
      url: "https://example.com/ad",
      brief,
    },
  });

  assert.equal(document.sourceRefs[0]?.id, "teardown-1");
  assert.equal(document.teardownBrief?.proof[0]?.label, "Most Powerful Proof Element");
  assert.equal(document.hookAlternatives[0]?.text, "My legs finally feel light again.");
  assert.match(document.modules[0]!.visualDirection, /Teardown reference/);
  assert.match(document.modules[1]!.visualDirection, /Heavy, uncomfortable legs/);
});
