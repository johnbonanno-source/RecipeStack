namespace RecipeApi.Contracts;

public sealed record RecipeIngredientDto(int IngredientId, string Name, decimal? Quantity, string? Unit);

public sealed record RecipeDto(int Id, string Name, string? Instructions, IReadOnlyList<RecipeIngredientDto> Ingredients);

public sealed record RecipeSummaryDto(int Id, string Name);
