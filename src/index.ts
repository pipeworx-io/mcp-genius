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
 * Genius MCP — wraps the Genius API (api.genius.com)
 *
 * IMPORTANT: This pack returns song / artist / album METADATA, search results,
 * stats (pageviews, followers), Genius page URLs, and annotation/description
 * text. It does NOT return full lyrics — the Genius API does not expose lyric
 * text (licensing). Do not imply lyrics retrieval.
 *
 * Tools:
 * - search:        keyword search across the Genius catalog (song metadata hits)
 * - get_song:      song metadata (title, artist, album, release, pageviews, about)
 * - get_artist:    artist metadata (name, followers, alternate names, about)
 * - artist_songs:  songs by an artist, ranked by popularity
 *
 * Auth: Bearer token. The caller passes a Genius access token as `_apiKey`
 * (OPTIONAL — the gateway injects the platform key when omitted). Register a
 * free Client Access Token at https://genius.com/api-clients.
 */


const BASE_URL = 'https://api.genius.com';
const USER_AGENT = 'pipeworx/1.0 (+https://pipeworx.io)';

const tools: McpToolExport['tools'] = [
  {
    name: 'search',
    description:
      'Search Genius for songs by title, artist, or keyword. Returns song METADATA hits (id, title, artist, Genius URL, release date, pageviews) — NOT lyric text (the Genius API does not return lyrics). Example: search({ query: "kendrick lamar humble", limit: 10 })',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search term — song title, artist name, or keyword, e.g. "humble kendrick"',
        },
        limit: {
          type: 'number',
          description: 'Max number of results to return (default 10)',
        },
        _apiKey: {
          type: 'string',
          description:
            'Genius access token (optional — omit to use the platform key; get your own free at https://genius.com/api-clients)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_song',
    description:
      'Get METADATA for a single Genius song by ID: title, primary artist, album, release date, pageviews, Genius URL, and a short "about" description. Does NOT return lyric text (not available via the Genius API). Example: get_song({ id: 378195 })',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: ['number', 'string'],
          description: 'Genius song ID, e.g. 378195',
        },
        _apiKey: {
          type: 'string',
          description: 'Genius access token (optional — omit to use the platform key)',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_artist',
    description:
      'Get METADATA for a Genius artist by ID: name, Genius URL, image, follower count, alternate names, and a short "about" description. Example: get_artist({ id: 1421 })',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: ['number', 'string'],
          description: 'Genius artist ID, e.g. 1421',
        },
        _apiKey: {
          type: 'string',
          description: 'Genius access token (optional — omit to use the platform key)',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'artist_songs',
    description:
      'List an artist\'s songs ranked by popularity. Returns song METADATA (id, title, artist, Genius URL) — NOT lyric text. Example: artist_songs({ artist_id: 1421, limit: 20 })',
    inputSchema: {
      type: 'object',
      properties: {
        artist_id: {
          type: ['number', 'string'],
          description: 'Genius artist ID, e.g. 1421',
        },
        limit: {
          type: 'number',
          description: 'Max number of songs to return (default 20, max 50)',
        },
        _apiKey: {
          type: 'string',
          description: 'Genius access token (optional — omit to use the platform key)',
        },
      },
      required: ['artist_id'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const apiKey = args._apiKey as string | undefined;
  delete args._apiKey;

  if (!apiKey) {
    return { error: 'Genius requires an access token via _apiKey or the platform key' };
  }

  try {
    switch (name) {
      case 'search':
        return await search(args.query as string, args.limit as number | undefined, apiKey);
      case 'get_song':
        return await getSong(args.id as number | string, apiKey);
      case 'get_artist':
        return await getArtist(args.id as number | string, apiKey);
      case 'artist_songs':
        return await artistSongs(
          args.artist_id as number | string,
          args.limit as number | undefined,
          apiKey,
        );
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// Marker thrown for HTTP 401 so callers can short-circuit to the auth message.
class GeniusAuthError extends Error {}
// Marker thrown for HTTP 404 so per-tool handlers can return a typed not-found.
class GeniusNotFoundError extends Error {}

async function geniusFetch<T>(path: string, apiKey: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  });
  if (res.status === 401) throw new GeniusAuthError('Genius auth error (check access token)');
  if (res.status === 404) throw new GeniusNotFoundError('not found');
  if (!res.ok) throw new Error(`Genius error: HTTP ${res.status}`);
  return (await res.json()) as T;
}

function truncate(text: string | undefined | null, max = 600): string | null {
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

interface ArtistRef {
  id?: number;
  name?: string;
}

interface SongHitResult {
  id?: number;
  title?: string;
  full_title?: string;
  primary_artist?: ArtistRef;
  url?: string;
  release_date_for_display?: string;
  stats?: { pageviews?: number };
}

async function search(query: string, limit: number | undefined, apiKey: string) {
  const cap = typeof limit === 'number' && limit > 0 ? limit : 10;
  let data: { response?: { hits?: { result?: SongHitResult }[] } };
  try {
    data = await geniusFetch(`/search?q=${encodeURIComponent(query)}`, apiKey);
  } catch (err) {
    if (err instanceof GeniusAuthError) return { error: err.message };
    throw err;
  }
  const hits = data.response?.hits ?? [];
  const results = hits.slice(0, cap).map((h) => {
    const r = h.result ?? {};
    return {
      id: r.id,
      title: r.full_title,
      artist: r.primary_artist?.name,
      artist_id: r.primary_artist?.id,
      url: r.url,
      release_date: r.release_date_for_display,
      pageviews: r.stats?.pageviews,
    };
  });
  return { count: results.length, results };
}

interface SongDetail {
  id?: number;
  title?: string;
  full_title?: string;
  primary_artist?: ArtistRef;
  album?: { id?: number; name?: string } | null;
  release_date?: string;
  release_date_for_display?: string;
  stats?: { pageviews?: number };
  url?: string;
  description?: { plain?: string };
}

async function getSong(id: number | string, apiKey: string) {
  let data: { response?: { song?: SongDetail } };
  try {
    data = await geniusFetch(`/songs/${encodeURIComponent(String(id))}`, apiKey);
  } catch (err) {
    if (err instanceof GeniusAuthError) return { error: err.message };
    if (err instanceof GeniusNotFoundError) return { error: 'song not found', id };
    throw err;
  }
  const s = data.response?.song;
  if (!s) return { error: 'song not found', id };
  return {
    id: s.id,
    title: s.full_title,
    artist: s.primary_artist?.name,
    artist_id: s.primary_artist?.id,
    album: s.album?.name,
    release_date: s.release_date,
    pageviews: s.stats?.pageviews,
    url: s.url,
    about: truncate(s.description?.plain),
  };
}

interface ArtistDetail {
  id?: number;
  name?: string;
  url?: string;
  image_url?: string;
  followers_count?: number;
  description?: { plain?: string };
  alternate_names?: string[];
}

async function getArtist(id: number | string, apiKey: string) {
  let data: { response?: { artist?: ArtistDetail } };
  try {
    data = await geniusFetch(`/artists/${encodeURIComponent(String(id))}`, apiKey);
  } catch (err) {
    if (err instanceof GeniusAuthError) return { error: err.message };
    if (err instanceof GeniusNotFoundError) return { error: 'artist not found', id };
    throw err;
  }
  const a = data.response?.artist;
  if (!a) return { error: 'artist not found', id };
  return {
    id: a.id,
    name: a.name,
    url: a.url,
    image: a.image_url,
    followers: a.followers_count,
    alternate_names: a.alternate_names,
    about: truncate(a.description?.plain),
  };
}

interface ArtistSong {
  id?: number;
  title?: string;
  full_title?: string;
  primary_artist?: ArtistRef;
  url?: string;
}

async function artistSongs(artistId: number | string, limit: number | undefined, apiKey: string) {
  let perPage = typeof limit === 'number' && limit > 0 ? limit : 20;
  if (perPage > 50) perPage = 50;
  let data: { response?: { songs?: ArtistSong[] } };
  try {
    data = await geniusFetch(
      `/artists/${encodeURIComponent(String(artistId))}/songs?sort=popularity&per_page=${encodeURIComponent(String(perPage))}`,
      apiKey,
    );
  } catch (err) {
    if (err instanceof GeniusAuthError) return { error: err.message };
    throw err;
  }
  const songs = (data.response?.songs ?? []).map((s) => ({
    id: s.id,
    title: s.full_title,
    artist: s.primary_artist?.name,
    url: s.url,
  }));
  return { artist_id: artistId, count: songs.length, songs };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
