import { reactive } from 'vue';

/**
 * Theme preference. '' means follow the OS, which is the default; the two
 * explicit modes only set `color-scheme` on the root element, and light-dark()
 * in app.css does the rest.
 *
 * The key is also read by an inline script in index.bxm so an explicit choice is
 * applied before first paint -- keep the two in sync.
 */
const STORAGE_THEME = 'stomp.theme';
const MODES = [ '', 'light', 'dark' ];

function readMode() {
	try {
		const stored = localStorage.getItem( STORAGE_THEME ) || '';
		return MODES.includes( stored ) ? stored : '';
	} catch ( e ) {
		return '';
	}
}

export const theme = reactive( { mode: readMode() } );

export function applyTheme() {
	const root = document.documentElement;
	if ( theme.mode ) {
		root.dataset.theme = theme.mode;
	} else {
		delete root.dataset.theme;
	}
}

export function cycleTheme() {
	theme.mode = MODES[ ( MODES.indexOf( theme.mode ) + 1 ) % MODES.length ];
	try {
		if ( theme.mode ) {
			localStorage.setItem( STORAGE_THEME, theme.mode );
		} else {
			localStorage.removeItem( STORAGE_THEME );
		}
	} catch ( e ) { /* private mode; the choice just won't survive a reload */ }
	applyTheme();
}

export function themeLabel() {
	return theme.mode || 'auto';
}
