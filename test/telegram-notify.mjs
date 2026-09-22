import {expect} from "chai";
import {
  parseEnvText,
  redact,
  selectSetupChat,
  setEnvValue,
} from "../tools/osd-telegram-notify.mjs";

describe("Telegram milestone notification helpers", () => {
  it("reads quoted tokens without losing embedded equals signs", () => {
    const parsed = parseEnvText([
      "# secret",
      "OSG_TELEGRAM_BOT_TOKEN='123:abc=def'",
      "OSG_TELEGRAM_CHAT_ID=",
      "",
    ].join("\n"));
    expect(parsed.OSG_TELEGRAM_BOT_TOKEN).to.equal("123:abc=def");
    expect(parsed.OSG_TELEGRAM_CHAT_ID).to.equal("");
  });

  it("writes one canonical value even when the input had duplicates", () => {
    const updated = setEnvValue(
      "OSG_TELEGRAM_BOT_TOKEN=secret\n"
        + "OSG_TELEGRAM_CHAT_ID=old\n"
        + "OSG_TELEGRAM_CHAT_ID=wrong\n",
      "OSG_TELEGRAM_CHAT_ID",
      "-12345",
    );
    expect(updated).to.match(/^OSG_TELEGRAM_BOT_TOKEN=secret$/m);
    expect(updated).to.match(/^OSG_TELEGRAM_CHAT_ID=-12345$/m);
    expect(updated.match(/OSG_TELEGRAM_CHAT_ID=/g)).to.have.length(1);
    expect(updated.endsWith("\n")).to.equal(true);
  });

  it("appends a missing value", () => {
    const updated = setEnvValue(
      "OSG_TELEGRAM_BOT_TOKEN=secret\n",
      "OSG_TELEGRAM_CHAT_ID",
      "42",
    );
    expect(updated).to.match(/^OSG_TELEGRAM_CHAT_ID=42$/m);
  });

  it("accepts repeated updates from one private chat", () => {
    expect(selectSetupChat([
      {message: {chat: {id: 42, type: "private"}}},
      {message: {chat: {id: 42, type: "private"}}},
    ]).id).to.equal(42);
  });

  it("refuses to guess between two private recipients", () => {
    expect(() => selectSetupChat([
      {message: {chat: {id: 42, type: "private"}}},
      {message: {chat: {id: 43, type: "private"}}},
    ])).to.throw(/More than one private/);
  });

  it("redacts token and chat identity from remote errors", () => {
    expect(redact("bad secret and 42", ["secret", "42"]))
      .to.equal("bad [redacted] and [redacted]");
  });
});
