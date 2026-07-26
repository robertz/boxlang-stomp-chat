import { createApp, computed } from 'vue';
import {
	state,
	displayTitle,
	connect,
	loadChannels,
	reconnectNow,
	changeUsername,
	closePanels,
	totalUnread,
	usersFor,
	isDMSlug,
	dmPartner,
	isOnline
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

		const activeTitle = computed( () => displayTitle( state.activeSlug ) );
		const showGate = computed( () => !state.username || state.gateOpen );
		const otherUnread = computed( () => totalUnread() - ( state.unread[ state.activeSlug ] || 0 ) );
		const memberCount = computed( () => usersFor( state.activeSlug ).length );
		// A two-person conversation has no useful member list, so the panel and its
		// drawer button go away and the partner's status moves into the header,
		// where it's visible at every width.
		const isDM = computed( () => isDMSlug( state.activeSlug ) );
		const partnerOnline = computed( () => isDM.value && isOnline( dmPartner( state.activeSlug ) ) );

		return {
			state,
			activeTitle,
			showGate,
			otherUnread,
			memberCount,
			isDM,
			partnerOnline,
			reconnectNow,
			changeUsername,
			closePanels
		};
	},
	template: `
		<NameGate v-if="showGate" />
		<div
			v-else
			class="shell"
			:class="{ 'is-nav-open': state.navOpen, 'is-members-open': state.membersOpen, 'shell--dm': isDM }"
		>
			<div class="scrim" @click="closePanels"></div>
			<ChannelSidebar />
			<main class="main">
				<header class="main__header">
					<button class="main__icon main__icon--nav" aria-label="Channels" @click="state.navOpen = true">
						<span class="main__burger"></span>
						<span v-if="otherUnread" class="main__icon-badge">{{ otherUnread }}</span>
					</button>
					<h1 class="main__title">{{ activeTitle }}</h1>
					<span v-if="isDM" class="main__dm-status" :class="{ 'is-online': partnerOnline }">
						{{ partnerOnline ? 'online' : 'offline' }}
					</span>
					<span v-if="!state.connected && !state.offlineReason" class="main__reconnecting">reconnecting…</span>
					<span v-else-if="state.offlineReason" class="main__reconnecting">offline</span>
					<button
						v-if="!isDM"
						class="main__icon main__icon--members"
						aria-label="Members"
						@click="state.membersOpen = true"
					>
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
			<PresenceList v-if="!isDM" />
		</div>
	`
};

createApp( App ).mount( '#app' );
