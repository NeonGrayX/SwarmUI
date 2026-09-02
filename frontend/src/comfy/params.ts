/** Turns a ComfyUI workflow into a set of Swarm generation parameters.
 *
 * This is a port of comfyBuildParams in
 * src/BuiltinExtensions/ComfyUIBackend/Assets/comfy_workflow_editor_helper.js, and deliberately
 * mirrors it step for step: the result is written into `comfyworkflowparammetadata` and read back
 * by the server (ComfyUIBackendExtension.DynamicParamGenerator), and saved workflows are shared
 * with the existing interface, so the two have to produce byte-comparable output.
 *
 * The shape of the job: every literal input of every node becomes a pseudo-parameter, and the node
 * input is rewritten to `${paramid:literal}` so the server can substitute a value back in (or fall
 * back to the literal when the client sends nothing). Inputs that map onto a real Swarm parameter -
 * the prompt, the model, the seed - are instead "claimed", so the normal control drives them.
 */

import type { ComfyGraph, ComfyObjectInfo, ComfyPrompt, ComfyPromptNode } from './bridge';

/** A group of generated parameters, one per workflow node (plus 'Primitives'). */
export interface ComfyParamGroupDef {
    name: string;
    id: string;
    open: boolean;
    priority: number;
    advanced: boolean;
    can_shrink: boolean;
    toggles: boolean;
}

/** One generated parameter, in the exact shape T2IParamType.FromNet reads back
 *  (src/Text2Image/T2IParamTypes.cs:162). Extra keys are ignored by the server and used here. */
export interface ComfyParamDef {
    name: string;
    id: string;
    type: string;
    subtype?: string | null;
    description: string;
    default: unknown;
    values: string[] | null;
    /** Absent when a `SwarmInput` node left it unset, which the server reads as its own default. */
    view_type?: string;
    min: number;
    max: number;
    view_max?: number;
    step: number;
    visible: boolean;
    toggleable: boolean;
    priority: number;
    advanced: boolean;
    feature_flag: string | null;
    do_not_save: boolean;
    no_popover: boolean;
    image_should_resize?: boolean;
    image_always_b64?: boolean;
    always_first?: boolean;
    extra_hidden?: boolean;
    group: ComfyParamGroupDef | null;
}

/** Everything the Generate panel needs to stand in for a Comfy workflow. */
export interface ComfyWorkflowInput {
    /** Generated parameters by id, including `comfyworkflowraw` and `comfyworkflowparammetadata`. */
    params: Record<string, ComfyParamDef>;
    /** Ids of real Swarm parameters the workflow claimed, which stay in the panel. */
    retained: string[];
    /** Values the workflow supplies for those claimed parameters. */
    paramVal: Record<string, string | number | boolean>;
}

/** One of the two parameters that carry the workflow itself into a generation: the rewritten
 *  prompt, and the definitions of every parameter above. Neither is shown - they exist to be sent,
 *  and the server reads the graph and its parameter types back out of them.
 *
 * Shaped exactly like the generated parameters around them, so a saved workflow reopened without a
 * Comfy editor (./saved.ts) can rebuild the pair from stored data. */
export function carrierParam(id: 'comfyworkflowraw' | 'comfyworkflowparammetadata', value: string): ComfyParamDef {
    return {
        name: id,
        default: value,
        id,
        type: 'text',
        description: `The ${id} input for Comfy Workflow (text)`,
        values: null,
        view_type: 'big',
        min: 0,
        max: 1,
        step: 1,
        visible: false,
        toggleable: false,
        priority: -999999,
        advanced: false,
        feature_flag: null,
        do_not_save: false,
        no_popover: true,
        extra_hidden: true,
        always_first: true,
        group: {
            name: 'Comfy Workflow',
            id: 'comfyworkflow',
            open: false,
            priority: -999999,
            advanced: true,
            can_shrink: true,
            toggles: false
        }
    };
}

