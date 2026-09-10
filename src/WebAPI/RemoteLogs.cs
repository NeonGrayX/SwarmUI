using Newtonsoft.Json.Linq;
using SwarmUI.Accounts;
using SwarmUI.Backends;
using SwarmUI.Utils;

namespace SwarmUI.WebAPI;

/// <summary>Forwards log reading, and log pastebin submission, onto a remote Swarm backend.
/// <para>Log trackers live in this process's memory (<see cref="Logs.OtherTrackers"/>), holding the server's own messages plus the output of every process it launched itself.
/// A backend on another machine is launched by that machine, so nothing about it is in here, and its logs are otherwise readable only by logging into that machine.
/// A remote Swarm serves the same log routes this one does, so they are called over there and the answers handed back as-is.</para>
/// <para>Only <see cref="SwarmSwarmBackend"/> can be targeted: a raw remote ComfyUI has no log route to call.</para></summary>
public static class RemoteLogs
{
    public static void Register()
    {
        API.RegisterAPICall(ListRemoteLogMessages, false, Permissions.ViewLogs);
        API.RegisterAPICall(RemoteLogSubmitToPastebin, true, Permissions.ViewLogs);
    }

    /// <summary>Calls a log route on the Swarm behind a backend and returns its reply verbatim.
    /// Anything the user can act on is raised as <see cref="SwarmReadableErrorException"/>.</summary>
    public static async Task<JObject> Forward(string backendId, string route, JObject request)
    {
        SwarmSwarmBackend backend = RemoteModelDownload.TryGetTarget(backendId);
        if (backend is null)
        {
            throw new SwarmReadableErrorException("Cannot read logs from that backend: it is not a remote Swarm instance.");
        }
        // Any other status is worth trying, errored most of all - a backend that just fell over is exactly when its logs are wanted.
        // A stale or absent session is no reason to refuse either: RunWithSession reconnects and retries.
        if (backend.Status == BackendStatus.DISABLED)
        {
            throw new SwarmReadableErrorException("Cannot read logs from that backend: it is disabled, so this server holds no connection to it.");
        }
        JObject result = null;
        try
        {
            await backend.RunWithSession(async () =>
            {
                request["session_id"] = backend.Session;
                JObject response = await SwarmSwarmBackend.HttpClient.PostJson($"{backend.Address}/API/{route}", request, backend.RequestAdapter());
                // Checked ahead of AutoThrowException, which would report it as a plain remote error and leave the user hunting through their own permissions.
                if (response.TryGetValue("error_id", out JToken errorId) && errorId.ToString() == "bad_permissions")
                {
                    throw new SwarmReadableErrorException("The remote Swarm refused: the account this backend connects as lacks the 'View Server Logs' permission over there.");
                }
                SwarmSwarmBackend.AutoThrowException(response);
                result = response;
            });
        }
        catch (SwarmReadableErrorException)
        {
            throw;
        }
        catch (Exception ex)
        {
            Logs.Warning($"Failed to call '{route}' on remote Swarm backend {backendId}: {ex.ReadableString()}");
            throw new SwarmReadableErrorException("Could not reach the remote Swarm to read its logs. It may be offline, or too old to have a log API. See this server's own logs for details.");
        }
        return result;
    }

    [API.APIDescription("Returns recent log messages from a remote Swarm backend, in the same format `ListRecentLogMessages` uses for this server.\nThe available log types are the remote's own, and so are the sequence IDs - they mean nothing to this server.",
        """
          "last_sequence_id": 123,
          "types_available": [
                {
                    "name": "namehere",
                    "color": "#RRGGBB",
                    "identifier": "identifierhere"
                }
            ],
          "data": {
                "info": [
                    {
                        "sequence_id": 123,
                        "timestamp": "yyyy-MM-dd HH:mm:ss.fff",
                        "message": "messagehere"
                    }, ...
                ]
            }
        """)]
    public static async Task<JObject> ListRemoteLogMessages(Session session,
        [API.APIParameter("ID of the remote Swarm backend to read logs from.")] string backend_id,
        [API.APIParameter("Same content as `ListRecentLogMessages` takes: `\"types\": [\"info\"]`, and optionally `\"last_sequence_ids\": { \"info\": 123 }`.")] JObject raw)
    {
        // Both keys are dereferenced unconditionally by the remote's handler, so they are filled in here rather than passed through as-is.
        JObject request = new()
        {
            ["types"] = raw["types"] as JArray ?? [],
            ["last_sequence_ids"] = raw["last_sequence_ids"] as JObject ?? []
        };
        try
        {
            return await Forward(backend_id, "ListRecentLogMessages", request);
        }
        catch (SwarmReadableErrorException ex)
        {
            return new JObject() { ["error"] = ex.Message };
        }
    }

    [API.APIDescription("Submits a remote Swarm backend's current log info to a pastebin service, the same way `LogSubmitToPastebin` does for this server.\nThe remote uploads its own logs, so the paste holds that machine's log text, not this one's.",
        """
          "url": "a url to the paste here"
        """)]
    public static async Task<JObject> RemoteLogSubmitToPastebin(Session session,
        [API.APIParameter("ID of the remote Swarm backend to submit logs from.")] string backend_id,
        [API.APIParameter("The minimum log level (verbose, debug, info) to include.")] string type)
    {
        Logs.Info($"User {session.User.UserID} is submitting logs above level {type} from remote Swarm backend {backend_id} to pastebin...");
        try
        {
            return await Forward(backend_id, "LogSubmitToPastebin", new JObject() { ["type"] = type });
        }
        catch (SwarmReadableErrorException ex)
        {
            return new JObject() { ["error"] = ex.Message };
        }
    }
}
