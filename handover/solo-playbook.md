# Working alone: decisions, critics, not blocking

For any session that works unattended on open-steamgate or osg-demo. It
complements CLAUDE.md, which still applies in full.

## The loop (every tick)

1. Orient: read your rules file, `git status`, `git branch --show-current`.
   Never have changes on `main`.
2. Read the relay (OSG Relay artifact, collection `messages`), and answer
   what is addressed to you.
3. Take the next step of your queue. A step is small enough to finish or to
   checkpoint within one tick. If a run is going, check it; don't start a
   second heavy one.
4. Checkpoint: commit WIP on your own branch with a one-line PROGRESS note,
   so a lost context or an OOM loses nothing.

## Deciding alone

Classify each choice first:

| Kind | Examples | What to do |
|------|----------|------------|
| Reversible and local | a name, a file layout, seed values, a text, which of two reasonable designs | decide; write it in the PR under "Decisions taken", with one line of why |
| Reversible but visible to others | a contract field, a public API shape, a test's rule | decide with a critic subagent (two options → the critic picks, with reasons); record it; change the contract/doc in the same PR |
| Hard to reverse or outside your remit | merge, anything on `main`, someone else's branch, deleting branches or data, any SAP system, publishing a release, a new public repo, work outside your queue | don't do it; ask Alice in a draft PR and on the relay; move on to the next item |

Rules of thumb:
- Measure before you decide. A number from a run beats a belief; write the
  number into the PR.
- Grep before saying "nothing exists": docs/, git log, git grep.
- If two options are close, take the smaller, more reversible one and say
  so.
- A blocked item never blocks the queue: park it with its question, then
  take the next one.

## Critics

A critic is a subagent with fresh context that did not build the thing.
Read-only. It gets the diff and the PR draft, not your reasoning.

When to use one:
- before every PR and every upstream issue (always);
- before a decision of the second kind above;
- after a surprising result ("green on the first try", "the bug went away
  by itself").

Lenses. Pick one per critic; use two critics for anything non-trivial:
- **claims vs diff**: every sentence of the draft is backed by a line of
  the diff, or it is marked UNSUPPORTED;
- **tests can fail**: check out the base, run each new test, and see it
  FAIL; then see it pass on the branch; `test/suites.json` registers it;
- **hygiene**: no stray or generated files, no live identifiers (hosts,
  IPs, users, SAP system names), ABAP 7-bit ASCII and lint clean, no
  scope creep;
- **reader**: for docs and README steps, whether each "Expected:" is what
  the running system actually shows.

Template:
> You are a critic. Read-only. Lens: <lens>. Here is the diff
> (`git diff origin/main...HEAD`) and the PR draft. <lens instructions>.
> Answer PASS or a numbered list of fixes; nothing else.

Fix what it flags, then re-run the same critic until PASS. If you disagree
with a finding, run a second critic on just that point. Two against you
means fix it. Put the final verdicts in the PR body under "Critic".

## Reporting

- After each finished item, give Alice one line: the PR link, what is
  verified (and how), and the decisions taken.
- Say what did not run, and why (the network, the environment). The check
  that did not run and the check that passed must not look the same.
- Learned something the hard way? Add one line to your rules file in the
  same commit.
