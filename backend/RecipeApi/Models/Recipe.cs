namespace RecipeApi.Models;

public sealed class Recipe
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public string? Instructions { get; set; }
    public ICollection<RecipeIngredient> RecipeIngredients { get; set; } = [];
}
