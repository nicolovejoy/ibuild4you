# #246 — offer to save a freshly minted Loop read key into 1Password (design)

Approved by Nico 2026-11-02. Copied from the session spec
(`small-three-spec.md`, "#246") so the reference survives.

- On `/admin/apps/<slug>`, where the read key is shown once after mint/rotate, render it inside a small `<form>` with a username field prefilled `loop-read-key-<slug>` (autocomplete="username") and the key in `<input type="password" autocomplete="new-password">` (readonly is fine if it does not stop password managers; prefer not readonly), so the 1Password browser extension can offer "Save in 1Password". The existing Copy control stays. The form must never submit anywhere (preventDefault; no network call carries the key).
- The key is still shown once and never stored (only its hash, as today).
- Whether 1Password actually reacts can only be verified in Nico's real Chrome; do not try. Unit/component tests cover the form shape and that the key is not sent anywhere.

## Controller rulings (2026-11-02)

1. Both inputs are editable (not readonly), as the spec prefers. Copy always copies the minted key held in component state, never the field's current value, so an accidental keystroke cannot corrupt the copy. The fields are controlled inputs reset to the minted key/username on each mint.
2. The form has a submit button labelled "Save to password manager" (type="submit"): password managers mostly offer to save on a submit event. Its handler calls `preventDefault()` and does nothing else. The form has no `action`/`method` attributes.
3. No show/hide toggle (YAGNI). The key is masked (type="password"); Copy remains the way to get it. A one-line note tells the admin the field is masked so a password manager can save it.
