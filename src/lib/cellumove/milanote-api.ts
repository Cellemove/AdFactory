import type { ScriptEvidenceRow } from "@/lib/database.types";
import {
  buildMilanoteScriptText,
  isExcludedMilanoteSection,
  normalizeMilanoteExtraction,
} from "@/lib/cellumove/milanote-script-extraction";

export type MilanoteRichTextNode = {
  type?: string;
  text?: string;
  content?: MilanoteRichTextNode[];
};

export type MilanoteApiElement = {
  id?: string;
  _id?: string;
  elementType?: string;
  content?: {
    title?: string;
    textContent?: MilanoteRichTextNode;
  };
  location?: {
    parentId?: string;
    position?: { index?: number; score?: number; x?: number; y?: number };
    section?: string;
  };
};

export type MilanoteBoardResponse = {
  elements?: Record<string, MilanoteApiElement>;
  childrenReturned?: Record<string, boolean>;
  errors?: Record<string, unknown>;
};

export type MilanoteEvidenceExtraction = {
  scriptText: string;
  deconstructionText: string | null;
  sectionLabels: string[];
  excludedLabels: string[];
  matchedElementId: string;
  matchedBy: "external_id" | "title" | "direct_board";
};

export type MilanoteEvidenceExtractionResult =
  | { status: "matched"; extraction: MilanoteEvidenceExtraction }
  | { status: "no_match" | "ambiguous" | "no_script"; reason: string };

