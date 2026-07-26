import { ref, computed } from 'vue';
import { state, channelName, sendMessage, notifyTyping, typingNamesFor } from '../useChat.js';

export default {
	name: 'Composer',
	setup() {
		const draft = ref( '' );

		const placeholder = computed( () => 'Message #' + channelName( state.activeSlug ) );

		const typingLabel = computed( () => {
			const names = typingNamesFor( state.activeSlug );
			if ( !names.length ) {
				return '';
			}
			if ( names.length === 1 ) {
				return names[ 0 ] + ' is typing…';
			}
			if ( names.length === 2 ) {
				return names.join( ' and ' ) + ' are typing…';
			}
			return 'Several people are typing…';
		} );

		const submit = () => {
			sendMessage( draft.value );
			draft.value = '';
		};

		return { draft, placeholder, typingLabel, submit, notifyTyping, state };
	},
	template: `
		<div class="composer">
			<form class="composer__form" @submit.prevent="submit">
				<textarea
					class="composer__input"
					v-model="draft"
					rows="1"
					:placeholder="placeholder"
					:disabled="!state.connected"
					@input="notifyTyping"
					@keydown.enter.exact.prevent="submit"
				></textarea>
				<button class="composer__send" type="submit" :disabled="!draft.trim() || !state.connected">Send</button>
			</form>
			<p class="composer__typing">{{ typingLabel }}</p>
		</div>
	`
};
