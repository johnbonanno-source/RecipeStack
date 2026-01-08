namespace RecipeApi.Contracts;

public sealed record GenerateAiRecipesRequest(IReadOnlyList<int> IngredientIds, int? MaxRecipes, string? Notes);
