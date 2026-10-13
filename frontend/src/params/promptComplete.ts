/** Suggestions for a prompt box: `<tag:...>` prompt syntax, and words from the user's
 *  autocompletion list. Ported from PromptTabCompleteClass (src/wwwroot/js/genpage/gentab/
 *  prompttools.js:3), which is also where the syntax descriptions come from - they are passed
 *  through `tDynamic` by their English text, the same as any other legacy-defined string. */

import { tDynamic } from '@/i18n';

/** One entry of the user's autocompletion list (Settings > AutoComplete > Source). */
export interface WordEntry {
    /** Text to insert. The server has already applied the user's spacing, escaping and suffix. */
    insert: string;
    /** Text to show. */
    display: string;
    /** `display` lowercased, spaces as underscores - what typed words are matched against. */
    low: string;
    /** Booru tag category, which picks the row's colour. */
    tag: string;
    count: number;
    alts: string[];
}

/** Parses GetMyUserData's `autocompletions`: one "insert\ndisplay[\ntag[\ncount[\nalts]]]" string
 *  per entry (AutoCompleteListHelper.GetData, read by loadUserData in
 *  src/wwwroot/js/genpage/main.js:331). Null when the user has no list selected. */
export function parseWordList(raw: string[] | null | undefined): WordEntry[] | null {
    if (!raw) {
        return null;
    }
    return raw.map(line => {
        const split = line.split('\n');
        const display = split[1] ?? split[0];
        return {
            insert: split[0],
            display,
            low: display.replaceAll(' ', '_').toLowerCase(),
            tag: split[2] ?? '0',
            count: parseInt(split[3] ?? '') || 0,
            alts: split.length > 4 ? split[4].split(',').map(alt => alt.trim().toLowerCase()) : []
        };
    });
}

/** A model a `<lora:...>`/`<embed:...>` suggestion can name. */
export interface NamedModel {
    name: string;
    /** Compat family badge, eg 'SDXL'. */
    badge: string | null;
}

/** Everything the suggestions are drawn from. */
export interface CompletionSources {
    words: WordEntry[] | null;
    /** AutoComplete.MatchMode: 'Bucketed', 'Contains' or 'StartsWith'. */
    matchMode: string;
    /** AutoComplete.SortMode: 'Active', 'Alphabetical', 'Frequency' or 'None'. */
    sortMode: string;
    wildcards: string[];
    /** Lines of one wildcard file: undefined while they load, null if it cannot be read. */
    wildcardLines: (name: string) => string[] | null | undefined;
    presets: string[];
    embeddings: NamedModel[];
    loras: NamedModel[];
    yoloModels: string[];
}

/** One row of the suggestion list. */
export interface Suggestion {
    label: string;
    /** Secondary text after the label: a syntax description, a hint, or a use count. */
    detail: string;
    badge: string | null;
    /** Booru tag category, for autocompletion-list words. */
    tag: string | null;
    /** Replaces the text from `from` up to the caret. Absent on hint rows, which only explain. */
    apply?: string;
    from: number;
}

export interface CompletionResult {
    suggestions: Suggestion[];
    /** True while a wildcard's lines are still loading; ask again once they arrive. */
    waiting: boolean;
}

/** What a syntax completer can hand back for the text after `<prefix:`. */
type CompleterItem =
    /** Explanatory text, not selectable. */
    | { hint: string }
    /** Becomes `<prefix:value>`. */
    | { value: string }
    /** Inserted as-is, replacing the whole tag typed so far. */
    | { raw: string; label?: string; badge?: string | null };

type Completer = (suffix: string, prompt: string, sources: CompletionSources) => CompleterItem[] | 'waiting';

interface PromptPrefix {
    description: string;
    completer: Completer;
    /** Written as a bare `<name>` with no value. */
    selfStanding: boolean;
    /** An alternate spelling: completes like its original, but is not offered itself. */
    isAlt: boolean;
}

function hints(...lines: string[]): CompleterItem[] {
    return lines.map(line => ({ hint: tDynamic(line) }));
}

/** Items whose name contains `needle`, those starting with it first. */
function orderedMatches<T>(items: T[], needleLow: string, nameOf: (item: T) => string): T[] {
    const matched = items.filter(item => nameOf(item).toLowerCase().includes(needleLow));
    const prefixed = matched.filter(item => nameOf(item).toLowerCase().startsWith(needleLow));
    const rest = matched.filter(item => !nameOf(item).toLowerCase().startsWith(needleLow));
    return prefixed.concat(rest);
}

