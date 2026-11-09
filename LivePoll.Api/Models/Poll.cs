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
    public string Code { get; set; } = string.Empty;
    public string Question { get; set; } = string.Empty;
    public PollStatus Status { get; set; } = PollStatus.Draft;
    public bool IsAnonymous { get; set; } = false; 
    public string OwnerId { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public ICollection<Option> Options { get; set; } = new List<Option>();
    public ICollection<Vote> Votes { get; set; } = new List<Vote>();
}