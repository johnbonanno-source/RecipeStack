namespace RecipeApi.Contracts;

public sealed record CreateRecipeIngredientRequest(int IngredientId, decimal? Quantity, string? Unit);

public sealed record CreateRecipeRequest(
    string Name,
    string? Instructions,
    IReadOnlyList<CreateRecipeIngredientRequest>? Ingredients);
