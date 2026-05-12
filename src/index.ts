interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Genius MCP — songs, artists, annotations metadata
 *
 * Note: Genius's API surfaces metadata (titles, IDs, URLs, descriptions,
 * artist info, hot/cold scores) but **not the actual lyric text** — that's
 * blocked by their TOS and only available via the web pages. This pack
 * returns metadata + page URLs.
 *
 * API: https://docs.genius.com/
 * Auth: Bearer token (Client Access Token). Free, register at genius.com/api-clients.
 *
 * Tools:
 * - search_songs:     keyword search across the catalog
 * - get_song:         song metadata + URL
 * - get_artist:       artist metadata
 * - list_artist_songs: songs by an artist (sortable, paginated)
 * - get_annotation:   annotation (community note) detail
 */


const BASE_URL = 'https://api.genius.com';

const tools: McpToolExport['tools'] = [
  {
    name: 'search_songs',
    description:
      'Search Genius for songs by title / artist / lyrics excerpt. Returns top hits with song ID, title, primary artist, full title, URL.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term' },
        page: { type: 'number', description: '1-based page (default 1)' },
        per_page: { type: 'number', description: '1-50 (default 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_song',
    description:
      'Song metadata: title, primary + featured artists, album, release date, description, hot count, lyrics URL. Lyric text is not in the API — use the URL.',
    inputSchema: {
      type: 'object',
      properties: {
        song_id: { type: 'number', description: 'Genius song ID' },
      },
      required: ['song_id'],
    },
  },
  {
    name: 'get_artist',
    description: 'Artist bio + identifiers.',
    inputSchema: {
      type: 'object',
      properties: {
        artist_id: { type: 'number', description: 'Genius artist ID' },
      },
      required: ['artist_id'],
    },
  },
  {
    name: 'list_artist_songs',
    description: 'Songs by an artist. Sort by popularity or release date.',
    inputSchema: {
      type: 'object',
      properties: {
        artist_id: { type: 'number', description: 'Genius artist ID' },
        sort: { type: 'string', description: 'title | popularity | release_date_with_null_last' },
        per_page: { type: 'number', description: '1-50 (default 20)' },
        page: { type: 'number', description: '1-based page' },
      },
      required: ['artist_id'],
    },
  },
  {
    name: 'get_annotation',
    description: 'Single annotation (Genius community note) by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        annotation_id: { type: 'number', description: 'Genius annotation ID' },
        text_format: { type: 'string', description: 'plain | html | dom (default plain)' },
      },
      required: ['annotation_id'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const apiKey = (args._apiKey as string | undefined)?.trim();
  if (!apiKey) {
    throw new Error(
      'Genius requires a Client Access Token. Contact the operator about platform credentials, or BYO via ?_apiKey=<token> after registering at https://genius.com/api-clients.',
    );
  }
  switch (name) {
    case 'search_songs':
      return searchSongs(apiKey, args);
    case 'get_song':
      return getSong(apiKey, reqNum(args, 'song_id', '378195'));
    case 'get_artist':
      return getArtist(apiKey, reqNum(args, 'artist_id', '16775'));
    case 'list_artist_songs':
      return listArtistSongs(apiKey, args);
    case 'get_annotation':
      return getAnnotation(apiKey, args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function reqNum(args: Record<string, unknown>, key: string, example: string): number {
  const v = args[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`Required argument "${key}" must be a number. Example: ${example}.`);
  }
  return v;
}

async function geniusFetch<T>(apiKey: string, path: string, params: URLSearchParams): Promise<T> {
  const url = `${BASE_URL}${path}${params.toString() ? `?${params}` : ''}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  if (res.status === 401 || res.status === 403) throw new Error('Genius: unauthorized — check the API token');
  if (res.status === 404) throw new Error('Genius: not found (HTTP 404)');
  if (res.status === 429) throw new Error('Genius: rate-limit (HTTP 429)');
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Genius error: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

interface GeniusEnvelope<T> {
  meta?: { status?: number };
  response?: T;
}

async function searchSongs(apiKey: string, args: Record<string, unknown>) {
  const params = new URLSearchParams({
    q: String(args.query),
    page: String(Math.max(1, (args.page as number) ?? 1)),
    per_page: String(Math.min(50, Math.max(1, (args.per_page as number) ?? 20))),
  });
  const data = await geniusFetch<
    GeniusEnvelope<{ hits?: { result?: GeniusSongSummary }[] }>
  >(apiKey, '/search', params);
  const hits = data.response?.hits ?? [];
  return {
    query: args.query,
    count: hits.length,
    songs: hits.map((h) => normalizeSongSummary(h.result ?? {})),
  };
}

interface GeniusSongSummary {
  id?: number;
  title?: string;
  full_title?: string;
  url?: string;
  song_art_image_url?: string;
  header_image_url?: string;
  primary_artist?: { id?: number; name?: string; url?: string };
}

function normalizeSongSummary(s: GeniusSongSummary) {
  return {
    id: s.id ?? null,
    title: s.title ?? null,
    full_title: s.full_title ?? null,
    primary_artist: s.primary_artist?.name ?? null,
    primary_artist_id: s.primary_artist?.id ?? null,
    art_image: s.song_art_image_url ?? null,
    genius_url: s.url ?? null,
  };
}

async function getSong(apiKey: string, songId: number) {
  const data = await geniusFetch<GeniusEnvelope<{ song?: Record<string, unknown> }>>(
    apiKey,
    `/songs/${songId}`,
    new URLSearchParams({ text_format: 'plain' }),
  );
  return data.response?.song ?? null;
}

async function getArtist(apiKey: string, artistId: number) {
  const data = await geniusFetch<GeniusEnvelope<{ artist?: Record<string, unknown> }>>(
    apiKey,
    `/artists/${artistId}`,
    new URLSearchParams({ text_format: 'plain' }),
  );
  return data.response?.artist ?? null;
}

async function listArtistSongs(apiKey: string, args: Record<string, unknown>) {
  const artistId = reqNum(args, 'artist_id', '16775');
  const params = new URLSearchParams({
    sort: (args.sort as string) ?? 'popularity',
    per_page: String(Math.min(50, Math.max(1, (args.per_page as number) ?? 20))),
    page: String(Math.max(1, (args.page as number) ?? 1)),
  });
  const data = await geniusFetch<GeniusEnvelope<{ songs?: GeniusSongSummary[]; next_page?: number | null }>>(
    apiKey,
    `/artists/${artistId}/songs`,
    params,
  );
  return {
    artist_id: artistId,
    next_page: data.response?.next_page ?? null,
    count: data.response?.songs?.length ?? 0,
    songs: (data.response?.songs ?? []).map(normalizeSongSummary),
  };
}

async function getAnnotation(apiKey: string, args: Record<string, unknown>) {
  const id = reqNum(args, 'annotation_id', '12345');
  const params = new URLSearchParams({
    text_format: (args.text_format as string) ?? 'plain',
  });
  const data = await geniusFetch<GeniusEnvelope<{ annotation?: Record<string, unknown> }>>(
    apiKey,
    `/annotations/${id}`,
    params,
  );
  return data.response?.annotation ?? null;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
