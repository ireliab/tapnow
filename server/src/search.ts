import { getSettings } from './store.js'

export interface SearchResult { title: string; url: string; snippet: string; date?: string }

/** Web search for the agent via Tavily or Brave (key in Settings → Web search). */
export async function webSearch(query: string, max = 5, signal?: AbortSignal): Promise<SearchResult[]> {
  const { provider, apiKey } = getSettings().search
  if (!apiKey) throw new Error('Web search is not configured — add a Tavily or Brave API key in Settings → Web search')
  const n = Math.min(Math.max(1, max), 10)
  if (provider === 'brave') {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q: query, count: String(n) })}`, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey }, signal,
    })
    if (!res.ok) throw new Error(`Brave search ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const data = await res.json() as any
    return (data.web?.results ?? []).slice(0, n).map((r: any) => ({
      title: r.title, url: r.url, snippet: String(r.description ?? '').replace(/<[^>]+>/g, ''), date: r.age ?? r.page_age,
    }))
  }
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, max_results: n, search_depth: 'basic' }),
  })
  if (!res.ok) throw new Error(`Tavily search ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json() as any
  return (data.results ?? []).map((r: any) => ({ title: r.title, url: r.url, snippet: String(r.content ?? '').slice(0, 400), date: r.published_date }))
}
