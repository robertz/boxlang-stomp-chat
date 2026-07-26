import { computed } from 'vue';
import { state, usersFor, channelName, closePanels } from '../useChat.js';

export default {
	name: 'PresenceList',
	setup() {
		const users = computed( () => usersFor( state.activeSlug ) );
		const label = computed( () => channelName( state.activeSlug ) );
		return { state, users, label, closePanels };
	},
	template: `
		<aside class="presence">
			<div class="presence__top">
				<h2 class="presence__heading">In #{{ label }} — {{ users.length }}</h2>
				<button class="panel__close" aria-label="Close members" @click="closePanels">&times;</button>
			</div>
			<ul class="presence__list">
				<li v-for="user in users" :key="user" class="presence__item">
					<span class="presence__dot"></span>
					<span class="presence__name" :class="{ 'is-me': user === state.username }">{{ user }}</span>
				</li>
			</ul>
			<p v-if="!users.length" class="presence__empty">No one here yet.</p>
		</aside>
	`
};
