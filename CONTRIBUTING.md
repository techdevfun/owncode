# Contributing

## Development

```sh
npm install
npm run build
npm test        # unit + e2e (fixture git repos built in tmp with real commits)
npm run test:live  # live smoke; soft-skips on network failure
npm run lint    # eslint + prettier
node scripts/preflight.js  # ASCII-only + no-internal-names scan
```

## Rules

- Zero runtime dependencies. TypeScript strict, Node 20+.
- Every figure cited in the README must come from a live source fetched
  during the build or a recorded fixture labelled as such. No invented
  numbers.
- All public content is English only (ASCII). The preflight script blocks
  anything else, including text inside the demo transcript.
- Verdicts are heuristics, not legal advice. Every legal sentence in the
  README, the CLI help, and JSON output must cite US Copyright Office
  guidance Part 2 (29 January 2025) and carry the UK / other-jurisdictions
  caveat. Never present a verdict as a legal opinion.
- A human commit is evidence of a human touch, not proof of review depth.
  Never claim otherwise.
- The demo fixture repo is synthetic and labelled as such in the
  transcript, the GIF title card, and the README. Never present fixture
  numbers as measurements of a real project. Live checks against a real
  repo go in the build note and README section 6, with the repo and the
  commit SHA recorded.
