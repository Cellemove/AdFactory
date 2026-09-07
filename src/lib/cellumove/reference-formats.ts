// Seed payload for the ReferenceFormat table — SCRIPT structures (Module 5).
// These are distinct from the VISUAL Big-Swing formats in formats.ts: a
// reference format is the timed beat-skeleton the Script Generator fills in.
// Start with the 5 patterns already identified; enrich over time with winners.

export interface ReferenceFormatBeat {
  label: string;   // "Dream Outcome", "Why Not Me", …
  time: string;    // "0–3s"
  note: string;    // what this beat must accomplish
}

export interface ReferenceFormatSeed {
  slug: string;
  name: string;
  description: string;
  beats: ReferenceFormatBeat[];
  bestForAngle: string;          // type of angle this format works best with
  optimalDurationSec: number;
  // Illustrative reference scripts — NOT proven winners. These are hand-authored
  // exemplars that show the beats filled in; they are compliance-checked against
  // constants.ts but carry no performance data. Replace with real winners as they land.
  exampleScripts: string[];
  order: number;
}

export const REFERENCE_FORMATS: ReferenceFormatSeed[] = [
  {
    slug: "magic-formula",
    name: "Magic Formula",
    description: "Lead with the dream outcome, dissolve the 'why not me' objection, prove it, then a warm offer.",
    beats: [
      { label: "Dream Outcome", time: "0–3s", note: "Open on the after-state the avatar most wants — concrete, visual, specific." },
      { label: "Why Not Me", time: "3–8s", note: "Name the belief that's been keeping them out ('I've tried everything')." },
      { label: "Proof", time: "8–20s", note: "Show the mechanism + real proof — never just told, shown on screen." },
      { label: "CTA", time: "20–30s", note: "Warm, low-pressure offer from the allowed-CTA list." },
    ],
    bestForAngle: "Aspirational / desire-led angles where the after-state is vivid.",
    optimalDurationSec: 30,
    exampleScripts: [],
    order: 1,
  },
  {
    slug: "regret-arc",
    name: "Regret Arc",
    description: "Confess the cost of waiting, walk the turning point, land on relief — regret converted to motion.",
    beats: [
      { label: "The Regret", time: "0–3s", note: "A specific thing they stopped doing / years lost ('I haven't worn shorts in 4 years')." },
      { label: "The Spiral", time: "3–10s", note: "How the avoidance compounded — the quiet daily toll." },
      { label: "Turning Point", time: "10–20s", note: "What changed — the mechanism that finally made it different." },
      { label: "Relief + CTA", time: "20–30s", note: "The reclaimed moment, then a gentle invitation." },
    ],
    bestForAngle: "Shame / avoidance angles (Lipoedema, Quietly-Suffering).",
    optimalDurationSec: 30,
    exampleScripts: [],
    order: 2,
  },
  {
    slug: "behavior-change",
    name: "Behavior Change",
    description: "One small swap reframed as the lever — the 'I changed one thing' structure.",
    beats: [
      { label: "The One Change", time: "0–3s", note: "'The only thing I changed was…' — single, concrete swap." },
      { label: "Old Way vs New Way", time: "3–12s", note: "Contrast the old routine's friction with the new ease." },
      { label: "Mechanism", time: "12–22s", note: "Why the swap works — the angle's mechanism, plainly." },
      { label: "CTA", time: "22–30s", note: "Invite them to make the same swap." },
    ],
    bestForAngle: "Habit / effortlessness angles (Heavy Legs, end-of-day relief).",
    optimalDurationSec: 30,
    exampleScripts: [],
    order: 3,
  },
  {
    slug: "comparison-detox",
    name: "Comparison Detox",
    description: "Quietly dismantle the category's broken promises, then position the product as the honest alternative.",
    beats: [
      { label: "The Frustration", time: "0–4s", note: "'Other leggings promised X and…' — the category's broken promise." },
      { label: "Why They Fail", time: "4–14s", note: "The structural reason the usual options don't work — no named competitor." },
      { label: "The Honest Alternative", time: "14–24s", note: "What we do differently, including what we DON'T claim (skeptic trust)." },
      { label: "CTA", time: "24–30s", note: "Low-risk offer for the burned-before buyer." },
    ],
    bestForAngle: "Skeptic / tried-everything audiences, BOFU.",
    optimalDurationSec: 30,
    exampleScripts: [],
    order: 4,
  },
  {
    slug: "texture-test",
    name: "Texture Test",
    description: "A satisfying, tactile on-screen demonstration carries the whole ad — show, barely tell.",
    beats: [
      { label: "The Test", time: "0–3s", note: "Start mid-demonstration — the satisfying tactile moment that stops the scroll." },
      { label: "The Reaction", time: "3–10s", note: "Honest reaction to what they feel/see — relatable, unscripted feel." },
      { label: "Why It Works", time: "10–20s", note: "Tie the sensation to the mechanism, briefly." },
      { label: "CTA", time: "20–30s", note: "Invite them to feel it themselves." },
    ],
    bestForAngle: "Demo-friendly angles where the product's feel is the proof.",
    optimalDurationSec: 30,
    exampleScripts: [],
    order: 5,
  },
  {
    slug: "problem-agitate-solve",
    name: "Problem–Agitate–Solve",
    description: "The classic long-form arc — name the problem, sit in what it costs, then resolve it.",
    beats: [
      { label: "Recognition Hook", time: "0–5s", note: "A line only someone with this problem would nod at ('if your legs feel heavier at 6pm than at 8am')." },
      { label: "The Problem", time: "5–13s", note: "State the problem plainly in her words — no mechanism yet, just recognition." },
      { label: "Agitation", time: "13–24s", note: "The quiet daily cost. Three specific things she stopped doing because of it — concrete, never melodramatic." },
      { label: "The Solution", time: "24–33s", note: "Introduce the mechanism as the answer to the cost just named, not as a product feature list." },
      { label: "Proof", time: "33–40s", note: "One supportable proof point shown on screen — trust text from the approved bank, never invented stats." },
      { label: "CTA", time: "40–45s", note: "Warm, low-pressure offer from the allowed-CTA list." },
    ],
    bestForAngle: "Angles with a vivid daily toll — Heavy Legs, Lipoedema, Varicose Veins.",
    optimalDurationSec: 45,
    exampleScripts: [
      `[0–5s] Recognition Hook — VO: "If your legs feel heavier at 6pm than they did at 8am, this one's for you."
[5–13s] The Problem — VO: "By the afternoon my calves ache and my ankles feel tight. I always assumed that was just what standing all day feels like."
[13–24s] Agitation — VO: "So I'd sit down earlier. Skip the evening walk. Change the second I got home. It's a small thing that quietly shrinks your evenings."
[24–33s] The Solution — VO: "These are 3D-shaping compression leggings — graduated zones through the calf that support circulation while you're moving."
[33–40s] Proof — VO: "Three weeks in and I stopped noticing 6pm." / On-screen: "Designed by physiotherapists"
[40–45s] CTA — On-screen: "Shop Now"`,
    ],
    order: 6,
  },
  {
    slug: "objection-stack",
    name: "Objection Stack",
    description: "Answer the three hesitations in order, then earn the click with candour rather than pressure.",
    beats: [
      { label: "The Doubt", time: "0–5s", note: "Open on her own scepticism, said out loud ('I didn't think leggings would make any difference')." },
      { label: "Objection: Does It Work", time: "5–14s", note: "Answer the efficacy doubt with the mechanism and the result, stated flat. Say what it does. Never spend the beat on what it doesn't do." },
      { label: "Objection: Burned Before", time: "14–24s", note: "Answer the burned-by-the-category doubt with a specific failure it avoids (rolling, sagging) — never name a competitor." },
      { label: "Objection: Comfort & Fit", time: "24–33s", note: "Answer the comfort doubt — 'firm, not tight'. Sensory, not technical." },
      { label: "Honest Offer", time: "33–40s", note: "State who it isn't for before who it is for. The candour is the persuasion." },
      { label: "CTA", time: "40–45s", note: "Low-risk offer for the burned-before buyer." },
    ],
    bestForAngle: "Skeptic / tried-everything audiences, BOFU retargeting.",
    optimalDurationSec: 45,
    exampleScripts: [
      `[0–5s] The Doubt — VO: "I did not think a pair of leggings would make any difference. Three questions I had, answered honestly."
[5–14s] Objection: Does It Work — VO: "The 3D knit grips exactly where the dimpling shows. You pull them on and your thighs are smooth. That fast."
[14–24s] Objection: Burned Before — VO: "I've owned shaping leggings that rolled down by lunch. These have a wide band that stays where you put it. I wore them through a school run and a class."
[24–33s] Objection: Comfort & Fit — VO: "Compression usually means uncomfortable. These feel firm, not tight. By the afternoon I forget I have them on."
[33–40s] Honest Offer — VO: "If you like how your legs look right now, skip this. If you want them smooth the second you get dressed, these are yours."
[40–45s] CTA — On-screen: "Get 50% OFF"`,
    ],
    order: 7,
  },
  {
    slug: "three-things",
    name: "Three Things",
    description: "A fast listicle of the category's three failures, resolved in one line — built for the scroll.",
    beats: [
      { label: "List Hook", time: "0–4s", note: "Promise the count up front ('three things your leggings should never do')." },
      { label: "Problem One", time: "4–10s", note: "First failure — the most physical, most recognisable one. Fast cut." },
      { label: "Problem Two", time: "10–16s", note: "Second failure — the one that causes self-consciousness in public." },
      { label: "Problem Three", time: "16–22s", note: "Third failure — the one that sets up our mechanism as the answer." },
      { label: "The Alternative", time: "22–26s", note: "One line resolving all three. Do not re-list them." },
      { label: "CTA", time: "26–30s", note: "Immediate, no wind-up — the list already did the persuading." },
    ],
    bestForAngle: "TOFU cold traffic across any angle; strongest where the category's failures are universal.",
    optimalDurationSec: 30,
    exampleScripts: [
      `[0–4s] List Hook — VO: "Three things your leggings should never do."
[4–10s] Problem One — VO: "One: roll down when you sit. If you're tugging at your waistband, the fit is wrong."
[10–16s] Problem Two — VO: "Two: go sheer when you bend. You shouldn't have to check in the mirror first."
[16–22s] Problem Three — VO: "Three: squeeze without supporting. Tight is not the same as supported."
[22–26s] The Alternative — VO: "3D-shaping zones that hold their shape and move with you. A smoother line, no tugging."
[26–30s] CTA — On-screen: "Shop Now"`,
    ],
    order: 8,
  },
  {
    slug: "myth-bust",
    name: "Myth Bust",
    description: "Name the belief the whole category runs on, show why it fails, replace it with the real mechanism.",
    beats: [
      { label: "The Myth", time: "0–4s", note: "State the myth flatly as a quote ('the myth: compression leggings are just tight leggings')." },
      { label: "The Old Way", time: "4–13s", note: "Why that belief produces a bad product — structural, never a named competitor." },
      { label: "The Mechanism", time: "13–24s", note: "Replace it with how ours actually works. This beat carries the whole ad — keep it plain." },
      { label: "CTA", time: "24–30s", note: "Straight offer; the reframe has already done the work." },
    ],
    bestForAngle: "Educated / researched buyers, MOFU — Anti-Cellulite and Lipoedema especially.",
    optimalDurationSec: 30,
    exampleScripts: [
      `[0–4s] The Myth — VO: "The myth: compression leggings are just tight leggings."
[4–13s] The Old Way — VO: "That's why most of them let you down. One flat squeeze from waist to ankle — it flattens, it doesn't shape, and by hour two you want them off."
[13–24s] The Mechanism — VO: "3D shaping works in zones. Firmer panels where you want a smoother line, lighter knit where you need to move. That's why the look holds and the feel doesn't fight you."
[24–30s] CTA — On-screen: "Shop Now"`,
    ],
    order: 9,
  },
  {
    slug: "six-pm-test",
    name: "The 6PM Test",
    description: "One day, two versions of the same legs — the arc runs on time-of-day, not on transformation.",
    beats: [
      { label: "Morning Hook", time: "0–4s", note: "Establish the 8am baseline in one line — light, ordinary, unremarkable." },
      { label: "The 6PM Problem", time: "4–13s", note: "The end-of-day state in her own words. Sensory (tight, puffy, heavy), never clinical." },
      { label: "Proof at 6PM", time: "13–24s", note: "Same day, same hours, wearing them — tie the change to the mechanism. Do NOT use a clock, timer, or calendar on screen; show the light and the setting instead." },
      { label: "Relief + CTA", time: "24–30s", note: "The reclaimed evening, then a gentle invitation." },
    ],
    bestForAngle: "Heavy Legs and Varicose Veins — anywhere the complaint is time-of-day, not appearance.",
    optimalDurationSec: 30,
    exampleScripts: [
      `[0–4s] Morning Hook — VO: "8am me and 6pm me have very different legs."
[4–13s] The 6PM Problem — VO: "By the end of a shift my calves feel tight and my ankles look puffy. I'd always blamed the shoes."
[13–24s] Proof at 6PM — VO: "Same day, same hours, wearing these. Graduated compression through the calf supports circulation while I'm on my feet — and the end of the day stopped feeling like something to get through."
[24–30s] Relief + CTA — VO: "Lighter evenings." / On-screen: "Shop Now"`,
    ],
    order: 10,
  },
  {
    slug: "not-for-everyone",
    name: "Not For Everyone",
    description: "Disqualify most of the audience in the first five seconds — the exclusion is what earns the trust.",
    beats: [
      { label: "The Negative Hook", time: "0–4s", note: "Tell them not to buy ('these are not for everyone'). No hedging, no wink." },
      { label: "Who This Isn't For", time: "4–13s", note: "Name two people this genuinely won't suit. Must be real disqualifiers, not humblebrags." },
      { label: "Why It Works For Them", time: "13–20s", note: "Now the narrow yes — who it is for, tied to the mechanism." },
      { label: "Proof", time: "20–26s", note: "One trust line from the approved bank. Restraint reads as credibility here." },
      { label: "CTA", time: "26–30s", note: "Understated — pressure would undo the whole structure." },
    ],
    bestForAngle: "Skeptic and burned-before audiences; strong in restrained markets (UK, DE).",
    optimalDurationSec: 30,
    exampleScripts: [
      `[0–4s] The Negative Hook — VO: "These leggings are not for everyone."
[4–13s] Who This Isn't For — VO: "If you want something that works on your body while you sleep, keep scrolling. If you want a change that stays once they're off, we're honestly not that either."
[13–20s] Why It Works For Them — VO: "They're for women who want a smoother line under a dress today, and legs that feel supported while they're wearing them."
[20–26s] Proof — On-screen: "Designed by physiotherapists" / VO: "That's the whole promise."
[26–30s] CTA — On-screen: "Shop Now"`,
    ],
    order: 11,
  },
  {
    slug: "reattribution-spine",
    name: "Reattribution Spine",
    description:
      "The long-form winner structure (SU0900002IO): three fully directed hook variants over one shared spine — hyper-dated pain, reattribute the cause to the real mechanism, execute the category, quantify the mechanism, inoculate skepticism, climb a time ladder of proof, then a story-worded guarantee and a reason-why offer.",
    beats: [
      { label: "Hook", time: "0–5s", note: "A directed micro-scene, not a line: VO with a dated/counted specific, exact visual blocking (split screen, object count, cross-section...), and a ≤8-word contrast overlay ('SAME WEIGHT. DIFFERENT LEGS.'). Generate 3 variants, each a different visual mechanism." },
      { label: "Hyper-Dated Problem", time: "5–12s", note: "Timestamp the pain: week number, time of day, the exact private moment (pinching the inside of her knee at 9pm). Overlay carries the numbers." },
      { label: "Reattribution Mechanism", time: "12–17s", note: "Reframe the cause: it's not what she thinks it is, it's the real mechanism underneath. One clean belief line, no noise over it." },
      { label: "Category Execution — Why They Fail", time: "17–25s", note: "Walk the whole menu of alternatives with their prices and structural failures. No named competitors. The category dies here." },
      { label: "Quantified Mechanism", time: "25–34s", note: "The product's mechanism with numbers and rhythm ('press, release, every step'). She does nothing extra — it works while she lives her day." },
      { label: "Skepticism Inoculation (Objection)", time: "34–41s", note: "Concede week one shows nothing and validate the doubt. A problem that built for months doesn't reverse in a weekend — honesty here buys the time ladder." },
      { label: "Time Ladder Proof", time: "41–50s", note: "Same room, same light, jump cuts: week 3, day 30, day 90. The overlay is the ladder." },
      { label: "Witness Reaction", time: "50–54s", note: "A third party notices unprompted and asks what changed. Social mirror, one line." },
      { label: "Raw Proof", time: "54–60s", note: "Break the fourth wall: 'this part isn't animation' — raw customer footage, visible timestamps, no grade." },
      { label: "Social Proof", time: "60–64s", note: "Adoption count + rating from the approved trust bank only. Fast." },
      { label: "Guarantee Offer", time: "64–70s", note: "The risk reversal worded inside the story ('wear them through the next thirty pounds...'). Always clean — never edgy copy on the guarantee." },
      { label: "Reason-Why Offer", time: "70–74s", note: "The deal with a story-logic reason ('she's dropping a size — she'll need the second pair'), closing on identity: she did the hard part already." },
      { label: "CTA", time: "74–76s", note: "One line from the allowed-CTA list. The spine already did the persuading." },
    ],
    bestForAngle: "Transformation-in-progress angles (rapid weight loss, postpartum) where the category failed her and the mechanism reattributes the cause.",
    optimalDurationSec: 76,
    exampleScripts: [
      `[0–5s] Hook — VO: "What happens to a woman's legs when she loses the weight fast — and what happens if she puts these on before she's done?" / VISUAL: hard split screen, same woman, same number on the scale both sides; LEFT bare legs with creased inner-knee skin, RIGHT smooth in the leggings. / TEXT: "SAME WEIGHT. SAME SCALE. DIFFERENT LEGS."
[5–12s] Hyper-Dated Problem — VO: "Month four. Forty pounds down, thirty to go. Nine at night she's in the bathroom pinching the inside of her knee — and it doesn't go back." / TEXT: "MONTH 4. −40 LBS."
[12–17s] Reattribution Mechanism — VO: "Her thighs aren't sagging because she lost too fast. Nothing moves under that skin anymore. That's not a skin problem — that's a circulation problem." / TEXT: "NOT A SKIN PROBLEM."
[17–25s] Category Execution — VO: "Sixty-dollar firming cream that never gets past the top layer. Shapewear that rolls down by lunch. A twelve-thousand-dollar quote and a scar. That's the whole menu." / TEXT: "$60 A JAR. $12,000 AND A KNIFE."
[25–34s] Quantified Mechanism — VO: "Inside these, raised 3D shaping zones press into her leg and let go with every step. Press, release. Support back into skin that emptied out. She isn't doing anything extra — she's walking to the car." / TEXT: "PRESS. RELEASE. EVERY STEP."
[34–41s] Skepticism Inoculation — VO: "Week one, nothing. She thinks she wasted sixty bucks. Fair. Skin that changed over months isn't changing back over a weekend." / TEXT: "WEEK 1. NOTHING."
[41–50s] Time Ladder Proof — VO: "Week three, the crease above her knee is shallower. Day thirty, the skin came down with the next eleven pounds. Day ninety, her legs got there with her." / VISUAL: same bathroom, same light, jump cuts. / TEXT: "WEEK 3 · DAY 30 · DAY 90"
[50–54s] Witness Reaction — VO: "Her sister asked what she's doing at the gym. She hasn't set foot in one." / TEXT: "WHAT ARE YOU DOING AT THE GYM?"
[54–60s] Raw Proof — VO: "This part isn't animation. Real customers, same angle, same light. Day one. Day fourteen. Day sixty." / TEXT: "NOT ANIMATION."
[60–64s] Social Proof — On-screen trust line from the approved bank.
[64–70s] Guarantee Offer — VO: "Wear them through the next thirty pounds. If her thighs don't come down with the rest of her, she doesn't pay a dollar."
[70–74s] Reason-Why Offer — VO: "Buy one, second one free — she's dropping a size before day ninety and she's going to need it. She did the hardest part already. Don't finish with legs she has to cover."
[74–76s] CTA — On-screen: "Shop Now"`,
    ],
    order: 12,
  },
];
