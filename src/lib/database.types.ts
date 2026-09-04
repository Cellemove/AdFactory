// Database types for Supabase JS client. Mirrors the (former) Prisma schema.
// Table names are PascalCase to match the existing Postgres schema created by Prisma.
//
// Important: Row/Insert/Update are `type` aliases (not `interface`), because
// supabase-js requires each table's Row to be assignable to `Record<string, unknown>`,
// which interfaces do not satisfy by default.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type AngleRow = {
  id: string;
  slug: string;
  name: string;
  requiredKeyword: string;
  mechanism: string;
  bannedMechanism: string;
  silhouette: string;
  colorway: string;
  order: number;
  createdAt: string;
};
export type SubAvatarRow = {
  id: string;
  angleId: string;
  slug: string;
  name: string;
  shortDesc: string | null;
  createdAt: string;
  updatedAt: string;
};
export type AvatarResearchRow = {
  id: string;
  subAvatarId: string;
  painPoints: string;
  desires: string;
  objections: string;
  dailyLanguage: string;
  triggers: string;
  identity: string;
  socialProof: string;
  buyingContext: string;
  notes: string | null;
  // JSON-stringified AvatarProfile (the structured deep dive). Null for legacy /
  // flat-only rows; parse with parseAvatarProfile, which tolerates absence.
  profile: string | null;
  updatedAt: string;
  createdAt: string;
};
export type WinningAdRow = {
  id: string;
  angleId: string;
  adName: string;
  funnel: string;
  headline: string;
  visualConcept: string;
  hookType: string | null;
  imagePath: string | null;
  metrics: string | null;
  notes: string | null;
  // "static" | "video" — optional on the type to gracefully handle legacy rows
  // that pre-date this column. Always coalesce with `?? "static"` at read sites.
  adType?: string | null;
  createdAt: string;
};
export type BigSwingRow = {
  id: string;
  slug: string;
  name: string;
  format: string;
  hookMechanic: string | null;
  funnel: string;
  description: string;
  headlineOptions: string;
  visualSpec: string;
  order: number;
  createdAt: string;
};
export type BriefRow = {
  id: string;
  angleId: string;
  subAvatarId: string | null;
  lane: string;
  funnel: string;
  hook: string;
  exactHeadline: string;
  visualConcept: string;
  targetCount: number;
  parentWinnerId: string | null;
  iterationVar: string | null;
  hypothesis: string | null;
  bigSwingId: string | null;
  hookMechanic: string | null;
  notes: string | null;
  createdAt: string;
};
export type RunRow = {
  id: string;
  briefId: string;
  angleId: string;
  status: string;
  model: string;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};
export type GenerationRow = {
  id: string;
  runId: string;
  index: number;
  promptJson: string;
  promptText: string;
  tool: string;
  level: string;
  hook: string;
  headlineRendered: string;
  complianceStatus: string;
  complianceNotes: string;
  verdict: string;
  verdictNote: string | null;
  imagePath: string | null;
  createdAt: string;
  updatedAt: string;
};
export type IterationRow = {
  id: string;
  iterationName: string;
  parentWinnerId: string | null;
  runId: string | null;
  iterationNumber: number;
  level: string;
  editor: string;
  originalAdName: string;
  hookSlug: string;
  notes: string | null;
  createdAt: string;
};
export type PerformanceEntryRow = {
  id: string;
  winnerId: string | null;
  adName: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpa: number | null;
  roas: number | null;
  purchases: number;
  date: string;
  source: string;
  notes: string | null;
  createdAt: string;
};
export type SwipeFileRow = {
  id: string;
  title: string;
  brand: string | null;
  category: string | null;
  notes: string | null;
  imagePath: string | null;
  sourceUrl: string | null;
  tags: string | null;
  createdAt: string;
};
export type KnowledgeNoteRow = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  tags: string | null;
  createdAt: string;
  updatedAt: string;
};
export type CopyPrincipleRow = {
  id: string;
  slug: string;
  category: string;
  title: string;
  body: string;
  order: number;
};
export type ProductRow = {
  id: string;
  name: string;
  code?: string | null;
  context?: Json;
  imagePath: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};
