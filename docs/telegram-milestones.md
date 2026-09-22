# Telegram milestone notifications

This is an optional local delivery channel. It does not decide that a
milestone is complete; the milestone's acceptance gate does. It only delivers
the already-made decision.

## One-time setup

1. Create a bot with Telegram's `@BotFather`.
2. Open the new bot and send `/start`.
3. Put only the token in `.local/telegram.env`:

   ```text
   OSG_TELEGRAM_BOT_TOKEN=
   OSG_TELEGRAM_CHAT_ID=
   ```

4. Run:

   ```sh
   npm run notify:setup
   ```

The setup command requires exactly one unique private chat among the bot's
updates, writes its numeric chat id into the same mode-0600 file and sends one
test message. Repeated messages from that chat are fine; if more than one
private recipient contacted the bot, setup refuses to guess. It never prints
the token or chat id.

## Reaching a milestone

After the named acceptance script is green:

```sh
npm run notify:milestone -- gw1 "Kernel, matchers and headless runner are green"
```

The message includes the current branch, short commit and a `+dirty` suffix
when applicable. An atomic local claim under `.local/milestones/` prevents
two concurrent processes from sending the same id. A successful send becomes a
completed marker. If delivery is ambiguous, the claim is retained and an
operator must inspect Telegram before clearing it; the tool does not risk an
automatic duplicate.

Notification failure must not turn a failed product gate green. Conversely, a
temporary Telegram outage does not revoke an achieved milestone; retry the
notification after connectivity returns. Tokens, chat ids, captures and
markers stay under `.local/` and are never committed.

This tool does not keep Codex alive and does not wake an inactive conversation.
For unattended delivery, a long-running local runner or CI job must invoke the
milestone command after its acceptance gate succeeds.
