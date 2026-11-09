using LivePoll.Api.Data;
using LivePoll.Api.DTOs;
using LivePoll.Api.Hubs;
using LivePoll.Api.Models;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Security.Cryptography;


var builder = WebApplication.CreateBuilder(args);
var jwtKey = builder.Configuration["Jwt:Key"] ?? "SuperSecretKey_ChangeThisInProduction_123456";
var jwtIssuer = builder.Configuration["Jwt:Issuer"] ?? "LivePollApi";

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("DefaultConnection") ?? "Data Source=livepoll.db"));

builder.Services.AddSignalR();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtIssuer,
            ValidAudience = jwtIssuer,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey))
        };
    });

builder.Services.AddAuthorization();

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

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.EnsureCreatedAsync();
}

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
        IsAnonymous = dto.IsAnonymous,
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
        VoterName = poll.IsAnonymous ? "Anonymous Participant" : v.VoterName,
        OptionText = v.Option.Text,
        v.VotedAt
    });

    return Results.Ok(voteRecords);
});

app.MapPost("/api/auth/register", async (RegisterDto dto, AppDbContext db) =>
{
    if (await db.Users.AnyAsync(u => u.Username == dto.Username || u.Email == dto.Email))
    {
        return Results.BadRequest(new { error = "Username or Email already exists." });
    }

    var verificationToken = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));

    var user = new User
    {
        Username = dto.Username,
        Email = dto.Email,
        PasswordHash = BCrypt.Net.BCrypt.HashPassword(dto.Password),
        Role = string.IsNullOrWhiteSpace(dto.Role) ? "Student" : dto.Role,
        IsEmailVerified = false,
        EmailVerificationToken = verificationToken
    };

    db.Users.Add(user);
    await db.SaveChangesAsync();

    return Results.Ok(new { message = "Registration successful. Please verify your email.", verificationToken });
});

app.MapPost("/api/auth/login", async (LoginDto dto, AppDbContext db) =>
{
    var user = await db.Users.FirstOrDefaultAsync(u => u.Username == dto.Username);
    if (user is null || !BCrypt.Net.BCrypt.Verify(dto.Password, user.PasswordHash))
    {
        return Results.BadRequest(new { error = "Invalid username or password." });
    }

    var tokenHandler = new JwtSecurityTokenHandler();
    var key = Encoding.UTF8.GetBytes(jwtKey);
    var tokenDescriptor = new SecurityTokenDescriptor
    {
        Subject = new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Role, user.Role),
            new Claim("UserId", user.Id.ToString())
        }),
        Expires = DateTime.UtcNow.AddDays(7),
        Issuer = jwtIssuer,
        Audience = jwtIssuer,
        SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(key), SecurityAlgorithms.HmacSha256Signature)
    };

    var token = tokenHandler.CreateToken(tokenDescriptor);
    var tokenString = tokenHandler.WriteToken(token);

    return Results.Ok(new AuthResponseDto(tokenString, user.Username, user.Role));
});

app.MapPost("/api/auth/verify-email", async (string email, string token, AppDbContext db) =>
{
    var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email && u.EmailVerificationToken == token);
    if (user is null) return Results.BadRequest(new { error = "Invalid verification token or email." });

    user.IsEmailVerified = true;
    user.EmailVerificationToken = null;
    await db.SaveChangesAsync();

    return Results.Ok(new { message = "Email verified successfully!" });
});

app.MapPost("/api/auth/forgot-password", async (ForgotPasswordDto dto, AppDbContext db) =>
{
    var user = await db.Users.FirstOrDefaultAsync(u => u.Email == dto.Email);
    if (user is null) return Results.NotFound(new { error = "User with this email not found." });

    var resetToken = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    user.ResetPasswordToken = resetToken;
    user.ResetPasswordExpiry = DateTime.UtcNow.AddHours(1);
    await db.SaveChangesAsync();

    return Results.Ok(new { message = "Password reset token generated.", resetToken });
});

app.MapPost("/api/auth/reset-password", async (ResetPasswordDto dto, AppDbContext db) =>
{
    var user = await db.Users.FirstOrDefaultAsync(u => u.Email == dto.Email && u.ResetPasswordToken == dto.Token);
    if (user is null || user.ResetPasswordExpiry < DateTime.UtcNow)
    {
        return Results.BadRequest(new { error = "Invalid or expired password reset token." });
    }

    user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(dto.NewPassword);
    user.ResetPasswordToken = null;
    user.ResetPasswordExpiry = null;
    await db.SaveChangesAsync();

    return Results.Ok(new { message = "Password reset successfully." });
});

app.MapPut("/api/admin/users/{id}/role", async (Guid id, UpdateUserRoleDto dto, AppDbContext db) =>
{
    var user = await db.Users.FindAsync(id);
    if (user is null) return Results.NotFound(new { error = "User not found." });

    user.Role = dto.NewRole;
    await db.SaveChangesAsync();

    return Results.Ok(new { message = $"User role updated to {dto.NewRole} successfully." });
});

app.MapGet("/api/polls/{code}/analytics", async (string code, AppDbContext db) =>
{
    var poll = await db.Polls
        .Include(p => p.Options)
        .Include(p => p.Votes)
        .FirstOrDefaultAsync(p => p.Code.ToUpper() == code.ToUpper());

    if (poll is null) return Results.NotFound(new { error = "Poll not found." });

    int totalVotes = poll.Votes.Count;
    var optionStats = poll.Options.Select(o =>
    {
        int count = poll.Votes.Count(v => v.OptionId == o.Id);
        double percentage = totalVotes > 0 ? Math.Round((double)count / totalVotes * 100, 2) : 0;
        return new { o.Id, o.Text, VoteCount = count, Percentage = percentage };
    }).OrderByDescending(x => x.VoteCount).ToList();

    var leadingOption = optionStats.FirstOrDefault()?.Text ?? "N/A";

    return Results.Ok(new
    {
        poll.Code,
        poll.Question,
        TotalVotes = totalVotes,
        LeadingOption = leadingOption,
        IsAnonymous = poll.IsAnonymous,
        Options = optionStats
    });
});

app.MapGet("/api/polls/{code}/export/csv", async (string code, AppDbContext db) =>
{
    var poll = await db.Polls
        .Include(p => p.Options)
        .Include(p => p.Votes)
        .FirstOrDefaultAsync(p => p.Code.ToUpper() == code.ToUpper());

    if (poll is null) return Results.NotFound(new { error = "Poll not found." });

    var csvBuilder = new StringBuilder();
    csvBuilder.AppendLine("Poll Code,Question,Option Text,Vote Count,Percentage");

    int totalVotes = poll.Votes.Count;
    foreach (var option in poll.Options)
    {
        int count = poll.Votes.Count(v => v.OptionId == option.Id);
        double percentage = totalVotes > 0 ? Math.Round((double)count / totalVotes * 100, 2) : 0;
        csvBuilder.AppendLine($"\"{poll.Code}\",\"{poll.Question}\",\"{option.Text}\",{count},{percentage}%");
    }

    var bytes = Encoding.UTF8.GetBytes(csvBuilder.ToString());
    return Results.File(bytes, "text/csv", $"{poll.Code}_Results.csv");
});


app.MapHub<PollHub>("/hubs/polls");

app.Run();