namespace RecipeApi.Models;

public sealed class Ingredient
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public ICollection<RecipeIngredient> RecipeIngredients { get; set; } = [];
}
