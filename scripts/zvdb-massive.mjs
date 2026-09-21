#!/usr/bin/env node
// Select a small, deterministic, parallel multilingual benchmark from
// Amazon MASSIVE 1.1. The source dataset is CC BY 4.0 and is not downloaded
// by this script; point MASSIVE_DIR at its extracted data/ directory.
import {createHash} from "node:crypto";
import {readFileSync, writeFileSync, mkdirSync} from "node:fs";
import {dirname, join, resolve} from "node:path";

const root = resolve(new URL("../", import.meta.url).pathname);
const sourceDir = resolve(process.env.MASSIVE_DIR ?? process.argv[2] ?? "");
const target = resolve(process.argv[3]
  ?? `${root}/packs/zvdb/fixtures/benchmark-texts.massive.json`);
if (sourceDir === root) {
  throw new Error("Set MASSIVE_DIR to the extracted MASSIVE 1.1 data directory");
}

const sourceLocales = ["en-US", "ru-RU", "de-DE", "fr-FR", "es-ES"];
const baseScenarios = {
  alarm: ["alarm_query", "alarm_set"],
  calendar: ["calendar_query", "calendar_set"],
  email: ["email_query", "email_sendemail"],
  iot: ["iot_cleaning", "iot_coffee"],
  lists: ["lists_createoradd", "lists_query"],
  music: ["music_likeness", "music_query"],
  play: ["play_music", "play_radio"],
  qa: ["qa_definition", "qa_factoid"],
  recommendation: ["recommendation_events", "recommendation_movies"],
  transport: ["transport_query", "transport_taxi"],
};
const extraScenarios = {
  audio: ["audio_volume_mute", "audio_volume_other"],
  cooking: ["cooking_query", "cooking_recipe"],
  datetime: ["datetime_convert", "datetime_query"],
  general: ["general_greet", "general_joke"],
  news: ["news_query"],
  social: ["social_post", "social_query"],
  takeaway: ["takeaway_order", "takeaway_query"],
  weather: ["weather_query"],
  play: ["play_audiobook", "play_game", "play_podcasts"],
  qa: ["qa_currency", "qa_maths", "qa_stock"],
};
const scenarios = {};
for (const set of [baseScenarios, extraScenarios]) {
  for (const [scenario, intents] of Object.entries(set)) {
    (scenarios[scenario] ??= []).push(...intents);
  }
}
const wantedIntents = new Set(Object.values(scenarios).flat());

const translitMap = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};
function transliterate(text) {
  return [...text].map((character) => {
    const lower = character.toLowerCase();
    const mapped = translitMap[lower];
    if (mapped === undefined) return character;
    return character === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
  }).join("");
}

function readLocale(locale) {
  const file = join(sourceDir, `${locale}.jsonl`);
  const rows = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  return new Map(rows.map((row) => [String(row.id), row]));
}

const byLocale = new Map(sourceLocales.map((locale) => [locale, readLocale(locale)]));
const english = byLocale.get("en-US");

const stable = (id) => createHash("sha256").update(`zvdb-massive-v1:${id}`).digest("hex");
const rows = [];
let intentNo = 0;
const sets = [
  {name: "five-language", scenarios: baseScenarios, phrases: () => 10,
    partition: "test",
    variants: sourceLocales.map((locale) => ({locale, sourceLocale: locale, transform: (text) => text}))},
  {name: "russian-transliteration", scenarios: extraScenarios,
    // cooking_query has only six parallel en/ru rows in MASSIVE. Keep all
    // six and put the remaining eleven groups into the abundant weather set:
    // 18 * 17 + 6 + 22 = 334 parallel triples = 1002 rows.
    phrases: (intent) => intent === "cooking_query" ? 6 : intent === "weather_query" ? 22 : 17,
    variants: [
      {locale: "en-US", sourceLocale: "en-US", transform: (text) => text},
      {locale: "ru-RU", sourceLocale: "ru-RU", transform: (text) => text},
      {locale: "ru-Latn", sourceLocale: "ru-RU", transform: transliterate},
    ]},
];
for (const set of sets) {
  for (const [scenario, intents] of Object.entries(set.scenarios)) {
    for (const intent of intents) {
      intentNo++;
      const count = set.phrases(intent);
      const ids = [...english.values()].filter((row) => {
        if (row.intent !== intent || (set.partition && row.partition !== set.partition)) return false;
        return set.variants.every((variant) => {
          const source = byLocale.get(variant.sourceLocale).get(String(row.id));
          return source && source.intent === intent && [...variant.transform(source.utt)].length <= 255;
        });
      }).map((row) => String(row.id)).sort((a, b) => stable(a).localeCompare(stable(b))).slice(0, count);
      if (ids.length !== count) throw new Error(`${intent}: expected ${count} parallel test rows, got ${ids.length}`);
      for (let pairNo = 0; pairNo < ids.length; pairNo++) {
        for (let localeNo = 0; localeNo < set.variants.length; localeNo++) {
          const variant = set.variants[localeNo];
          const source = byLocale.get(variant.sourceLocale).get(ids[pairNo]);
          rows.push({
            id: `I${String(intentNo).padStart(2, "0")}P${String(pairNo + 1).padStart(2, "0")}L${localeNo + 1}`,
            sourceId: ids[pairNo],
            locale: variant.locale,
            scenario,
            intent,
            payload: variant.transform(source.utt),
          });
        }
      }
    }
  }
}

const expectedRows = 2002;
if (rows.length !== expectedRows || new Set(rows.map((row) => row.id)).size !== expectedRows) {
  throw new Error(`expected ${expectedRows} unique rows, got ${rows.length}`);
}
const output = {
  format: "zvdb-massive-benchmark-texts/v1",
  source: {
    name: "MASSIVE 1.1",
    url: "https://github.com/alexa/massive",
    download: "https://amazon-massive-nlu-dataset.s3.amazonaws.com/amazon-massive-dataset-1.1.tar.gz",
    license: "CC BY 4.0",
    citation: "FitzGerald et al., MASSIVE, ACL 2023",
  },
  design: {
    rows: expectedRows,
    locales: [...new Set(sets.flatMap((set) => set.variants.map((variant) => variant.locale)))],
    scenarios: Object.keys(scenarios),
    intents: [...wantedIntents],
    sets: [
      {name: "five-language", rows: 1000, variants: sourceLocales, parallelUtterancesPerIntent: 10},
      {name: "russian-transliteration", rows: 1002, variants: ["en-US", "ru-RU", "ru-Latn"], parallelGroups: 334},
    ],
    relevance: "intent is the fine label; scenario is the coarse label; sourceId joins translations",
  },
  rows,
};
mkdirSync(dirname(target), {recursive: true});
writeFileSync(target, JSON.stringify(output, null, 2) + "\n");
console.log(`zvdb-massive: ${rows.length} rows, ${wantedIntents.size} intents, ${output.design.locales.length} variants -> ${target}`);
