# Agent Note: Desktop ordinary-message copy coverage

Status: implemented

English | [中文](2026-08-21-desktop-ordinary-message-copy.zh.md)

## Problem

The desktop 0.3 roadmap requires a visually consistent copy action beside every ordinary user and assistant message. The audit of the assembled renderer coverage found one gap: the Turn Tail copy action wrote only the closing Assistant node's text, so narration in a multi-step turn was visible but not copyable.

## Decision

`MessageIconActions` remains the single clipboard implementation. `TurnTailChatData` gains a `copyText` field: the complete Assistant plain text of the Turn, built by the turn-tail node builder from every finalized Assistant step in seq order (`assistantText` over each step's text blocks). The Turn Tail copy action writes `copyText` instead of the closing node's blocks. User, steering, and pending-steering bubbles already copy their complete text; context injections, compaction markers, retry/error status rows, and unknown-surface JSON rows remain excluded because they do not represent one ordinary message.

## Alternatives considered

**Render a copy action on every mid-turn Assistant node** — rejected: the footer already owns Turn-local actions, and per-step copy would duplicate chrome without changing what a user can copy.

**Copy only the closing node's text** — rejected: multi-step narration would stay uncopyable, which is the gap the audit found.

## Consequences

The fixture snapshot (`chat-snapshot-fixture.client.ts`) mirrors `copyText` so rendered views stay truthful in tests. Branching semantics are unchanged: the branch action still anchors on the closing node's seq, and `copyText` does not affect fork behavior.

## Testing

`chat-view.client.spec.tsx` pins that a multi-step Turn's copy action writes `mid-turn text` plus `final answer` in seq order, and that one Turn Tail (not per-step) copy action renders.
