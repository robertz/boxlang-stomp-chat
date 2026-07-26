import { ref, computed } from 'vue';
import {
	state,
	DEFAULT_SLUG,
	channelName,
	unreadFor,
	isJoined,
	joinChannel,
	leaveChannel,
	createChannel,
	setActive,
	changeUsername,
	closePanels,
	dmConversations,
	closeDM,
	isOnline
} from '../useChat.js';
import { cycleTheme, themeLabel } from '../useTheme.js';

export default {
	name: 'ChannelSidebar',
	setup() {
		const draft = ref( '' );
		const showBrowse = ref( false );

		const joinedChannels = computed( () =>
			state.joined.map( ( slug ) => ( { slug, name: channelName( slug ) } ) )
		);
		const unjoinedChannels = computed( () =>
			state.channels.filter( ( c ) => !isJoined( c.slug ) )
		);
		const conversations = computed( () => dmConversations() );

		const submit = () => {
			if ( !draft.value.trim() ) {
				return;
			}
			createChannel( draft.value );
			draft.value = '';
		};

		return {
			state,
			DEFAULT_SLUG,
			draft,
			showBrowse,
			joinedChannels,
			unjoinedChannels,
			conversations,
			closeDM,
			isOnline,
			unreadFor,
			joinChannel,
			leaveChannel,
			setActive,
			changeUsername,
			closePanels,
			cycleTheme,
			themeLabel,
			submit
		};
	},
	template: `
		<aside class="sidebar">
			<header class="sidebar__header">
				<span class="sidebar__brand">Stomp Chat</span>
				<span class="sidebar__status" :class="{ 'is-live': state.connected }">
					{{ state.connected ? 'online' : 'offline' }}
				</span>
				<button class="panel__close" aria-label="Close channels" @click="closePanels">&times;</button>
			</header>

			<section class="sidebar__section">
				<h2 class="sidebar__heading">Channels</h2>
				<ul class="channel-list">
					<li v-for="channel in joinedChannels" :key="channel.slug">
						<button
							class="channel"
							:class="{ 'is-active': channel.slug === state.activeSlug }"
							@click="setActive( channel.slug )"
						>
							<span class="channel__name">#{{ channel.name }}</span>
							<span v-if="unreadFor( channel.slug )" class="channel__badge">
								{{ unreadFor( channel.slug ) }}
							</span>
							<span
								v-if="channel.slug !== DEFAULT_SLUG"
								class="channel__leave"
								title="Leave channel"
								@click.stop="leaveChannel( channel.slug )"
							>&times;</span>
						</button>
					</li>
				</ul>
			</section>

			<section class="sidebar__section">
				<form class="create" @submit.prevent="submit">
					<input class="create__input" v-model="draft" maxlength="40" placeholder="New channel name">
					<button class="create__button" type="submit" :disabled="!draft.trim()">+</button>
				</form>
				<p v-if="state.actionError" class="create__error" @click="state.actionError = ''">
					{{ state.actionError }}
				</p>
			</section>

			<section class="sidebar__section">
				<h2 class="sidebar__heading">Direct messages</h2>
				<ul class="channel-list">
					<li v-for="dm in conversations" :key="dm.slug">
						<button
							class="channel"
							:class="{ 'is-active': dm.slug === state.activeSlug }"
							@click="setActive( dm.slug )"
						>
							<span class="channel__dot" :class="{ 'is-online': isOnline( dm.partner ) }"></span>
							<span class="channel__name">{{ dm.partner }}</span>
							<span v-if="unreadFor( dm.slug )" class="channel__badge">
								{{ unreadFor( dm.slug ) }}
							</span>
							<span
								class="channel__leave"
								title="Close conversation"
								@click.stop="closeDM( dm.slug )"
							>&times;</span>
						</button>
					</li>
				</ul>
				<p v-if="!conversations.length" class="sidebar__hint">
					Pick someone from the member list to start one.
				</p>
			</section>

			<section class="sidebar__section" v-if="unjoinedChannels.length">
				<button class="sidebar__toggle" @click="showBrowse = !showBrowse">
					{{ showBrowse ? '▾' : '▸' }} Browse ({{ unjoinedChannels.length }})
				</button>
				<ul class="channel-list" v-show="showBrowse">
					<li v-for="channel in unjoinedChannels" :key="channel.slug">
						<button class="channel channel--muted" @click="joinChannel( channel.slug ); setActive( channel.slug )">
							<span class="channel__name">#{{ channel.name }}</span>
							<span class="channel__join">join</span>
						</button>
					</li>
				</ul>
			</section>

			<footer class="sidebar__footer">
				<span class="sidebar__me">{{ state.username }}</span>
				<button
					class="sidebar__theme"
					:title="'Theme: ' + themeLabel() + ' — click to change'"
					@click="cycleTheme"
				>{{ themeLabel() }}</button>
				<button class="sidebar__link" @click="changeUsername">change</button>
			</footer>
		</aside>
	`
};