const SCRIPT_HEADER_PATTERN = /^(?:hook(?:\s*#?\s*[a-z0-9]+)?|body(?:\s*#?\s*\d+)?|script|cta|final\s+script)\b/i;
const DECONSTRUCTION_PATTERN = /deconstruction/i;
const SCRIPT_FIELD_PATTERN = /^(?:hook(?:\s*#?\s*[a-z0-9]+)?|body(?:\s*#?\s*\d+)?|script|cta|final\s+script|beat\s*\d+|vo\s*:|visual\s*:|first\s+frame\s*:)/i;
const PLANNING_CARD_PATTERN = /(?:\bwe target\b|\bthe angle is\b|full\s+b[- ]?roll\s+ads?|\bneed clarity\b|\byou cho(?:o)?se the music\b|\btake your time\b|different hooks?.*mandatory|hooks? you do them from your head|\bgoal is having\b|\bsame mood\b|\bchange colou?r\b|\badapt(?:ation)?\b.*\b(?:video|ads?)\b|\bdo a full freestyle\b|\bname it yourself\b|\bapply the enhanced prompt\b|\bsystem prompt\b|\byour objective is to create\b|\bwho you are working with\b|\breturn only (?:this )?json\b)/i;
const AUDIENCE_COPY_SIGNAL = /(?:\bvo\s*:|on[- ]screen|\bheadline\b|\bcaption\b|\boverlay\b|\bcta\b|\btext\s*:|\bpov\s*:|\bhook\b|\bbuy\s+\d|\bcellumove\b|^[\s"“])/i;

export function parseMilanoteBoardLink(rawUrl: string): { boardId: string; permissionId: string | null } {
  const url = new URL(rawUrl);
  if (url.hostname.toLowerCase() !== "app.milanote.com") throw new Error("Expected an app.milanote.com board URL.");
  const boardId = url.pathname.split("/").filter(Boolean)[0];
  if (!boardId) throw new Error("The Milanote URL does not contain a board ID.");
  return { boardId, permissionId: url.searchParams.get("p") };
}

export function milanoteRichTextToPlainText(node: MilanoteRichTextNode | null | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  const content = (node.content ?? []).map(milanoteRichTextToPlainText).join("");
  if (["paragraph", "heading", "blockquote", "listItem"].includes(node.type ?? "")) return `${content}\n`;
  if (["bulletList", "orderedList"].includes(node.type ?? "")) return `${content}\n`;
  return content;
}

export function extractMilanoteEvidence(
  response: MilanoteBoardResponse,
  rootBoardId: string,
  evidence: Pick<ScriptEvidenceRow, "externalId" | "title">,
  evidenceCountForBoard: number,
): MilanoteEvidenceExtractionResult {
  const elements = response.elements ?? {};
  const root = elements[rootBoardId];
  if (!root || root.elementType === "SKELETON" || response.childrenReturned?.[rootBoardId] === false) {
    return { status: "no_match", reason: "The board contents are not available with the supplied Milanote permissions." };
  }

  const descendants = descendantElements(elements, rootBoardId);
  const match = resolveEvidenceContainer(descendants, evidence, root, evidenceCountForBoard);
  if (match.status !== "matched") return match;

  const extraction = match.elementId === rootBoardId
    ? extractStructuredBoard(elements, rootBoardId)
    : extractEvidenceContainer(elements, match.elementId, evidence);
  if (!extraction.sections.length) {
    return { status: "no_script", reason: `Matched by ${match.matchedBy.replace("_", " ")}, but no final script cards remained after prompts and planning material were excluded.` };
  }

  try {
    const normalized = normalizeMilanoteExtraction({
      sections: extraction.sections,
      excludedLabels: extraction.excludedLabels,
    });
    return {
      status: "matched",
      extraction: {
        scriptText: buildMilanoteScriptText(normalized),
        deconstructionText: extraction.deconstructionText,
        sectionLabels: normalized.sections.map((section) => section.label),
        excludedLabels: normalized.excludedLabels,
        matchedElementId: match.elementId,
        matchedBy: match.matchedBy,
      },
    };
  } catch (error) {
    return { status: "no_script", reason: error instanceof Error ? error.message : String(error) };
  }
}

function resolveEvidenceContainer(
  descendants: MilanoteApiElement[],
  evidence: Pick<ScriptEvidenceRow, "externalId" | "title">,
  root: MilanoteApiElement,
  evidenceCountForBoard: number,
): { status: "matched"; elementId: string; matchedBy: MilanoteEvidenceExtraction["matchedBy"] }
  | { status: "no_match" | "ambiguous"; reason: string } {
  const externalId = normalizeIdentifier(evidence.externalId ?? "");
  if (externalId) {
    const rootId = elementId(root);
    const rootHasScriptColumns = descendants.some((element) => element.location?.parentId === rootId && SCRIPT_HEADER_PATTERN.test(elementTitle(element)));
    if (rootHasScriptColumns && identifiersIn(elementTitle(root)).includes(externalId)) {
      return { status: "matched", elementId: elementId(root), matchedBy: "direct_board" };
    }
    const titleExact = descendants.filter((element) => identifiersIn(elementTitle(element)).includes(externalId));
    const exact = titleExact.length
      ? preferredContainers(titleExact)
      : preferredContainers(descendants.filter((element) => identifiersIn(elementText(element)).includes(externalId)));
    const resolved = resolveCandidate(exact, evidence.title);
    if (resolved) return { status: "matched", elementId: elementId(resolved), matchedBy: "external_id" };
    if (exact.length > 1) return { status: "ambiguous", reason: `The external ID ${evidence.externalId} appears in more than one Milanote container and the title did not identify one uniquely.` };
  }

  const normalizedTitle = normalizeTitle(evidence.title);
  if (normalizedTitle.length >= 12) {
    const titleMatches = preferredContainers(descendants.filter((element) => {
      const candidate = normalizeTitle(elementText(element));
      return candidate.length >= 12 && (candidate.includes(normalizedTitle) || normalizedTitle.includes(candidate));
    }));
    const resolved = resolveCandidate(titleMatches, evidence.title);
    if (resolved) return { status: "matched", elementId: elementId(resolved), matchedBy: "title" };
    if (titleMatches.length > 1) return { status: "ambiguous", reason: "The normalized title matches more than one Milanote container." };
  }

  const rootIdentifiers = identifiersIn(elementText(root));
  if ((externalId && rootIdentifiers.includes(externalId)) || evidenceCountForBoard === 1) {
    return { status: "matched", elementId: elementId(root), matchedBy: "direct_board" };
  }
  return { status: "no_match", reason: "No unique Milanote card or column matched the evidence external ID or title." };
}

function extractStructuredBoard(elements: Record<string, MilanoteApiElement>, parentId: string) {
  const sections: Array<{ label: string; content: string }> = [];
  const excludedLabels: string[] = [];
  const deconstructionParts: string[] = [];

  for (const child of childrenOf(elements, parentId)) {
    const label = elementTitle(child).trim();
    if (!label) continue;
    const cards = childrenOf(elements, elementId(child))
      .map(elementText)
      .map((text) => text.trim())
      .filter(Boolean);
    const content = cards.length ? cards.join("\n\n") : elementBodyWithoutTitle(child, label);
    if (DECONSTRUCTION_PATTERN.test(label)) {
      if (content) deconstructionParts.push(content);
      continue;
    }
    if (!SCRIPT_HEADER_PATTERN.test(label)) {
      excludedLabels.push(shortLabel(label));
      continue;
    }
    if (content && !isExcludedMilanoteSection({ label, content })) sections.push({ label, content });
  }
  return {
    sections,
    excludedLabels: unique(excludedLabels),
    deconstructionText: deconstructionParts.length ? deconstructionParts.join("\n\n") : null,
  };
}

function extractEvidenceContainer(
  elements: Record<string, MilanoteApiElement>,
  containerId: string,
  evidence: Pick<ScriptEvidenceRow, "externalId" | "title">,
) {
  const container = elements[containerId];
  if (!container) return { sections: [], excludedLabels: [], deconstructionText: null };

  const nestedColumns = childrenOf(elements, containerId).filter((child) => child.elementType === "COLUMN");
  if (nestedColumns.some((child) => SCRIPT_HEADER_PATTERN.test(elementTitle(child)))) {
    return extractStructuredBoard(elements, containerId);
  }

  const sections: Array<{ label: string; content: string }> = [];
  const excludedLabels: string[] = [];
  const deconstructionParts: string[] = [];
  let bodyIndex = 0;
  const children = childrenOf(elements, containerId);
  const candidates = children.length ? children : [container];

  for (const child of candidates) {
    let text = elementText(child).trim();
    if (!text) continue;
    if (child === container) text = stripEvidenceHeading(stripContainerHeading(text, elementTitle(container)), evidence);
    const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? "";
    if (DECONSTRUCTION_PATTERN.test(firstLine)) {
      deconstructionParts.push(text);
      continue;
    }
    if (isPlanningCard(text)) {
      excludedLabels.push(shortLabel(firstLine || "Planning card"));
      continue;
    }
    const explicit = SCRIPT_FIELD_PATTERN.exec(firstLine);
    if (!explicit && text.length < 80) {
      excludedLabels.push(shortLabel(firstLine || "Short non-script card"));
      continue;
    }
    const label = explicit ? explicit[0]!.replace(/\s*:\s*$/, "").trim() : bodyIndex++ === 0 ? "BODY" : `BODY ${bodyIndex}`;
    sections.push({ label, content: text });
  }

  return {
    sections,
    excludedLabels: unique(excludedLabels),
    deconstructionText: deconstructionParts.length ? deconstructionParts.join("\n\n") : null,
  };
}

function isPlanningCard(text: string): boolean {
  if (isExcludedMilanoteSection({ label: text.split(/\r?\n/, 1)[0] ?? "", content: text })) return true;
  return PLANNING_CARD_PATTERN.test(text) && !AUDIENCE_COPY_SIGNAL.test(text);
}

function childrenOf(elements: Record<string, MilanoteApiElement>, parentId: string): MilanoteApiElement[] {
  return Object.values(elements)
    .filter((element) => element.location?.parentId === parentId)
    .sort(comparePosition);
}

function comparePosition(left: MilanoteApiElement, right: MilanoteApiElement): number {
  const a = left.location?.position ?? {};
  const b = right.location?.position ?? {};
  return (a.index ?? a.y ?? 0) - (b.index ?? b.y ?? 0)
    || (a.score ?? 0) - (b.score ?? 0)
    || (a.x ?? 0) - (b.x ?? 0);
}

function preferredContainers(elements: MilanoteApiElement[]): MilanoteApiElement[] {
  const containers = elements.filter((element) => ["COLUMN", "BOARD"].includes(element.elementType ?? ""));
  return containers.length ? containers : elements;
}

function resolveCandidate(candidates: MilanoteApiElement[], evidenceTitle: string): MilanoteApiElement | null {
  if (candidates.length === 1) return candidates[0]!;
  if (!candidates.length) return null;
  const scored = candidates
    .map((candidate) => ({ candidate, score: titleSimilarity(evidenceTitle, elementText(candidate)) }))
    .sort((left, right) => right.score - left.score);
  if (scored[0]!.score >= 0.35 && scored[0]!.score - (scored[1]?.score ?? 0) >= 0.08) return scored[0]!.candidate;
  return null;
}

function descendantElements(elements: Record<string, MilanoteApiElement>, rootId: string): MilanoteApiElement[] {
  const output: MilanoteApiElement[] = [];
  const queue = [rootId];
  const visited = new Set(queue);
  while (queue.length) {
    const parentId = queue.shift()!;
    for (const child of childrenOf(elements, parentId)) {
      const id = elementId(child);
      if (!id || visited.has(id)) continue;
      visited.add(id);
      output.push(child);
      queue.push(id);
    }
  }
  return output;
}

function elementId(element: MilanoteApiElement): string {
  return element.id ?? element._id ?? "";
}

function elementTitle(element: MilanoteApiElement): string {
  return element.content?.title ?? "";
}

function elementText(element: MilanoteApiElement): string {
  return normalizePlainText([elementTitle(element), milanoteRichTextToPlainText(element.content?.textContent)].filter(Boolean).join("\n"));
}

function elementBodyWithoutTitle(element: MilanoteApiElement, title: string): string {
  return stripContainerHeading(elementText(element), title);
}

function stripContainerHeading(text: string, title: string): string {
  const normalizedText = text.trim();
  return normalizedText.startsWith(title) ? normalizedText.slice(title.length).trim() : normalizedText;
}

function stripEvidenceHeading(text: string, evidence: Pick<ScriptEvidenceRow, "externalId" | "title">): string {
  const lines = text.split(/\r?\n/);
  const externalId = normalizeIdentifier(evidence.externalId ?? "");
  if (externalId && identifiersIn(lines[0] ?? "").includes(externalId)) lines.shift();
  const title = normalizeTitle(evidence.title);
  if (title.length >= 8) {
    const first = normalizeTitle(lines[0] ?? "");
    if (first && (first.includes(title) || title.includes(first))) lines.shift();
  }
  return lines.join("\n").trim();
}

function normalizePlainText(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function identifiersIn(value: string): string[] {
  return unique((value.toUpperCase().match(/\b[A-Z]{2,5}[\s_-]*\d{5,}[A-Z]*\b/g) ?? []).map(normalizeIdentifier));
}

function normalizeIdentifier(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function titleSimilarity(left: string, right: string): number {
  const leftWords = new Set(normalizeTitle(left).split(" ").filter((word) => word.length > 2));
  const rightWords = new Set(normalizeTitle(right).split(" ").filter((word) => word.length > 2));
  if (!leftWords.size || !rightWords.size) return 0;
  const overlap = [...leftWords].filter((word) => rightWords.has(word)).length;
  return overlap / new Set([...leftWords, ...rightWords]).size;
}

function shortLabel(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 100 ? `${normalized.slice(0, 97)}…` : normalized;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)].filter(Boolean);
}
