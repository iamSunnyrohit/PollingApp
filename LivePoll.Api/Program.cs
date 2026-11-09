using LivePoll.Api.Data;
using LivePoll.Api.DTOs;
using LivePoll.Api.Hubs;
using LivePoll.Api.Models;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("DefaultConnection") ?? "Data Source=livepoll.db"));

builder.Services.AddSignalR();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowReactClient", policy =>
    {
        policy.WithOrigins("http://localhost:5173")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

var app = builder.Build();

app.UseCors("AllowReactClient");

app.MapGet("/health", () => Results.Ok(new { status = "Healthy", timestamp = DateTime.UtcNow }));

string GeneratePollCode()
{
    const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var random = new Random();
    return new string(Enumerable.Repeat(chars, 6).Select(s => s[random.Next(s.Length)]).ToArray());
}

async Task<PollResponseDto?> GetPollResponseAsync(AppDbContext db, string code)
{
    var poll = await db.Polls
        .Include(p => p.Options)
        .Include(p => p.Votes)
        .FirstOrDefaultAsync(p => p.Code.ToUpper() == code.ToUpper());

    if (poll is null) return null;

    var voteCounts = poll.Votes.GroupBy(v => v.OptionId).ToDictionary(g => g.Key, g => g.Count());

    return new PollResponseDto(
        poll.Id,
        poll.Code,
        poll.Question,
        poll.Status.ToString(),
        poll.OwnerId,
        poll.CreatedAt,
        poll.Options.OrderBy(o => o.Position).Select(o => new OptionResponseDto(
            o.Id,
            o.Text,
            o.Position,
            voteCounts.TryGetValue(o.Id, out var count) ? count : 0
        )).ToList()
    );
}

app.MapPost("/api/polls", async (CreatePollDto dto, AppDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(dto.Question) || dto.Options is null || dto.Options.Count < 2 || dto.Options.Count > 10)
    {
        return Results.BadRequest(new { error = "Question is required and options must be between 2 and 10." });
    }

    string code;
    bool exists;
    do
    {
        code = GeneratePollCode();
        exists = await db.Polls.AnyAsync(p => p.Code == code);
    } while (exists);

    var poll = new Poll
    {
        Code = code,
        Question = dto.Question,
        Status = PollStatus.Draft,
        OwnerId = "anonymous-host",
        Options = dto.Options.Select((text, index) => new Option
        {
            Text = text,
            Position = index + 1
        }).ToList()
    };

    db.Polls.Add(poll);
    await db.SaveChangesAsync();

    var response = await GetPollResponseAsync(db, poll.Code);
    return Results.Created($"/api/polls/{poll.Code}", response);
});

app.MapGet("/api/polls/{code}", async (string code, AppDbContext db) =>
{
    var response = await GetPollResponseAsync(db, code);
    if (response is null)
    {
        return Results.NotFound(new { error = "Poll not found." });
    }
    return Results.Ok(response);
});

app.MapPost("/api/polls/{code}/open", async (string code, AppDbContext db, IHubContext<PollHub> hubContext) =>
{
    var poll = await db.Polls.FirstOrDefaultAsync(p => p.Code.ToUpper() == code.ToUpper());
    if (poll is null) return Results.NotFound(new { error = "Poll not found." });
    if (poll.Status == PollStatus.Closed) return Results.BadRequest(new { error = "Cannot reopen a closed poll." });

    poll.Status = PollStatus.Open;
    poll.OpenedAt = DateTime.UtcNow;
    await db.SaveChangesAsync();

    var updatedPoll = await GetPollResponseAsync(db, code);
    await hubContext.Clients.Group(code.ToUpper()).SendAsync("ReceivePollUpdate", updatedPoll);

    return Results.Ok(new { message = "Poll is now open for voting.", status = poll.Status.ToString() });
});

app.MapPost("/api/polls/{code}/close", async (string code, AppDbContext db, IHubContext<PollHub> hubContext) =>
{
    var poll = await db.Polls.FirstOrDefaultAsync(p => p.Code.ToUpper() == code.ToUpper());
    if (poll is null) return Results.NotFound(new { error = "Poll not found." });

    poll.Status = PollStatus.Closed;
    poll.ClosedAt = DateTime.UtcNow;
    await db.SaveChangesAsync();

    var updatedPoll = await GetPollResponseAsync(db, code);
    await hubContext.Clients.Group(code.ToUpper()).SendAsync("ReceivePollUpdate", updatedPoll);

    return Results.Ok(new { message = "Poll voting is now closed.", status = poll.Status.ToString() });
});

app.MapPost("/api/polls/{code}/votes", async (string code, CastVoteDto dto, AppDbContext db, IHubContext<PollHub> hubContext) =>
{
    var poll = await db.Polls
        .Include(p => p.Options)
        .FirstOrDefaultAsync(p => p.Code.ToUpper() == code.ToUpper());

    if (poll is null) return Results.NotFound(new { error = "Poll not found." });
    if (poll.Status != PollStatus.Open) return Results.BadRequest(new { error = "Voting is not open for this poll." });
    if (string.IsNullOrWhiteSpace(dto.VoterId)) return Results.BadRequest(new { error = "VoterId is required." });

    if (!poll.Options.Any(o => o.Id == dto.OptionId))
    {
        return Results.BadRequest(new { error = "Invalid option for this poll." });
    }

    db.Votes.Add(new Vote
    {
        PollId = poll.Id,
        OptionId = dto.OptionId,
        VoterId = dto.VoterId,
   VoterName = string.IsNullOrWhiteSpace(dto.VoterName) ? "Anonymous" : dto.VoterName
    });

    try
    {
        await db.SaveChangesAsync();
    }
    catch (DbUpdateException)
    {
        return Results.Conflict(new { error = "You have already voted in this poll." });
    }

    var updatedPoll = await GetPollResponseAsync(db, code);
    await hubContext.Clients.Group(code.ToUpper()).SendAsync("ReceivePollUpdate", updatedPoll);

    return Results.Ok(new { message = "Vote recorded successfully." });
});

app.MapGet("/api/polls/{code}/votes", async (string code, AppDbContext db) =>
{
    var poll = await db.Polls
        .Include(p => p.Votes)
        .ThenInclude(v => v.Option)
        .FirstOrDefaultAsync(p => p.Code.ToUpper() == code.ToUpper());

    if (poll is null) return Results.NotFound(new { error = "Poll not found." });

    var voteRecords = poll.Votes.Select(v => new
    {
        v.VoterName,
        OptionText = v.Option.Text,
        v.VotedAt
    });

    return Results.Ok(voteRecords);
});

app.MapHub<PollHub>("/hubs/polls");

app.Run();