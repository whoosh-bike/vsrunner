// Generates media/icons/{light,dark}/*.svg, media/activitybar.svg and media/icon.png
// from one set of glyphs, so both themes and the marketplace icon share the design tokens
// documented in docs/icons.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const TOKENS = {
	// Sampled from the Whoosh app icon: slate tile, amber underline, white mark.
	yellow: '#FDB52B',
	graphite: '#4E5761',
	white: '#FFFFFF',
	red: '#F05A50',
	// Pure yellow washes out on white, so the light theme uses a deeper amber accent.
	light: { ink: '#4E5761', muted: '#9AA1A9', accent: '#F2A20C' },
	dark: { ink: '#D3D8DE', muted: '#7D8792', accent: '#FDB52B' },
};

// 16×16 grid, 1.5px stroke, round caps and joins. INK is the theme foreground,
// MUTED the secondary line, ACC the brand yellow: one yellow detail per glyph.
const GLYPHS = {
	build: `<path d="M3 13.5 8.5 8" stroke="INK"/><path d="M7 4.5 9.5 2l4.5 4.5L11.5 9z" fill="ACC" stroke="ACC"/>`,
	clean: `<path d="M10.5 2 7.5 7" stroke="INK"/><path d="M4.5 7h6l1 7h-8z" stroke="INK"/><path d="M5.5 10.5v3.5M8 10.5v3.5" stroke="ACC"/>`,
	rebuild: `<path d="M13 8a5 5 0 1 1-1.5-3.6" stroke="INK"/><path d="M12 1.5v3h-3" stroke="INK"/><circle cx="8" cy="8" r="1.75" fill="ACC" stroke="ACC"/>`,
	stop: `<rect x="3.5" y="3.5" width="9" height="9" rx="2" fill="RED" stroke="RED"/>`,
	run: `<path d="M5 3v10l8-5z" fill="ACC" stroke="ACC"/>`,
	flash: `<path d="M9 1.5 4 9h4l-1 5.5L12 7H8z" fill="ACC" stroke="ACC"/>`,
	analyze: `<path d="M2.5 13.5h11" stroke="INK"/><path d="M4.5 11V8M8 11V3.5" stroke="INK"/><path d="M11.5 11V6" stroke="ACC"/>`,
	terminal: `<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" stroke="INK"/><path d="m4.5 6 2 2-2 2" stroke="ACC"/><path d="M8.5 10.5h3" stroke="INK"/>`,
	publish: `<path d="M8 10.5V2.5M5 5.5l3-3 3 3" stroke="ACC"/><path d="M2.5 10v3.5h11V10" stroke="INK"/>`,
	chip: `<rect x="4" y="4" width="8" height="8" rx="1.5" stroke="INK"/><rect x="6.5" y="6.5" width="3" height="3" fill="ACC" stroke="ACC" stroke-width="1"/><path d="M6.5 1.5V4M9.5 1.5V4M6.5 12v2.5M9.5 12v2.5M1.5 6.5H4M1.5 9.5H4M12 6.5h2.5M12 9.5h2.5" stroke="MUTED"/>`,
	board: `<rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1.5" stroke="INK"/><circle cx="5" cy="8" r="1.5" fill="ACC" stroke="ACC"/><path d="M8.5 6.5h3M8.5 9.5h3" stroke="MUTED"/>`,
	target: `<path d="m8 1.75 5.75 3.25v6L8 14.25 2.25 11V5z" stroke="INK"/><path d="M2.5 5.25 8 8.5l5.5-3.25M8 8.5v5.5" stroke="INK"/><path d="m8 1.75 5.75 3.25L8 8.5 2.25 5z" fill="ACC" stroke="ACC" stroke-width="1"/>`,
	tag: `<path d="M2 2.5v5l6.5 6.5 5-5L7 2.5z" stroke="INK"/><circle cx="5" cy="5.5" r="1.25" fill="ACC" stroke="ACC"/>`,
	text: `<rect x="1.75" y="4.25" width="12.5" height="7.5" rx="1.5" stroke="INK"/><path d="M5 6.5v3" stroke="ACC"/>`,
	toggle: `<rect x="1.75" y="4.25" width="12.5" height="7.5" rx="3.75" stroke="INK"/><circle cx="10.5" cy="8" r="2" fill="ACC" stroke="ACC"/>`,
	option: `<path d="M2.5 4.5h11M2.5 11.5h11" stroke="INK"/><circle cx="5.5" cy="4.5" r="1.75" fill="ACC" stroke="ACC"/><circle cx="10.5" cy="11.5" r="1.75" fill="BG" stroke="INK"/>`,
	selected: `<circle cx="8" cy="8" r="5.5" fill="ACC" stroke="ACC"/><path d="m5.5 8 1.75 1.75L10.75 6.25" stroke="GRAPHITE"/>`,
	unselected: `<circle cx="8" cy="8" r="5" stroke="MUTED"/>`,
	success: `<circle cx="8" cy="8" r="5.75" stroke="ACC"/><path d="m5.5 8 1.75 1.75L10.75 6.25" stroke="ACC"/>`,
	failure: `<circle cx="8" cy="8" r="5.75" stroke="RED"/><path d="m6 6 4 4m0-4-4 4" stroke="RED"/>`,
};

