/** Messages streamed by GenerateText2ImageWS.
 *  Documented inline at src/WebAPI/T2IAPI.cs:44-79. */

export interface GenProgressMessage {
    gen_progress: {
        batch_index: string;
        /** 0..1 through the overall workflow. */
        overall_percent: number;
        /** 0..1 within the current node. */
        current_percent: number;
        /** data: URL. Absent when the backend has no preview to offer. */
        preview?: string;
    };
}

export interface GenImageMessage {
    /** Path to GET (eg 'View/local/raw/...'), or occasionally an inline data: URL. */
    image: string;
    batch_index: string;
    /** Usually a stringified JSON blob, but not guaranteed. */
    metadata?: string | null;
    request_id?: string;
}

export interface GenDiscardMessage {
    discard_indices: number[];
}

export type GenMessage = Partial<GenProgressMessage & GenImageMessage & GenDiscardMessage>;

/** One slot in the batch rail. */
export interface BatchItem {
    /** Unique across runs: `batch_index` restarts at 0 for every run, so it alone cannot key a slot. */
    id: string;
    /** Which run produced this slot. */
    runId: number;
    batchIndex: string;
    status: 'pending' | 'running' | 'done' | 'discarded' | 'failed';
    /** Final image URL once done, or the latest preview while running. */
    src?: string;
    /** True while `src` is a preview rather than the finished image. */
    isPreview?: boolean;
    overallPercent?: number;
    currentPercent?: number;
    metadata?: string | null;
    error?: string;
}