export type SettingsRow = {
  id: string;
  brandWordmarkPath: string | null;
  referenceImagePath: string | null;
  defaultEditor: string;
  defaultTargetCount: number;
  allowedSkinTones: string;
  updatedAt: string;
  createdAt: string;
};

// Research = persisted sessions where the engine pulls drafts from grounded
// search. Three types today: angle ideas, sub-avatar candidates, ad concepts.
export type ResearchRow = {
  id: string;
  type: string;             // 'angle' | 'sub_avatar' | 'concept'
  angleSlug: string | null;
  focus: string | null;
  drafts: string;           // JSON-stringified draft array — shape depends on `type`
  status: string;           // 'pending' | 'saved' | 'discarded'
  notes: string | null;
  queryPlan: Json | null;
  qualityScore: number | null;
  qualityStatus: string | null;
  qualityReport: Json | null;
  createdAt: string;
};

export type ResearchSourceRow = {
  id: string;
  researchId: string;
  canonicalUrl: string;
  domain: string;
  sourceType: string;
  title: string | null;
  author: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  status: string;
  httpStatus: number;
  excerpt: string | null;
  contentHash: string | null;
  metadata: Json;
};

export type ResearchEvidenceRow = {
  id: string;
  researchId: string;
  sourceId: string | null;
  draftKey: string;
  category: string;
  evidenceType: string;
  text: string;
  normalizedText: string;
  sourceUrl: string | null;
  verificationStatus: string;
  confidence: number;
  contentHash: string;
  embedding: string | null;
  embeddingModel: string | null;
  embeddingVersion: string;
  metadata: Json;
  createdAt: string;
};

export type ResearchFeedbackRow = {
  id: string;
  researchId: string;
  draftKey: string;
  evidenceId: string | null;
  rating: string;
  note: string | null;
  createdAt: string;
};

// ─── Layer-1 SOP foundation ──────────────────────────────────────────────────
// Sop = a written Standard Operating Procedure the agents read. `body` is the
// markdown an agent injects verbatim into its system prompt; `payload` holds
// structured SOPs that are data, not prose (e.g. a hook taxonomy, a block list).
export type SopRow = {
  id: string;
  slug: string;
  // 'verbatim_classification' | 'source_weighting' | 'hook_taxonomy' |
  // 'hook_rules_market' | 'deep_dive_template' | 'reference_format' |
  // 'compliance' | 'block_taxonomy' | 'naming' | 'other'
  type: string;
  title: string;
  body: string;              // markdown read verbatim by the agent
  payload: string | null;    // JSON-stringified structured payload, when applicable
  // which agent role loads this SOP: 'strategist' | 'copywriter' | 'researcher' |
  // 'designer' | 'compliance' | 'all'
  roleScope: string;
  marketScope: string | null; // null = global; else a market code ('uk','de',…)
  pinned: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
};

// ReferenceFormat = a SCRIPT structure (Magic Formula, Regret Arc, …). Distinct
// from the visual Big-Swing formats in formats.ts. `beats` is the timed skeleton
// the Script Generator (Module 5) fills in.
export type ReferenceFormatRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  beats: string;             // JSON: [{label,time,note}]
  bestForAngle: string | null;
  optimalDurationSec: number | null;
  exampleScripts: string | null; // JSON: string[] of winner scripts
  order: number;
  // Provenance (migration 014). NULL sourceKind = seeded or hand-authored;
  // otherwise this format was extracted from a reference video.
  sourceKind: string | null;     // 'upload' | 'youtube' | 'url'
  sourceUrl: string | null;
  sourceLabel: string | null;
  createdAt: string;
  updatedAt: string;
};

