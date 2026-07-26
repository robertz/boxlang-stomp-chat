import { ref } from 'vue';
import { state, connect } from '../useChat.js';

export default {
	name: 'NameGate',
	setup() {
		const draft = ref( state.username );
		const submit = () => connect( draft.value );
		return { draft, submit, state };
	},
	template: `
		<div class="gate">
			<form class="gate__card" @submit.prevent="submit">
				<h1 class="gate__title">Stomp Chat</h1>
				<p class="gate__blurb">Pick a display name to get started. No password needed.</p>
				<input
					class="gate__input"
					v-model="draft"
					maxlength="32"
					placeholder="e.g. ada"
					autofocus
					:disabled="state.connecting"
				>
				<p v-if="state.authError" class="gate__error">{{ state.authError }}</p>
				<button class="gate__button" type="submit" :disabled="state.connecting || !draft.trim()">
					{{ state.connecting ? 'Connecting…' : 'Start chatting' }}
				</button>
			</form>
		</div>
	`
};
