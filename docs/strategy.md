# Context Delta — Strategy & Positioning (May 2026)

This note records the current strategic read after a market review and a
cross-check between the original deep-research report, an independent market
scan, and a second engineering review. It complements (does not replace)
[positioning.md](positioning.md) and [roadmap.md](roadmap.md).

## The wedge (one sentence)

> **Context Delta is open-source, local-first, inspectable context packets for
> AI coding agents.**

We do **not** win by beating Augment or Cursor on retrieval quality. We win on
**transparency, privacy/local-first, zero lock-in, and a public standard for
what a *correct* context packet is.**

### Internal candor vs. public voice

The line above is **internal framing** — keep it out of public copy, where
"we don't beat Augment" reads as reactive. Maintain two surfaces:

- **This doc** (`strategy.md`): candid, competitor-aware, roadmap-oriented.
- **README / site**: simpler, positive, user-facing.

Public voice should be confident and complementary, not defensive:

- **One-liner:** Context Delta is the context packet layer for AI coding
  agents — inspectable, replayable, local-first, measurable, and agent-portable.
- **Framing:** Context Delta complements the agent you already use by making
  its working context visible, reviewable, replayable, measurable, and portable.

Keep one honest signal even in the confident voice: an "alpha / what works
today" note, so confidence doesn't tip into overpromising.

## What the market validated

- **The category is real.** Context engineering is now cited as the leading
  quality blocker for agents at scale, and a large share of agent failures
  trace to context drift / poorly prioritized context.
