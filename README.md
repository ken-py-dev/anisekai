# AniseKai

> A standalone anime scraper, REST API, and web client.

This is an open-source release of a larger system. The parent project is not disclosed, which is why some parts of the code may appear incomplete or unstructured.

## Prerequisites

- Node.js 18 or later
- npm

## Installation

```bash
npm install
```

## Running

```bash
node index.js
```

The server starts on port 5000 by default. Open `http://localhost:5000` in your browser.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | HTTP server port |

## What Works in Standalone Mode

- **Web client** at `/` — browse and search anime
- **API documentation** at `/docs**
- **Watch pages** at `/watch/:slug/:episode`
- **REST API** at `/api/*` — all data endpoints
- **Image proxy** at `/api/image-proxy`

The HLS tunnel (playback proxy) is a closed-source feature from the parent project and is not functional in this standalone release.

## Modules

| Module | Purpose |
|--------|---------|
| `index.js` | Server, routes, watch page rendering |
| `scraper.js` | Scraping logic |
| `libs/host_base.js` | URL generation utility |
| `public/` | Static assets |

## Dependencies

- express
- axios
- axios-http2-adapter
- cheerio
- node-cache