function orderedValues(items: string[], needle: string): CompleterItem[] {
    return orderedMatches(items, needle.toLowerCase(), item => item).map(value => ({ value }));
}

function modelTags(prefix: string, models: NamedModel[], needle: string): CompleterItem[] {
    return orderedMatches(models, needle.toLowerCase(), model => model.name).map(model => {
        const raw = `<${prefix}:${model.name}>`;
        return { raw, label: raw, badge: model.badge };
    });
}

/** Names captured by `<setvar[name]:` or `<setmacro[name]:` earlier in the prompt. */
function savedNames(prompt: string, tag: string, needle: string): CompleterItem[] {
    const needleLow = needle.toLowerCase();
    const names: CompleterItem[] = [];
    for (const match of prompt.matchAll(new RegExp(`<${tag}\\[(.*?)\\]:`, 'g'))) {
        const name = match[1].split(',')[0];
        if (name.toLowerCase().includes(needleLow)) {
            names.push({ value: name });
        }
    }
    return names;
}

const PREFIXES: Record<string, PromptPrefix> = {};

function register(name: string, description: string, completer: Completer, selfStanding = false): void {
    PREFIXES[name] = { description, completer, selfStanding, isAlt: false };
}

function registerAlt(name: string, copyFrom: string): void {
    PREFIXES[name] = { ...PREFIXES[copyFrom], isAlt: true };
}

const none: Completer = () => [];

/** The prefix a bracketed tag as actually typed belongs to, eg `random[2]` to the `random[2-4]`
 *  registered as its example. Null when the name has no brackets, or no tag of that name takes any. */
function bracketedPrefix(name: string): PromptPrefix | null {
    const bracket = name.indexOf('[');
    if (bracket <= 0) {
        return null;
    }
    const base = name.substring(0, bracket + 1);
    const found = Object.entries(PREFIXES).find(([registered]) => registered.startsWith(base));
    return found ? found[1] : null;
}

