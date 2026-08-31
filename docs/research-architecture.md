# Evidence-first research architecture

AdFactory research now separates planning, collection, evidence verification,
synthesis, retrieval, and feedback. The original `Research.drafts` JSON remains
the immutable session snapshot; migration 011 adds reusable relational evidence.

## System flow

```text
Research brief
    -> fast query planner (facets + concrete searches)
    -> collectors (Reddit prefetch + Gemini Google Search/url context)
    -> synthesis with atomic evidence objects
    -> deterministic source and exact-quote verification
    -> per-draft quality gate
    -> Research JSON snapshot
    -> ResearchSource + ResearchEvidence ledger
    -> keyword + vector retrieval with reciprocal-rank fusion
    -> future research and Script Studio context
    -> strategist feedback
```

## Vector database decision

The ledger uses Supabase PostgreSQL with pgvector rather than adding a separate
vector service. It keeps source metadata, feedback, lexical search, and vectors
transactionally close and fits the expected evidence volume. Reconsider Qdrant
or another dedicated store only if the corpus reaches a scale or latency target
that PostgreSQL cannot meet.

Embeddings are versioned with `embeddingModel` and `embeddingVersion`. The
current Vertex text embedding model produces 768-dimensional vectors. Changing
the model or dimensions requires a parallel column/index or a re-embedding
migration; never silently mix vector versions.

## Chunking strategy

Evidence uses proposition-level chunks rather than arbitrary fixed sizes:

- One exact customer quote per `verbatim` evidence item.
- One source-supported observation per `claim` item.
- One clearly labelled strategic deduction per `inference` item.

Every retrievable unit carries its research run, draft, category, source URL,
verification status, timestamps, source type, and content hash. Deterministic
hashes make ingestion idempotent.

## Retrieval

1. Apply angle/category metadata filters.
2. Retrieve up to 30 lexical candidates using PostgreSQL full-text search.
3. Retrieve up to 30 semantic candidates using pgvector cosine distance.
4. Fuse ranks with reciprocal-rank fusion (60% dense, 40% lexical).
5. Pass only verified/source-checked evidence to generation.

The first implementation uses deterministic rank fusion. A learned or
cross-encoder reranker should only be introduced after the golden evaluation set
contains enough relevance labels to compare it honestly.

## Quality gate

A draft is rejected unless it has at least three source-linked evidence items,
three cited sources, two live sources, and two independent domains. Verbatims
must appear in their exact cited page. Concept research additionally requires a
real-ad source and a real-person source. The UI permits an explicit override,
which is visible rather than silently weakening the gate.

## Evaluation

Build a 50-case stratified golden set across angles, sub-avatars, concepts,
markets, and difficult/ambiguous briefs. Label relevant evidence IDs and source
quality. Run the suite whenever retrieval, embeddings, ranking, or prompts change.

Pass thresholds:

- Precision@5 >= 0.70
- Recall@5 >= 0.80
- NDCG@5 >= 0.70
- Citation validity >= 0.95
- Exactness for content labelled `verbatim` = 1.00
- Unsupported claims in saved drafts = 0

Production feedback (`useful`, `generic`, `incorrect`, `duplicate`, and
`used_in_script`) should be monitored separately from the offline test set. It
is a ranking signal, not automatically trusted ground truth.

## Rollout

1. Apply `migrations/011_research_evidence_architecture.sql` in Supabase.
2. Run `npm run test:research-architecture` and `npm run typecheck`.
3. Generate one research session of each type and inspect quality blockers.
4. Confirm `ResearchSource`, `ResearchEvidence`, and `ResearchFeedback` rows.
5. Curate the first golden evaluation cases before tuning weights or models.