// MarketProfile = per-market tone + claims rules. Feeds Module 11 (compliance)
// and Module 12 (localization), plus the copywriter's per-market grading pass.
export type MarketProfileRow = {
  id: string;
  code: string;              // 'uk' | 'es' | 'de' | 'cz' | 'pl' | 'pt' | 'gr' | 'se' | 'nz' | 'au' | 'ca'
  name: string;
  tone: string;
  vocabulary: string | null;       // JSON: { favor: string[], avoid: string[] }
  hooksThatWork: string | null;    // JSON: string[]
  hooksThatFlop: string | null;    // JSON: string[]
  allowedClaims: string | null;    // JSON: string[]
  forbiddenClaims: string | null;  // JSON: string[]
  disclaimerClaims: string | null; // JSON: string[]
  trustpilotScore: string | null;
  culturalNotes: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
};

// EditorClaim = an editor claiming a completed pipeline run + the strategist's
// review on it (Migration 004).
export type EditorClaimRow = {
  id: string;
  runId: string;
  label: string;
  claimedByEmail: string;
  claimedAt: string;
  deliveryUrl: string | null;
  reviewNote: string | null;
  reviewStatus: string; // 'pending' | 'changes_requested' | 'approved'
  reviewedByEmail: string | null;
  updatedAt: string;
};

// BrollClip = one video clip indexed from the team's Google Drive b-roll folder
// (Migration 007). Fed into the generation and handoff workflows so B-roll
// suggestions map to real files.
export type BrollClipRow = {
  id: string;
  driveId: string;
  name: string;
  mimeType: string;
  folderPath: string | null;
  webViewLink: string | null;
  thumbnailLink: string | null;
  description: string | null;
  durationMs: number | null;
  sizeBytes: number | null;
  indexedAt: string;
  // Migration 008 — b-roll intelligence. Nullable/defaulted so rows read before
  // the migration (or inserts that omit them) stay valid.
  aiDescription: string | null;
  tags: string | null;
  analyzedAt: string | null;
  timesSuggested: number;
  lastSuggestedAt: string | null;
  timesUsed: number;
  lastUsedAt: string | null;
};

