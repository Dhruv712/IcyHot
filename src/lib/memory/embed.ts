/**
 * Voyage AI embedding — uses voyage-3 model (1024 dimensions).
 * Raw fetch, no SDK needed.
 */

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-3";
const MAX_BATCH_SIZE = 128; // Voyage limit per request

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY is not set");
  }

  const results: number[][] = [];

  // Batch into chunks of MAX_BATCH_SIZE
  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE);
    const embeddings = await fetchEmbeddings(apiKey, batch);
    results.push(...embeddings);
  }

  return results;
}

export async function embedSingle(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text]);
  return embedding;
}

async function fetchEmbeddings(
  apiKey: string,
  texts: string[],
  retries = 1
): Promise<number[][]> {
  const body = JSON.stringify({
    model: MODEL,
    input: texts,
    input_type: "document",
  });

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(VOYAGE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    });

    if (res.ok) {
      const json = (await res.json()) as {
        data: Array<{ embedding: number[]; index: number }>;
      };
      // Sort by index to preserve input order
      const sorted = json.data.sort((a, b) => a.index - b.index);
      return sorted.map((d) => d.embedding);
    }

    // Retry on 429 (rate limit) or 5xx
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const waitMs = res.status === 429 ? 2000 : 1000;
      console.warn(
        `[embed] Voyage API returned ${res.status}, retrying in ${waitMs}ms...`
      );
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    const errText = await res.text();
    throw new Error(
      `Voyage API error ${res.status}: ${errText.slice(0, 200)}`
    );
  }

  // Should never reach here due to throw above, but TypeScript needs it
  throw new Error("Voyage API: exhausted retries");
}
