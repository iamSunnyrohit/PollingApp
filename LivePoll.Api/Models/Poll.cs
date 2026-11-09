namespace LivePoll.Api.Models;

public enum PollStatus
{
    Draft,
    Open,
    Closed
}

public class Poll
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Code { get; set; } = string.Empty; // 6-character unique code
    public string Question { get; set; } = string.Empty;
    public PollStatus Status { get; set; } = PollStatus.Draft;
    public string OwnerId { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? OpenedAt { get; set; }
    public DateTime? ClosedAt { get; set; }

    public ICollection<Option> Options { get; set; } = new List<Option>();
    public ICollection<Vote> Votes { get; set; } = new List<Vote>();
}