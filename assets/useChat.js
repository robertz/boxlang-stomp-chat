import { reactive } from 'vue';
import { Client } from '@stomp/stompjs';

const STORAGE_USERNAME = 'stomp-chat.username';

export const DEFAULT_SLUG = 'general';

const DM_PREFIX = 'dm-';
const DM_SEPARATOR = '--';

const TYPING_TTL_MS = 3000;
const TYPING_THROTTLE_MS = 2000;
// How many failed socket opens before we stop saying "reconnecting" and admit
// the server isn't there.
const OFFLINE_AFTER_FAILURES = 2;

/**
 * This tab's identity lives in sessionStorage; localStorage only remembers the
 * last name used, as a default for new tabs. Two tabs sharing one localStorage
 * key used to overwrite each other's name, so a reload would try to connect as
 * whoever wrote last and get rejected as a duplicate.
 */
function readUsername() {
	try {
		return sessionStorage.getItem( STORAGE_USERNAME ) || localStorage.getItem( STORAGE_USERNAME ) || '';
	} catch ( e ) {
		return '';
	}
}

function persistUsername( username ) {
	try {
		sessionStorage.setItem( STORAGE_USERNAME, username );
		localStorage.setItem( STORAGE_USERNAME, username );
	} catch ( e ) {
		/* private mode; identity just won't survive a reload */
	}
}

// Joined channels are per identity, not per browser, so two people sharing a
// machine don't inherit each other's sidebar.
function joinedKey( username ) {
	return 'stomp-chat.joined.' + ( username || '' ).toLowerCase();
}

function readJoined( username ) {
	try {
		const stored = JSON.parse( localStorage.getItem( joinedKey( username ) ) || '[]' );
		const slugs = Array.isArray( stored ) ? stored.filter( ( s ) => typeof s === 'string' ) : [];
		return [ DEFAULT_SLUG, ...slugs.filter( ( s ) => s !== DEFAULT_SLUG && !isDMSlug( s ) ) ];
	} catch ( e ) {
		return [ DEFAULT_SLUG ];
	}
}

function dmKey( username ) {
	return 'stomp-chat.dms.' + ( username || '' ).toLowerCase();
}

function readDMs( username ) {
	try {
		const stored = JSON.parse( localStorage.getItem( dmKey( username ) ) || '[]' );
		return Array.isArray( stored ) ? stored.filter( isDMSlug ) : [];
	} catch ( e ) {
		return [];
	}
}

/*
 * A conversation's slug is the two lowercased usernames hex-encoded and sorted,
 * so both ends compute the same one without asking the server. Hex because a
 * username may contain spaces and dots: anything lossier could map two different
 * people onto one conversation, which would leak messages between them. Must
 * stay in step with the same helpers in WebSocket.bx.
 */
function encodeName( name ) {
	return Array.from( new TextEncoder().encode( ( name || '' ).trim().toLowerCase() ) )
		.map( ( byte ) => byte.toString( 16 ).padStart( 2, '0' ) )
		.join( '' );
}

function decodeName( hex ) {
	const pairs = hex.match( /../g ) || [];
	return new TextDecoder().decode( new Uint8Array( pairs.map( ( pair ) => parseInt( pair, 16 ) ) ) );
}

export function isDMSlug( slug ) {
	return typeof slug === 'string' && slug.startsWith( DM_PREFIX );
}

export function dmSlugFor( other ) {
	const pair = [ state.username, other ].map( ( name ) => ( name || '' ).trim().toLowerCase() ).sort();
	return DM_PREFIX + pair.map( encodeName ).join( DM_SEPARATOR );
}

/**
 * The other person in a conversation. Falls back to the first half so a slug
 * stored under a name you've since changed still renders as something.
 */
export function dmPartner( slug ) {
	if ( !isDMSlug( slug ) ) {
		return '';
	}
	const halves = slug.slice( DM_PREFIX.length ).split( DM_SEPARATOR ).map( decodeName );
	const me = ( state.username || '' ).trim().toLowerCase();
	return halves.find( ( name ) => name !== me ) || halves[ 0 ] || '';
}

