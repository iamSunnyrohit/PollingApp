namespace LivePoll.Api.DTOs;

public record CreatePollDto(string Question, List<string> Options);

public record OptionResponseDto(Guid Id, string Text, int Position, int VoteCount);

public record CastVoteDto(Guid OptionId, string VoterId, string VoterName);


public record PollResponseDto(
    Guid Id,
    string Code,
    string Question,
    string Status,
    string OwnerId,
    DateTime CreatedAt,
    List<OptionResponseDto> Options
);