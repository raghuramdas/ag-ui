# Twitter Thread One-Pager

This small demo application converts a Twitter thread URL into a simple one-page HTML document including images, videos or GIFs referenced in the thread. It also stores previously processed threads in a SQLite database and exposes search and history endpoints.

## Features

- Paste a Twitter thread URL and receive HTML content for the whole thread.
- Stores processed threads for quick retrieval via `/history`.
- Full–text search of stored threads via `/search?q=...`.
- Simple retrieval of an individual thread HTML via `/thread/:id`.

## Requirements

- Node.js 18+.
- Twitter API credentials set in environment variables:
  - `TWITTER_API_KEY`
  - `TWITTER_API_SECRET`
  - `TWITTER_ACCESS_TOKEN`
  - `TWITTER_ACCESS_SECRET`

## Run

```bash
npm install
npm start
```

The server listens on port `3000` by default.