export const state = reactive( {
	username: readUsername(),
	sessionId: '',
	connected: false,
	connecting: false,
	// Forces the name gate open even when a name is already stored
	gateOpen: false,
	// Reason the name gate is showing (empty when the gate is just "no name yet")
	authError: '',
	// Transient, dismissable errors such as a rejected channel name
	actionError: '',
	// Set once we can no longer honestly call this a transient reconnect
	offlineReason: '',
	channels: [],
	joined: readJoined( readUsername() ),
	// Open direct-message conversations, as dm- slugs
	dms: readDMs( readUsername() ),
	activeSlug: DEFAULT_SLUG,
	messages: {},
	unread: {},
	// slug -> array of logins currently subscribed to that channel
	usersByChannel: {},
	// slug -> { username: true }, entries removed by their own expiry timer
	typing: {},
	// Off-canvas panels, only reachable at narrow widths
	navOpen: false,
	membersOpen: false
} );

// Append ?debug to the URL for STOMP frame logging and a peek at reactive state
const DEBUG = new URLSearchParams( location.search ).has( 'debug' );
if ( DEBUG ) {
	window.__chat = state;
}

let client = null;
// Consecutive socket opens that never reached a CONNECTED frame
let socketFailures = 0;
// slug -> { chat, typing } stomp subscription handles
const channelSubs = new Map();
// "slug:username" -> timeout id that clears the typing flag
const typingTimers = new Map();
let lastTypingSentAt = 0;

/**
 * Flag someone as typing and arm a one-shot expiry. A per-entry timer beats
 * polling a clock, which browsers throttle to a standstill in background tabs.
 */
function markTyping( slug, username ) {
	if ( !state.typing[ slug ] ) {
		state.typing[ slug ] = {};
	}
	state.typing[ slug ][ username ] = true;

	const key = slug + ':' + username;
	clearTimeout( typingTimers.get( key ) );
	typingTimers.set(
		key,
		setTimeout( () => {
			if ( state.typing[ slug ] ) {
				delete state.typing[ slug ][ username ];
			}
			typingTimers.delete( key );
		}, TYPING_TTL_MS )
	);
}

/* ------------------------------------------------------------------ derived */

export function channelName( slug ) {
	const match = state.channels.find( ( c ) => c.slug === slug );
	return match ? match.name : slug;
}

/**
 * How a conversation is named everywhere in the UI, sigil included, so the
 * header, composer and presence panel can't disagree about it. A raw DM slug is
 * hex and must never reach the screen.
 */
export function displayTitle( slug ) {
	return isDMSlug( slug ) ? '@' + dmPartner( slug ) : '#' + channelName( slug );
}

export function messagesFor( slug ) {
	return state.messages[ slug ] || [];
}

export function unreadFor( slug ) {
	return state.unread[ slug ] || 0;
}

export function usersFor( slug ) {
	return state.usersByChannel[ slug ] || [];
}

export function typingNamesFor( slug ) {
	return Object.keys( state.typing[ slug ] || {} );
}

export function isJoined( slug ) {
	return state.joined.includes( slug );
}

/* ------------------------------------------------------------------ helpers */

function persistJoined() {
	localStorage.setItem( joinedKey( state.username ), JSON.stringify( state.joined ) );
}

function persistDMs() {
	try {
		localStorage.setItem( dmKey( state.username ), JSON.stringify( state.dms ) );
	} catch ( e ) {
		/* private mode; the conversation list just won't survive a reload */
	}
}

function parseBody( message ) {
	try {
		return JSON.parse( message.body );
	} catch ( e ) {
		return { text: message.body };
	}
}

function mergeHistory( slug, history ) {
	const live = state.messages[ slug ] || [];
	const seen = new Set( history.map( ( m ) => m.id ) );
	state.messages[ slug ] = history.concat( live.filter( ( m ) => !seen.has( m.id ) ) );
}

function appendMessage( slug, chatMessage ) {
	const existing = state.messages[ slug ] || [];
	if ( chatMessage.id && existing.some( ( m ) => m.id === chatMessage.id ) ) {
		return;
	}
	state.messages[ slug ] = existing.concat( chatMessage );
}