register('random', 'Select from a set of random words to include', () =>
    hints(
        'Specify a comma-separated list of words to choose from, like "<random:cat,dog,elephant>".',
        'You can use "||" instead of "," if you need to include commas in your values.',
        'You can use eg "1-5" to pick a random number in a range.'
    )
);
register('random[2-4]', 'Selects multiple options from a set of random words to include', () =>
    hints(
        'Specify a comma-separated list of words to choose from, like "<random[2]:cat,dog,elephant>".',
        'You can use "||" instead of "," if you need to include commas in your values. You can use eg "1-5" to pick a random number in a range.',
        'Put a comma in the input (eg "random[2,]:") to make the output have commas too.'
    )
);
register('alternate', 'Cause multiple different words or phrases to be alternated between.', () =>
    hints(
        'Specify a comma-separated list of words to choose from, like "<alternate:cat,dog>".',
        'You can use "||" instead of "," if you need to include commas in your values.'
    )
);
register('fromto[0.5]', 'Have the prompt change after a given timestep.', () =>
    hints(
        'Specify in the brackets a timestep like 10 (for step 10) or 0.5 (for halfway through).',
        'In the data area specify the before and the after separate by "," or "|".',
        'For example, "<fromto[10]:cat,dog>" switches from "cat" to "dog" at step 10.'
    )
);
register('weight[1.5]', 'Change how strongly the model attends to a section of the prompt.', () =>
    hints(
        'Use like "<weight[1.5]:some text>" to apply a weight of 1.5 to "some text".',
        'Values above 1 are more important, values below 1 (eg 0.5) are less important.',
        'Some text encoders such as CLIP natively support weighting. Others it is hacked-in with conditioning multiplication (this may have side effects!).',
        'You can also hold Control and press the up/down arrow keys to change the weight of selected text.'
    )
);
register('wildcard', 'Select a random line from a wildcard file (presaved list of options)', (suffix, _prompt, sources) => {
    const colon = suffix.indexOf(':');
    if (colon === -1) {
        return orderedValues(sources.wildcards, suffix);
    }
    // `<wildcard:name:text` picks one line of that wildcard, written in place of the whole tag.
    const nameLow = suffix.substring(0, colon).trim().toLowerCase();
    const name = sources.wildcards.find(card => card.toLowerCase() === nameLow);
    if (name === undefined) {
        return hints('Wildcard not found');
    }
    const lines = sources.wildcardLines(name);
    if (lines === undefined) {
        return 'waiting';
    }
    if (lines === null) {
        return hints('Wildcard not found');
    }
    return orderedMatches(lines, suffix.substring(colon + 1).toLowerCase(), line => line).map(raw => ({ raw }));
});
registerAlt('wc', 'wildcard');
register(
    'wildcard[2-4]',
    'Select multiple random lines from a wildcard file (presaved list of options) (works same as "random" but for wildcards)',
    (suffix, _prompt, sources) => orderedValues(sources.wildcards, suffix)
);
register('repeat[3]', 'Repeat a value several times', () =>
    hints(
        'Use for example like "<repeat[3]:very> big" to get "very very very big",',
        'or "<repeat[1-3]:very>" to get randomly between 1 to 3 "very"s,',
        'or <repeat[3]:<random:cat,dog>>" to get "cat" or "dog" 3 times in a row eg "cat dog cat".'
    )
);
register(
    'preset',
    'Forcibly apply a preset onto the current generation (useful eg inside wildcards or other automatic inclusions - normally use the Presets UI tab)',
    (suffix, _prompt, sources) => orderedValues(sources.presets, suffix)
);
registerAlt('p', 'preset');
register('param', 'Read a raw parameter value.', () =>
    hints('Read a parameter value, for example "<param:CFG Scale>" or "<param:cfgscale>" to read the value of CFG Scale.')
);
register('param[param_id]', 'Set a raw parameter value directly.', () =>
    hints(
        'Set a parameter value directly, for example "<param[CFG Scale]:1>" or "<param[cfgscale]:1>" to set CFG Scale to 1.',
        'You can combine with sub-syntax, eg "<param[cfgscale]:<random:1,2,3>>" to set CFG Scale to a random value.'
    )
);
register('embed', 'Use a pretrained CLIP TI Embedding', (suffix, _prompt, sources) => modelTags('embed', sources.embeddings, suffix));
registerAlt('embedding', 'embed');
register(
    'lora',
    'Forcibly apply a pretrained LoRA model (useful eg inside wildcards or other automatic inclusions - normally use the LoRAs UI tab)',
    (suffix, _prompt, sources) => modelTags('lora', sources.loras, suffix)
);
register('region', 'Apply a different prompt to a sub-region within the image', () =>
    hints(
        'x,y,width,height eg "0.25,0.25,0.5,0.5"',
        'or x,y,width,height,strength eg "0,0,1,1,0.5"',
        'where strength is how strongly to apply the prompt to the region (vs global prompt). Can do "region:background" for background-only region.'
    )
);
register('object', 'Select a sub-region inside the image and inpaint over it with a different prompt', () =>
    hints(
        'x,y,width,height eg "0.25,0.25,0.5,0.5"',
        'or x,y,width,height,strength,strength2 eg "0,0,1,1,0.5,0.4"',
        'where strength is how strongly to apply the prompt to the region (vs global prompt) on the general pass, and strength2 is how strongly to inpaint (ie InitImageCreativity).'
    )
);
register('extend', 'Use an Image2Video model to extend a video repeatedly', () =>
    hints(
        'Input is a frame count, also follow this tag with a prompt for the section.\nFor example, "<extend:81> the cat runs" to add an 81 frame clip of your cat running.\nSee also the "Video Extend" parameter group.'
    )
);
register(
    'segment',
    'Automatically segment an area by CLIP matcher and inpaint it (optionally with a unique prompt)',
    (suffix, _prompt, sources) => {
        if (suffix.toLowerCase().startsWith('yolo-') && sources.yoloModels.length > 0) {
            return orderedValues(
                sources.yoloModels.map(model => `yolo-${model}`),
                suffix
            );
        }
        return hints(
            'Specify before the ">" some text to match against in the image, like "<segment:face>".',
            'Can also do "<segment:text,creativity,threshold>" eg "face,0.6,0.5" where creativity is InitImageCreativity, and threshold is mask matching threshold for CLIP-Seg.',
            'You can use a negative threshold value like "<segment:face,0.6,-0.5>" to invert the mask.',
            'You may use the "yolo-" prefix to use a YOLOv8 seg model,',
            'For more advanced usages and a link to relevant docs, click the "+" button next to the prompt box, then "Auto Segment Refinement".'
        );
    }
);
register('setvar[var_name]', 'Store text for reference later in the prompt', () =>
    hints(
        'Save the content of the tag into the named variable. eg "<setvar[colors]: red and blue>", then use like "<var:colors>"',
        'Variables can include the results of other tags. eg "<setvar[expression]: <random: smiling|frowning|crying>>"',
        'Reference stored values later in the prompt with the <var:> tag',
        'The setvar tag emits a copy the variable value in place. You can not do this with eg "<setvar[colors,false]: red and blue>"'
    )
);
register('var', 'Reference a previously saved variable later', (suffix, prompt) => {
    const names = savedNames(prompt, 'setvar', suffix);
    return names.length > 0
        ? names
        : hints(
            'Recall a value previously saved with <setvar[name]:...>, use like "<var:name>"',
            '"setvar" must be used earlier in the prompt, then "var" later'
        );
});
register('setmacro[macro_name]', 'Store raw text for reference later in the prompt', () =>
    hints(
        'Save the raw content of the tag into the named macro. eg "<setmacro[color]:<random:red|blue|green>>", then use like "<macro:color>"',
        'Macro content will be re-evaluated each time it is used eg "<macro:color> hair, <macro:color> eyes" might produce "red hair, blue eyes',
        'Reference macros later in the prompt with the <macro:> tag',
        'The setmacro tag emits a copy the variable value in place. You can not do this with eg "<setmacro[colors,false]: red and blue>"'
    )
);
register('macro', 'Reference a previously saved macro', (suffix, prompt) => {
    const names = savedNames(prompt, 'setmacro', suffix);
    return names.length > 0
        ? names
        : hints(
            'Recall a macro previously saved with <setmacro[name]:...>, use like "<macro:name>"',
            '"setmacro" must be used earlier in the prompt, then "macro" later'
        );
});
register(
    'clear',
    'Automatically clear part of the image to transparent (by CLIP segmentation matching) (iffy quality, prefer the Remove Background parameter over this)',
    () => hints('Specify before the ">" some text to match against in the image, like "<segment:background>"')
);
register('break', 'Split this prompt across multiple lines of conditioning to the model (helps separate concepts for long prompts).', none, true);
register('base', 'Add a section of prompt text that is only used for the Base pass (excluding refiner/i2v/etc).', none, true);
register('refiner', 'Add a section of prompt text that is only used for the Refine/Upscale pass.', none, true);
register('pixeldecoder', 'Add a section of prompt text that is only used for the PiD pixel-decoder upscale pass.', none, true);
register('video', 'Add a section of prompt text that replaces the prompt for the image-to-video generation pass.', none, true);
register('videoswap', 'Add a section of prompt text that replaces the prompt for the image-to-video Swap pass (eg Wan 2.2 lownoise).', none, true);
register('trigger', "Automatically fills with the current model or LoRA's trigger phrase(s), if any.", none, true);
register('comment', "Add a discarded personal comment. Will not be treated as part of the 'real prompt'.", () =>
    hints('This is a personal comment, write a note to yourself.')
);

