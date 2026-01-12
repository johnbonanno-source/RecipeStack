using Microsoft.EntityFrameworkCore;
using RecipeApi.Models;

namespace RecipeApi.Data;

public sealed class RecipeDbContext(DbContextOptions<RecipeDbContext> options) : DbContext(options)
{
    public DbSet<Ingredient> Ingredients => Set<Ingredient>();
    public DbSet<Recipe> Recipes => Set<Recipe>();
    public DbSet<RecipeIngredient> RecipeIngredients => Set<RecipeIngredient>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Ingredient>(entity =>
        {
            entity.Property(i => i.Name).HasMaxLength(200);
            entity.Property(i => i.Location)
                .HasConversion<string>()
                .HasMaxLength(16)
                .HasDefaultValue(StorageLocation.Pantry);
            entity.HasIndex(i => i.Name).IsUnique();
        });

        modelBuilder.Entity<Recipe>(entity =>
        {
            entity.Property(r => r.Name).HasMaxLength(200);
            entity.HasIndex(r => r.Name).IsUnique();
        });

        modelBuilder.Entity<RecipeIngredient>(entity =>
        {
            entity.HasKey(ri => new { ri.RecipeId, ri.IngredientId });
            entity.Property(ri => ri.Quantity).HasColumnType("numeric(10,2)");
            entity.Property(ri => ri.Unit).HasMaxLength(32);

            entity.HasOne(ri => ri.Recipe)
                .WithMany(r => r.RecipeIngredients)
                .HasForeignKey(ri => ri.RecipeId);

            entity.HasOne(ri => ri.Ingredient)
                .WithMany(i => i.RecipeIngredients)
                .HasForeignKey(ri => ri.IngredientId);
        });
    }
}