async function loadHistory( slug ) {
	try {
		const response = await fetch( `/api.bxm?action=history&channel=${ encodeURIComponent( slug ) }` );
		const payload = await response.json();
		mergeHistory( slug, payload.messages || [] );
	} catch ( e ) {
		console.error( 'Failed to load history for', slug, e );
	}
}

export async function loadChannels() {
	try {
		const response = await fetch( '/api.bxm?action=channels' );
		const payload = await response.json();
		state.channels = payload.channels || [];
	} catch ( e ) {
		console.error( 'Failed to load channels', e );
	}
}

/* ------------------------------------------------------------------ connection */

export function connect( username ) {
	const name = ( username || '' ).trim();
	if ( !name ) {
		state.authError = 'Please choose a username.';
		return;
	}

	// Re-entering the gate must not leave the previous client connected, or the
	// new CONNECT gets rejected as a duplicate of our own session.
	disconnect();

	state.username = name;
	state.authError = '';
	state.offlineReason = '';
	state.connecting = true;
	socketFailures = 0;

	const scheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
	const brokerURL = scheme + location.host + '/ws';

	client = new Client( {
		brokerURL,
		connectHeaders: { login: name },
		reconnectDelay: 5000,
		heartbeatIncoming: 10000,
		heartbeatOutgoing: 10000,
		onConnect: ( frame ) => {
			state.connected = true;
			state.connecting = false;
			state.gateOpen = false;
			state.offlineReason = '';
			state.sessionId = frame.headers.session || '';
			socketFailures = 0;
			if ( DEBUG ) {
				window.__chatClient = client;
			}
			persistUsername( name );

			// A reconnect replays this handler, so rebuild every subscription
			channelSubs.clear();
			state.joined = readJoined( name );
			state.dms = readDMs( name );

			client.subscribe( 'channels', ( m ) => {
				state.channels = parseBody( m ).channels || [];
			} );
			loadChannels();
			state.joined.forEach( ( slug ) => subscribeChannel( slug ) );

			if ( state.sessionId ) {
				// Frames from one socket are not necessarily handled in the order they
				// were sent -- the broker dispatches them across worker threads. That
				// matters here because subscribing to a DM makes the server push its
				// backlog to this destination, and on a reconnect both frames go out in
				// the same burst: the reply can be sent before the subscription
				// registering it exists, and then it's simply lost. Waiting for the
				// broker's RECEIPT removes the ordering assumption instead of hoping.
				client.subscribe(
					'private.' + state.sessionId,
					( m ) => handlePrivateMessage( parseBody( m ) ),
					{ receipt: 'private-ready' }
				);
				client.watchForReceipt( 'private-ready', () => {
					state.dms.forEach( ( slug ) => subscribeChannel( slug ) );
				} );
			}
		},
		onStompError: ( frame ) => {
			// SocketBox hardcodes the `message` header to "Invalid login" and puts
			// the real reason in the frame body, so prefer the body.
			const reason = ( frame.body || '' ).trim() || frame.headers.message || 'Connection rejected.';
			if ( !state.connected ) {
				// Almost certainly a rejected username. Reconnecting would just fail
				// the same way, so stop and reopen the gate. The stored name is left
				// alone -- it may be perfectly good once the other session ends, and
				// other tabs share this localStorage.
				state.authError = reason;
				state.connecting = false;
				state.gateOpen = true;
				// A specific reason from the server beats the generic offline notice
				state.offlineReason = '';
				disconnect();
			} else {
				state.actionError = reason;
			}
		},
		onWebSocketClose: () => {
			const wasConnected = state.connected;
			state.connected = false;
			// Never leave this true on a failed open, or the name gate's input and
			// button stay disabled and there's no way back in.
			state.connecting = false;

			if ( wasConnected ) {
				// A live connection dropped. stompjs will retry, and that retry is
				// worth believing in, so say nothing yet.
				socketFailures = 0;
				return;
			}

			// The socket opened and closed without ever reaching CONNECTED, or it
			// never opened at all. Either way, retrying silently forever is a lie.
			socketFailures++;
			if ( socketFailures >= OFFLINE_AFTER_FAILURES && !state.authError ) {
				state.offlineReason = `Can't reach the chat server at ${ brokerURL }. It may have stopped — check that \`box server start\` is still running.`;
			}
		},
		onWebSocketError: () => {
			// Fires before onWebSocketClose; the event carries no useful detail, so
			// just make sure a stuck "Connecting…" can't outlive it.
			state.connecting = false;
		},
		// Must always be a function. stompjs configures itself with
		// Object.assign( this, conf ), so `debug: undefined` overwrites its default
		// no-op and the first internal this.debug() call throws inside _connect --
		// the socket never opens and no error handler ever fires.
		debug: DEBUG ? ( line ) => console.log( '[stomp]', line ) : () => {}
	} );

	client.activate();
}

