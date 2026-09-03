using Newtonsoft.Json.Linq;
using SwarmUI.Backends;
using SwarmUI.Core;
using SwarmUI.Utils;
using System.Net.WebSockets;

namespace SwarmUI.WebAPI;

/// <summary>Forwards a model download onto a remote Swarm backend.
/// <para>The normal downloader writes into this server's own model folders, which is no use when the thing that will actually load the model runs on another machine.
/// A remote Swarm exposes the same download route this one does, so the download is run over there and its progress relayed back here, leaving the file on the disk the backend reads.</para>
/// <para>Only <see cref="SwarmSwarmBackend"/> can be targeted: a raw ComfyUI backend has no download API to call.</para></summary>
public static class RemoteModelDownload
{
    /// <summary>Finds the remote Swarm backend a download should be forwarded to, or null if the ID doesn't name one.</summary>
    public static SwarmSwarmBackend TryGetTarget(string backendId)
    {
        if (!int.TryParse(backendId, out int id) || !Program.Backends.AllBackends.TryGetValue(id, out BackendHandler.BackendData data))
        {
            return null;
        }
        return data.AbstractBackend as SwarmSwarmBackend;
    }

    /// <summary>Applies a Swarm backend's configured auth headers to an outbound websocket, matching what <see cref="SwarmSwarmBackend"/> does for its own connections.</summary>
    public static void ApplyHeaders(SwarmSwarmBackend backend, ClientWebSocket socket)
    {
        if (!string.IsNullOrWhiteSpace(backend.Settings.AuthorizationHeader))
        {
            socket.Options.SetRequestHeader("Authorization", backend.Settings.AuthorizationHeader);
        }
        if (!string.IsNullOrWhiteSpace(backend.Settings.OtherHeaders))
        {
            foreach (string line in backend.Settings.OtherHeaders.Split('\n'))
            {
                string[] parts = line.Split(':');
                if (parts.Length != 2)
                {
                    Logs.Error($"Invalid header line in SwarmSwarmBackend: '{line}'");
                    continue;
                }
                socket.Options.SetRequestHeader(parts[0].Trim(), parts[1].Trim());
            }
        }
    }

    /// <summary>Runs a model download on a remote Swarm backend, relaying the remote's progress messages onto <paramref name="ws"/> so the caller cannot tell the difference from a local download.
    /// Errors are reported to <paramref name="ws"/> rather than thrown.</summary>
    public static async Task Forward(WebSocket ws, string backendId, string url, string type, string name, string metadata)
    {
        SwarmSwarmBackend backend = TryGetTarget(backendId);
        if (backend is null)
        {
            await ws.SendJson(new JObject() { ["error"] = "Cannot download to that backend: it is not a remote Swarm instance." }, API.WebsocketTimeout);
            return;
        }
        if (backend.Status != BackendStatus.RUNNING && backend.Status != BackendStatus.IDLE)
        {
            await ws.SendJson(new JObject() { ["error"] = "Cannot download to that backend: it is not currently connected." }, API.WebsocketTimeout);
            return;
        }
        JObject request = new()
        {
            ["url"] = url,
            ["type"] = type,
            ["name"] = name
        };
        if (!string.IsNullOrWhiteSpace(metadata))
        {
            request["metadata"] = metadata;
        }
        // A session that expires is normally handled by retrying the whole call, but a retry here would restart a download that may be gigabytes in.
        // Only the first exchange can safely be retried, so once anything has been relayed the retry is refused instead.
        bool relayed = false;
        try
        {
            await backend.RunWithSession(async () =>
            {
                if (relayed)
                {
                    throw new SwarmReadableErrorException("Lost the session to the remote Swarm partway through the download.");
                }
                request["session_id"] = backend.Session;
                Logs.Debug($"Forwarding model download of '{url}' to remote Swarm backend {backend.BackendData.ID} at {backend.Address}");
                using ClientWebSocket remote = await NetworkBackendUtils.ConnectWebsocket(backend.Address, "API/DoModelDownloadWS", socket => ApplyHeaders(backend, socket));
                bool finished = false;
                await remote.SendJson(request, API.WebsocketTimeout);
                // The caller's only inbound message is the cancel signal, which means nothing here except as something to pass along.
                Task listenForSignal = Utilities.RunCheckedTask(async () =>
                {
                    try
                    {
                        while (!finished && ws.State == WebSocketState.Open && !ws.CloseStatus.HasValue)
                        {
                            JObject data = await ws.ReceiveJson(1024 * 1024, true);
                            if (data is not null && data.ContainsKey("signal") && !finished)
                            {
                                Logs.Verbose($"Relaying model download signal to remote Swarm: {data}");
                                await remote.SendJson(data, API.WebsocketTimeout);
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        // Nothing to report: this side only carries the cancel signal, and the socket closing under it is the normal end of a download.
                        Logs.Verbose($"Model download signal relay ended: {ex.ReadableString()}");
                    }
                });
                while (true)
                {
                    JObject response = await remote.ReceiveJson(Utilities.ExtraLargeMaxReceive, true);
                    if (response is null)
                    {
                        if (remote.State != WebSocketState.Open)
                        {
                            throw new SwarmReadableErrorException("The remote Swarm closed the connection before the download finished.");
                        }
                        continue;
                    }
                    // Throws for a dead session (worth retrying, and only possible before any progress has been relayed) or for a plain error from the remote.
                    SwarmSwarmBackend.AutoThrowException(response);
                    if (response.ContainsKey("success"))
                    {
                        // Refreshed before the caller is told, or the model list reload it does on success would race this one and miss the new model.
                        finished = true;
                        await Refresh(backend);
                        await ws.SendJson(response, API.WebsocketTimeout);
                        return;
                    }
                    relayed = true;
                    await ws.SendJson(response, API.WebsocketTimeout);
                }
            });
        }
        catch (SwarmReadableErrorException userErr)
        {
            Logs.Warning($"Failed to download the model to remote backend {backendId} due to: {userErr.Message}");
            await ws.SendJson(new JObject() { ["error"] = userErr.Message }, API.WebsocketTimeout);
        }
        catch (Exception ex)
        {
            Logs.Warning($"Failed to download the model to remote backend {backendId} due to internal exception: {ex.ReadableString()}");
            await ws.SendJson(new JObject() { ["error"] = "Failed to download the model to the remote backend due to internal exception." }, API.WebsocketTimeout);
        }
    }

    /// <summary>Re-pulls a remote Swarm's model list, so a model that now exists over there is one this server knows about.
    /// Failure is logged and swallowed: the download itself already succeeded, and the list catches up on the next poll.</summary>
    public static async Task Refresh(SwarmSwarmBackend backend)
    {
        try
        {
            // The model list lives on the control instance; a linked child backend only mirrors one remote backend of it.
            await (backend.Parent ?? backend).TriggerRefresh();
        }
        catch (Exception ex)
        {
            Logs.Warning($"Downloaded a model to remote backend {backend.BackendData.ID}, but failed to refresh its model list: {ex.ReadableString()}");
        }
    }
}