/** The most autocompletion-list words shown at once. */
const WORD_LIMIT = 50;

/** Where the word being typed starts: after the last space, comma, period or newline. */
function lastWordIndex(text: string): number {
    let index = -1;
    for (const cut of [' ', ',', '.', '\n']) {
        index = Math.max(index, text.lastIndexOf(cut));
    }
    return index + 1;
}

function sortWords(list: WordEntry[], sortMode: string): void {
    if (sortMode === 'Active') {
        list.sort((a, b) => a.low.length - b.low.length || a.low.localeCompare(b.low));
    }
    else if (sortMode === 'Alphabetical') {
        list.sort((a, b) => a.low.localeCompare(b.low));
    }
    else if (sortMode === 'Frequency') {
        list.sort((a, b) => b.count - a.count);
    }
    // 'None' keeps the list's own order.
}

/** Compact count, eg 1.2K or 3.4M. Mirrors largeCountStringify (src/wwwroot/js/util.js:821). */
function compactCount(count: number): string {
    if (count > 1e9) {
        return `${(count / 1e9).toFixed(1)}B`;
    }
    if (count > 1e6) {
        return `${(count / 1e6).toFixed(1)}M`;
    }
    if (count > 1e3) {
        return `${(count / 1e3).toFixed(1)}K`;
    }
    return `${count}`;
}

