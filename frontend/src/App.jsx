import { useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost } from './api.js'

const sentenceSplitRegex = /(?<=[.!?])\s+(?=[A-Z0-9])/

function splitSentences(text) {
  if (!text?.trim()) return []
  return text
    .split(sentenceSplitRegex)
    .map((s) => s.trim())
    .filter(Boolean)
}

function titleCaseWords(value) {
  return value
    .trim()
    .split(/\s+/)
    .map((word) =>
      word
        .split('-')
        .map((part) => {
          const lower = part.toLowerCase()
          return lower ? lower[0].toUpperCase() + lower.slice(1) : lower
        })
        .join('-'),
    )
    .join(' ')
}

function normalizeIngredientDisplay(value) {
  const trimmed = value.trim().replace(/\.+$/, '')
  if (!trimmed) return ''
  return titleCaseWords(trimmed)
}

function parseProcedure(text) {
  if (!text?.trim()) return []
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const numbered = lines
    .map((line) => line.match(/^\d+\.\s*(.+)$/))
    .filter(Boolean)
    .map((match) => match[1].trim())

  if (numbered.length) return numbered

  const joined = lines.join(' ')
  return splitSentences(joined)
}

function parseAiRecipes(text) {
  if (!text?.trim()) return []

  const lines = text.split(/\r?\n/)
  const blocks = []
  let current = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (/^recipe\b/i.test(trimmed) && current.length) {
      blocks.push(current)
      current = [trimmed]
      continue
    }

    current.push(trimmed)
  }

  if (current.length) blocks.push(current)

  const recipes = (blocks.length ? blocks : [lines])
    .map((block) => block.filter((line) => line.trim().length > 0))
    .map((block, idx) => {
      const lines = [...block]
      let titleLine = lines.shift() || `Recipe ${idx + 1}`
      const titleMatch = titleLine.match(/^(?:recipe|name)\s*\d*[:.\-]?\s*(.+)$/i)
      const title = titleMatch?.[1]?.trim() || titleLine

      let ingredients = []
      let steps = []
      const rest = []
      let section = null

      const pushIngredient = (value) => {
        const normalized = normalizeIngredientDisplay(value)
        if (normalized) ingredients.push(normalized)
      }

      for (const line of lines) {
        const inlineIngredients = line.match(/^ingredients?\s*:\s*(.+)$/i)
        if (inlineIngredients?.[1]) {
          ingredients = inlineIngredients[1]
            .split(/[,;]\s*/)
            .map((item) => item.trim())
            .filter(Boolean)
            .map(normalizeIngredientDisplay)
          section = 'ingredients'
          continue
        }

        const inlineProcedure = line.match(/^(procedure|steps?|method)\s*:\s*(.+)$/i)
        if (inlineProcedure?.[2]) {
          steps = splitSentences(inlineProcedure[2])
          section = 'steps'
          continue
        }

        if (/^ingredients?\b/i.test(line)) {
          section = 'ingredients'
          continue
        }

        if (/^(procedure|steps?|method)\b/i.test(line)) {
          section = 'steps'
          continue
        }

        if (section === 'ingredients') {
          const cleaned = line.replace(/^[-*]\s*/, '').trim()
          if (!cleaned) continue
          if (cleaned.includes(',') && !/^[-*]/.test(line)) {
            cleaned
              .split(/[,;]\s*/)
              .map((item) => item.trim())
              .filter(Boolean)
              .forEach(pushIngredient)
          } else {
            pushIngredient(cleaned)
          }
          continue
        }

        if (section === 'steps') {
          const numbered = line.match(/^\d+\.\s*(.+)$/)
          if (numbered?.[1]) {
            steps.push(numbered[1].trim())
            continue
          }

          const bullet = line.replace(/^[-*]\s*/, '').trim()
          if (bullet) {
            steps.push(bullet)
            continue
          }
        }

        rest.push(line)
      }

      if (steps.length === 0 && rest.length) {
        steps = splitSentences(rest.join(' '))
      }

      return {
        title: title || `Recipe ${idx + 1}`,
        ingredients,
        steps,
        fallback: rest.join('\n'),
      }
    })

  return recipes.length ? recipes : [{ title: 'Recipe', ingredients: [], steps: [], fallback: text.trim() }]
}

