# MASSIVE benchmark subset

The benchmark text in `benchmark-texts.massive.json` and the corresponding
`PAYLOAD` values in `../data/zvdb_100_vec.tabu.json` are a deterministic
subset of **MASSIVE 1.1**:

- Copyright Amazon.com Inc. or its affiliates.
- Licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
- Source and attribution: [alexa/massive](https://github.com/alexa/massive).
- Paper: Jack FitzGerald et al., “MASSIVE: A 1M-Example Multilingual Natural
  Language Understanding Dataset with 51 Typologically-Diverse Languages”,
  ACL 2023.

The subset contains 2,002 rows in two deterministic parts covering 40 labeled
intents. The first part contains 1,000 unmodified utterances in five locales
(`en-US`, `ru-RU`, `de-DE`, `fr-FR`, `es-ES`). The second contains 334 linked
triples (1,002 rows): the original English and Russian utterances plus a
deterministic Latin-script transliteration derived from each Russian text.
Those `ru-Latn` rows are an explicit transformation of the MASSIVE material,
not original dataset rows. Selection and transliteration are reproducible with
`scripts/zvdb-massive.mjs`.
