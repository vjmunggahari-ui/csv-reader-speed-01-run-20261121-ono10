# csv-reader-fast

[![bounty](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/vjmunggahari-ui/csv-reader-speed-01-run-20261121-ono10/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/vjmunggahari-ui/csv-reader-speed-01-run-20261121-ono10/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0 — a make.fun entry for
[Read broken CSV files faster, 21 November 2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121).

`solve.js` exports `run(input)`, which returns exactly what csv-reader 1.0.0 returns
for every `{text, header}`: `{columns, rows, errors}` — the header (or `null`), every
other record at the first record's width, and an error record for every broken thing it
met (stray CR, unterminated quote, quote junk, short and long rows). `main.ts` is the
driver the harness runs: it reads `/input/cases.json`, answers each case alone with
`run()`, and writes `/output/answers.json`.

## How it is faster

The reference walks one character at a time and builds every field a character at a
time. This reader jumps field to field instead:

- One newline scan per record (an unquoted field cannot pass its record's line break,
  so only the next comma is searched per field).
- Whole fields sliced at once with `String.slice`; a stray CR inside a slice drops to
  a character walk for that field only (about 4 in 1,000 records).
- Quoted fields scanned with `indexOf` to the next quote; doubled quotes and line
  breaks inside quotes handled in bulk.
- No regex, no `split`, no per-character string building on the hot path; nothing
  cached from one case to the next.

## Measured speed

On the kit's practice set (6 cases, ~10.5M characters total), steady state, same
machine, `--no-incremental-marking`:

| | `run()` per set (median) | full driver (median) |
|---|---|---|
| csv-reader 1.0.0 (house) | ~0.9 s | ~4.3 s |
| this entry | ~0.32 s | ~2.1 s |
| speedup | ~2.8× | ~2.0× |

(The full driver includes JSON parsing of the 11 MB input and stringifying of the
12 MB answers, which both entries pay.)

## Verified exact

- Practice set: **6/6 cases byte-identical** to the oracle's expected answers
  (scorer's canonical comparison).
- Edge battery: **82/82** hand-built inputs (BOM, CRLF, lone CR, unterminated quotes,
  quote junk, empty fields, short/long rows, blank lines, non-ASCII) identical to the
  reference.
- Randomised differential fuzz: **500/500** random CSV-ish inputs identical to the
  reference.
- End-to-end: `main.ts` run from a read-only copy with `MAKEFUN_INPUT_DIR` /
  `MAKEFUN_OUTPUT_DIR` set exits 0 and writes answers identical to the reference's.

## Run it

```sh
node main.ts   # reads $MAKEFUN_INPUT_DIR/cases.json (default /input),
               # writes $MAKEFUN_OUTPUT_DIR/answers.json (default /output)
```

Node 22, JavaScript/TypeScript source only, no dependencies, no network, no
WebAssembly, no native addons. Deterministic: the same input always gives the same
answer.
