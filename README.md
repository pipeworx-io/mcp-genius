# @pipeworx/genius

Genius MCP — song / artist / album **metadata**, search, and Genius annotation
descriptions. Lyric text is **not** returned by the Genius API (licensing) —
this pack returns titles, IDs, stats, Genius page URLs, and "about" descriptions.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

- `search(query, limit?)` — keyword search; returns song metadata hits
- `get_song(id)` — song metadata (title, artist, album, release, pageviews, about)
- `get_artist(id)` — artist metadata (name, followers, alternate names, about)
- `artist_songs(artist_id, limit?)` — songs by an artist, ranked by popularity

`_apiKey` is optional on every tool — omit it to use the platform key.

## Auth

- **Platform key:** injected by the gateway when `_apiKey` is omitted.
- **BYO:** pass `_apiKey=<token>` after registering a free Client Access Token
  at https://genius.com/api-clients.

Sent as `Authorization: Bearer <token>` on every request.

## Data source

`https://api.genius.com` — Bearer access token.

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "genius": {
      "url": "https://gateway.pipeworx.io/genius/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Genius data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
