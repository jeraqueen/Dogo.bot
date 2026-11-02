# Dogo.bot — Deriv Automation Foundation

Mobile-first dashboard and integration foundation for a Deriv API trading bot.

## Current phase
This repository is the connection/dashboard foundation only. Strategy rules have intentionally not been added yet; the owner will supply those later.

## Planned architecture
- GitHub: source control
- Cloudflare Pages: dashboard hosting
- Cloudflare Worker/Durable Object or another suitable always-on backend: secure API session and execution
- Deriv API: authorized market data and contract execution

## Security
- Never put Deriv API tokens in frontend code, GitHub files, commits, or public logs.
- Store secrets only in backend secrets/environment settings.
- Start with a Deriv demo account and a token with only the permissions required.
- Trading is disabled until authentication, contract support, risk controls, and demo testing are verified.

## Deployment
Connect this repository to a Cloudflare Pages project with the production branch set to `main` and build command blank (static HTML), output directory `/`.

The dashboard is a UI shell at this stage; it does not claim to be connected to Deriv or execute trades yet.
