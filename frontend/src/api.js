const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

export async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(await safeMessage(res))
  return res.json()
}

export async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await safeMessage(res))
  return res.status === 204 ? null : res.json()
}

export async function apiDelete(path) {
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await safeMessage(res))
  return null
}

async function safeMessage(res) {
  try {
    const text = await res.text()
    return text || `${res.status} ${res.statusText}`
  } catch {
    return `${res.status} ${res.statusText}`
  }
}
