namespace LivePoll.Api.Models;

public class Vote
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PollId { get; set; }
    public Poll Poll { get; set; } = null!;
    public Guid OptionId { get; set; }
    public Option Option { get; set; } = null!;
    public string VoterId { get; set; } = string.Empty;
    public string VoterName { get; set; } = string.Empty;
    public DateTime VotedAt { get; set; } = DateTime.UtcNow;
}