// BankedAd = one competitor creative a strategist chose to KEEP from a spy sweep
// (Migration 012) — the idea bank / swipe file. Sweeps themselves are ephemeral
// JSON blobs on a Research row; these rows are the durable library, annotated
// with a note and a workflow status. sweepId is provenance only (not an FK), so
// deleting old sweeps never removes banked ideas.
export type BankedAdRow = {
  id: string;
  brand: string;
  hook: string;
  imageUrl: string | null;
  platform: string | null;
  sourceUrl: string;
  mediaType: string;
  note: string | null;
  status: string; // 'new' | 'shortlisted' | 'used' | 'archived'
  sweepId: string | null;
  savedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

// BrollSuggestion = one detected mention of a clip in a pipeline stage's output
// (Migration 008). The counters on BrollClip are the fast path; this is the audit
// trail ("suggested in run X on date Y").
export type BrollSuggestionRow = {
  id: string;
  clipId: string;
  clipName: string;
  source: string; // 'designer' | 'creative_briefs' | 'script_studio' | 'script_studio_used'
  refId: string | null;
  createdAt: string;
};

// AppUser = a login account for the internal team (Migration 005). Simple
// username + scrypt password hash + role. No email involved.
export type AppUserRow = {
  id: string;
  username: string;
  shortCode?: string | null;
  passwordHash: string;
  role: string; // 'creative_strategist' | 'editor'
  createdAt: string;
};

export type ScriptProjectRow = {
  id: string;
  title: string;
  status: string;
  strategistUserId: string;
  editorUserId: string | null;
  createdByUserId: string;
  productId: string;
  subAvatarId: string | null;
  angleId: string;
  referenceFormatId: string | null;
  idea: string;
  adNumber: string;
  creativeName: string;
  format: string;
  targetDurationSec: number;
  teardownRecordId: string | null;
  teardownSnapshot: Json | null;
  document: Json;
  displayName: string;
  revision: number;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type ScriptVersionRow = {
  id: string;
  projectId: string;
  version: number;
  document: Json;
  origin: string;
  changeSummary: string;
  model: string | null;
  promptVersion: string | null;
  createdByUserId: string;
  createdAt: string;
};

export type ScriptAssignmentRow = {
  id: string;
  projectId: string;
  editorUserId: string | null;
  status: string;
  deliveryUrl: string | null;
  reviewNote: string | null;
  reviewedByUserId: string | null;
  assignedAt: string | null;
  claimedAt: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ScriptSourceRow = {
  id: string;
  projectId: string;
  sourceType: string;
  sourceId: string | null;
  title: string;
  url: string | null;
  snapshot: Json | null;
  createdAt: string;
};

export type ScriptEventRow = {
  id: string;
  projectId: string;
  actorUserId: string | null;
  eventType: string;
  payload: Json;
  createdAt: string;
};

// Verbatim = one captured piece of real customer voice (Module 1). Classified
// by taxonomy category + weighted by source rank × engagement.
export type VerbatimRow = {
  id: string;
  angleSlug: string | null;
  subAvatarId: string | null;
  category: string;          // taxonomy slug
  text: string;
  sourceType: string;        // reddit_thread | youtube_comment | ...
  sourceUrl: string | null;
  engagementScore: number;
  sourceWeight: number;
  market: string | null;
  researchId: string | null;
  createdAt: string;
};

// Usage = one row per Gemini call. We aggregate by feature/day on the Usage page.
export type UsageRow = {
  id: string;
  feature: string;          // 'generation' | 'video_generation' | 'sub_avatar_research' |
                            // 'angle_research' | 'concept_research' | 'extraction'
  model: string;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  estimatedCostUsd: number;
  metadata: string | null;  // free-form JSON for grounding flag, run id, etc.
  createdAt: string;
};

export type Database = {
  public: {
    Tables: {
      Angle: { Row: AngleRow; Insert: Partial<AngleRow> & { slug: string; name: string; requiredKeyword: string; mechanism: string; bannedMechanism: string; silhouette: string; colorway: string }; Update: Partial<AngleRow>; Relationships: [] };
      SubAvatar: { Row: SubAvatarRow; Insert: Partial<SubAvatarRow> & { angleId: string; slug: string; name: string }; Update: Partial<SubAvatarRow>; Relationships: [{ foreignKeyName: "SubAvatar_angleId_fkey"; columns: ["angleId"]; isOneToOne: false; referencedRelation: "Angle"; referencedColumns: ["id"] }] };
      AvatarResearch: { Row: AvatarResearchRow; Insert: Partial<AvatarResearchRow> & { subAvatarId: string; painPoints: string; desires: string; objections: string; dailyLanguage: string; triggers: string; identity: string; socialProof: string; buyingContext: string }; Update: Partial<AvatarResearchRow>; Relationships: [{ foreignKeyName: "AvatarResearch_subAvatarId_fkey"; columns: ["subAvatarId"]; isOneToOne: true; referencedRelation: "SubAvatar"; referencedColumns: ["id"] }] };
      WinningAd: { Row: WinningAdRow; Insert: Partial<WinningAdRow> & { angleId: string; adName: string; funnel: string; headline: string; visualConcept: string }; Update: Partial<WinningAdRow>; Relationships: [{ foreignKeyName: "WinningAd_angleId_fkey"; columns: ["angleId"]; isOneToOne: false; referencedRelation: "Angle"; referencedColumns: ["id"] }] };
      BigSwing: { Row: BigSwingRow; Insert: Partial<BigSwingRow> & { slug: string; name: string; format: string; funnel: string; description: string; headlineOptions: string; visualSpec: string }; Update: Partial<BigSwingRow>; Relationships: [] };
      Brief: { Row: BriefRow; Insert: Partial<BriefRow> & { angleId: string; lane: string; funnel: string; hook: string; exactHeadline: string; visualConcept: string }; Update: Partial<BriefRow>; Relationships: [{ foreignKeyName: "Brief_angleId_fkey"; columns: ["angleId"]; isOneToOne: false; referencedRelation: "Angle"; referencedColumns: ["id"] }, { foreignKeyName: "Brief_subAvatarId_fkey"; columns: ["subAvatarId"]; isOneToOne: false; referencedRelation: "SubAvatar"; referencedColumns: ["id"] }, { foreignKeyName: "Brief_parentWinnerId_fkey"; columns: ["parentWinnerId"]; isOneToOne: false; referencedRelation: "WinningAd"; referencedColumns: ["id"] }, { foreignKeyName: "Brief_bigSwingId_fkey"; columns: ["bigSwingId"]; isOneToOne: false; referencedRelation: "BigSwing"; referencedColumns: ["id"] }] };
      Run: { Row: RunRow; Insert: Partial<RunRow> & { briefId: string; angleId: string }; Update: Partial<RunRow>; Relationships: [{ foreignKeyName: "Run_briefId_fkey"; columns: ["briefId"]; isOneToOne: false; referencedRelation: "Brief"; referencedColumns: ["id"] }, { foreignKeyName: "Run_angleId_fkey"; columns: ["angleId"]; isOneToOne: false; referencedRelation: "Angle"; referencedColumns: ["id"] }] };
      Generation: { Row: GenerationRow; Insert: Partial<GenerationRow> & { runId: string; index: number; promptJson: string; promptText: string; level: string; hook: string; headlineRendered: string; complianceNotes: string }; Update: Partial<GenerationRow>; Relationships: [{ foreignKeyName: "Generation_runId_fkey"; columns: ["runId"]; isOneToOne: false; referencedRelation: "Run"; referencedColumns: ["id"] }] };
      Iteration: { Row: IterationRow; Insert: Partial<IterationRow> & { iterationName: string; iterationNumber: number; level: string; editor: string; originalAdName: string; hookSlug: string }; Update: Partial<IterationRow>; Relationships: [] };
      PerformanceEntry: { Row: PerformanceEntryRow; Insert: Partial<PerformanceEntryRow> & { adName: string; spend: number }; Update: Partial<PerformanceEntryRow>; Relationships: [] };
      SwipeFile: { Row: SwipeFileRow; Insert: Partial<SwipeFileRow> & { title: string }; Update: Partial<SwipeFileRow>; Relationships: [] };
      KnowledgeNote: { Row: KnowledgeNoteRow; Insert: Partial<KnowledgeNoteRow> & { title: string; body: string }; Update: Partial<KnowledgeNoteRow>; Relationships: [] };
      CopyPrinciple: { Row: CopyPrincipleRow; Insert: Partial<CopyPrincipleRow> & { slug: string; category: string; title: string; body: string }; Update: Partial<CopyPrincipleRow>; Relationships: [] };
      Product: { Row: ProductRow; Insert: Partial<ProductRow> & { name: string }; Update: Partial<ProductRow>; Relationships: [] };
      Settings: { Row: SettingsRow; Insert: Partial<SettingsRow>; Update: Partial<SettingsRow>; Relationships: [] };
      Research: { Row: ResearchRow; Insert: Partial<ResearchRow> & { type: string; drafts: string }; Update: Partial<ResearchRow>; Relationships: [] };
      ResearchSource: { Row: ResearchSourceRow; Insert: Partial<ResearchSourceRow> & { id: string; researchId: string; canonicalUrl: string; domain: string; sourceType: string }; Update: Partial<ResearchSourceRow>; Relationships: [] };
      ResearchEvidence: { Row: ResearchEvidenceRow; Insert: Partial<ResearchEvidenceRow> & { id: string; researchId: string; draftKey: string; category: string; evidenceType: string; text: string; normalizedText: string; verificationStatus: string; confidence: number; contentHash: string }; Update: Partial<ResearchEvidenceRow>; Relationships: [] };
      ResearchFeedback: { Row: ResearchFeedbackRow; Insert: Partial<ResearchFeedbackRow> & { id: string; researchId: string; draftKey: string; rating: string }; Update: Partial<ResearchFeedbackRow>; Relationships: [] };
      Usage: { Row: UsageRow; Insert: Partial<UsageRow> & { feature: string; model: string }; Update: Partial<UsageRow>; Relationships: [] };
      Sop: { Row: SopRow; Insert: Partial<SopRow> & { slug: string; type: string; title: string; body: string; roleScope: string }; Update: Partial<SopRow>; Relationships: [] };
      ReferenceFormat: { Row: ReferenceFormatRow; Insert: Partial<ReferenceFormatRow> & { slug: string; name: string; description: string; beats: string }; Update: Partial<ReferenceFormatRow>; Relationships: [] };
      MarketProfile: { Row: MarketProfileRow; Insert: Partial<MarketProfileRow> & { code: string; name: string; tone: string }; Update: Partial<MarketProfileRow>; Relationships: [] };
      Verbatim: { Row: VerbatimRow; Insert: Partial<VerbatimRow> & { category: string; text: string; sourceType: string }; Update: Partial<VerbatimRow>; Relationships: [] };
      EditorClaim: { Row: EditorClaimRow; Insert: Partial<EditorClaimRow> & { runId: string; label: string; claimedByEmail: string }; Update: Partial<EditorClaimRow>; Relationships: [] };
      AppUser: { Row: AppUserRow; Insert: Partial<AppUserRow> & { id: string; username: string; passwordHash: string }; Update: Partial<AppUserRow>; Relationships: [] };
      BrollClip: { Row: BrollClipRow; Insert: Partial<BrollClipRow> & { id: string; driveId: string; name: string; mimeType: string }; Update: Partial<BrollClipRow>; Relationships: [] };
      BankedAd: { Row: BankedAdRow; Insert: Partial<BankedAdRow> & { id: string; sourceUrl: string }; Update: Partial<BankedAdRow>; Relationships: [] };
      BrollSuggestion: { Row: BrollSuggestionRow; Insert: Partial<BrollSuggestionRow> & { id: string; clipId: string; clipName: string; source: string }; Update: Partial<BrollSuggestionRow>; Relationships: [] };
      ScriptProject: { Row: ScriptProjectRow; Insert: Partial<ScriptProjectRow> & { id: string; title: string; strategistUserId: string; createdByUserId: string; productId: string; angleId: string; idea: string; adNumber: string; creativeName: string; format: string; document: Json; displayName: string }; Update: Partial<ScriptProjectRow>; Relationships: [] };
      ScriptVersion: { Row: ScriptVersionRow; Insert: Partial<ScriptVersionRow> & { id: string; projectId: string; version: number; document: Json; origin: string; changeSummary: string; createdByUserId: string }; Update: Partial<ScriptVersionRow>; Relationships: [] };
      ScriptAssignment: { Row: ScriptAssignmentRow; Insert: Partial<ScriptAssignmentRow> & { id: string; projectId: string; status: string }; Update: Partial<ScriptAssignmentRow>; Relationships: [] };
      ScriptSource: { Row: ScriptSourceRow; Insert: Partial<ScriptSourceRow> & { id: string; projectId: string; sourceType: string; title: string }; Update: Partial<ScriptSourceRow>; Relationships: [] };
      ScriptEvent: { Row: ScriptEventRow; Insert: Partial<ScriptEventRow> & { id: string; projectId: string; eventType: string }; Update: Partial<ScriptEventRow>; Relationships: [] };
    };
    Views: Record<string, never>;
    Functions: {
      match_research_evidence: {
        Args: { query_embedding: string; match_count?: number; filter_angle_slug?: string | null; filter_category?: string | null };
        Returns: Array<Pick<ResearchEvidenceRow, "id" | "researchId" | "draftKey" | "category" | "text" | "sourceUrl" | "verificationStatus"> & { similarity: number }>;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];
