using Microsoft.AspNetCore.SignalR;

namespace LivePoll.Api.Hubs;

public class PollHub : Hub
{
    public async Task JoinPollGroup(string pollCode)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, pollCode.ToUpper());
    }

    public async Task LeavePollGroup(string pollCode)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, pollCode.ToUpper());
    }
}