/** Works out suggestions for one prompt box. Holds the last word-list search, so that typing one
 *  more letter narrows the previous matches instead of scanning a list that can run to hundreds of
 *  thousands of tags again. */
export class PromptCompleter {
    private lastWords: WordEntry[] | null = null;
    private lastWord: string | null = null;
    private lastMatches: WordEntry[] = [];

    /** Suggestions for `text` with the caret at `caret`. */
    complete(text: string, caret: number, sources: CompletionSources): CompletionResult {
        const prompt = text.substring(0, caret);
        const lastBrace = prompt.lastIndexOf('<');
        if (lastBrace === -1 || prompt.lastIndexOf('>') > lastBrace) {
            return { suggestions: this.matchWords(prompt, sources), waiting: false };
        }
        const content = prompt.substring(lastBrace + 1);
        const colon = content.indexOf(':');
        if (colon === -1) {
            const typed = content.toLowerCase();
            const suggestions = Object.entries(PREFIXES)
                .filter(([name, prefix]) => !prefix.isAlt && name.toLowerCase().startsWith(typed))
                .map(([name, prefix]) => ({
                    label: name,
                    detail: tDynamic(prefix.description),
                    badge: null,
                    tag: null,
                    apply: prefix.selfStanding ? `<${name}>` : `<${name}:`,
                    from: lastBrace
                }));
            return { suggestions, waiting: false };
        }
        const name = content.substring(0, colon);
        const prefix = PREFIXES[name] ?? bracketedPrefix(name);
        if (!prefix) {
            return { suggestions: [], waiting: false };
        }
        const items = prefix.completer(content.substring(colon + 1), prompt, sources);
        if (items === 'waiting') {
            return { suggestions: [], waiting: true };
        }
        const suggestions = items.map((item): Suggestion => {
            if ('hint' in item) {
                return { label: '', detail: item.hint, badge: null, tag: null, from: lastBrace };
            }
            if ('value' in item) {
                const apply = `<${name}:${item.value}>`;
                return { label: apply, detail: '', badge: null, tag: null, apply, from: lastBrace };
            }
            return { label: item.label ?? item.raw, detail: '', badge: item.badge ?? null, tag: null, apply: item.raw, from: lastBrace };
        });
        return { suggestions, waiting: false };
    }

    private matchWords(prompt: string, sources: CompletionSources): Suggestion[] {
        const wordStart = lastWordIndex(prompt);
        const word = prompt.substring(wordStart);
        const words = sources.words;
        if (word.length <= 1 || !words) {
            return [];
        }
        const wordLow = word.toLowerCase();
        const narrowing = this.lastWords === words && this.lastWord !== null && word.startsWith(this.lastWord);
        const pool = narrowing ? this.lastMatches : words;
        const startsWith: WordEntry[] = [];
        const altStartsWith: WordEntry[] = [];
        const contains: WordEntry[] = [];
        const all: WordEntry[] = [];
        for (const entry of pool) {
            if (!entry.low.includes(wordLow) && !entry.alts.some(alt => alt.includes(wordLow))) {
                continue;
            }
            if (entry.low.startsWith(wordLow)) {
                startsWith.push(entry);
            }
            else if (entry.alts.some(alt => alt.startsWith(wordLow))) {
                altStartsWith.push(entry);
            }
            else {
                contains.push(entry);
            }
            all.push(entry);
        }
        this.lastWords = words;
        this.lastWord = word;
        this.lastMatches = all;
        let list: WordEntry[] = [];
        if (sources.matchMode === 'Contains') {
            list = [...all];
            sortWords(list, sources.sortMode);
        }
        else if (sources.matchMode === 'StartsWith') {
            sortWords(startsWith, sources.sortMode);
            sortWords(altStartsWith, sources.sortMode);
            list = startsWith.concat(altStartsWith);
        }
        else {
            sortWords(startsWith, sources.sortMode);
            sortWords(altStartsWith, sources.sortMode);
            sortWords(contains, sources.sortMode);
            list = startsWith.concat(altStartsWith, contains);
        }
        return list.slice(0, WORD_LIMIT).map(entry => ({
            label: entry.display,
            detail: entry.count ? compactCount(entry.count) : '',
            badge: null,
            tag: entry.tag,
            apply: entry.insert,
            from: wordStart
        }));
    }
}
