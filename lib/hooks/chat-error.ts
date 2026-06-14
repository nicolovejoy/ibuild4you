// Pull a human-readable error off a failed response without assuming JSON.
// A framework-level 500, gateway error, or empty body is not JSON — calling
// res.json() there throws and masks the real status. Try JSON first, fall back
// to the status code. Kept in its own (dependency-free) module so it's unit-
// testable without dragging in the firebase client that useStreamingChat needs.
export async function errorMessageFromResponse(res: Response): Promise<string> {
  try {
    const data = await res.clone().json()
    if (data?.error) return data.error
  } catch {
    // non-JSON body — fall through to the status-based message
  }
  return `Chat request failed (${res.status})`
}
