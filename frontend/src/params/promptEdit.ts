/** Keyboard edits for prompt boxes: Ctrl+Up/Down to change the weight of the selected text, and
 *  Alt+Left/Right to move a comma-separated tag. Both are ported from textPromptAddKeydownHandler
 *  (src/wwwroot/js/site.js:355) so a prompt edited in either UI comes out the same. */

/** A prompt box's text and selection after an edit. */
export interface PromptEdit {
    text: string;
    selStart: number;
    selEnd: number;
}

/** Rounds away float noise, so 1.1 + 0.1 reads 1.2 rather than 1.2000000000000002. */
function cleanNumber(value: number): string {
    return `${parseFloat(value.toFixed(5))}`;
}

/** Raises or lowers the weight of the selection, or of the word at the caret when nothing is
 *  selected, by `step`. Writes Swarm's `<weight[1.2]:text>` form, and reads that back as well as
 *  the Comfy/A1111 `(text:1.2)` and `(text)` forms, so an existing weight is adjusted rather than
 *  nested. A weight that lands on 1 removes the wrapper. Null when there is nothing to weight. */
export function shiftPromptWeight(text: string, selStart: number, selEnd: number, up: boolean, step: number): PromptEdit | null {
    if (selStart === selEnd) {
        let simpleText = text;
        for (const char of ['\n', '\t', ',', '.']) {
            simpleText = simpleText.replaceAll(char, ' ');
        }
        const lastSpace = simpleText.lastIndexOf(' ', selStart - 1);
        selStart = lastSpace === -1 ? 0 : lastSpace + 1;
        const nextSpace = simpleText.indexOf(' ', selStart);
        selEnd = nextSpace === -1 ? simpleText.length : nextSpace;
    }
    let before = text.substring(0, selStart);
    let after = text.substring(selEnd);
    let mid = text.substring(selStart, selEnd);
    if (mid.trim() === '') {
        return null;
    }
    let strength = 1;
    while (mid.startsWith(' ')) {
        mid = mid.substring(1);
        before = before + ' ';
    }
    while (mid.endsWith(' ')) {
        mid = mid.substring(0, mid.length - 1);
        after = ' ' + after;
    }
    const weightPrefix = before.match(/<weight\[([0-9.-]*)\]:$/);
    if (weightPrefix && after.startsWith('>')) {
        before = before.substring(0, before.length - weightPrefix[0].length);
        strength = parseFloat(weightPrefix[1]);
        after = after.substring(1);
    }
    else {
        const parsedWeight = mid.match(/^<weight\[([0-9.-]*)\]:(.*)>$/);
        if (parsedWeight) {
            strength = parseFloat(parsedWeight[1]);
            mid = parsedWeight[2];
        }
        else {
            if (mid.startsWith('(')) {
                before += mid.substring(0, 1);
                mid = mid.substring(1);
            }
            // Matches a trailing ":1.5)", ")" or ":1.5", unless backslash-escaped. Also matches
            // empty, hence the check on the match itself.
            const matched = mid.trim().match(/(?<![\\])(?::[0-9.-]*)?\)?$/);
            if (matched && matched[0]) {
                after = mid.substring(mid.length - matched[0].length) + after;
                mid = mid.substring(0, mid.length - matched[0].length);
            }
            if (before.trimEnd().endsWith('(') && after.trimStart().startsWith(':')) {
                const postColon = after.trimStart().substring(1);
                let paren = postColon.indexOf(')');
                while (paren > 0 && postColon.substring(paren - 1).startsWith('\\)')) {
                    paren = postColon.indexOf(')', paren + 1);
                }
                if (paren !== -1) {
                    before = before.trimEnd();
                    before = before.substring(0, before.length - 1);
                    strength = parseFloat(postColon.substring(0, paren).trim());
                    after = postColon.substring(paren + 1);
                }
            }
            else if (before.trimEnd().endsWith('(') && after.trimStart().startsWith(')')) {
                before = before.trimEnd();
                before = before.substring(0, before.length - 1);
                strength = 1.1;
                after = after.trimStart().substring(1);
            }
        }
    }
    const weight = cleanNumber(strength + (up ? step : -step));
    if (weight === '1') {
        return { text: `${before}${mid}${after}`, selStart: before.length, selEnd: before.length + mid.length };
    }
    const tagStart = `<weight[${weight}]:`;
    const start = before.length + tagStart.length;
    return { text: `${before}${tagStart}${mid}>${after}`, selStart: start, selEnd: start + mid.length };
}

/** Swaps the comma-separated section holding the caret with its neighbour to the left or right,
 *  keeping the caret and selection on the moved section. Null at either end. */
export function moveCommaSeparatedTag(text: string, selStart: number, selEnd: number, left: boolean): PromptEdit | null {
    const parts = text.split(',');
    let textIndex = 0;
    let index = -1;
    for (let i = 0; i < parts.length; i++) {
        const len = parts[i].length + 1;
        if (selStart >= textIndex && selStart < textIndex + len) {
            index = i;
            break;
        }
        textIndex += len;
    }
    if (index === -1) {
        return null;
    }
    const swapIndex = left ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= parts.length) {
        return null;
    }
    [parts[index], parts[swapIndex]] = [parts[swapIndex], parts[index]];
    let newText = '';
    let newCursor = 0;
    for (let i = 0; i < parts.length; i++) {
        if (i > 0) {
            newText += ',';
        }
        if (i === swapIndex) {
            newCursor = newText.length + (selStart - textIndex);
        }
        newText += parts[i];
    }
    return { text: newText, selStart: newCursor, selEnd: newCursor + (selEnd - selStart) };
}
