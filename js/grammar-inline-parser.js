/**
 * grammar-inline-parser.js
 * Parses [[UID::TEXT]] inline grammar markers in lesson paragraphs, and the
 * [[TEXT]] markers without a uid in example sentences (lesson grammar points,
 * grammar details). Returns array of segments: {type:'text',text} or
 * {type:'grammar',uid,text}; uid is '' for a marker without one.
 */
var GrammarInlineParser = {
    MARKER_RE: /\[\[(?:([^\]]+?)::)?([^\]]+?)\]\]/g,

    /**
     * Parse a raw paragraph string into segments.
     * @param {string} raw - Raw paragraph text
     * @returns {Array<{type:string, text:string, uid?:string}>}
     */
    parse: function(raw) {
        if (!raw) return [{ type: 'text', text: '' }];
        var segments = [];
        var lastIndex = 0;
        var match;
        // Reset regex
        this.MARKER_RE.lastIndex = 0;
        while ((match = this.MARKER_RE.exec(raw)) !== null) {
            // Text before this match
            if (match.index > lastIndex) {
                segments.push({ type: 'text', text: raw.slice(lastIndex, match.index) });
            }
            segments.push({ type: 'grammar', uid: match[1] || '', text: match[2] });
            lastIndex = this.MARKER_RE.lastIndex;
        }
        // Remaining text
        if (lastIndex < raw.length) {
            segments.push({ type: 'text', text: raw.slice(lastIndex) });
        }
        if (segments.length === 0) {
            segments.push({ type: 'text', text: raw });
        }
        return segments;
    },

    /**
     * Escaped HTML of a marked string, each marked part in <strong>.
     * @param {string} raw - Text with [[UID::TEXT]] or [[TEXT]] markers
     * @returns {string}
     */
    renderStrong: function(raw) {
        var segments = this.parse(raw == null ? '' : String(raw));
        var h = '';
        for (var i = 0; i < segments.length; i++) {
            var text = window.JPLearn.html.escape(segments[i].text);
            h += segments[i].type === 'grammar' ? '<strong>' + text + '</strong>' : text;
        }
        return h;
    }
};