export interface BuildComfyParamsOptions {
    workflow: ComfyGraph;
    /** Mutated in place: node inputs are rewritten to `${id:default}` placeholders. */
    prompt: ComfyPrompt;
    objectInfo: ComfyObjectInfo;
    /** Ids of the parameters the server actually registers, for `SwarmUI: name` primitive reuse. */
    knownParamIds: ReadonlySet<string>;
    /** Checkpoint names, for a checkpoint loader that could not be claimed as `model`. */
    allModels: string[];
    /** The user's ResetBatchSizeToOne preference. */
    resetBatchSizeToOne: boolean;
    /** True when the workflow is destined for generation, which needs an image-saving node.
     *  False when it is only being saved to disk. */
    requireSave: boolean;
}

/** Thrown when the workflow cannot be used for generation as it stands. */
export class ComfyWorkflowError extends Error {
    readonly reason: 'no-save-node';

    constructor(reason: 'no-save-node') {
        super(reason);
        this.name = 'ComfyWorkflowError';
        this.reason = reason;
    }
}

/** Nodes that write out an animation rather than an image, and so count as an output. */
const ALT_SAVE_NODES = [
    'ADE_AnimateDiffCombine',
    'VHS_VideoCombine',
    'SaveAnimatedWEBP',
    'SaveAnimatedPNG',
    'SwarmSaveAnimatedWebpWS',
    'SwarmSaveAnimationWS'
];

const INPUT_PREFIX = 'comfyrawworkflowinput';

/** Parameter ids that always stay in the panel, whether the workflow mentions them or not. */
export const ALWAYS_RETAIN = ['images', 'model', 'comfyuicustomworkflow'];

/** 1=a, 2=b, ... 26=aa, 27=ab. Ported verbatim from numberToLetters (src/wwwroot/js/util.js:748),
 *  fractional recursion included - the ids only have to be stable and unique, and changing the
 *  arithmetic would rename parameters inside workflows saved by the existing interface. */
function numberToLetters(id: number): string {
    if (id > 26) {
        const rem = id % 26;
        return numberToLetters(id / 26) + numberToLetters(rem);
    }
    return String.fromCharCode(id + 'a'.charCodeAt(0));
}

/** A name reduced to id form: lowercase letters only. Mirrors cleanParamName (params.js:1577). */
export function cleanParamName(name: string): string {
    return name.toLowerCase().replaceAll(/[^a-z]/g, '');
}

/** Escapes a literal so it survives being embedded in a `${id:literal}` placeholder. */
function escapeLiteral(value: unknown): string {
    return `${value}`.replaceAll('${', '(').replaceAll('}', ')');
}

function placeholder(id: string, value: unknown, numeric: boolean): string {
    const body = '${' + id + ':' + escapeLiteral(value) + '}';
    // Numeric inputs have to survive being written into a JSON number slot, so they carry a marker
    // the server strips along with the surrounding quotes.
    return numeric ? `%%_COMFYFIXME_${body}_ENDFIXME_%%` : body;
}

/** A link value in the API prompt: `[nodeId, outputSlot]`. */
function asLink(value: unknown): [string, number] | null {
    return Array.isArray(value) && value.length === 2 ? (value as [string, number]) : null;
}

