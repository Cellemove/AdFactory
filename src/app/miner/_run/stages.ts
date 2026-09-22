import type { PipelineStepKey, StageKey } from "./types";

export type StageDef = {
  key: StageKey;
  title: string;
  /** One line, plain English — what this step does for the writer. */
  blurb: string;
  cost: string;
  cli: string;
  /** Per-ad stages run one request per ad on this many lanes. Absent = batch stage. */
  lanes?: number;
  limits?: Array<{ label: string; value: number | null }>;
  defaultLimit?: number | null;
  /** Share of the overall progress bar. Transcribe and beats are the real work. */
  weight: number;
};

export const STAGES: StageDef[] = [
  {
    key: "ingest",
    title: "Collect winning ads",
    blurb: "Takes this brand's winners: videos still running 3+ weeks after launch, newest first. Brands switch losing ads off within days, so the survivors are the winners; each run swaps the oldest out for what launched since.",
    cost: "1 BrandSearch credit per ad",
    cli: "npm run miner:winners -- --brand <brand>",
    weight: 5,
  },
  {
    key: "media",
    title: "Save the videos",
    blurb: "Keeps a permanent copy of each video. BrandSearch's links stop working after three days, so this has to happen soon after collecting.",
    cost: "Free",
    cli: "npm run miner:media -- --brand <brand>",
    lanes: 3,
    limits: [{ label: "10", value: 10 }, { label: "50", value: 50 }, { label: "All", value: null }],
    defaultLimit: null,
    weight: 15,
  },
  {
    key: "transcribe",
    title: "Capture every word",
    blurb: "The AI watches each ad and writes down what is said, what is written on screen and what is happening in the shot, all timed to the second. Most of the copy in this category is on-screen text, so both are captured.",
    cost: "Gemini, cost shown per ad",
    cli: "npm run miner:transcribe -- --brand <brand>",
    lanes: 2,
    limits: [{ label: "10", value: 10 }, { label: "50", value: 50 }, { label: "All", value: null }],
    defaultLimit: null,
    weight: 35,
  },
  {
    key: "extract",
    title: "Split each ad into its parts",
    blurb: "Labels every part — the hook, the pain, the belief shift, how it works, the proof, the offer — with the exact words and the timecode. Any label whose quote is not really in the ad is thrown out, so nothing is invented.",
    cost: "Gemini, cost shown per ad",
    cli: "npm run miner:extract -- --brand <brand>",
    lanes: 2,
    limits: [{ label: "10", value: 10 }, { label: "50", value: 50 }, { label: "All", value: null }],
    defaultLimit: null,
    weight: 35,
  },
  {
    key: "score",
    title: "Rank the ads",
    blurb: "Puts this brand's ads in order using how long each ran, how many versions were made, how widely it was placed and how often the idea came back. A ranking from public signals, not real sales.",
    cost: "Free",
    cli: "npm run miner:score -- --brand <brand>",
    weight: 5,
  },
  {
    key: "mine",
    title: "Find what repeats",
    blurb: "Counts which parts this brand uses, the order they always come in, how long each takes, and what its strongest ads do differently. Pure counting, no AI.",
    cost: "Free",
    cli: "npm run miner:mine -- --brand <brand>",
    weight: 5,
  },
  {
    key: "playbook",
    title: "Write the playbook",
    blurb: "Turns all of it into one page you can write from: the structure their ads follow with typical timings, the hooks they open with, their formats and big ideas, and their copywriting rules — every rule backed by real lines from their ads.",
    cost: "Free",
    cli: "npm run miner:playbook -- --brand <brand>",
    weight: 5,
  },
  {
    key: "teardown",
    title: "Deep-dive the best ads",
    blurb: "Sends this brand's strongest ads for a full written analysis: who it speaks to, why the hook works, the proof, the offer and what to borrow — plus a scene-by-scene script. Reading for strategists; it does not change the numbers.",
    cost: "About $0.15–0.20 per ad",
    cli: "npm run miner:teardown -- --brand <brand>",
    lanes: 3,
    limits: [{ label: "Top 25%", value: null }, { label: "Top 10", value: 10 }, { label: "All ranked", value: 1000 }],
    defaultLimit: null,
    weight: 0,
  },
];

export const STAGE_BY_KEY = new Map(STAGES.map((stage) => [stage.key, stage]));

/** The one-click chain. Teardown is deliberately absent: it costs real money per ad. */
export const PIPELINE_PLAN: PipelineStepKey[] = ["ingest", "media", "transcribe", "extract", "score", "mine", "playbook"];

export const PIPELINE_STAGES = PIPELINE_PLAN.map((key) => STAGE_BY_KEY.get(key)!);

export function stageDef(key: StageKey): StageDef {
  return STAGE_BY_KEY.get(key)!;
}