- **Task-aware pruning works** — and the evidence is academic, not just vendor
  decks: SWE-Pruner reports 23–54% token reduction; Squeez removes ~92% of
  tool-output tokens at ~0.86 recall. The premise ("too much poorly
  prioritized context," not "not enough context") holds.
- **Spec-driven development went mainstream** (Spec Kit ~90k GitHub stars, a
  growing extension ecosystem). Our "complement to Spec Kit" framing is aimed
  at a fast-growing audience.
- **The transparency gap is still open — and users are asking for it.**
  Mainstream coding agents rarely make the final working context inspectable,
  replayable, and portable, and users are publicly complaining that context
  visibility is *decreasing*.

## Correction in emphasis (what changed since the research report)

The report's claim that "no product packages cross-host semantic delta +
transparency" was true when written, but the cross-host half has started to
close:

- **Augment launched its Context Engine as a standalone MCP server on
  February 6, 2026** — plug deep semantic indexing into Cursor, Claude Code,
  Zed, or any MCP client. This is the cross-host middleware the report called
  empty space, shipped by a well-funded incumbent with a deeper engine.
- **Qodo's Deep Context Engine** covers multi-repo analysis and review.
- **AGENTS.md** is now a cross-tool standard governed by the Linux Foundation's
  Agentic AI Foundation; parsing it is table stakes, not a differentiator.

Implication: retire the "nobody does cross-agent context" line. The unclaimed,
durable space is narrower and sharper — transparency + local-first + a packet
quality standard.

## Claims to retire vs. claims to make

| Retire | Use instead |
|---|---|
| "Solves a problem no one solves" | "Makes context visible, portable, and measurable — which incumbents do invisibly" |
| "Nobody has cross-agent context middleware" | "Open-source and local-first: packets are built and stored on your machine, and you choose what to send — not locked to one vendor" |
| "Your code never leaves your machine" | "Packets are built and stored locally by default; you choose what packet to send to your agent (which then goes to that agent's service)" |
| "Better/most relevant context than X" (unproven) | "See exactly what's sent and why" — defer correctness claims until we have eval numbers |
| Whole-repo "% context reduction" as the headline | "Useful-context density" + raw token counts against a realistic baseline |

## The defensible moat, in priority order

1. **Radical transparency.** The literal serialized packet + per-item inclusion
   reasons + exclusions + packet diff + replay. This is the signature artifact
   and the thing incumbents are *moving away from*.
2. **Local-first by default, private, zero lock-in.** Packet assembly and
   storage stay local by default; sharing a packet with an agent is explicit
   and user-controlled. Lead here for individual developers.
3. **A public packet-quality eval / gold set.** A rigorous, published
   definition of the *minimum sufficient* context for a task (precision,
   impact coverage, omission rate, packed size). This is the only asset
   competitors can't trivially copy, and it compounds. Promote it from "nice
   to have" to a core company bet.
4. **Then** better ranking (semantic + graph) to *earn* correctness claims —
   not before.

## Honesty guardrails (metrics)

- Replace the whole-repo baseline in the engine's reduction metric, or label it
  precisely everywhere as an upper bound. The website copy already carries that
  caveat; the engine should follow.
- Adopt **useful-context density** as the north-star (how much of the packet
  was actually relevant), with raw token counts as a secondary proof point.
- **Do not** publish any "best/better context than <competitor>" claim until
  the eval harness produces defensible numbers.

## Re-prioritized roadmap (sequenced)

Sequencing rule: **build the eval + honest metrics first, ranking second,
correctness claims last.** Maps onto the phases in [roadmap.md](roadmap.md).

### Now — defend the moat, earn the right to claim correctness
- **Packet-quality eval harness + gold set** (100–200 labeled tasks): the
  minimum-sufficient artifacts per task; score precision / impact coverage /
  omission / packed size. *(extends roadmap Phase 5)*
- **Metric reframe**: useful-context density + realistic baseline; stop leading
  with whole-repo %. *(Phase 5)*
- **Native AGENTS.md / CLAUDE.md parsing** with closest-file-wins precedence —
  table stakes. *(Phase 4)*
- **Packet replay + approval flow in VS Code**: replay the exact packet behind
  a good/bad answer. The inspectable packet is the product. *(Phase 2)*

### Next — make the correctness story real
- **Hybrid semantic + graph ranking**: tree-sitter symbol index, local
  embeddings, lineage/impact graph, hybrid reranker. Replaces keyword + path +
  hardcoded auth regex. *(upgrades Phase 1)*
- **MCP multi-host conformance**: validated across Claude Code, Cursor,
  Windsurf, Copilot, with a published checklist. *(Phase 3)*
- **Ship as a Spec Kit extension/plugin**, not a parallel tool. *(Phase 4)*

### Later — expand where the real token burn is
- **Mid-session loop compaction**: extend from the first packet into the agent
  loop (where 50× token burn actually happens). Biggest TAM expansion.
- **Spec/code/test drift detection** (directly targets context-drift failures).
- **Privacy-safe team/org rollup dashboard** and **multi-repo impact analysis**
  for the enterprise tier. *(Phase 6)*

## Competitive snapshot

| Player | Owns | Context Delta's relation |
|---|---|---|
| Augment Context Engine (MCP, Feb 2026) | Deep cross-host semantic indexing | Don't compete head-on; be the transparent, local-first, OSS alternative |
| Cursor | Native IDE + invisible hybrid retrieval | Contrast on transparency (they're reducing it) and lock-in |
| Qodo | Multi-repo review/governance | Different buyer; we start with the individual dev |
| Packmind / Tessl / Ruler | Org standards / versioned context / rules fan-out | Adjacent; we're delta + packet transparency, not rules distribution |
| Spec Kit | Spec → plan → tasks workflow | Complement: deliver the right slice of the spec at runtime |
| Mem0 | Persistent memory substrate | Complement, not substitute |

## Bottom line

The research thesis is sound and, on transparency, *more* validated than when
it was written. The risk is no longer "is the problem real" — it's that the
copyable half of the moat (transparency UX, naive delta) is built while the
defensible half (eval gold set, semantic/graph ranking) is not, and incumbents
are moving in. The next work that matters is the eval, the honest metric, and
the ranking — in that order — so any future "better context" claim is earned.
