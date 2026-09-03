import { lazy, Suspense, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/api/hooks';
import { usePermission } from '@/api/permissions';
import { useGenerateStore } from '@/generate/store';
import { imageOutPrefix } from '@/library/types';

/** The editor and the frame-trimming it carries are a chunk of their own: most sessions never
 *  open a video, and the ones that do are already waiting on the video itself to load. */
const VideoEditor = lazy(() => import('./VideoEditor').then(module => ({ default: module.VideoEditor })));

export interface VideoEditing {
    /** False when this user may not run the editing routes, which are gated the same way
     *  generation is (T2IAPI.cs:32-33). */
    available: boolean;
    /** Opens the editor on a video. `src` is a loadable URL; `name` names the saved file. */
    edit: (src: string, name: string) => void;
    /** Render once, anywhere in the calling screen's tree. */
    dialog: ReactNode;
}

/** Opening the video editor from wherever a video is on screen.
 *
 * What the editor saves goes two places, as it does in the legacy UI (video_editor.js
 * addOutputToBatch): onto the batch rail, so the result is one click from being looked at, and
 * into the Library listings, which are otherwise still showing the folder as it was a moment ago.
 * Both happen whichever screen opened the editor - a video edited from the Library is still a
 * thing the user just made, and the rail is where the things you just made live. */
export function useVideoEditor(): VideoEditing {
    const [editing, setEditing] = useState<{ src: string; name: string } | null>(null);
    const available = usePermission('basic_image_generation');
    const session = useSession();
    const addResult = useGenerateStore(s => s.addResult);
    const queryClient = useQueryClient();

    const prefix = imageOutPrefix(session.data?.user_id, session.data?.output_append_user);

    return {
        available,
        edit: (src, name) => setEditing({ src, name }),
        dialog: editing && (
            <Suspense fallback={null}>
                <VideoEditor
                    src={editing.src}
                    name={editing.name}
                    onClose={() => setEditing(null)}
                    onSaved={path => {
                        // The routes answer with a path relative to the output directory; the rail
                        // holds view paths, the same fully-prefixed form the generation socket sends.
                        addResult(`${prefix}/${path}`);
                        void queryClient.invalidateQueries({ queryKey: ['images'] });
                    }}
                />
            </Suspense>
        )
    };
}
