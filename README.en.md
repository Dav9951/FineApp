# FineApp

A self-hosted **household budget planner** for one household run by two people, built for
Polish users: the interface, the documentation and the defaults (PLN, Polish date formats,
Polish categories) are in Polish.

- **Month view** — balances, what is left, goal progress, what needs doing this month.
- **Accounts, transactions, recurring items, liabilities** — set up once, then confirmed.
- **Planned expenses** — insurance, car service, holidays: a monthly set-aside amount and
  a warning when a month runs short.
- **Percentage goals** — "save 20% of income", tracked net in both directions
  (amount ⇄ percent).
- **Budget planner** — a draft of next month assembled from recurring items, planned
  expenses, instalments and goals; plan vs. actual.
- **Receipt reading with AI** (optional, Anthropic API) — photo of a receipt → suggested
  line items and categories, always confirmed by a human.

Runs in Docker on your own server; data stays in SQLite. Mobile-first PWA.

**Stack:** TypeScript, Node 22.12+, Fastify 5, SQLite + Drizzle ORM, Zod, React 19 + Vite,
TanStack Query, Tailwind CSS, pnpm workspaces.

## Quick start

```bash
pnpm install
cp .env.example .env   # then set JWT_SECRET and IP_HASH_SALT
pnpm db:migrate && pnpm db:seed
pnpm --filter @fineapp/api user:create -- --email me@example.com --name "Name"
pnpm dev
```

Full instructions, deployment and all design documents are in Polish:
[README.md](./README.md), [`plans/`](./plans/README.md).

Issues and pull requests are welcome in Polish or English — see
[CONTRIBUTING.md](./CONTRIBUTING.md).

License: [MIT](./LICENSE).
