import "server-only";

import { PDFDocument } from "pdf-lib";
import { extractJsonObject } from "@/lib/cellumove/agents";
import {
  buildMilanoteBodyExtractionPrompt,
  buildMilanoteExtractionPrompt,
  buildMilanoteScriptText,
  isPdfBytes,
  MAX_MILANOTE_PDF_BYTES,
  MilanoteScriptPassSchema,
  normalizeMilanoteExtraction,
} from "@/lib/cellumove/milanote-script-extraction";
import { FAST_MODEL, getLLM } from "@/lib/llm";
import { recordUsage } from "@/lib/usage";

export type ExtractedMilanoteScript = {
  scriptText: string;
  sectionLabels: string[];
  excludedLabels: string[];
  model: string;
};

export async function extractMilanoteScriptFromPdf(file: File): Promise<ExtractedMilanoteScript> {
  if (file.size === 0) throw new Error("That Milanote PDF is empty.");
  if (file.size > MAX_MILANOTE_PDF_BYTES) throw new Error("Milanote PDF is too large (maximum 10 MB).");

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isPdfBytes(bytes)) throw new Error("The selected file is not a valid PDF.");

  const deliverablePdf = await cropToDeliverableArea(bytes);
  const encodedPdf = Buffer.from(deliverablePdf).toString("base64");
  const primary = await extractPass(encodedPdf, file, "script", buildMilanoteExtractionPrompt());
  const body = await extractPass(encodedPdf, file, "body", buildMilanoteBodyExtractionPrompt());
  const targetedBodySections = body.sections.filter((section) => isBodySection(section.label));
  const sections = [
    ...primary.sections.filter((section) => !targetedBodySections.length || !isBodySection(section.label)),
    ...targetedBodySections,
  ];
  const extraction = normalizeMilanoteExtraction({
    sections,
    excludedLabels: [...primary.excludedLabels, ...body.excludedLabels],
  });
  return {
    scriptText: buildMilanoteScriptText(extraction),
    sectionLabels: extraction.sections.map((section) => section.label),
    excludedLabels: extraction.excludedLabels,
    model: FAST_MODEL,
  };
}

async function extractPass(
  encodedPdf: string,
  file: File,
  pass: "script" | "body",
  prompt: string,
) {
  let lastError: unknown = new Error("Gemini did not return a valid extraction.");

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await getLLM().models.generateContent({
        model: FAST_MODEL,
        contents: [{
          role: "user",
          parts: [
            { inlineData: { mimeType: "application/pdf", data: encodedPdf } },
            { text: prompt },
          ],
        }],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: {
            type: "object",
            additionalProperties: false,
            required: ["sections", "excludedLabels"],
            properties: {
              sections: {
                type: "array",
                minItems: 1,
                maxItems: 30,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["label", "content"],
                  properties: {
                    label: { type: "string" },
                    content: { type: "string" },
                  },
                },
              },
              excludedLabels: {
                type: "array",
                maxItems: 30,
                items: { type: "string" },
              },
            },
          },
          maxOutputTokens: 65_535,
          thinkingConfig: { thinkingBudget: 0 },
        },
      });

      await recordUsage({
        feature: "scorer_evidence_milanote_extract",
        model: FAST_MODEL,
        usage: response.usageMetadata,
        metadata: { filename: file.name, bytes: file.size, pass, attempt },
      });

      if (!response.text?.trim()) throw new Error(`Gemini did not complete the ${pass} extraction pass.`);
      return MilanoteScriptPassSchema.parse(extractJsonObject<unknown>(response.text));
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Milanote ${pass} extraction failed after two attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function isBodySection(label: string): boolean {
  return /\b(?:body|cta)\b/i.test(label);
}

async function cropToDeliverableArea(bytes: Uint8Array): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes);
  if (!source.getPageCount()) throw new Error("The Milanote PDF has no pages.");

  const output = await PDFDocument.create();
  for (const sourcePage of source.getPages()) {
    const { width, height } = sourcePage.getSize();
    // Milanote canvas exports place the final production columns at the far
    // right. Cropping at 54% retains BODY + hook variants in the supplied
    // layout while physically removing the prompt/research columns.
    const left = width * 0.54;
    const embedded = await output.embedPage(sourcePage, { left, bottom: 0, right: width, top: height });
    const page = output.addPage([width - left, height]);
    page.drawPage(embedded, { x: 0, y: 0, width: width - left, height });
  }
  return output.save();
}
