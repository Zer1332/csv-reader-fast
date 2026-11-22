# csv-reader-fast

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Zer1332/csv-reader-fast/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Zer1332/csv-reader-fast/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for csv-reader 1.0.0: it returns exactly csv-reader's answers for every input, in less CPU time. Dependency-free JavaScript, single pass, no randomness, no clock.

## Run it

```sh
node main.ts
```

`main.ts` reads every case from `/input/cases.json` (or `$MAKEFUN_INPUT_DIR/cases.json`) and writes `/output/answers.json` (or `$MAKEFUN_OUTPUT_DIR/answers.json`).

## How it is fast

- Clean lines (no quotes, no stray CR) are split with one slice + `String.split`.
- Unquoted fields are read with a tight `charCodeAt` loop that slices whole runs instead of building strings a character at a time.
- Quoted fields jump from quote to quote with `indexOf` and slice whole chunks; `""` doubles and CR/LF inside quotes are handled in the chunk.
- Error objects are only built when an error actually occurs, so the hot path for clean rows allocates nothing but the answer itself.
- V8's incremental marking is off, as the house baseline runs.

## Semantics

The reader follows csv-reader 1.0.0's broken-row policy exactly: a leading U+FEFF is dropped, records end at LF or CRLF, blank lines are no records, a CR outside quotes not followed by LF is dropped (`stray_cr`), a quoted field runs to the next non-doubled quote with `""` as one quote and CR/CRLF inside read as LF, junk after a closing quote is appended as it stands (`quote_junk`), a quote that never closes is a literal and the rest is re-read as unquoted (`unterminated_quote`), rows are padded (`short_row`) or cut (`long_row`) to the first record's width, and every error carries its record's starting line and row index.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
