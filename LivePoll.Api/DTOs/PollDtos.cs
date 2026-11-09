namespace LivePoll.Api.DTOs;

public record CreatePollDto(string Question, List<string> Options, bool IsAnonymous);

public record OptionResponseDto(Guid Id, string Text, int Position, int VoteCount);

public record CastVoteDto(Guid OptionId, string VoterId, string VoterName);

public record RegisterDto(string Username, string Password, string Role);
public record LoginDto(string Username, string Password);
public record AuthResponseDto(string Token, string Username, string Role);

public record PollResponseDto(
    Guid Id,
    string Code,
    string Question,
    string Status,
    string OwnerId,
    DateTime CreatedAt,
    List<OptionResponseDto> Options
);