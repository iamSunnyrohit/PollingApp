namespace LivePoll.Api.Models;

public class Option
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PollId { get; set; }
    public string Text { get; set; } = string.Empty;
    public int Position { get; set; }

    public Poll? Poll { get; set; }
}