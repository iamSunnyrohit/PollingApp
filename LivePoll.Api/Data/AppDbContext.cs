using LivePoll.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace LivePoll.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Poll> Polls => Set<Poll>();
    public DbSet<Option> Options => Set<Option>();
    public DbSet<Vote> Votes => Set<Vote>();
    public DbSet<User> Users => Set<User>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Poll>()
            .HasIndex(p => p.Code)
            .IsUnique();

        modelBuilder.Entity<Vote>()
            .HasIndex(v => new { v.PollId, v.VoterId })
            .IsUnique();
    }
}