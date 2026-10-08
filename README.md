# Dream Experience Survey

A single-page survey application built with HTML, CSS, browser JavaScript, Node.js built-in HTTP, and SQLite via Node's built-in `node:sqlite` API. It has no npm dependencies.

## Features

- Multi-select dream sensory experiences.
- View sub-options: Without colour / With colour.
- Touch sub-options: Wetness / Temperature / Roughness, with an extensible option model.
- “Other” free text, validated to a maximum of 100 whitespace-separated words.
- One submission per IP address.
- IP addresses are never stored directly; a SHA-256 hash with a server-side salt is stored instead.
- SQLite persistence in `data/survey.sqlite`.
- Per-option integer counts.
- Exact “Other” answers shown as individual text bubbles.
- Mobile and desktop responsive layout.
- Safe text rendering for user-submitted “Other” responses.

## Run locally

Node.js 22+ is recommended because the app uses Node's built-in `node:sqlite` module.

```bash
npm start
```

Then open `http://localhost:3000`.

## Production configuration

Always set a strong private salt before deployment:

```bash
IP_HASH_SALT="replace-with-a-long-random-secret" npm start
```

When the application is behind a reverse proxy that correctly overwrites `X-Forwarded-For`, enable proxy IP extraction:

```bash
TRUST_PROXY=true IP_HASH_SALT="..." npm start
```

Do not enable `TRUST_PROXY=true` unless your proxy is trusted; otherwise clients could spoof the header and bypass the intended IP-based uniqueness rule.

## Persistence

The first run creates `data/survey.sqlite`. Keep the `data` directory to preserve submissions across restarts and sessions.

## Privacy/security note

IP hashing avoids storing the raw IP address, but a deterministic salted hash is still sensitive data. Keep `IP_HASH_SALT` secret and protect the SQLite database and server. For a public deployment, add HTTPS/TLS, rate limiting, backups, and an appropriate privacy/retention notice.
