import { computed, ref, watch, nextTick, onMounted } from 'vue';
import { state, messagesFor } from '../useChat.js';

function timeLabel( iso ) {
	const parsed = new Date( iso );
	if ( isNaN( parsed.getTime() ) ) {
		return '';
	}
	return parsed.toLocaleTimeString( [], { hour: 'numeric', minute: '2-digit' } );
}

export default {
	name: 'MessageList',
	setup() {
		const scroller = ref( null );

		// Collapse runs of consecutive messages from the same author
		const rows = computed( () => {
			let previousFrom = null;
			return messagesFor( state.activeSlug ).map( ( chatMessage ) => {
				const grouped = chatMessage.type === 'chat' && chatMessage.from === previousFrom;
				previousFrom = chatMessage.type === 'chat' ? chatMessage.from : null;
				return { ...chatMessage, grouped, time: timeLabel( chatMessage.sentAt ) };
			} );
		} );

		const scrollToBottom = () => {
			nextTick( () => {
				if ( scroller.value ) {
					scroller.value.scrollTop = scroller.value.scrollHeight;
				}
			} );
		};

		onMounted( scrollToBottom );
		watch( () => rows.value.length, scrollToBottom );
		watch( () => state.activeSlug, scrollToBottom );

		return { rows, scroller };
	},
	template: `
		<div class="messages" ref="scroller">
			<p v-if="!rows.length" class="messages__empty">No messages yet. Say something.</p>
			<div
				v-for="row in rows"
				:key="row.id"
				class="message"
				:class="{ 'message--system': row.type === 'system', 'message--grouped': row.grouped }"
			>
				<template v-if="row.type === 'system'">
					<span class="message__system-text">{{ row.text }}</span>
				</template>
				<template v-else>
					<div class="message__avatar" v-if="!row.grouped">{{ row.from.slice( 0, 1 ).toUpperCase() }}</div>
					<div class="message__avatar message__avatar--blank" v-else></div>
					<div class="message__body">
						<div class="message__meta" v-if="!row.grouped">
							<span class="message__from">{{ row.from }}</span>
							<span class="message__time">{{ row.time }}</span>
						</div>
						<div class="message__text">{{ row.text }}</div>
					</div>
				</template>
			</div>
		</div>
	`
};
