# I built a Slack clone in BoxLang with no build step

I wanted to see how far you could get building a realtime chat app without the usual scaffolding. No npm install on the frontend. No bundler. No auth service. No database. Just BoxLang running under CommandBox, SocketBox's STOMP broker doing the realtime work, and Vue 3 loaded straight from a CDN.

The answer is: further than you'd think. The whole server is one file plus a state object.

Here's how it works, in plain terms.

## The messaging layer is a post office, not a program

The hard part of chat is normally the plumbing — who's connected, who should receive what, how a message gets from one browser to five others. SocketBox gives you a STOMP broker, and STOMP is basically a post office protocol. Clients say "I want mail addressed to `chat.general`" (SUBSCRIBE) or "deliver this to `chat.general`" (SEND). The broker matches them up.

The thing that makes this so cheap is the **direct exchange**. It routes a message to whatever subscriptions currently exist at that exact address — nothing more. There's no registry of valid addresses. So when someone creates a channel called `design-lab`, there is no configuration step, no server restart, no allocation of anything. The first client to subscribe to `chat.design-lab` makes that address real, and the first SEND to it gets delivered. Channels are free because addresses are free.

I use six address patterns:

| Address | Purpose |
|---|---|
| `chat.<slug>` | messages in one channel |
| `typing.<slug>` | transient "X is typing" pings, never stored |
| `channels` | the channel directory |
| `channels.create` | asking the server to make a new one |
| `presence.<slug>` | who's currently in one channel |
| `private.<session>` | replies meant for exactly one connection |

A single `authorize()` function enforces that table. Some addresses are write-only from the client's side, some are read-only, and a connection can only read its *own* `private.` address. That last one matters — without it, anyone could subscribe to someone else's private line.

## Presence is derived, not tracked

This is the design decision I'm happiest with.

The obvious way to build a presence list is to keep one: a user connects, you add them to a set; they disconnect, you remove them. That's also the way you end up with ghosts. Someone's laptop sleeps, the socket dies in a way that doesn't fire the clean disconnect path, and now there's a user in your sidebar who left forty minutes ago. Every chat app has had this bug.

So I don't keep a list. When the server needs to know who's in `#general`, it asks the broker who is currently subscribed to `chat.general` and reads the usernames off those connections. Presence is a *view* of the subscription table, not a copy of it.

That single choice makes several problems disappear at once. A dropped connection vanishes from presence automatically, because the subscription is gone — there's nothing to clean up. A user with two tabs open appears once, because you're deduplicating on the username rather than counting connections. And the list can't drift out of sync with reality, because it *is* reality.

The general principle: if you can compute something from state you already have, don't store it a second time. Two copies of a fact is two chances to disagree.

## The server doesn't trust the client about anything

There's no login. You pick a display name and you're in. That sounds like it means there's no security model, but it doesn't — it means the security model is narrower, not absent.

Every message that arrives gets its author stamped **server-side**. The client sends the text; the server throws away whatever `from` field the client attached and writes in the username it has on record for that socket. You can send me any JSON you like and you still can't post as someone else. It's the difference between trusting the envelope and checking the postmark.

Names are unique among connected users, checked at connect time. That's not identity — nothing stops you claiming a name someone used yesterday — but it does stop two people being confusingly named `rob` in the same room right now, which is the actual problem in a no-auth app.

## Killing stale assets without a build step

Once I had it working I hit the boring problem: I'd change some CSS, reload, and get the old file. The standard fix is a bundler that hashes filenames. I didn't have a bundler.

What I have instead is a small BoxLang class that walks the `assets/` folder and hashes every file's path, size, and modification time into a short fingerprint. Change any file and the fingerprint changes. The page then requests `/assets/app.css?v=<fingerprint>`, so the browser treats an edited file as a different URL.

That works fine for the stylesheet. It does *not* work for the JavaScript, and the reason is interesting.

Modules import each other with lines like `import { state } from './useChat.js'`. That path is static text inside the file. I can add a query string to the `<script>` tag that loads the entry point, but I can't reach inside it and rewrite its imports — that's the bundler's job, and I don't have one. So the entry file busts, and everything it pulls in comes from cache. Worst case: you get the new `app.js` talking to the old `useChat.js`, which is more confusing than getting no update at all.

The escape hatch is the **import map**. It's a browser feature that lets you say "when anything asks for X, actually load Y," and — this is the part that saves it — the matching happens against the *resolved* URL, after `./useChat.js` has been turned into `/assets/useChat.js`. So the server generates a map with one entry per local module, each pointing at itself-plus-fingerprint. Nested imports get busted, and because every importer resolves to the same final URL, they all share a single instance of the module. No accidental duplicates.

The HTML page itself is served `no-cache`, since it's the only thing that knows the current fingerprint. And the scan runs on every page load rather than at startup, so editing a file busts it immediately — no restart in the loop.

## Two themes, one list of colours

Dark mode is usually implemented twice: you write your colours, then write a `prefers-color-scheme` block that overrides them. Two lists, and a permanent low-grade chore keeping them in sync.

CSS has a function now called `light-dark()` that takes both values at once. One line per colour, both themes covered. It picks a side based on the element's `color-scheme` property — which means the manual override, the thing that lets you force a theme regardless of your OS setting, is one declaration:

```css
:root[data-theme='dark'] { color-scheme: dark; }
```

Setting `color-scheme` has a second benefit that custom properties can't buy you: it fixes the parts of the page the *browser* draws rather than you. Scrollbars, the textarea chrome, default form colours. Those ignore your variables entirely and follow `color-scheme`.

There's a small inline script in the page head that reads the saved preference before anything else loads, so an explicit choice doesn't produce a flash of the wrong theme. It duplicates one storage key from the theme module, which I'd normally object to, but nothing behind the import map has loaded that early — it's duplicated on purpose and commented as such.

While I was in there I actually measured the contrast ratios instead of eyeballing them, and found four failures against the WCAG AA threshold, two of which predated dark mode entirely. The instructive one: my first instinct was to make the accent colour *lighter* for dark mode. That's the reflex — dark theme, brighter accents. But the accent is nearly always a background with white text on it, so lightening it made white-on-accent *worse*, dropping it to 3.15:1. The fix was to darken it slightly and use the same value in both themes.

## What I'd change

The history is in memory and dies with the server, which is fine for what this is and obviously not fine for anything real. It's a single node — SocketBox supports clustering, I just didn't need it. And `light-dark()` sets a browser floor of roughly Chrome 123 / Safari 17.5.

But the shape of it holds up. One file of server logic, a state object, five Vue components loaded as plain files, and no build tooling anywhere in the loop. Edit a file, reload, see the change.