export function disconnect() {
	if ( client ) {
		client.deactivate();
		client = null;
	}
	channelSubs.clear();
	socketFailures = 0;
	state.connected = false;
	state.connecting = false;
	state.usersByChannel = {};
}

/**
 * Manual retry for when the automatic one has clearly given up. Rebuilds the
 * client from scratch rather than poking the old one, whose internal reconnect
 * timer we no longer trust.
 */
export function reconnectNow() {
	if ( state.username ) {
		connect( state.username );
	}
}

function handlePrivateMessage( payload ) {
	if ( payload.type === 'error' ) {
		state.actionError = payload.text || 'Something went wrong.';
	} else if ( payload.type === 'channelCreated' && payload.channel ) {
		state.actionError = '';
		joinChannel( payload.channel.slug );
		setActive( payload.channel.slug );
	} else if ( payload.type === 'dmHistory' && isDMSlug( payload.slug ) ) {
		mergeHistory( payload.slug, payload.messages || [] );
	} else if ( payload.type === 'dmOpened' && isDMSlug( payload.slug ) ) {
		// The server re-sends this on every message, so only a conversation we
		// weren't already in counts as unread. Once subscribed, the message itself
		// arrives through the chat handler and is counted there — this branch
		// existing at all is what stops a DM to someone who hasn't opened it from
		// vanishing.
		if ( !state.dms.includes( payload.slug ) ) {
			trackDM( payload.slug );
			if ( payload.slug !== state.activeSlug && payload.from !== state.username ) {
				state.unread[ payload.slug ] = unreadFor( payload.slug ) + 1;
			}
		}
	}
}

/* ------------------------------------------------------------------ channels */

function subscribeChannel( slug ) {
	if ( !client || !state.connected || channelSubs.has( slug ) ) {
		return;
	}
	const chat = client.subscribe( 'chat.' + slug, ( m ) => {
		const chatMessage = parseBody( m );
		appendMessage( slug, chatMessage );
		// They just sent it, so they're done typing
		if ( chatMessage.from && state.typing[ slug ] ) {
			delete state.typing[ slug ][ chatMessage.from ];
		}
		const isOwn = chatMessage.type === 'chat' && chatMessage.from === state.username;
		if ( slug !== state.activeSlug && !isOwn ) {
			state.unread[ slug ] = unreadFor( slug ) + 1;
		}
	} );
	const typing = client.subscribe( 'typing.' + slug, ( m ) => {
		const payload = parseBody( m );
		if ( !payload.from || payload.from === state.username ) {
			return;
		}
		markTyping( slug, payload.from );
	} );
	const presence = client.subscribe( 'presence.' + slug, ( m ) => {
		state.usersByChannel[ slug ] = parseBody( m ).users || [];
	} );

	channelSubs.set( slug, { chat, typing, presence } );
	// DM backlog arrives on the private destination in response to the subscribe
	// above, because api.bxm can't safely hand it out.
	if ( !isDMSlug( slug ) ) {
		loadHistory( slug );
	}
}

export function joinChannel( slug ) {
	if ( !state.joined.includes( slug ) ) {
		state.joined.push( slug );
		persistJoined();
	}
	subscribeChannel( slug );
}

