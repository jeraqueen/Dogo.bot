# Dogo.bot Strategy Lab

A research-only, mobile-friendly Deriv synthetic-index tick-history scanner.

## Current scope

- Ten Volatility markets: R_10, R_25, R_50, R_75, R_100 and the five 1-second variants.
- Requests up to 5,000 historical ticks per market from Deriv's public market-data WebSocket.
- Chronological 70/30 development/validation split.
- Rolling 100-tick hypotheses: Digit Differs (least frequent digit), Even/Odd imbalance, Over/Under imbalance, and short-term Rise/Fall momentum.
- Reports observed validation hit rates and Wilson confidence lower bounds.
- Sends no orders, stores no Deriv token, and cannot access a live account.

## Important limitations

This is the first research scanner, not a profitable trading bot and not a strategy approval engine. A high observed hit rate is not proof of positive expected value. It does not yet query and store exact contract proposals, account for every payout/contract rule, correct for multiple comparisons, or run a long demo forward test. The on-screen REVIEW label is only a prompt for deeper analysis, never permission to trade.

Before demo execution is added, the next stage must:
1. Query contracts_for for each symbol and identify actually supported contracts.
2. Capture live proposal quotes for the exact stake, duration, barrier and contract.
3. Calculate break-even probability and expected value from the returned payout.
4. Add walk-forward folds, untouched holdout data, multiple-testing correction and minimum sample-size gates.
5. Add a separate demo-only execution service with strict demo-account verification, a US$3.50 stake ceiling, no Martingale, and at most four completed trades per market. Live trading must remain disabled.

## Run

Deploy this branch as a Cloudflare Pages preview or serve the repository root as a static site. Open the page and press Load history & test strategies. It needs a browser connection to Deriv's public WebSocket endpoint. No secrets or API token are required.

## Research background

The public dtwijesekara/deriv-alpha-search study reports 1,584 strategy variants across 26 synthetic-index symbols with no validated out-of-sample edge among the tested families. This does not prove no possible strategy exists; it is why Dogo.bot uses measured evidence and payout-aware validation rather than marketing win rates.
