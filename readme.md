# Stomp Chat

A Slack-like multi-channel chat app built on **BoxLang** (via CommandBox) using
**SocketBox**'s STOMP broker for realtime messaging, with a **Vue 3** frontend
that needs no build step.

No auth — pick a display name and go. Names must be unique among connected users.

## Running it

```bash
box install && box server start
```

Then open http://localhost:8080. Append `?debug` to the URL for STOMP frame
logging in the console, plus `window.__chat` (reactive state) and
`window.__chatClient` (the STOMP client) for poking at things.

## Features

- Create channels and join/leave them; `General` is the default and can't be left
- Message history (last 100 per channel, in memory — cleared on server restart)
- Per-channel presence list, showing who is in the channel you're viewing
- Direct messages — click anyone in the member list to start one
- Join/leave system messages
- Typing indicators
- Per-channel unread badges

## How it works

The whole server side is `WebSocket.bx`, which extends
`modules.socketbox.models.WebSocketSTOMP`. `server.json` points CommandBox's
WebSocket listener at it, exposing the broker at `/ws`.

State lives in `models/ChatStore.bx`, a single instance cached in the
application scope and shared by the WebSocket listener and HTTP requests.

### Asset versioning

`models/Assets.bx` fingerprints every file under `assets/` (path, size, mtime)
and hands `index.bxm` a `?v=<hash>` for the stylesheet and entry script. Because
a JS module's own relative imports (`./useChat.js`) are static text nobody can
rewrite, the generated **import map** carries one entry per local module mapping
`/assets/x.js` to `/assets/x.js?v=<hash>` — import map keys match the *resolved*
URL, so nested imports get the same query string and every importer still lands
on a single module instance. `index.bxm` itself is served `Cache-Control:
no-cache`, since it's the only thing that knows the current fingerprint.

The scan runs per page load, so editing a file busts it immediately; no restart
needed.

### Direct messages

A conversation between two people is just a channel with a reserved slug:
`dm-<hexA>--<hexB>`, the two lowercased usernames hex-encoded and sorted. Both
ends compute it independently, so no lookup is needed, and history, typing
indicators, unread counts and presence all come along for free.

Hex rather than the plain names because a username may contain spaces and dots —
any lossier flattening could map two different people onto the same conversation,
which would leak messages between them. `WebSocket.bx` and `assets/useChat.js`
each carry the same encoder; they have to agree.

Since the slug is derivable from two public usernames, the only thing keeping a
conversation private is the guard at the top of `authorize()`, which rejects any
`chat.`, `typing.` or `presence.` destination whose slug is a DM the connection
isn't part of. For the same reason DM history is *not* served by `api.bxm` — that
endpoint has no identity behind it — and arrives over the socket instead, pushed
to `private.<session>` when a participant subscribes.

A DM has nowhere to appear in the recipient's sidebar until they subscribe to it,
so `onSend` also notifies every live connection of both participants. It re-sends
on every message; the client only treats it as unread for a conversation it wasn't
already in, which is what stops a message being counted twice.

Closing a conversation is local only. The history survives on the server, so the
next message reopens it where you left off.

### Theming

Every colour is one `light-dark( light, dark )` custom property in `:root`, so
there is a single token list rather than a base block plus a duplicated
`prefers-color-scheme` override. `light-dark()` resolves against the element's
used `color-scheme`, which means a manual override only has to change that one
property:

```css
:root[data-theme='dark'] { color-scheme: dark; }
```

`assets/useTheme.js` cycles auto → light → dark and stores the choice in
`localStorage` under `stomp.theme`; auto (the default) stores nothing and lets
`prefers-color-scheme` decide. An inline script in `index.bxm` reads the same key
before first paint so an explicit choice doesn't flash the wrong theme — the key
is deliberately duplicated there, since nothing behind the import map has loaded
that early.

Setting `color-scheme` also fixes the UA-rendered parts (scrollbars, the
textarea, focus rings) that no amount of custom properties would reach.

Baseline: Chrome 123, Safari 17.5, Firefox 120.

### Layout

Three columns above 1024px. Between 1024 and 760 the presence panel becomes a
right-hand drawer behind a member-count button in the header; below 760 the
channel sidebar becomes a left-hand drawer behind a hamburger that carries the
combined unread count for the channels you aren't looking at. Drawers close on
scrim tap, on their own ×, and on any channel switch.

### Destinations

Everything runs on SocketBox's default `direct` exchange, which routes a SEND to
whatever subscriptions exist at that exact destination. That's why channels can
be created at runtime with no configuration.

| Destination | Client SEND | Client SUBSCRIBE | Purpose |
|---|---|---|---|
| `chat.<slug>` | yes | yes | chat and system messages for one channel |
| `typing.<slug>` | yes | yes | transient typing pings, never stored |
| `channels` | no | yes | channel directory broadcasts |
| `channels.create` | yes | no | request creation of a new channel |
| `presence.<slug>` | no | yes | who is currently in one channel |
| `private.<session>` | no | yes | targeted replies to one connection |

Direct messages reuse the `chat.`, `typing.` and `presence.` rows above with a
`dm-` slug rather than adding destinations of their own.