function teardownChannel( slug ) {
	const subs = channelSubs.get( slug );
	if ( subs ) {
		subs.chat.unsubscribe();
		subs.typing.unsubscribe();
		subs.presence.unsubscribe();
		channelSubs.delete( slug );
	}
	delete state.messages[ slug ];
	delete state.unread[ slug ];
	delete state.typing[ slug ];
	delete state.usersByChannel[ slug ];
	if ( state.activeSlug === slug ) {
		setActive( DEFAULT_SLUG );
	}
}

export function leaveChannel( slug ) {
	if ( slug === DEFAULT_SLUG ) {
		return;
	}
	state.joined = state.joined.filter( ( s ) => s !== slug );
	persistJoined();
	teardownChannel( slug );
}

/* ------------------------------------------------------------------ direct messages */

function trackDM( slug ) {
	if ( !state.dms.includes( slug ) ) {
		state.dms.push( slug );
		persistDMs();
	}
	subscribeChannel( slug );
}

/**
 * Start or reopen a conversation with someone. Idempotent, so clicking a name
 * that's already in the sidebar just switches to it.
 */
export function openDM( username ) {
	const other = ( username || '' ).trim();
	if ( !other || other.toLowerCase() === ( state.username || '' ).trim().toLowerCase() ) {
		return;
	}
	const slug = dmSlugFor( other );
	trackDM( slug );
	setActive( slug );
}

/**
 * Closing a conversation is local only — it drops off your sidebar but the
 * history survives on the server, so the next message reopens it where you left
 * off rather than starting fresh.
 */
export function closeDM( slug ) {
	state.dms = state.dms.filter( ( s ) => s !== slug );
	persistDMs();
	teardownChannel( slug );
}

/**
 * Conversations in the sidebar, ordered by the name shown rather than by the hex
 * slug, which would sort meaninglessly.
 */
export function dmConversations() {
	return state.dms
		.map( ( slug ) => ( { slug, partner: dmPartner( slug ) } ) )
		.sort( ( a, b ) => a.partner.localeCompare( b.partner ) );
}

/**
 * Everyone subscribed to General, which nobody can leave — the closest thing to
 * a global online list in an app with no user table.
 */
export function isOnline( username ) {
	return usersFor( DEFAULT_SLUG ).some( ( user ) => user.toLowerCase() === ( username || '' ).toLowerCase() );
}

export function createChannel( name ) {
	if ( !client || !state.connected ) {
		return;
	}
	state.actionError = '';
	client.publish( {
		destination: 'channels.create',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify( { name } )
	} );
}

export function setActive( slug ) {
	state.activeSlug = slug;
	state.unread[ slug ] = 0;
	closePanels();
}

export function closePanels() {
	state.navOpen = false;
	state.membersOpen = false;
}

export function totalUnread() {
	return state.joined.concat( state.dms ).reduce( ( sum, slug ) => sum + unreadFor( slug ), 0 );
}

/* ------------------------------------------------------------------ sending */

export function sendMessage( text ) {
	const body = ( text || '' ).trim();
	if ( !body || !client || !state.connected ) {
		return;
	}
	client.publish( {
		destination: 'chat.' + state.activeSlug,
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify( { text: body } )
	} );
}

export function notifyTyping() {
	const now = Date.now();
	if ( !client || !state.connected || now - lastTypingSentAt < TYPING_THROTTLE_MS ) {
		return;
	}
	lastTypingSentAt = now;
	client.publish( {
		destination: 'typing.' + state.activeSlug,
		headers: { 'content-type': 'application/json' },
		body: '{}'
	} );
}

export function changeUsername() {
	disconnect();
	state.gateOpen = true;
	state.authError = '';
	state.offlineReason = '';
	state.messages = {};
	state.unread = {};
	state.typing = {};
	state.usersByChannel = {};
	// Conversations belong to the old identity, and their slugs wouldn't even
	// decode against the new one
	state.dms = [];
	if ( isDMSlug( state.activeSlug ) ) {
		state.activeSlug = DEFAULT_SLUG;
	}
}
