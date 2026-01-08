import { useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost } from './api.js'

function parseAiRecipes(text) {
  if (!text?.trim()) return []

  const sections = text
    .split(/\n\s*\n(?=Recipe\b|[A-Z])/i)
    .map((b) => b.trim())
    .filter(Boolean)

  const recipes = sections.map((block, idx) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    let title = lines.shift() || `Recipe ${idx + 1}`

    // Normalize title like "Recipe 1: Carbonara" -> "Carbonara"
    const match = title.match(/^recipe\s*\d*[:.\-]?\s*(.+)$/i)
    if (match?.[1]) title = match[1].trim()

    let ingredients = []
    let steps = []
    const rest = []

    for (const line of lines) {
      if (/^ingredients?\s*:/i.test(line)) {
        const after = line.replace(/^ingredients?\s*:/i, '').trim()
        if (after) {
          ingredients = after.split(/[,;]\s*/).filter(Boolean)
        }
      } else if (/^\d+\./.test(line)) {
        steps.push(line.replace(/^\d+\.\s*/, '').trim())
      } else {
        rest.push(line)
      }
    }

    // If steps were not numbered, attempt to split on sentences.
    if (steps.length === 0 && rest.length) {
      const joined = rest.join(' ')
      steps = joined
        .split(/(?<=\.)\s+(?=[A-Z])/)
        .map((s) => s.trim())
        .filter(Boolean)
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

  async function refresh() {
    const [i, r] = await Promise.all([apiGet('/api/ingredients'), apiGet('/api/recipes')])
    setIngredients(i)
    setRecipes(r)
  }

  async function onAddIngredient(e) {
    e.preventDefault()
    setError('')
    try {
      await apiPost('/api/ingredients', { name: ingredientName })
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

  function onSaveAiRecipe(recipe) {
    const newId = -(Date.now())
    const ingredientsForSave =
      recipe.ingredients?.length
        ? recipe.ingredients.map((name, idx) => ({
            ingredientId: newId * 100 - idx,
            name,
            quantity: null,
            unit: null,
          }))
        : []

    const instructions =
      recipe.steps?.length && recipe.steps.length > 0
        ? recipe.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
        : recipe.fallback ?? ''

    setRecipes((prev) => [
      ...prev,
      {
        id: newId,
        name: recipe.title || 'Recipe',
        instructions,
        ingredients: ingredientsForSave,
      },
    ])
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
              <span className="muted">{ingredients.length} total</span>
            </div>

            <form onSubmit={onAddIngredient} className="row">
              <input
                value={ingredientName}
                onChange={(e) => setIngredientName(e.target.value)}
                placeholder="Add ingredient (e.g., Onion)"
              />
              <button type="submit">Add</button>
            </form>

            <div className="list">
              {ingredients.map((i) => (
                <label key={i.id} className="checkbox">
                  <input type="checkbox" checked={pantry.has(i.id)} onChange={() => togglePantry(i.id)} />
                  <span>{i.name}</span>
                </label>
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
              <div className="muted">No AI output yet.</div>
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
                {recipes.map((r) => (
                  <details key={r.id} className="recipeItem">
                    <summary className="recipeSummary">{r.name}</summary>
                    {r.instructions ? <p className="instructions">{r.instructions}</p> : null}
                    <ul className="ul">
                      {r.ingredients.map((i) => (
                        <li key={i.ingredientId}>
                          {i.name}
                          {i.quantity == null ? '' : ` · ${i.quantity}`}
                          {i.unit ? ` ${i.unit}` : ''}
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
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