function svg(body, palette, size = 16) {
	const filled = body
		.replaceAll('INK', palette.ink)
		.replaceAll('MUTED', palette.muted)
		.replaceAll('ACC', palette.accent ?? TOKENS.yellow)
		.replaceAll('RED', TOKENS.red)
		.replaceAll('GRAPHITE', TOKENS.graphite)
		.replaceAll('BG', 'none');
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${filled}</svg>\n`;
}

for (const theme of ['light', 'dark']) {
	const dir = `media/icons/${theme}`;
	mkdirSync(dir, { recursive: true });
	for (const [name, body] of Object.entries(GLYPHS)) {
		writeFileSync(`${dir}/${name}.svg`, svg(body, TOKENS[theme]));
	}
}

// The activity bar masks icons to one theme colour, so this one is a pure silhouette.
writeFileSync('media/activitybar.svg',
	`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
<rect x="6" y="6" width="12" height="12" rx="2.5"/>
<path d="M9.5 2.5V6M14.5 2.5V6M9.5 18v3.5M14.5 18v3.5M2.5 9.5H6M2.5 14.5H6M18 9.5h3.5M18 14.5h3.5"/>
<path d="m10.5 9.25 4 2.75-4 2.75z" fill="currentColor"/>
</svg>
`);

// Marketplace icon in the app-icon style: white chip-and-play mark over the amber
// bar that runs off the left edge of the slate tile.
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<defs><clipPath id="tile"><rect width="256" height="256" rx="56"/></clipPath></defs>
<g clip-path="url(#tile)">
<rect width="256" height="256" fill="${TOKENS.graphite}"/>
<rect x="0" y="170" width="212" height="32" fill="${TOKENS.yellow}"/>
</g>
<g stroke="${TOKENS.white}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none">
<rect x="80" y="44" width="96" height="96" rx="16"/>
<path d="M104 22v22M152 22v22M58 76h22M58 108h22M176 76h22M176 108h22"/>
</g>
<path d="M114 72v40l32-20z" fill="${TOKENS.white}" stroke="${TOKENS.white}" stroke-width="8" stroke-linejoin="round"/>
</svg>`;
writeFileSync('media/icon.svg', icon + '\n');
writeFileSync('media/icon.png', new Resvg(icon, { fitTo: { mode: 'width', value: 256 } }).render().asPng());

// Contact sheet for docs/icons.md.
const names = Object.keys(GLYPHS);
const cell = 40;
const sheet = ['light', 'dark'].map((theme, row) => {
	const bg = theme === 'light' ? '#FFFFFF' : '#1E2227';
	const glyphs = names.map((n, i) =>
		`<g transform="translate(${12 + i * cell} ${row * 56 + 12}) scale(2)">${svg(GLYPHS[n], TOKENS[theme]).replace(/<svg[^>]*>|<\/svg>\n/g, '')}</g>`).join('');
	return `<rect y="${row * 56}" width="${names.length * cell + 16}" height="56" fill="${bg}"/><g fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${glyphs}</g>`;
}).join('');
const sheetSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${names.length * cell + 16}" height="112">${sheet}</svg>`;
mkdirSync('docs', { recursive: true });
writeFileSync('docs/icons.png', new Resvg(sheetSvg, { fitTo: { mode: 'zoom', value: 2 } }).render().asPng());
console.log(`${names.length} glyphs × 2 themes, icon.png, activitybar.svg, docs/icons.png`);