export function buildComfyParams(options: BuildComfyParamsOptions): ComfyWorkflowInput {
    const { workflow, prompt, objectInfo, knownParamIds, allModels, resetBatchSizeToOne, requireSave } = options;

    const params: Record<string, ComfyParamDef> = {};
    const idsUsed: string[] = [];

    function freeIdFrom(start: number): number {
        let id = start;
        while (`${id}` in prompt) {
            id++;
        }
        return id;
    }

    function addSimpleParam(def: {
        name: string;
        defVal: unknown;
        type: string;
        groupName: string;
        values: string[] | null;
        view_type: string;
        min: number;
        max: number;
        step: number;
        inputId: string;
        groupId: string;
        priority: number;
        visible?: boolean;
        toggles?: boolean;
    }): void {
        let inputId = def.inputId;
        let counter = 0;
        while (inputId in params) {
            inputId = `${def.inputId}${numberToLetters(counter++)}`;
        }
        // 'primitives' is rendered ungrouped, at the top of the panel, so it carries no group.
        const group: ComfyParamGroupDef | null =
            def.groupId === 'primitives'
                ? null
                : {
                      name: def.groupName,
                      id: def.groupId,
                      open: false,
                      priority: def.priority,
                      advanced: true,
                      can_shrink: true,
                      toggles: false
                  };
        params[inputId] = {
            name: def.name,
            default: def.defVal,
            id: inputId,
            type: def.type,
            description: `The ${def.name} input for ${def.groupName} (${def.type})`,
            values: def.values,
            view_type: def.view_type,
            min: def.min,
            max: def.max,
            step: def.step,
            visible: def.visible ?? true,
            toggleable: def.toggles ?? true,
            priority: def.priority,
            advanced: false,
            feature_flag: null,
            do_not_save: false,
            no_popover: true,
            group
        };
    }

    // --- Pass 1: read the UI graph for the things the API prompt does not carry: node titles,
    // primitive nodes feeding shared values, and 'randomize' widget state.
    const labelAlterations: Record<string, string> = {};
    /** `targetNode.slotIndex` -> generated id of the primitive driving it. */
    const nodeStatics: Record<string, string> = {};
    const nodeIdToClean: Record<string, string> = {};
    const nodeStaticUnique: string[] = [];
    /** `nodeId.inputName` -> `nodeId.slotIndex`. */
    const nodeLabelPaths: Record<string, string> = {};
    const nodeIsRandomize: Record<string, boolean> = {};
    const claimedByPrimitives: string[] = [];
    /** SwarmInput nodes mean the workflow author declared its own inputs, so nothing is claimed. */
    let doAutoClaim = true;

    for (const node of workflow.nodes ?? []) {
        if (node.title) {
            labelAlterations[`${node.id}`] = node.title;
        }
        // This is weird edge case hacking. There's a lot of weird values this key can hold.
        const widgets = node.widgets_values;
        if (widgets && typeof (widgets as { includes?: unknown }).includes === 'function'
            && (widgets as unknown[]).includes('randomize')) {
            nodeIsRandomize[`${node.id}`] = true;
        }
        if (node.type?.startsWith('SwarmInput')) {
            doAutoClaim = false;
        }
        if (node.type === 'PrimitiveNode' && node.title) {
            const colon = node.title.indexOf(':');
            if (colon > 0 && node.title.substring(0, colon).trim().toLowerCase() === 'swarmui') {
                claimedByPrimitives.push(cleanParamName(node.title.substring(colon + 1)));
            }
            const cleaned = INPUT_PREFIX + cleanParamName(node.title);
            let id = cleaned;
            let x = 0;
            while (nodeStaticUnique.includes(node.title)) {
                id = `${cleaned}${numberToLetters(x++)}`;
            }
            nodeStaticUnique.push(id);
            for (const link of workflow.links ?? []) {
                if (link[1] === node.id) {
                    nodeStatics[`${link[3]}.${link[4]}`] = id;
                    nodeIdToClean[id] = node.title;
                }
            }
        }
    }
    for (const node of workflow.nodes ?? []) {
        if (node.inputs) {
            let x = 0;
            for (const input of node.inputs) {
                nodeLabelPaths[`${node.id}.${input.name}`] = `${node.id}.${x++}`;
                if (`${node.id}` in labelAlterations) {
                    labelAlterations[`${node.id}.${input.name}`] = labelAlterations[`${node.id}`];
                }
            }
        }
    }

    // --- Pass 2: find the output node, and switch it to Swarm's websocket-streaming variant so
    // the image comes back to us rather than landing in Comfy's own output folder.
    let hasSaves = false;
    let saveNodeId: string | null = null;
    let previewNodes: string[] = [];
    for (const nodeId of Object.keys(prompt)) {
        const node = prompt[nodeId];
        if (node.class_type === 'PreviewImage') {
            previewNodes.push(nodeId);
            continue;
        }
        if (node.class_type === 'SaveImage') {
            if ('SwarmSaveImageWS' in objectInfo && requireSave) {
                node.class_type = 'SwarmSaveImageWS';
                delete node.inputs.filename_prefix;
            }
            saveNodeId = nodeId;
            hasSaves = true;
        }
        else if (node.class_type === 'SwarmSaveImageWS' || ALT_SAVE_NODES.includes(node.class_type)) {
            saveNodeId = nodeId;
            hasSaves = true;
        }
        for (const [inputId, val] of Object.entries(node.inputs ?? {})) {
            const link = asLink(val);
            if (link && link[1] === 0) {
                if (inputId === 'negative') {
                    labelAlterations[link[0]] = 'Negative Prompt';
                }
                else if (inputId === 'positive') {
                    labelAlterations[link[0]] = 'Positive Prompt';
                }
            }
        }
    }
    if (!hasSaves && previewNodes.length > 0 && requireSave) {
        prompt[previewNodes[0]].class_type = 'SwarmSaveImageWS';
        saveNodeId = previewNodes[0];
        hasSaves = true;
        previewNodes = previewNodes.slice(1);
    }
    if (hasSaves && saveNodeId !== null && parseInt(saveNodeId) < 200 && requireSave) {
        // Swarm's own node ids start low; move the output well clear of them.
        const newSaveId = freeIdFrom(200);
        prompt[newSaveId] = prompt[saveNodeId];
        delete prompt[saveNodeId];
    }
    for (const preview of previewNodes) {
        delete prompt[preview];
    }
    // Special case: propagate label alterations to conditioning nodes, for ReVision workflows.
    for (let hasFixes = true; hasFixes; ) {
        hasFixes = false;
        for (const nodeId of Object.keys(prompt)) {
            const node = prompt[nodeId];
            if (node.class_type !== 'unCLIPConditioning' || !labelAlterations[nodeId]) {
                continue;
            }
            const link = asLink(node.inputs.conditioning);
            if (link && !labelAlterations[link[0]]) {
                labelAlterations[link[0]] = labelAlterations[nodeId];
                hasFixes = true;
            }
        }
    }
    if (!hasSaves && requireSave) {
        throw new ComfyWorkflowError('no-save-node');
    }

    const retained = [...ALWAYS_RETAIN];
    const paramVal: Record<string, string | number | boolean> = {};
    const groups: string[] = [];

    /** The node input, if any, fed by output slot `pos` of node `target`. */
    function findConnection(target: string, pos: number): [string, string] | [null, null] {
        for (const nodeId of Object.keys(prompt)) {
            for (const [inputId, val] of Object.entries(prompt[nodeId].inputs ?? {})) {
                const link = asLink(val);
                if (link && link[0] === target && link[1] === pos) {
                    return [nodeId, inputId];
                }
            }
        }
        return [null, null];
    }

    // --- Pass 3: the main event. Walk every node and convert its literal inputs.
    for (const nodeId of Object.keys(prompt)) {
        const node = prompt[nodeId];
        const groupLabel = `${labelAlterations[nodeId] || node.class_type} (Node ${nodeId})`;
        let groupId = cleanParamName(labelAlterations[nodeId] || node.class_type);
        if (groups.includes(groupId)) {
            groupId = `${groupId}${numberToLetters(parseInt(nodeId))}`;
        }
        groups.push(groupId);
        // Float the groups people actually reach for to the top of the panel.
        let priority = 0;
        if (groupLabel.includes('Prompt')) {
            priority = -10;
        }
        else if (groupLabel.includes('EmptyLatent')) {
            priority = -7;
        }
        else if (groupLabel.includes('KSampler')) {
            priority = -5;
        }

        // A workflow that declares its own inputs contributes only those: the remaining literals on
        // a SwarmInput node (its title, range, description) are the declaration, not parameters.
        if (node.class_type.startsWith('SwarmInput')) {
            if (node.class_type !== 'SwarmInputGroup') {
                addDeclaredInput(nodeId, node);
            }
            continue;
        }

        function injectType(id: string, type: string): string {
            // The server reads the datatype back out of the id (DynamicParamGenerator, :233).
            return id.startsWith(INPUT_PREFIX) ? INPUT_PREFIX + type + id.substring(INPUT_PREFIX.length) : id;
        }

        function uniqueId(id: string): string {
            let result = id;
            let count = 0;
            while (idsUsed.includes(result)) {
                count++;
                result = `${id}${numberToLetters(count)}`;
            }
            return result;
        }

        /** Converts one literal node input into a parameter, and rewrites the input to match.
         *  Returns the parameter id it settled on. */
        function addParam(
            inputId: string,
            inputIdDirect: string,
            inputLabel: string,
            val: unknown,
            paramGroupId: string,
            paramGroupLabel: string,
            forceUniqueId: boolean
        ): string {
            const required = objectInfo[node.class_type]?.input?.required;
            const paramDataRaw = required && inputId in required ? required[inputId] : undefined;
            const spec = (paramDataRaw?.[1] ?? {}) as { min?: number; max?: number; step?: number };
            let type: string;
            let values: string[] | null = null;
            let min = -9999999999;
            let max = 9999999999;
            let view_type = 'normal';
            let step = 1;

            if (typeof val === 'number') {
                let numeric = val;
                let asSeed = false;
                if (['seed', 'noise_seed'].includes(inputId)) {
                    type = 'integer';
                    view_type = 'seed';
                    asSeed = true;
                    if (nodeId in nodeIsRandomize || numeric < 0) {
                        numeric = -1;
                    }
                    else if (numeric > max) {
                        numeric = parseInt(`${numeric}`.substring(0, `${max}`.length - 1));
                    }
                }
                else if (['width', 'height'].includes(inputId)) {
                    type = 'integer';
                    view_type = 'pot_slider';
                    min = 128;
                    max = 8192;
                    step = 64;
                }
                else if (inputId === 'denoise') {
                    type = 'decimal';
                    min = 0;
                    max = 1;
                    step = 0.05;
                    view_type = 'slider';
                }
                else if (inputId === 'cfg') {
                    type = 'decimal';
                    min = 1;
                    max = 50;
                    step = 0.5;
                }
                else if (['steps', 'start_at_step', 'end_at_step'].includes(inputId)) {
                    type = 'integer';
                    min = 0;
                    max = 10000;
                    step = 1;
                }
                else if (paramDataRaw?.[0] === 'INT' && paramDataRaw.length === 2) {
                    type = 'integer';
                    view_type = 'big';
                    min = spec.min ?? min;
                    max = spec.max ?? max;
                    step = spec.step ?? 1;
                    if (inputId === 'batch_size' && resetBatchSizeToOne && !claimedByPrimitives.includes('batchsize')) {
                        numeric = 1;
                    }
                }
                else if (paramDataRaw?.[0] === 'FLOAT' && paramDataRaw.length === 2) {
                    type = 'decimal';
                    view_type = 'slider';
                    min = spec.min ?? min;
                    max = spec.max ?? max;
                    step = spec.step ?? (max - min) * 0.01;
                }
                else {
                    type = 'decimal';
                }
                let finalId = injectType(inputIdDirect, asSeed ? 'seed' : type);
                if (forceUniqueId) {
                    finalId = uniqueId(finalId);
                }
                node.inputs[inputId] = placeholder(finalId + (asSeed ? '+seed' : ''), numeric, true);
                register(finalId, numeric);
                return finalId;
            }

            if (typeof val === 'string') {
                if (doAutoClaim && node.class_type === 'SaveImage' && inputId === 'filename_prefix') {
                    node.inputs[inputId] = '${prefix:}';
                    return inputIdDirect;
                }
                if (doAutoClaim && node.class_type === 'CheckpointLoaderSimple' && inputId === 'ckpt_name') {
                    if (!('model' in paramVal) && !claimedByPrimitives.includes('model')) {
                        node.inputs[inputId] = placeholder('model', val, false);
                        const clean = val.endsWith('.safetensors')
                            ? val.substring(0, val.length - '.safetensors'.length)
                            : val;
                        paramVal.model = clean.replaceAll('\\', '/');
                        return inputIdDirect;
                    }
                    type = 'model';
                    values = allModels;
                }
                else if (node.class_type === 'SwarmLoadImageB64') {
                    type = 'image';
                }
                else if (paramDataRaw && paramDataRaw.length === 1 && Array.isArray(paramDataRaw[0])
                    && paramDataRaw[0].length > 1) {
                    type = 'dropdown';
                    // Combo entries are occasionally `[value, ...]` tuples rather than bare strings.
                    values = paramDataRaw[0].map(entry => `${Array.isArray(entry) ? entry[0] : entry}`);
                }
                else {
                    view_type = 'prompt';
                    type = 'text';
                }
                let finalId = injectType(inputIdDirect, type);
                if (forceUniqueId) {
                    finalId = uniqueId(finalId);
                }
                node.inputs[inputId] = placeholder(finalId, val, false);
                register(finalId, val);
                return finalId;
            }

            return inputIdDirect;

            function register(finalId: string, defVal: unknown): void {
                if (idsUsed.includes(finalId)) {
                    return;
                }
                idsUsed.push(finalId);
                addSimpleParam({
                    name: inputLabel,
                    defVal,
                    type,
                    groupName: paramGroupLabel,
                    values,
                    view_type,
                    min,
                    max,
                    step,
                    inputId: finalId,
                    groupId: paramGroupId,
                    priority: paramGroupId === 'primitives' ? -200 : priority
                });
            }
        }

        /** Hands one node input to a real Swarm parameter, so the normal control drives it.
         *  Returns true when it claimed the parameter for the first time. */
        function claimOnce(classType: string, paramName: string, fieldName: string, numeric: boolean): boolean {
            if (claimedByPrimitives.includes(cleanParamName(paramName)) || node.class_type !== classType) {
                return false;
            }
            let val = node.inputs[fieldName];
            if (typeof val !== (numeric ? 'number' : 'string')) {
                return false;
            }
            if (paramName === 'seed' && nodeId in nodeIsRandomize) {
                val = -1;
            }
            const redirId = nodeStatics[nodeLabelPaths[`${nodeId}.${fieldName}`]];
            const paramNameClean = cleanParamName(paramName);
            let actualId = paramName;
            let claimed = false;
            if (redirId) {
                // A primitive node feeds this input, so the primitive's title names the parameter.
                const title = nodeIdToClean[redirId] || redirId.substring(INPUT_PREFIX.length);
                const colon = title.indexOf(':');
                if (colon > 0 && cleanParamName(title.substring(0, colon)) === 'swarmui') {
                    const reuseParam = cleanParamName(title.substring(colon + 1));
                    if (knownParamIds.has(reuseParam)) {
                        if (!retained.includes(reuseParam)) {
                            retained.push(reuseParam);
                            paramVal[reuseParam] = val as string | number;
                        }
                        node.inputs[fieldName] = placeholder(reuseParam, val, numeric);
                        return true;
                    }
                }
                actualId = addParam(fieldName, redirId, title, val, 'primitives', 'Primitives', false);
            }
            else if (retained.includes(paramNameClean)) {
                return false;
            }
            else {
                retained.push(paramNameClean);
                paramVal[paramNameClean] = val as string | number;
                actualId = paramNameClean;
                claimed = true;
            }
            node.inputs[fieldName] = placeholder(actualId, val, numeric);
            return claimed;
        }

        claimOnce('SwarmLoraLoader', 'loras', 'lora_names', false);
        claimOnce('SwarmLoraLoader', 'loraweights', 'lora_weights', false);
        if (doAutoClaim) {
            if (claimOnce('EmptyLatentImage', 'width', 'width', true)
                && claimOnce('EmptyLatentImage', 'height', 'height', true)
                && claimOnce('EmptyLatentImage', 'batchsize', 'batch_size', true)) {
                retained.push('aspectratio', 'sidelength');
                paramVal.aspectratio = 'Custom';
                continue;
            }
            claimOnce('KSampler', 'seed', 'seed', true);
            claimOnce('KSampler', 'steps', 'steps', true);
            claimOnce('KSampler', 'sampler', 'sampler_name', false);
            claimOnce('KSampler', 'scheduler', 'scheduler', false);
            claimOnce('KSampler', 'cfg_scale', 'cfg', true);
            claimOnce('KSamplerAdvanced', 'seed', 'noise_seed', true);
            claimOnce('KSamplerAdvanced', 'steps', 'steps', true);
            claimOnce('KSamplerAdvanced', 'sampler', 'sampler_name', false);
            claimOnce('KSamplerAdvanced', 'scheduler', 'scheduler', false);
            claimOnce('KSamplerAdvanced', 'cfg_scale', 'cfg', true);
            claimOnce('SwarmLoadImageB64', 'init_image', 'image_base64', false);
            claimOnce('LoadImage', 'initimage', 'image', false);
            if (node.class_type === 'CLIPTextEncode' && typeof node.inputs.text === 'string') {
                if (groupLabel.startsWith('Positive Prompt') && !retained.includes('prompt')) {
                    retained.push('prompt');
                    paramVal.prompt = node.inputs.text;
                    node.inputs.text = '${prompt}';
                    continue;
                }
                if (groupLabel.startsWith('Negative Prompt') && !retained.includes('negativeprompt')) {
                    retained.push('negativeprompt');
                    paramVal.negativeprompt = node.inputs.text;
                    node.inputs.text = '${negativeprompt}';
                    continue;
                }
            }
        }

        for (const inputId of Object.keys(node.inputs ?? {})) {
            if (inputId === 'choose file to upload' || inputId === 'image_upload') {
                continue;
            }
            const val = node.inputs[inputId];
            if (`${val}`.startsWith('${') || `${val}`.startsWith('%%_COMFYFIXME_${')) {
                continue;
            }
            if (['KSampler', 'KSamplerAdvanced'].includes(node.class_type) && inputId === 'control_after_generate') {
                continue;
            }
            const redirId = nodeStatics[nodeLabelPaths[`${nodeId}.${inputId}`]];
            if (redirId) {
                const title = nodeIdToClean[redirId] || redirId.substring(INPUT_PREFIX.length);
                const colon = title.indexOf(':');
                if (colon > 0 && cleanParamName(title.substring(0, colon)) === 'swarmui') {
                    const reuseParam = cleanParamName(title.substring(colon + 1));
                    if (knownParamIds.has(reuseParam)) {
                        if (!retained.includes(reuseParam)) {
                            retained.push(reuseParam);
                            paramVal[reuseParam] = val as string | number;
                        }
                        node.inputs[inputId] = placeholder(reuseParam, val, typeof val !== 'string');
                        continue;
                    }
                }
                addParam(inputId, redirId, title, val, 'primitives', 'Primitives', false);
            }
            else {
                const inputLabel = labelAlterations[`${nodeId}.${inputId}`] || inputId;
                const inputIdDirect = cleanParamName(
                    `${INPUT_PREFIX}${groupLabel}${inputId}${numberToLetters(parseInt(nodeId))}`
                );
                addParam(inputId, inputIdDirect, inputLabel, val, groupId, groupLabel, true);
            }
        }
    }

    // The metadata parameter has to describe the parameter set without describing itself, so it is
    // snapshotted before either of the two carrier parameters joins the set.
    params.comfyworkflowparammetadata = carrierParam('comfyworkflowparammetadata', JSON.stringify(params));
    params.comfyworkflowraw = carrierParam('comfyworkflowraw', JSON.stringify(prompt));

    if (retained.includes('width') && retained.includes('height')
        && (!retained.includes('aspectratio') || !retained.includes('sidelength'))) {
        retained.push('aspectratio', 'sidelength');
        paramVal.aspectratio = 'Custom';
    }

    return { params, retained, paramVal };

    /** A `SwarmInput*` node: the workflow author declared this parameter explicitly, so its type,
     *  label, range and group all come straight off the node. */
    function addDeclaredInput(nodeId: string, node: ComfyPromptNode): void {
        const inputs = node.inputs as Record<string, never> & {
            value: string | number | boolean;
            title: string;
            description: string;
            subtype?: string;
            values?: string;
            view_type?: string;
            min?: number;
            max?: number;
            view_max?: number;
            step?: number;
            order_priority?: number;
            is_advanced?: boolean;
            auto_resize?: boolean;
            raw_id?: string;
            group?: [string, number];
        };
        let type = '';
        let subtype: string | null = null;
        let defaultVal: unknown = inputs.value;
        let values: string[] | null = null;
        // Non-text types travel through JSON number/bool slots, so they need the fixme marker.
        let doFixMe = false;
        switch (node.class_type) {
            case 'SwarmInputInteger': type = 'integer'; doFixMe = true; break;
            case 'SwarmInputFloat': type = 'decimal'; doFixMe = true; break;
            case 'SwarmInputText': type = 'text'; break;
            case 'SwarmInputModelName':
                type = 'model';
                subtype = inputs.subtype ?? null;
                defaultVal = `${defaultVal}`.replaceAll('\\', '/').replaceAll('.safetensors', '');
                break;
            case 'SwarmInputCheckpoint':
                type = 'model';
                subtype = 'Stable-Diffusion';
                defaultVal = `${defaultVal}`.replaceAll('\\', '/').replaceAll('.safetensors', '');
                break;
            case 'SwarmInputDropdown':
                type = 'dropdown';
                values = `${inputs.values ?? ''}`.split(',').map(s => s.trim());
                if (values.length <= 1) {
                    // A single entry means the author left the list to whatever consumes it.
                    const [remoteNodeId, remoteInput] = findConnection(nodeId, 1);
                    const remoteClass = remoteNodeId ? prompt[remoteNodeId].class_type : null;
                    const data = remoteClass ? objectInfo[remoteClass]?.input : null;
                    if (data && remoteInput) {
                        const spec = data.required?.[remoteInput] ?? data.optional?.[remoteInput];
                        if (spec) {
                            const combo = spec.length > 1 && spec[0] === 'COMBO'
                                ? (spec[1] as { options?: unknown[] }).options
                                : spec[0];
                            if (Array.isArray(combo)) {
                                values = combo.map(entry => `${entry}`);
                            }
                        }
                    }
                }
                break;
            case 'SwarmInputBoolean': type = 'boolean'; doFixMe = true; break;
            case 'SwarmInputImage': type = 'image'; break;
            case 'SwarmInputAudio': type = 'audio'; break;
            case 'SwarmInputVideo': type = 'video'; break;
            default: throw new Error(`Unknown SwarmInput type ${node.class_type}`);
        }
        const inputIdDirect = inputs.raw_id || cleanParamName(inputs.title);
        let inputId = inputIdDirect;
        let counter = 0;
        while (inputId in params) {
            inputId = `${inputIdDirect}${numberToLetters(counter++)}`;
        }
        let group: ComfyParamGroupDef = {
            name: 'Ungrouped', id: 'ungrouped', open: true, priority: 0,
            advanced: false, toggles: false, can_shrink: false
        };
        if (inputs.group) {
            const groupInputs = prompt[inputs.group[0]].inputs as {
                title: string; open_by_default: boolean; order_priority: number;
                is_advanced: boolean; can_shrink: boolean;
            };
            group = {
                name: groupInputs.title,
                id: cleanParamName(groupInputs.title),
                open: groupInputs.open_by_default,
                priority: groupInputs.order_priority,
                advanced: groupInputs.is_advanced,
                can_shrink: groupInputs.can_shrink,
                toggles: false
            };
        }
        params[inputId] = {
            name: inputs.title,
            id: inputId,
            type,
            subtype,
            description: inputs.description,
            default: defaultVal,
            values,
            view_type: inputs.view_type,
            min: inputs.min || 0,
            max: inputs.max || 0,
            view_max: inputs.view_max || 0,
            step: inputs.step || 0,
            visible: true,
            toggleable: false,
            priority: inputs.order_priority ?? 0,
            advanced: inputs.is_advanced ?? false,
            feature_flag: null,
            do_not_save: false,
            no_popover: (inputs.description ?? '').length === 0,
            group
        };
        if (node.class_type === 'SwarmInputImage') {
            params[inputId].image_should_resize = inputs.auto_resize;
            params[inputId].image_always_b64 = true;
        }
        node.inputs.value = placeholder(inputId, inputs.value, doFixMe);
    }
}