`authorize()` in `WebSocket.bx` enforces that table. A connection may only read
its own `private.` destination, and `channels`/`presence.*` are broadcast-only so
a client can't forge a directory or presence update.

Channel membership is **derived** from the live `chat.<slug>` subscriptions
(`getChannelMembers()`) rather than tracked in a parallel structure, so it can't
drift out of sync — a dropped connection disappears from presence for free, and a
user with two tabs open still appears once.

The username arrives in the STOMP CONNECT frame's `login` header. `onSend()`
overwrites the message body server-side, stamping `from` from the connection
record, so a client can't spoof authorship.

### `api.bxm`

Two read-only JSON actions used to hydrate a freshly loaded page:
`?action=channels` and `?action=history&channel=<slug>`. Everything after load
comes over STOMP.

## Notes and gotchas

Things worth knowing if you extend this:

- **`sendError()` closes the channel.** Per the STOMP spec, SocketBox terminates
  the connection after an ERROR frame. Recoverable errors (a bad channel name)
  are sent to the client's `private.<session>` destination instead.
- **The ERROR frame's `message` header is hardcoded** to "Invalid login". Your
  real reason from `authenticate()` lands in the frame *body*, which is why the
  client prefers `frame.body`.
- **`onClose()` and `onSTOMPDisconnect()` delete the connection record** before
  returning, so capture the login and subscriptions *before* calling `super`.
- **UNSUBSCRIBE frames carry only an `id`**, no destination. It has to be
  resolved from the subscription registry before `super` removes it.
- **Presence needs a replay on subscribe.** A client subscribes to `chat.<slug>`
  and `presence.<slug>` as two separate frames, so the broadcast triggered by the
  first can land before the second exists. `onSubscribe()` re-sends a snapshot
  when someone subscribes to a `presence.` destination.
- **Never pass `debug: undefined` to the stompjs `Client`.** It configures itself
  with `Object.assign( this, conf )`, so an explicit `undefined` overwrites the
  class's default no-op `debug` method. The first internal `this.debug()` call
  then throws inside the `async _connect()`, which means the socket is never
  created and `onWebSocketClose` — the thing that schedules retries — never
  fires. The UI sits on "reconnecting…" forever without actually retrying. Pass
  `() => {}` instead.
- **A SEND can arrive before the connection is registered.** `getConnectionDetails()`
  comes back empty for a frame that races CONNECT, which would leave the client's
  raw body (and any `from` it invented) un-stamped. `onSend()` drops chat and
  typing frames that have no login rather than forwarding them.
- **Frames from one socket are not handled in order.** The broker dispatches them
  across worker threads, so a reply the server pushes in response to frame N can
  be sent before frame N-1's subscription is registered. This ate DM history on
  every reconnect: `private.<session>` and the DM's `chat.` subscribe went out in
  the same burst, and the backlog was sent into a destination nobody was listening
  to yet. The client now puts a `receipt` on the private subscribe and waits for
  the broker's RECEIPT before subscribing to any DM. The presence replay in
  `onSubscribe()` is a workaround for the same underlying thing.
- **A multi-byte character in a message body drops the frame.** SocketBox's
  `MessageParser.readBody()` loops `content-length` times over `charAt()`, but
  content-length counts bytes and `charAt()` walks UTF-16 chars — so a body holding
  an em dash, an accent, CJK or an emoji overruns the frame and is discarded with
  "Unexpected end of message while reading body (found 27 bytes, but content-length
  header specified 28 bytes)". Inbound only; `serialize()` sets the outgoing header
  in real bytes, so it can look like a client bug. **Not a charset setting** — the
  string is already correct UTF-8, which is why you get a length mismatch and not
  mojibake. Patched locally in `modules/socketbox/models/STOMP/MessageParser.cfc`
  by slicing the byte window and decoding it back; `modules/` is gitignored, so
  `box install` will undo that and it needs to go upstream.
- **A model cached in the application scope keeps its old class.** Editing
  `ChatStore.bx` while the server is running gets you `Method 'x' not found` from
  the instance already sitting in `application.chatStore`, even though the file on
  disk is correct. Restart after changing a cached model; only the unversioned
  frontend assets pick up edits live.
- **Media queries add no specificity.** The responsive block lives at the bottom
  of `app.css` on purpose — put a `@media` override before the base rule it
  undoes and the base rule wins, which is how the mobile header buttons stayed
  invisible the first time.
- **BoxLang has no `chr()` or `header()`.** Use `char()` and the `<bx:header>`
  *tag* — calling `bx:header()` in function form inside a `<bx:script>` block in
  a `.bxm` breaks the template lexer outright ("Un-popped Lexer modes").
- **`url` is a scope.** A method named `url()` on a component resolves to the URL
  scope struct instead, hence `Assets.versioned()`.
- **`.bx` files run in BoxLang mode**, so it's `jsonSerialize()`, not
  `serializeJSON()`. SocketBox's own `.cfc` files run in CF-compat mode where
  both exist — don't copy BIF names across the boundary.
- Cluster mode is off. SocketBox supports it (see `socketbox-intro` for a
  file-cache example) if you ever run more than one node.
