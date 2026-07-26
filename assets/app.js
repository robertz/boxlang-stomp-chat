import { createApp, computed } from 'vue';
import {
	state,
	channelName,
	connect,
	loadChannels,
	reconnectNow,
	changeUsername,
	closePanels,
	totalUnread,
	usersFor
} from './useChat.js';
import { applyTheme } from './useTheme.js';
import NameGate from './components/NameGate.js';
import ChannelSidebar from './components/ChannelSidebar.js';
import MessageList from './components/MessageList.js';
import Composer from './components/Composer.js';
import PresenceList from './components/PresenceList.js';

const App = {
	components: { NameGate, ChannelSidebar, MessageList, Composer, PresenceList },
	setup() {
		applyTheme();

		// Show the directory even before a name is chosen
		loadChannels();

		// A stored name means we can connect straight away
		if ( state.username ) {
			connect( state.username );
		}

		const activeName = computed( () => channelName( state.activeSlug ) );
		const showGate = computed( () => !state.username || state.gateOpen );
		const otherUnread = computed( () => totalUnread() - ( state.unread[ state.activeSlug ] || 0 ) );
		const memberCount = computed( () => usersFor( state.activeSlug ).length );

		return {
			state,
			activeName,
			showGate,
			otherUnread,
			memberCount,
			reconnectNow,
			changeUsername,
			closePanels
		};
	},
	template: `
		<NameGate v-if="showGate" />
		<div v-else class="shell" :class="{ 'is-nav-open': state.navOpen, 'is-members-open': state.membersOpen }">
			<div class="scrim" @click="closePanels"></div>
			<ChannelSidebar />
			<main class="main">
				<header class="main__header">
					<button class="main__icon main__icon--nav" aria-label="Channels" @click="state.navOpen = true">
						<span class="main__burger"></span>
						<span v-if="otherUnread" class="main__icon-badge">{{ otherUnread }}</span>
					</button>
					<h1 class="main__title">#{{ activeName }}</h1>
					<span v-if="!state.connected && !state.offlineReason" class="main__reconnecting">reconnecting…</span>
					<span v-else-if="state.offlineReason" class="main__reconnecting">offline</span>
					<button class="main__icon main__icon--members" aria-label="Members" @click="state.membersOpen = true">
						<span class="main__icon-text">{{ memberCount }}</span>
					</button>
				</header>
				<div v-if="state.offlineReason" class="banner banner--offline">
					<span class="banner__text">{{ state.offlineReason }}</span>
					<button class="banner__action" @click="reconnectNow">Retry</button>
					<button class="banner__action" @click="changeUsername">Change name</button>
				</div>
				<MessageList />
				<Composer />
			</main>
			<PresenceList />
		</div>
	`
};

createApp( App ).mount( '#app' );
