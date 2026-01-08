using Microsoft.EntityFrameworkCore;
using System.Globalization;
using RecipeApi.Ai;
using RecipeApi.Contracts;
using RecipeApi.Data;
using RecipeApi.Models;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.AllowAnyHeader().AllowAnyMethod().AllowAnyOrigin());
});

var connectionString = builder.Configuration.GetConnectionString("Default");
if (string.IsNullOrWhiteSpace(connectionString))
{
    throw new InvalidOperationException("Missing connection string 'ConnectionStrings:Default'.");
}

builder.Services.AddDbContext<RecipeDbContext>(options => options.UseNpgsql(connectionString));

var ollamaBaseUrl = builder.Configuration["Ollama:BaseUrl"]
    ?? builder.Configuration["OLLAMA_BASE_URL"]
    ?? "https://ollama.com";

var ollamaModel = builder.Configuration["Ollama:Model"]
    ?? builder.Configuration["OLLAMA_MODEL"]
    ?? "gemini-3-flash-preview:cloud";

var ollamaApiKey = builder.Configuration["Ollama:ApiKey"]
    ?? builder.Configuration["OLLAMA_API_KEY"];

builder.Services.AddSingleton(new OllamaConfig(new Uri(ollamaBaseUrl), ollamaModel, ollamaApiKey));
builder.Services.AddHttpClient<OllamaChatClient>((sp, client) =>
{
    var config = sp.GetRequiredService<OllamaConfig>();
    client.BaseAddress = config.BaseUri;
    client.Timeout = TimeSpan.FromSeconds(120);
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors();

await NormalizeExistingIngredientsAsync(app.Services);

if (args.Contains("--migrate"))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<RecipeDbContext>();

    await db.Database.MigrateAsync();

    if (args.Contains("--seed"))
    {
        await SeedDataAsync(db);
    }

    return;
}

app.MapGet("/healthz", () => Results.Ok(new { status = "ok" }));

var api = app.MapGroup("/api");

api.MapGet("/ingredients", async (RecipeDbContext db) =>
{
    var ingredients = await db.Ingredients
        .AsNoTracking()
        .OrderBy(i => i.Name)
        .Select(i => new IngredientDto(i.Id, i.Name))
        .ToListAsync();

    return Results.Ok(ingredients);
});

api.MapPost("/ingredients", async (RecipeDbContext db, CreateIngredientRequest request) =>
{
    var name = NormalizeIngredientName(request.Name);
    if (string.IsNullOrWhiteSpace(name))
    {
        return Results.BadRequest(new { message = "Name is required." });
    }

    var ingredient = new Ingredient { Name = name };
    db.Ingredients.Add(ingredient);

    try
    {
        await db.SaveChangesAsync();
    }
    catch (DbUpdateException)
    {
        return Results.Conflict(new { message = "Ingredient already exists." });
    }

    return Results.Created($"/api/ingredients/{ingredient.Id}", new IngredientDto(ingredient.Id, ingredient.Name));
});

api.MapGet("/recipes", async (RecipeDbContext db) =>
{
    var recipes = await db.Recipes
        .AsNoTracking()
        .OrderBy(r => r.Name)
        .Select(r => new RecipeDto(
            r.Id,
            r.Name,
            r.Instructions,
            r.RecipeIngredients
                .OrderBy(ri => ri.Ingredient.Name)
                .Select(ri => new RecipeIngredientDto(ri.IngredientId, ri.Ingredient.Name, ri.Quantity, ri.Unit))
                .ToList()))
        .ToListAsync();

    return Results.Ok(recipes);
});

api.MapGet("/recipes/{id:int}", async (RecipeDbContext db, int id) =>
{
    var recipe = await db.Recipes
        .AsNoTracking()
        .Where(r => r.Id == id)
        .Select(r => new RecipeDto(
            r.Id,
            r.Name,
            r.Instructions,
            r.RecipeIngredients
                .OrderBy(ri => ri.Ingredient.Name)
                .Select(ri => new RecipeIngredientDto(ri.IngredientId, ri.Ingredient.Name, ri.Quantity, ri.Unit))
                .ToList()))
        .FirstOrDefaultAsync();

    return recipe is null ? Results.NotFound() : Results.Ok(recipe);
});

api.MapPost("/recipes", async (RecipeDbContext db, CreateRecipeRequest request) =>
{
    var name = request.Name.Trim();
    if (string.IsNullOrWhiteSpace(name))
    {
        return Results.BadRequest(new { message = "Name is required." });
    }

    var requestedIngredients = request.Ingredients?.Where(i => i.IngredientId > 0).ToList() ?? [];
    if (requestedIngredients.Count == 0)
    {
        return Results.BadRequest(new { message = "At least one ingredient is required." });
    }

    var ingredientIds = requestedIngredients.Select(i => i.IngredientId).Distinct().ToArray();
    var existingIngredientIds = await db.Ingredients
        .AsNoTracking()
        .Where(i => ingredientIds.Contains(i.Id))
        .Select(i => i.Id)
        .ToListAsync();

    var missingIngredientIds = ingredientIds.Except(existingIngredientIds).ToArray();
    if (missingIngredientIds.Length > 0)
    {
        return Results.BadRequest(new { message = "Unknown ingredient IDs.", missingIngredientIds });
    }

    var recipe = new Recipe
    {
        Name = name,
        Instructions = string.IsNullOrWhiteSpace(request.Instructions) ? null : request.Instructions.Trim(),
    };

    foreach (var ingredient in requestedIngredients)
    {
        recipe.RecipeIngredients.Add(new RecipeIngredient
        {
            IngredientId = ingredient.IngredientId,
            Quantity = ingredient.Quantity,
            Unit = string.IsNullOrWhiteSpace(ingredient.Unit) ? null : ingredient.Unit.Trim(),
        });
    }

    db.Recipes.Add(recipe);

    try
    {
        await db.SaveChangesAsync();
    }
    catch (DbUpdateException)
    {
        return Results.Conflict(new { message = "Recipe already exists." });
    }

    var created = await db.Recipes
        .AsNoTracking()
        .Where(r => r.Id == recipe.Id)
        .Select(r => new RecipeDto(
            r.Id,
            r.Name,
            r.Instructions,
            r.RecipeIngredients
                .OrderBy(ri => ri.Ingredient.Name)
                .Select(ri => new RecipeIngredientDto(ri.IngredientId, ri.Ingredient.Name, ri.Quantity, ri.Unit))
                .ToList()))
        .FirstAsync();

    return Results.Created($"/api/recipes/{created.Id}", created);
});

api.MapGet("/recipes/can-make", async (RecipeDbContext db, int[] ingredientIds) =>
{
    var have = ingredientIds.Distinct().ToArray();
    if (have.Length == 0)
    {
        return Results.Ok(Array.Empty<RecipeSummaryDto>());
    }

    var recipes = await db.Recipes
        .AsNoTracking()
        .Where(r => !r.RecipeIngredients.Any(ri => !have.Contains(ri.IngredientId)))
        .OrderBy(r => r.Name)
        .Select(r => new RecipeSummaryDto(r.Id, r.Name))
        .ToListAsync();

    return Results.Ok(recipes);
});

api.MapPost("/ai/recipes", async (
    RecipeDbContext db,
    OllamaChatClient ollama,
    GenerateAiRecipesRequest request,
    CancellationToken cancellationToken) =>
{
    if (request.IngredientIds is null || request.IngredientIds.Count == 0)
    {
        return Results.BadRequest(new { message = "Provide at least one ingredientId." });
    }

    var ingredientIds = request.IngredientIds.Distinct().ToArray();
    var ingredientNames = await db.Ingredients
        .AsNoTracking()
        .Where(i => ingredientIds.Contains(i.Id))
        .OrderBy(i => i.Name)
        .Select(i => i.Name)
        .ToListAsync(cancellationToken);

    if (ingredientNames.Count != ingredientIds.Length)
    {
        return Results.BadRequest(new { message = "One or more ingredientIds are invalid." });
    }

    var maxRecipes = request.MaxRecipes is >= 1 and <= 10 ? request.MaxRecipes.Value : 5;

    var systemPrompt =
        "You are a practical cooking assistant. " +
        "Only suggest recipes that can be made using ONLY the provided ingredients plus common pantry staples " +
        "(salt, pepper, water, and neutral cooking oil). " +
        "Keep steps short and clear. " +
        "Return plain text only (no code blocks, no markdown fences, no ASCII art).";

    var userPrompt =
        $"Ingredients I have:\n- {string.Join("\n- ", ingredientNames)}\n\n" +
        $"Suggest up to {maxRecipes} recipes. For each recipe include:\n" +
        "1) Name\n2) Ingredients used (subset of my ingredients + pantry staples)\n3) Steps (3-6 steps)\n";

    if (!string.IsNullOrWhiteSpace(request.Notes))
    {
        userPrompt += $"\nNotes/preferences:\n{request.Notes.Trim()}\n";
    }

    try
    {
        var result = await ollama.ChatAsync(
            [
                new OllamaChatMessage("system", systemPrompt),
                new OllamaChatMessage("user", userPrompt),
            ],
            cancellationToken);

        return Results.Ok(new GenerateAiRecipesResponse(result.Model, result.Content));
    }
    catch (InvalidOperationException ex)
    {
        return Results.Problem(ex.Message, statusCode: StatusCodes.Status503ServiceUnavailable);
    }
    catch (HttpRequestException ex)
    {
        return Results.Problem(ex.Message, statusCode: StatusCodes.Status502BadGateway);
    }
})
.WithOpenApi();

app.Run();

static string NormalizeIngredientName(string raw)
{
    var cleaned = (raw ?? string.Empty).Trim();
    if (cleaned.Length == 0) return string.Empty;

    cleaned = cleaned.Replace("  ", " ");
    var text = CultureInfo.InvariantCulture.TextInfo;
    return text.ToTitleCase(cleaned.ToLowerInvariant());
}

static async Task NormalizeExistingIngredientsAsync(IServiceProvider services)
{
    using var scope = services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<RecipeDbContext>();

    var ingredients = await db.Ingredients.ToListAsync();
    var updated = false;
    foreach (var ingredient in ingredients)
    {
        var normalized = NormalizeIngredientName(ingredient.Name);
        if (!string.Equals(ingredient.Name, normalized, StringComparison.Ordinal))
        {
            ingredient.Name = normalized;
            updated = true;
        }
    }

    if (updated)
    {
        await db.SaveChangesAsync();
    }
}

static async Task SeedDataAsync(RecipeDbContext db)
{
    if (await db.Ingredients.AnyAsync() || await db.Recipes.AnyAsync())
    {
        return;
    }

    var ingredients = new[]
    {
        new Ingredient { Name = "Flour" },
        new Ingredient { Name = "Eggs" },
        new Ingredient { Name = "Milk" },
        new Ingredient { Name = "Sugar" },
        new Ingredient { Name = "Butter" },
        new Ingredient { Name = "Salt" },
        new Ingredient { Name = "Tomato" },
        new Ingredient { Name = "Basil" },
        new Ingredient { Name = "Garlic" },
        new Ingredient { Name = "Olive Oil" },
        new Ingredient { Name = "Pasta" },
    };

    db.Ingredients.AddRange(ingredients);

    var byName = ingredients.ToDictionary(i => i.Name);

    var pancakes = new Recipe
    {
        Name = "Pancakes",
        Instructions = "Mix ingredients, then cook on a lightly buttered skillet until golden.",
        RecipeIngredients =
        {
            new RecipeIngredient { Ingredient = byName["Flour"], Quantity = 200, Unit = "g" },
            new RecipeIngredient { Ingredient = byName["Eggs"], Quantity = 2, Unit = "pcs" },
            new RecipeIngredient { Ingredient = byName["Milk"], Quantity = 300, Unit = "ml" },
            new RecipeIngredient { Ingredient = byName["Butter"], Quantity = 30, Unit = "g" },
            new RecipeIngredient { Ingredient = byName["Sugar"], Quantity = 20, Unit = "g" },
            new RecipeIngredient { Ingredient = byName["Salt"], Quantity = 1, Unit = "tsp" },
        },
    };

    var tomatoPasta = new Recipe
    {
        Name = "Tomato Basil Pasta",
        Instructions = "Cook pasta. Sauté garlic in olive oil, add tomatoes, toss with pasta, finish with basil and salt.",
        RecipeIngredients =
        {
            new RecipeIngredient { Ingredient = byName["Pasta"], Quantity = 200, Unit = "g" },
            new RecipeIngredient { Ingredient = byName["Tomato"], Quantity = 3, Unit = "pcs" },
            new RecipeIngredient { Ingredient = byName["Garlic"], Quantity = 2, Unit = "cloves" },
            new RecipeIngredient { Ingredient = byName["Olive Oil"], Quantity = 2, Unit = "tbsp" },
            new RecipeIngredient { Ingredient = byName["Basil"], Quantity = 10, Unit = "leaves" },
            new RecipeIngredient { Ingredient = byName["Salt"], Quantity = 1, Unit = "tsp" },
        },
    };

    db.Recipes.AddRange(pancakes, tomatoPasta);

    await db.SaveChangesAsync();
}