const storageLocations = ['Fridge', 'Pantry', 'Freezer']
const ingredientViews = [...storageLocations, 'Manual Entry']

export default function App() {
  const [ingredients, setIngredients] = useState([])
  const [recipes, setRecipes] = useState([])
  const [aiModel, setAiModel] = useState('')
  const [aiContent, setAiContent] = useState('')
  const [aiNotes, setAiNotes] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  const [ingredientName, setIngredientName] = useState('')
  const [recipeName, setRecipeName] = useState('')
  const [recipeInstructions, setRecipeInstructions] = useState('')
  const [recipeIngredientId, setRecipeIngredientId] = useState('')
  const [recipeIngredientQty, setRecipeIngredientQty] = useState('')
  const [recipeIngredientUnit, setRecipeIngredientUnit] = useState('')
  const [recipeIngredients, setRecipeIngredients] = useState([])

  const [activeView, setActiveView] = useState('Manual Entry')
  const [manualLocation, setManualLocation] = useState('Pantry')

  const [pantry, setPantry] = useState(() => new Set())
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const [i, r] = await Promise.all([apiGet('/api/ingredients'), apiGet('/api/recipes')])
        setIngredients(i)
        setRecipes(r)
      } catch (e) {
        setError(e?.message ?? String(e))
      }
    })()
  }, [])

  const pantryIds = useMemo(() => Array.from(pantry.values()).sort((a, b) => a - b), [pantry])
  const ingredientsByLocation = useMemo(() => {
    const grouped = Object.fromEntries(storageLocations.map((location) => [location, []]))
    for (const item of ingredients) {
      const location = storageLocations.includes(item.location) ? item.location : 'Pantry'
      grouped[location].push(item)
    }
    for (const location of storageLocations) {
      grouped[location].sort((a, b) => a.name.localeCompare(b.name))
    }
    return grouped
  }, [ingredients])
  const locationCounts = useMemo(
    () => storageLocations.map((location) => `${location} ${ingredientsByLocation[location].length}`).join(' · '),
    [ingredientsByLocation],
  )

  async function refresh() {
    const [i, r] = await Promise.all([apiGet('/api/ingredients'), apiGet('/api/recipes')])
    setIngredients(i)
    setRecipes(r)
  }

  async function onAddIngredient(e) {
    e.preventDefault()
    setError('')
    try {
      await apiPost('/api/ingredients', { name: ingredientName, location: manualLocation })
      setIngredientName('')
      await refresh()
    } catch (e) {
      setError(e?.message ?? String(e))
    }
  }

  function addRecipeIngredient() {
    setError('')
    const id = Number(recipeIngredientId)
    if (!id) return
    if (recipeIngredients.some((x) => x.ingredientId === id)) return

    const quantity = recipeIngredientQty.trim() === '' ? null : Number(recipeIngredientQty)
    const unit = recipeIngredientUnit.trim() === '' ? null : recipeIngredientUnit.trim()

    setRecipeIngredients((prev) => [...prev, { ingredientId: id, quantity, unit }])
    setRecipeIngredientId('')
    setRecipeIngredientQty('')
    setRecipeIngredientUnit('')
  }

  function removeRecipeIngredient(id) {
    setRecipeIngredients((prev) => prev.filter((x) => x.ingredientId !== id))
  }

  async function onCreateRecipe(e) {
    e.preventDefault()
    setError('')
    try {
      await apiPost('/api/recipes', {
        name: recipeName,
        instructions: recipeInstructions,
        ingredients: recipeIngredients,
      })
      setRecipeName('')
      setRecipeInstructions('')
      setRecipeIngredients([])
      await refresh()
    } catch (e) {
      setError(e?.message ?? String(e))
    }
  }

  function togglePantry(id) {
    setPantry((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function onGenerateAiRecipes() {
    setError('')
    setAiLoading(true)
    try {
      const result = await apiPost('/api/ai/recipes', {
        ingredientIds: pantryIds,
        maxRecipes: 5,
        notes: aiNotes,
      })
      setAiModel(result.model ?? '')
      setAiContent(result.content ?? '')
    } catch (e) {
      setError(e?.message ?? String(e))
    } finally {
      setAiLoading(false)
    }
  }

  const aiRecipes = useMemo(() => parseAiRecipes(aiContent), [aiContent])

  async function ensureIngredientIds(names) {
    const cleaned = names.map((name) => name.trim()).filter(Boolean)
    const unique = Array.from(new Set(cleaned))

    if (unique.length === 0) return []

    let current = ingredients
    const toMap = (list) => new Map(list.map((item) => [item.name.toLowerCase(), item]))
    let map = toMap(current)

    const missing = unique.filter((name) => !map.has(name.toLowerCase()))
    let needsRefresh = false

    for (const name of missing) {
      try {
        const created = await apiPost('/api/ingredients', { name })
        current = [...current, created]
        map.set(created.name.toLowerCase(), created)
      } catch {
        needsRefresh = true
      }
    }

    if (needsRefresh) {
      current = await apiGet('/api/ingredients')
      map = toMap(current)
    }

    setIngredients(current)

    const ids = unique
      .map((name) => map.get(name.toLowerCase())?.id)
      .filter((id) => Number.isInteger(id))

    if (ids.length !== unique.length) {
      throw new Error('Could not match all ingredients for saving.')
    }

    return ids
  }

  async function onSaveAiRecipe(recipe) {
    setError('')
    try {
      const ingredientNames = recipe.ingredients?.map((name) => name.trim()).filter(Boolean) ?? []
      if (ingredientNames.length === 0) {
        throw new Error('AI recipe is missing an ingredient list.')
      }

      const ingredientIds = await ensureIngredientIds(ingredientNames)
      const instructions =
        recipe.steps?.length && recipe.steps.length > 0
          ? recipe.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
          : recipe.fallback?.trim() ?? ''

      await apiPost('/api/recipes', {
        name: recipe.title?.trim() || 'Recipe',
        instructions: instructions.length ? instructions : null,
        ingredients: ingredientIds.map((id) => ({
          ingredientId: id,
          quantity: null,
          unit: null,
        })),
      })

      await refresh()
    } catch (e) {
      setError(e?.message ?? String(e))
    }
  }

  return (
    <div className="page">
      <header className="siteHeader">
        <div className="topStrip">
          <div className="topStripInner">
            <a href="#ingredients">INGREDIENTS</a>
            <a href="#ai">ASK AI</a>
            <a href="#saved">SAVED RECIPES</a>
          </div>
        </div>

        <div className="masthead">
          <div className="logo">RecipeStack</div>
          <div className="tagline">Curated recipes from what you already have.</div>
        </div>

        <div className="rule" />
      </header>

      <main className="container">

        {error ? (
          <div className="error" role="alert">
            {error}
          </div>
        ) : null}

        <div className="grid">
          <section id="ingredients" className="card">
            <div className="cardTitle">
              <h2>Ingredients</h2>
              <span className="muted">
                {activeView === 'Manual Entry' ? locationCounts : `${activeView} Photo`}
              </span>
            </div>

            {activeView === 'Manual Entry' ? (
              <>
                <form onSubmit={onAddIngredient} className="ingredientAddRow">
                  <input
                    value={ingredientName}
                    onChange={(e) => setIngredientName(e.target.value)}
                    placeholder="Add ingredient (e.g., Onion)"
                  />
                  <select value={manualLocation} onChange={(e) => setManualLocation(e.target.value)}>
                    {storageLocations.map((location) => (
                      <option key={location} value={location}>
                        {location}
                      </option>
                    ))}
                  </select>
                  <button type="submit">Add</button>
                </form>

                <div className="ingredientColumns">
                  {storageLocations.map((location) => (
                    <div key={location} className="ingredientColumn">
                      <div className="ingredientColumnHeader">{location}</div>
                      <div className="ingredientList">
                        {ingredientsByLocation[location].length === 0 ? (
                          <div className="muted ingredientEmpty">No items</div>
                        ) : (
                          ingredientsByLocation[location].map((i) => (
                            <label key={i.id} className="checkbox">
                              <input type="checkbox" checked={pantry.has(i.id)} onChange={() => togglePantry(i.id)} />
                              <span>{i.name}</span>
                            </label>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="uploadPanel">
                <div className="uploadCard">
                  <svg className="uploadIcon" viewBox="0 0 120 80" role="img" aria-label="Upload">
                    <path
                      d="M84 60H35c-10 0-18-8-18-18 0-9 6-16 14-18 3-11 14-18 26-18 13 0 24 8 27 20 10 1 18 9 18 20 0 9-8 16-18 16z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="4"
                      strokeLinejoin="round"
                    />
                    <path d="M60 24v28M60 24l-10 10M60 24l10 10" fill="none" stroke="currentColor" strokeWidth="4" />
                  </svg>
                  <div className="uploadTitle">Drag files to upload</div>
                  <div className="uploadSubtitle">or</div>
                  <label className="uploadButton">
                    Select files to upload
                    <input type="file" accept="image/*" />
                  </label>
                </div>
              </div>
            )}

            <div className="ingredientTabs">
              {ingredientViews.map((view) => (
                <button
                  key={view}
                  type="button"
                  className={`ingredientTab${view === activeView ? ' active' : ''}`}
                  onClick={() => setActiveView(view)}
                  aria-pressed={view === activeView}
                >
                  {view}
                </button>
              ))}
            </div>
          </section>

          <section id="ai" className="card">
            <div className="cardTitle">
              <h2>Ask AI</h2>
              <span className="muted">{aiModel ? `Model: ${aiModel}` : 'Ollama Cloud'}</span>
            </div>

            <p className="muted">Select ingredients, add notes, then generate recipes.</p>

            <div className="aiCenter">
              <textarea
                className="aiTextarea"
                value={aiNotes}
                onChange={(e) => setAiNotes(e.target.value)}
                placeholder="Optional notes (diet, cuisine, constraints)…"
                rows={3}
              />

              <button className="aiButton" type="button" onClick={onGenerateAiRecipes} disabled={aiLoading || pantryIds.length === 0}>
                {aiLoading ? 'Generating…' : 'Generate'}
              </button>

              <div className="muted aiHint">{pantryIds.length === 0 ? 'Select ingredients first.' : `${pantryIds.length} selected`}</div>
            </div>

            {aiRecipes.length ? (
              <div className="aiMenu">
                {aiRecipes.map((r, idx) => (
                  <details key={`${r.title}-${idx}`} className="aiRecipeItem">
                    <summary className="aiRecipeSummary">{r.title}</summary>
                    <div className="aiRecipeBody">
                      {r.ingredients?.length ? (
                        <div className="aiSection">
                          <div className="aiSectionTitle">Ingredients</div>
                          <ul className="aiList">
                            {r.ingredients.map((ing, i) => (
                              <li key={i}>{ing}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {r.steps?.length ? (
                        <div className="aiSection">
                          <div className="aiSectionTitle">Procedure</div>
                          <ol className="aiList">
                            {r.steps.map((step, i) => (
                              <li key={i}>{step}</li>
                            ))}
                          </ol>
                        </div>
                      ) : null}

                      {!r.ingredients?.length && !r.steps?.length && r.fallback ? (
                        r.fallback.split('\n').map((line, i) => <p key={i}>{line}</p>)
                      ) : null}

                      <div className="aiButtonRow">
                        <button
                          type="button"
                          className="aiExplore"
                          onClick={() => console.log(`explore pressed: ${r.title}`)}
                        >
                          Explore this recipe
                        </button>
                        <button
                          type="button"
                          className="aiExplore"
                          onClick={() => onSaveAiRecipe(r)}
                        >
                          Save this recipe
                        </button>
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <div className="muted aiEmpty">No AI output yet.</div>
            )}
          </section>
        </div>

        <section id="saved" className="card">
          <details className="details" open>
            <summary className="summary">
              <span>Saved Recipes</span>
              <span className="badge">{recipes.length}</span>
            </summary>

            {recipes.length === 0 ? (
              <div className="muted">No recipes saved yet.</div>
            ) : (
              <div className="recipes">
                {recipes.map((r) => {
                  const procedure = parseProcedure(r.instructions)
                  return (
                    <details key={r.id} className="recipeItem">
                      <summary className="recipeSummary">{r.name}</summary>
                      <div className="recipeBody">
                        <div className="aiSection">
                          <div className="aiSectionTitle">Ingredients</div>
                          {r.ingredients.length ? (
                            <ul className="aiList">
                              {r.ingredients.map((i) => (
                                <li key={i.ingredientId}>
                                  {i.name}
                                  {i.quantity == null ? '' : ` · ${i.quantity}`}
                                  {i.unit ? ` ${i.unit}` : ''}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <div className="muted">No ingredients listed.</div>
                          )}
                        </div>

                        <div className="aiSection">
                          <div className="aiSectionTitle">Procedure</div>
                          {procedure.length ? (
                            <ol className="aiList">
                              {procedure.map((step, i) => (
                                <li key={i}>{step}</li>
                              ))}
                            </ol>
                          ) : (
                            <div className="muted">No procedure yet.</div>
                          )}
                        </div>
                      </div>
                    </details>
                  )
                })}
              </div>
            )}
          </details>

          <details className="details">
            <summary className="summary">Save a Recipe</summary>

            <form onSubmit={onCreateRecipe} className="stack">
              <input value={recipeName} onChange={(e) => setRecipeName(e.target.value)} placeholder="Recipe name" />
              <textarea
                value={recipeInstructions}
                onChange={(e) => setRecipeInstructions(e.target.value)}
                placeholder="Instructions (optional)"
                rows={4}
              />

              <div className="rowFields">
                <select value={recipeIngredientId} onChange={(e) => setRecipeIngredientId(e.target.value)}>
                  <option value="">Select ingredient…</option>
                  {ingredients.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
                <input
                  value={recipeIngredientQty}
                  onChange={(e) => setRecipeIngredientQty(e.target.value)}
                  placeholder="Qty"
                  inputMode="decimal"
                />
                <input value={recipeIngredientUnit} onChange={(e) => setRecipeIngredientUnit(e.target.value)} placeholder="Unit" />
                <button type="button" onClick={addRecipeIngredient}>
                  Add
                </button>
              </div>

              {recipeIngredients.length ? (
                <div className="pillList">
                  {recipeIngredients.map((ri) => {
                    const name = ingredients.find((x) => x.id === ri.ingredientId)?.name ?? `#${ri.ingredientId}`
                    const qty = ri.quantity == null ? '' : `${ri.quantity}`
                    const unit = ri.unit == null ? '' : ` ${ri.unit}`
                    return (
                      <div key={ri.ingredientId} className="pill">
                        <span>
                          {name}
                          {qty ? ` · ${qty}${unit}` : ''}
                        </span>
                        <button type="button" onClick={() => removeRecipeIngredient(ri.ingredientId)} aria-label={`Remove ${name}`}>
                          ×
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="muted">Add at least one ingredient.</div>
              )}

              <button type="submit" disabled={!recipeName.trim() || recipeIngredients.length === 0}>
                Save Recipe
              </button>
            </form>
          </details>
        </section>
      </main>
    </div>
  )
}
